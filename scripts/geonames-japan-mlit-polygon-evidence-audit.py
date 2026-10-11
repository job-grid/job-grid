#!/usr/bin/env python3
"""Read-only point-in-polygon evidence audit for Japan GeoNames name collisions.

Downloads historical MLIT N03 administrative-area boundary archives by resolving
their exact links from the official MLIT catalogue page. The audit reports
containment evidence only; it does not infer or create operational parent links.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

MLIT_HISTORIC_CATALOG = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_2.html"
EXPECTED_TARGET_IDS = {"1851030", "1851031", "1859673", "1865064", "1865066", "1865067"}
HISTORIC_SNAPSHOTS = [
    ("1965-10-01", "N03-651001"),
    ("1970-10-01", "N03-701001"),
    ("1975-10-01", "N03-751001"),
]
CONTEXT_SNAPSHOT = ("1995-10-01", "N03-951001")
CANDIDATE_PREFECTURES_FOR_HISTORIC_SNAPSHOTS = {"06", "08", "15", "20", "21", "45"}
MAX_WORKERS = 5
USER_AGENT = "Job-Grid-Geography-PointInPolygon-Audit/1.0"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1]


def normalized_tag(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", local_name(value).lower())


def read_bytes(url: str, attempts: int = 3) -> tuple[bytes, dict]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {"nlftp.mlit.go.jp"}:
        raise ValueError(f"Refusing non-MLIT source URL: {url}")
    last_error = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                status = getattr(response, "status", 200)
                data = response.read()
                headers = {str(k).lower(): str(v) for k, v in response.headers.items()}
            if status != 200 or not data:
                raise RuntimeError(f"Unexpected MLIT response status/size: {status}/{len(data)} for {url}")
            return data, {"http_status": status, "headers": headers}
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep((attempt + 1) * 1.5)
    raise RuntimeError(f"Official MLIT retrieval failed for {url}: {last_error}") from last_error


class DownloadTableParser(HTMLParser):
    """Tie each filename to the direct link in its official catalogue row."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_row = False
        self.row_text = []
        self.row_links = []
        self.links_by_filename = {}

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        attrs = dict(attrs)
        if tag == "tr":
            self.in_row = True
            self.row_text = []
            self.row_links = []
        if self.in_row:
            for key in ("href", "data-href", "data-url", "data-download-url"):
                value = attrs.get(key)
                if value:
                    self.row_links.append(value)
            onclick = attrs.get("onclick", "")
            if onclick:
                for candidate in re.findall(r"""['"]([^'"]+\.zip(?:\?[^'"]*)?)['"]""", onclick, re.I):
                    self.row_links.append(candidate)

    def handle_data(self, data):
        if self.in_row:
            self.row_text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != "tr" or not self.in_row:
            return
        row_text = re.sub(r"\s+", " ", html.unescape(" ".join(self.row_text))).strip()
        filenames = re.findall(r"N03-[A-Za-z0-9]+_\d{2}_GML\.zip", row_text)
        for filename in filenames:
            urls = []
            for link in self.row_links:
                absolute = urllib.parse.urljoin(MLIT_HISTORIC_CATALOG, link)
                parsed = urllib.parse.urlparse(absolute)
                # The HTML page sometimes includes only a basename in a download
                # widget/onclick argument. urljoin() would turn that into a bogus
                # /ksj/gml/datalist/<archive>.zip URL, which returns 404. Never
                # treat that page-relative basename as a download link.
                explicit_download_path = (
                    parsed.path.startswith("/ksj/gml/data/")
                    or (
                        parsed.path.startswith("/ksj/gmlold/")
                        and "/codelist/" not in parsed.path.lower()
                        and "/datalist/" not in parsed.path.lower()
                    )
                )
                if (
                    parsed.scheme == "https"
                    and parsed.hostname == "nlftp.mlit.go.jp"
                    and parsed.path.rsplit("/", 1)[-1] == filename
                    and explicit_download_path
                ):
                    urls.append(absolute)
            # Do not guess a URL when the official row exposes only a filename.
            # An absent direct href is an explicit blocker, not a prompt to try
            # constructed directory layouts.
            unique_urls = list(dict.fromkeys(urls))
            if unique_urls:
                # Prefer the canonical data archive path when multiple explicit
                # official links are present in the same row.
                canonical = [url for url in unique_urls if "/ksj/gml/data/" in urllib.parse.urlparse(url).path]
                self.links_by_filename[filename] = (canonical or unique_urls)[0]
        self.in_row = False
        self.row_text = []
        self.row_links = []


def official_download_links(page_bytes: bytes) -> tuple[dict, dict]:
    parser = DownloadTableParser()
    parser.feed(page_bytes.decode("utf-8", errors="replace"))
    return parser.links_by_filename, {
        "parser": "HTMLParser: exact filename and download href from same official table row",
        "unique_historic_zip_links_resolved": len(parser.links_by_filename),
    }


def point_on_segment(point, start, end, epsilon=1e-9) -> bool:
    x, y = point
    x1, y1 = start
    x2, y2 = end
    cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
    if abs(cross) > epsilon:
        return False
    return (
        min(x1, x2) - epsilon <= x <= max(x1, x2) + epsilon
        and min(y1, y2) - epsilon <= y <= max(y1, y2) + epsilon
    )


def ring_location(point, ring) -> str:
    if len(ring) < 3:
        return "OUTSIDE"
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if point_on_segment(point, ring[j], ring[i]):
            return "BOUNDARY"
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-300) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return "INSIDE" if inside else "OUTSIDE"


def polygon_location(point, rings) -> str:
    if not rings:
        return "OUTSIDE"
    exterior = ring_location(point, rings[0])
    if exterior != "INSIDE":
        return exterior
    for hole in rings[1:]:
        where = ring_location(point, hole)
        if where == "BOUNDARY":
            return "BOUNDARY"
        if where == "INSIDE":
            return "OUTSIDE"
    return "INSIDE"


def geometry_location(point, geometry) -> str:
    if not geometry:
        return "OUTSIDE"
    kind = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if kind == "Polygon":
        return polygon_location(point, coords)
    if kind == "MultiPolygon":
        results = [polygon_location(point, polygon) for polygon in coords]
        if "INSIDE" in results:
            return "INSIDE"
        if "BOUNDARY" in results:
            return "BOUNDARY"
    return "OUTSIDE"


def coord_values(text: str) -> list[float]:
    return [float(value) for value in re.split(r"[\s,]+", text.strip()) if value]


def point_pairs(element, feature) -> list[tuple[float, float]]:
    tag = local_name(element.tag).lower()
    values = coord_values(" ".join(element.itertext()))
    if tag == "coordinates":
        # GML 2 coordinates tuples use x,y, which is longitude, latitude here.
        if len(values) % 2:
            raise ValueError("Malformed GML coordinates tuple list.")
        return [(values[i], values[i + 1]) for i in range(0, len(values), 2)]
    # MLIT N03 v2.2 specifies JGD2000 / (B, L): latitude, longitude.
    labels = ""
    for parent in [element, *list(element.iterancestors())] if hasattr(element, "iterancestors") else [element, feature]:
        labels += " " + " ".join(str(parent.attrib.get(key, "")) for key in ("axisLabels", "axisOrder"))
    labels = labels.lower()
    if "long lat" in labels or "lon lat" in labels:
        if len(values) % 2:
            raise ValueError("Malformed longitude/latitude GML position list.")
        return [(values[i], values[i + 1]) for i in range(0, len(values), 2)]
    if len(values) % 2:
        raise ValueError("Malformed latitude/longitude GML position list.")
    return [(values[i + 1], values[i]) for i in range(0, len(values), 2)]


def coordinate_sequence(container, feature) -> list[tuple[float, float]]:
    for element in container.iter():
        tag = local_name(element.tag).lower()
        if tag in {"poslist", "coordinates"}:
            pairs = point_pairs(element, feature)
            if len(pairs) >= 3:
                return pairs
        if tag == "pos":
            vals = coord_values(" ".join(element.itertext()))
            if len(vals) == 2:
                # GML pos obeys the MLIT axis convention unless explicitly labelled XY.
                labels = " ".join(str(element.attrib.get(key, "")) for key in ("axisLabels", "axisOrder")).lower()
                if "long lat" in labels or "lon lat" in labels:
                    return [(vals[0], vals[1])]
                return [(vals[1], vals[0])]
    return []


def extract_gml_geometry(feature) -> list[list[list[tuple[float, float]]]]:
    # Return a geometry list: each item is a polygon [exterior, hole, ...].
    all_nodes = list(feature.iter())
    patch_nodes = [node for node in all_nodes if local_name(node.tag).lower() == "polygonpatch"]
    polygon_nodes = [node for node in all_nodes if local_name(node.tag).lower() == "polygon"]
    geometries = patch_nodes if patch_nodes else polygon_nodes
    result = []
    for polygon in geometries:
        exteriors = []
        interiors = []
        for node in polygon.iter():
            tag = local_name(node.tag).lower()
            if tag not in {"exterior", "outerboundaryis", "interior", "innerboundaryis"}:
                continue
            ring = coordinate_sequence(node, feature)
            if ring:
                if tag in {"exterior", "outerboundaryis"}:
                    exteriors.append(ring)
                else:
                    interiors.append(ring)
        if not exteriors:
            # Some producers omit the explicit exterior wrapper but retain posList.
            ring = coordinate_sequence(polygon, feature)
            if ring:
                exteriors.append(ring)
        for exterior in exteriors:
            result.append([exterior, *interiors])
    return result


def field_values(feature) -> dict:
    wanted = {
        "n03001": "prefecture_name",
        "n03002": "branch_name",
        "n03003": "district_name",
        "n03004": "municipality_name",
        "n03007": "area_code",
    }
    result = {name: "" for name in wanted.values()}
    for element in feature.iter():
        key = normalized_tag(element.tag)
        if key in wanted:
            value = re.sub(r"\s+", " ", " ".join(element.itertext())).strip()
            if value and not result[wanted[key]]:
                result[wanted[key]] = value
    return result


def feature_record(feature, snapshot) -> dict | None:
    attrs = field_values(feature)
    polygons = extract_gml_geometry(feature)
    if not polygons:
        return None
    return {
        **attrs,
        "snapshot_date": snapshot["snapshot_date"],
        "prefecture_code": snapshot["prefecture_code"],
        "archive_filename": snapshot["archive_filename"],
        "polygons": polygons,
    }


def normalize_xml_bytes_for_expat(xml_bytes: bytes) -> bytes:
    """Convert declared legacy multibyte XML encodings to UTF-8 before Expat parsing.

    Python's bundled Expat may reject some multi-byte XML encoding labels (for
    example Shift_JIS / CP932) even though Python can decode them. The archive
    remains source-pinned and hashed as raw bytes; only a parser input copy is
    transcoded. A declared encoding is required for any non-UTF-8 conversion.
    """
    declaration = re.search(
        br"<\\?xml[^>]*\\bencoding\\s*=\\s*['\"]([^'\"]+)['\"]",
        xml_bytes[:2048],
        re.IGNORECASE,
    )
    if not declaration:
        # No declaration: leave the bytes untouched so malformed/ambiguous XML
        # fails closed in ElementTree instead of guessing an encoding.
        return xml_bytes
    try:
        encoding = declaration.group(1).decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise ValueError("XML declaration uses a non-ASCII encoding label.") from error
    normalized = encoding.lower().replace("_", "-")
    if normalized in {"utf-8", "utf8", "us-ascii", "ascii"}:
        return xml_bytes
    decoded = xml_bytes.decode(encoding, errors="strict")
    updated, count = re.subn(
        r"(?i)(<\\?xml[^>]*\\bencoding\\s*=\\s*['\"])[^'\"]+(['\"])",
        r"\\1UTF-8\\2",
        decoded,
        count=1,
    )
    if count != 1:
        raise ValueError(f"Could not safely rewrite declared XML encoding {encoding!r}.")
    return updated.encode("utf-8")


def parse_gml_archive(zip_bytes: bytes, snapshot: dict) -> tuple[list[dict], list[str]]:
    records = []
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        bad = archive.testzip()
        if bad:
            raise RuntimeError(f"Corrupt MLIT ZIP member {bad} in {snapshot['archive_filename']}")
        names = archive.namelist()
        gml_files = [
            name for name in names
            if name.lower().endswith((".gml", ".xml"))
            and not name.lower().endswith(("metadata.xml", "manifest.xml"))
        ]
        if gml_files:
            for member_name in gml_files:
                with archive.open(member_name) as stream:
                    raw_xml = stream.read()
                try:
                    parser_bytes = normalize_xml_bytes_for_expat(raw_xml)
                    for _event, node in ET.iterparse(io.BytesIO(parser_bytes), events=("end",)):
                        if local_name(node.tag).lower() not in {"featuremember", "featuremembers"}:
                            continue
                        if local_name(node.tag).lower() == "featuremembers":
                            children = list(node)
                        else:
                            children = list(node)[:1]
                        for feature in children:
                            record = feature_record(feature, snapshot)
                            if record:
                                records.append(record)
                        node.clear()
                except (LookupError, UnicodeError, ValueError, ET.ParseError) as error:
                    raise RuntimeError(
                        f"Could not parse official MLIT XML {snapshot['archive_filename']}/{member_name}: {error}"
                    ) from error
            return records, names
        # Some publisher packages may contain a Shape archive; support that format too.
        shp_files = [name for name in names if name.lower().endswith(".shp")]
        if not shp_files:
            raise RuntimeError(
                f"No GML/XML or SHP geometry member was found in {snapshot['archive_filename']}; members={names[:12]}"
            )
        try:
            import shapefile
        except ImportError as error:
            raise RuntimeError("pyshp is required to inspect an MLIT SHP package.") from error
        for shp_name in shp_files:
            stem = shp_name[:-4]
            by_ext = {Path(name).suffix.lower(): name for name in names if name.startswith(stem)}
            if not {".shp", ".shx", ".dbf"}.issubset(by_ext):
                raise RuntimeError(f"Incomplete SHP component set in {snapshot['archive_filename']}/{stem}")
            reader = shapefile.Reader(
                shp=io.BytesIO(archive.read(by_ext[".shp"])),
                shx=io.BytesIO(archive.read(by_ext[".shx"])),
                dbf=io.BytesIO(archive.read(by_ext[".dbf"])),
            )
            fields = [item[0] for item in reader.fields[1:]]
            for item in reader.iterShapeRecords():
                attrs_raw = dict(zip(fields, item.record))
                attrs = {}
                for field, out in [
                    ("N03_001", "prefecture_name"), ("N03_002", "branch_name"),
                    ("N03_003", "district_name"), ("N03_004", "municipality_name"),
                    ("N03_007", "area_code"),
                ]:
                    attrs[out] = str(attrs_raw.get(field, "") or "")
                geometry = item.shape.__geo_interface__
                coords = geometry.get("coordinates", [])
                if geometry.get("type") == "Polygon":
                    polygons = [coords]
                elif geometry.get("type") == "MultiPolygon":
                    polygons = list(coords)
                else:
                    continue
                records.append({
                    **attrs,
                    "snapshot_date": snapshot["snapshot_date"],
                    "prefecture_code": snapshot["prefecture_code"],
                    "archive_filename": snapshot["archive_filename"],
                    "polygons": polygons,
                })
    return records, names


def find_direct_links(page_bytes: bytes) -> tuple[dict[str, str], dict]:
    parser = DownloadTableParser()
    parser.feed(page_bytes.decode("utf-8", errors="replace"))
    return parser.links_by_filename, {
        "parser_description": "exact source filename and direct download link extracted from the same official MLIT catalogue table row",
        "catalog_rows_with_zip_links": len(parser.links_by_filename),
    }


def required_snapshots(candidate_prefectures: set[str]) -> list[dict]:
    required = []
    for date, prefix in HISTORIC_SNAPSHOTS:
        for prefecture in sorted(candidate_prefectures):
            required.append({
                "snapshot_date": date,
                "prefix": prefix,
                "prefecture_code": prefecture,
                "archive_filename": f"{prefix}_{prefecture}_GML.zip",
                "catalog_url": MLIT_HISTORIC_CATALOG,
            })
    for prefecture in [f"{n:02d}" for n in range(1, 48)]:
        required.append({
            "snapshot_date": CONTEXT_SNAPSHOT[0],
            "prefix": CONTEXT_SNAPSHOT[1],
            "prefecture_code": prefecture,
            "archive_filename": f"{CONTEXT_SNAPSHOT[1]}_{prefecture}_GML.zip",
            "catalog_url": MLIT_HISTORIC_CATALOG,
        })
    return required


def candidate_targets(audit: dict) -> list[dict]:
    rows = []
    for target in audit.get("target_results", []):
        if target.get("geonames_id") not in EXPECTED_TARGET_IDS:
            continue
        lat = float(target["source_latitude"])
        lon = float(target["source_longitude"])
        codes = sorted({
            str(candidate["area_code"]).zfill(5)
            for candidate in target.get("candidates", [])
            if re.fullmatch(r"\d{5}", str(candidate.get("area_code", "")))
        })
        rows.append({
            "geonames_id": str(target["geonames_id"]),
            "name": target["geonames_name"],
            "latitude": lat,
            "longitude": lon,
            "raw_admin1_code": target.get("raw_admin1_code", ""),
            "raw_admin2_code": target.get("raw_admin2_code", ""),
            "candidate_area_codes": codes,
        })
    ids = {row["geonames_id"] for row in rows}
    if ids != EXPECTED_TARGET_IDS:
        raise RuntimeError(f"Expected six identity-collision targets; found ids={sorted(ids)}")
    return sorted(rows, key=lambda row: int(row["geonames_id"]))


def perform_point_audit(audit_path: Path, output_prefix: Path) -> dict:
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    targets = candidate_targets(audit)
    candidate_prefectures = {
        code[:2]
        for target in targets
        for code in target["candidate_area_codes"]
    }
    if not candidate_prefectures or any(not re.fullmatch(r"\d{2}", code) for code in candidate_prefectures):
        raise RuntimeError("Could not derive a safe prefecture archive set from the candidate codes.")

    catalog_bytes, catalog_response = read_bytes(MLIT_HISTORIC_CATALOG)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    catalog_snapshot_path = output_prefix.parent / "mlit-n03-v2_2-download-index.html"
    catalog_snapshot_path.write_bytes(catalog_bytes)
    links, link_manifest = find_direct_links(catalog_bytes)
    required = required_snapshots(candidate_prefectures)
    missing = [item["archive_filename"] for item in required if item["archive_filename"] not in links]
    if missing:
        raise RuntimeError(
            "Official MLIT catalogue did not expose exact download links for required archives; "
            f"refusing to guess archive URLs. Missing={missing[:30]} (count={len(missing)})"
        )

    # Record source page and resolve the exact direct download URLs from its own table rows.
    source_manifest = {
        "catalog_url": MLIT_HISTORIC_CATALOG,
        "catalog_http_status": catalog_response["http_status"],
        "catalog_response_bytes": len(catalog_bytes),
        "catalog_response_sha256": sha256(catalog_bytes),
        "catalog_snapshot_artifact_path": str(catalog_snapshot_path),
        **link_manifest,
    }
    for item in required:
        item["download_url"] = urllib.parse.urljoin(MLIT_HISTORIC_CATALOG, links[item["archive_filename"]])
        if urllib.parse.urlparse(item["download_url"]).hostname != "nlftp.mlit.go.jp":
            raise RuntimeError(f"Resolved archive URL is not on official MLIT host: {item['download_url']}")

    # Parallel retrieval keeps the read-only audit within the CI job's time budget.
    def fetch_archive(item):
        content, response = read_bytes(item["download_url"])
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f"Corrupt ZIP member {bad} in {item['archive_filename']}")
            member_names = archive.namelist()
        return {**item, "archive_bytes": content, "http_status": response["http_status"],
                "http_last_modified_header": response["headers"].get("last-modified"),
                "etag": response["headers"].get("etag"),
                "archive_bytes_size": len(content), "archive_sha256": sha256(content),
                "zip_member_names": member_names}

    source_snapshots = []
    features_by_snapshot = []
    all_code_presence = set()
    archive_root = output_prefix.parent / "polygon-source-archives"
    archive_root.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for fetched in executor.map(fetch_archive, required):
            archive_path = archive_root / fetched["snapshot_date"] / fetched["archive_filename"]
            archive_path.parent.mkdir(parents=True, exist_ok=True)
            archive_path.write_bytes(fetched["archive_bytes"])
            snapshot_meta = {key: value for key, value in fetched.items() if key != "archive_bytes"}
            snapshot_meta["local_artifact_path"] = str(archive_path.relative_to(output_prefix.parent))
            features, member_names = parse_gml_archive(fetched["archive_bytes"], fetched)
            snapshot_meta["parsed_boundary_feature_count"] = len(features)
            snapshot_meta["source_member_names"] = member_names
            if len(features) == 0:
                raise RuntimeError(f"Zero boundary features parsed from official MLIT archive {fetched['archive_filename']}; failing closed.")
            source_snapshots.append(snapshot_meta)
            for feature in features:
                code = str(feature.get("area_code", "")).zfill(5) if feature.get("area_code") else ""
                if code:
                    all_code_presence.add((fetched["snapshot_date"], fetched["prefecture_code"], code))
                features_by_snapshot.append((fetched["snapshot_date"], fetched["prefecture_code"], feature))

    # Only use features from the target point's relevant official snapshot coverage:
    # all prefectures in 1995; candidate prefectures for 1965/1970/1975.
    snapshot_records = []
    target_observations = {target["geonames_id"]: [] for target in targets}
    candidate_stats = {}
    target_by_id = {target["geonames_id"]: target for target in targets}
    codes_by_target = {
        target["geonames_id"]: set(target["candidate_area_codes"])
        for target in targets
    }
    for date, pref, feature in features_by_snapshot:
        code = str(feature.get("area_code", "")).zfill(5) if feature.get("area_code") else ""
        poly_hit_targets = []
        for target in targets:
            point = (target["longitude"], target["latitude"])
            locations = [geometry_location(point, {"type": "Polygon", "coordinates": polygon})
                         for polygon in feature.get("polygons", [])]
            if "INSIDE" in locations:
                location = "INSIDE"
            elif "BOUNDARY" in locations:
                location = "BOUNDARY"
            else:
                continue
            observation = {
                "snapshot_date": date,
                "snapshot_prefecture_code": pref,
                "containing_area_code": code,
                "containing_prefecture_name": feature.get("prefecture_name", ""),
                "containing_district_name": feature.get("district_name", ""),
                "containing_municipality_name": feature.get("municipality_name", ""),
                "point_relation": location,
                "candidate_code_match": code in codes_by_target[target["geonames_id"]],
                "archive_filename": feature.get("archive_filename", ""),
            }
            target_observations[target["geonames_id"]].append(observation)
            if observation["candidate_code_match"]:
                poly_hit_targets.append(target["geonames_id"])
        # For each source candidate code, track source presence and point-in-polygon match.
        for target in targets:
            for candidate_code in codes_by_target[target["geonames_id"]]:
                key = (target["geonames_id"], candidate_code)
                stats = candidate_stats.setdefault(key, {
                    "candidate_code": candidate_code,
                    "geonames_id": target["geonames_id"],
                    "geonames_name": target["name"],
                    "geonames_latitude": target["latitude"],
                    "geonames_longitude": target["longitude"],
                    "source_snapshots_with_candidate_code": [],
                    "point_inside_candidate_polygon_snapshots": [],
                })
                if code == candidate_code:
                    present_key = (date, pref, candidate_code)
                    # Unique list, regardless of multiple islands/multipart features.
                    if present_key in all_code_presence and date not in stats["source_snapshots_with_candidate_code"]:
                        stats["source_snapshots_with_candidate_code"].append(date)
                    if target["geonames_id"] in poly_hit_targets and date not in stats["point_inside_candidate_polygon_snapshots"]:
                        stats["point_inside_candidate_polygon_snapshots"].append(date)

    # Count code presence separately using the snapshot/prefecture key.
    for stats in candidate_stats.values():
        code = stats["candidate_code"]
        target_id = stats["geonames_id"]
        prefecture = code[:2]
        stats["source_snapshots_with_candidate_code"] = sorted({
            date for date, pref, candidate in all_code_presence
            if candidate == code and date in {"1965-10-01", "1970-10-01", "1975-10-01", "1995-10-01"}
        })
        stats["point_inside_candidate_polygon_snapshots"] = sorted(set(stats["point_inside_candidate_polygon_snapshots"]))
        stats["disposition"] = (
            "SPATIAL_CANDIDATE_POINT_INSIDE_POLYGON_IN_SELECTED_SNAPSHOT_REQUIRES_ENTITY_AND_DATE_REVIEW"
            if stats["point_inside_candidate_polygon_snapshots"]
            else "NO_POINT_INSIDE_CANDIDATE_POLYGON_OBSERVED_IN_SELECTED_SNAPSHOTS"
        )
        stats["operational_parent_link_created"] = False

    # Coalesce observations from multiple islands/overlapping rows but retain all feature records.
    for target in targets:
        target_observations[target["geonames_id"]].sort(
            key=lambda row: (row["snapshot_date"], row["containing_area_code"], row["containing_municipality_name"])
        )
    result = {
        "report_version": 1,
        "status": "PASS_OFFICIAL_MLIT_HISTORICAL_BOUNDARY_RETRIEVAL_AND_POINT_TEST; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target_count": len(targets),
        "target_ids": sorted(target_by_id, key=int),
        "candidate_codes_tested": len(candidate_stats),
        "source_catalog": source_manifest,
        "source_snapshots": source_snapshots,
        "source_snapshot_archive_count": len(source_snapshots),
        "target_observations": [
            {**target, "polygon_observations": target_observations[target["geonames_id"]]}
            for target in targets
        ],
        "candidate_results": sorted(candidate_stats.values(), key=lambda row: (int(row["geonames_id"]), row["candidate_code"])),
        "operational_parent_links_created": 0,
        "limitations": [
            "The audit runs point-in-polygon against official historical municipality boundary geometries; these are geographic evidence, not a GeoNames entity crosswalk.",
            "GeoNames points may represent feature reference points rather than polygon centroids; absence of containment in selected historical snapshots does not automatically invalidate a named candidate.",
            "The 1995 nationwide prefecture set provides broad point context; 1965/1970/1975 archives are restricted to candidate-code prefectures.",
            "Boundary-datum and axis handling follow the MLIT v2.2 metadata (JGD2000 / latitude-longitude); any boundary or CRS issue must remain unresolved rather than inferred.",
            "No operational parent links are created; no raw admin codes are changed.",
        ],
    }
    prefix = output_prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    (prefix.with_suffix(".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    flat_rows = []
    for target in result["target_observations"]:
        for obs in target["polygon_observations"]:
            flat_rows.append({
                "geonames_id": target["geonames_id"],
                "geonames_name": target["name"],
                "geonames_latitude": target["latitude"],
                "geonames_longitude": target["longitude"],
                "raw_admin1_code": target["raw_admin1_code"],
                "raw_admin2_code": target["raw_admin2_code"],
                **obs,
                "operational_parent_link_created": "false",
            })
    import csv
    with prefix.with_suffix(".csv").open("w", newline="", encoding="utf-8") as stream:
        fields = [
            "geonames_id", "geonames_name", "geonames_latitude", "geonames_longitude",
            "raw_admin1_code", "raw_admin2_code", "snapshot_date", "snapshot_prefecture_code",
            "containing_area_code", "containing_prefecture_name", "containing_district_name",
            "containing_municipality_name", "point_relation", "candidate_code_match",
            "archive_filename", "operational_parent_link_created",
        ]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(flat_rows)
    with prefix.with_suffix(".candidate-results.csv").open("w", newline="", encoding="utf-8") as stream:
        fields = [
            "geonames_id", "geonames_name", "geonames_latitude", "geonames_longitude",
            "candidate_code", "source_snapshots_with_candidate_code",
            "point_inside_candidate_polygon_snapshots", "disposition", "operational_parent_link_created",
        ]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in result["candidate_results"]:
            writer.writerow({
                **{k: row[k] for k in ("geonames_id", "geonames_name", "geonames_latitude", "geonames_longitude",
                                          "candidate_code", "disposition", "operational_parent_link_created")},
                "source_snapshots_with_candidate_code": ";".join(row["source_snapshots_with_candidate_code"]),
                "point_inside_candidate_polygon_snapshots": ";".join(row["point_inside_candidate_polygon_snapshots"]),
            })
    (prefix.with_suffix(".manifest.json")).write_text(json.dumps({
        "status": result["status"],
        "generated_at_utc": result["generated_at_utc"],
        "catalog_snapshot": source_manifest,
        "source_snapshots": source_snapshots,
        "source_snapshot_archive_count": len(source_snapshots),
        "source_archive_hashes": [
            {"snapshot_date": item["snapshot_date"], "prefecture_code": item["prefecture_code"],
             "archive_filename": item["archive_filename"], "download_url": item["download_url"],
             "archive_sha256": item["archive_sha256"], "archive_bytes_size": item["archive_bytes_size"]}
            for item in source_snapshots
        ],
        "operational_parent_links_created": 0,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "target_count": result["target_count"],
        "candidate_codes_tested": result["candidate_codes_tested"],
        "source_snapshot_archive_count": result["source_snapshot_archive_count"],
        "target_rows_with_polygon_observations": sum(bool(t["polygon_observations"]) for t in result["target_observations"]),
        "candidate_codes_with_point_inside_candidate_polygon": sum(bool(c["point_inside_candidate_polygon_snapshots"]) for c in result["candidate_results"]),
        "operational_parent_links_created": 0,
        "source_snapshot_archives": len(result["source_snapshots"]),
    }, ensure_ascii=False, indent=2))
    return result


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2:
        sys.stderr.write("Usage: geonames-japan-mlit-polygon-evidence-audit.py <japan-estat-evidence-audit.json> <output-prefix>\n")
        return 2
    try:
        perform_point_audit(Path(argv[0]), Path(argv[1]))
    except Exception as error:
        sys.stderr.write(f"MLIT polygon evidence audit failed closed: {type(error).__name__}: {error}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
