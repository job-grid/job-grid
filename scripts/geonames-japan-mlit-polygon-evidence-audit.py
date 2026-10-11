#!/usr/bin/env python3
"""Read-only point-in-polygon evidence audit for Japan GeoNames name collisions.

Downloads historical MLIT N03 administrative-area boundary archives by resolving
their exact links from the official MLIT catalogue page. The audit reports
containment evidence only; it does not infer or create operational parent links.
"""
from __future__ import annotations

import concurrent.futures
import codecs
import hashlib
from collections import Counter
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


def binding_value(binding: dict, key: str) -> str:
    """Read SPARQL JSON bindings case-insensitively; absent optional labels are blank."""
    entry = next(
        (value for name, value in (binding or {}).items() if str(name).lower() == key.lower()),
        {},
    )
    return str(entry.get("value", "") or "")


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
        br"<\?xml[^>]*\bencoding\s*=\s*['\"]([^'\"]+)['\"]",
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
        r"(?i)(<\?xml[^>]*\bencoding\s*=\s*['\"])[^'\"]+(['\"])",
        r"\1UTF-8\2",
        decoded,
        count=1,
    )
    if count != 1:
        raise ValueError(f"Could not safely rewrite declared XML encoding {encoding!r}.")
    return updated.encode("utf-8")


def archive_structure_diagnostic(zip_bytes: bytes) -> dict:
    """Provide bounded structural diagnostics when an archive yields no features."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        names = archive.namelist()
        xml_members = [
            name for name in names
            if name.lower().endswith((".gml", ".xml"))
            and not name.lower().endswith(("metadata.xml", "manifest.xml"))
        ]
        shp_members = [name for name in names if name.lower().endswith(".shp")]
        diagnostics = []
        for member in xml_members[:3]:
            raw = archive.read(member)
            decl = re.search(
                br"<\?xml[^>]*\bencoding\s*=\s*['\"]([^'\"]+)['\"]",
                raw[:2048],
                re.IGNORECASE,
            )
            try:
                normalized = normalize_xml_bytes_for_expat(raw)
                tags = re.findall(
                    rb"<(?:[A-Za-z0-9_.-]+:)?([A-Za-z][A-Za-z0-9_.-]*)\b",
                    normalized,
                )
                counts = Counter(tag.decode("ascii", errors="replace").lower() for tag in tags)
                diagnostics.append({
                    "member": member,
                    "declared_encoding": decl.group(1).decode("ascii", errors="replace") if decl else None,
                    "xml_bytes": len(raw),
                    "tag_name_counts_top_25": counts.most_common(25),
                    "feature_member_count": counts.get("featuremember", 0),
                    "feature_members_collection_count": counts.get("featuremembers", 0),
                    "administrative_area_count": counts.get("administrativearea", 0),
                    "polygon_count": counts.get("polygon", 0),
                    "polygon_patch_count": counts.get("polygonpatch", 0),
                    "coordinate_element_counts": {
                        tag: counts.get(tag, 0) for tag in ("pos", "poslist", "coordinates")
                    },
                })
            except Exception as error:
                diagnostics.append({
                    "member": member,
                    "declared_encoding": decl.group(1).decode("ascii", errors="replace") if decl else None,
                    "diagnostic_parse_error": f"{type(error).__name__}: {error}",
                })
        return {
            "archive_member_count": len(names),
            "archive_members_sample": names[:25],
            "xml_member_names": xml_members[:25],
            "shp_member_names": shp_members[:25],
            "xml_structure_samples": diagnostics,
        }


def resolve_dbf_encoding(archive: zipfile.ZipFile, member_names: list[str], shp_name: str) -> tuple[str, str]:
    """Resolve the DBF text encoding from an explicit sidecar or archive metadata.

    Prefer the SHP's same-stem .cpg declaration. Otherwise use the declared
    encoding in the publisher's KS-META XML. Fail closed if neither exists;
    do not guess a locale based only on decoded text.
    """
    shp_stem = Path(shp_name).stem.lower()
    cpg_members = [
        name for name in member_names
        if Path(name).suffix.lower() == ".cpg" and Path(name).stem.lower() == shp_stem
    ]
    if len(cpg_members) > 1:
        raise RuntimeError(f"Multiple DBF code-page sidecars exist for {shp_name}: {cpg_members}")
    if cpg_members:
        raw_label = archive.read(cpg_members[0]).decode("ascii", errors="strict").strip().strip("\ufeff")
        aliases = {
            "932": "cp932",
            "ms932": "cp932",
            "windows-31j": "cp932",
            "65001": "utf-8",
        }
        encoding = aliases.get(raw_label.lower(), raw_label)
        try:
            codecs.lookup(encoding)
        except LookupError as error:
            raise RuntimeError(
                f"Unsupported encoding {raw_label!r} from explicit sidecar {cpg_members[0]}"
            ) from error
        return encoding, cpg_members[0]

    metadata_members = [
        name for name in member_names
        if Path(name).suffix.lower() in {".xml", ".gml"}
        and "meta" in Path(name).name.lower()
    ]
    declarations = []
    for member in metadata_members:
        raw = archive.read(member)
        match = re.search(
            br"<\?xml[^>]*\bencoding\s*=\s*['\"]([^'\"]+)['\"]",
            raw[:2048],
            re.IGNORECASE,
        )
        if not match:
            continue
        label = match.group(1).decode("ascii", errors="strict").strip()
        try:
            codecs.lookup(label)
        except LookupError as error:
            raise RuntimeError(
                f"Unsupported declared DBF encoding {label!r} in official metadata {member}"
            ) from error
        declarations.append((label, member))

    distinct_encodings = {label.lower() for label, _member in declarations}
    if len(distinct_encodings) > 1:
        raise RuntimeError(f"Conflicting official archive metadata encodings: {declarations}")
    if declarations:
        encoding, member = declarations[0]
        return encoding, member
    raise RuntimeError(
        f"No explicit .cpg or publisher metadata encoding could be resolved for {shp_name}; "
        "refusing to guess DBF text encoding."
    )


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
            # Some official N03 archives bundle both descriptive GML/XML and
            # a complete Shapefile. If the XML uses a GML geometry model we do
            # not support yet (for example CurveMember/Surface rather than
            # featureMember/Polygon), do not claim success with zero features:
            # fall through to the archive's verified .shp/.shx/.dbf components.
            if records:
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
            dbf_encoding, encoding_source = resolve_dbf_encoding(archive, names, shp_name)
            reader = shapefile.Reader(
                shp=io.BytesIO(archive.read(by_ext[".shp"])),
                shx=io.BytesIO(archive.read(by_ext[".shx"])),
                dbf=io.BytesIO(archive.read(by_ext[".dbf"])),
                encoding=dbf_encoding,
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
                    "dbf_text_encoding": dbf_encoding,
                    "dbf_encoding_source_member": encoding_source,
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


def candidate_targets(audit: dict, include_all_positive: bool = False) -> list[dict]:
    target_rows = audit.get("target_results", [])
    if include_all_positive:
        selected = [target for target in target_rows if target.get("candidates")]
        expected_ids = {str(target["geonames_id"]) for target in selected}
        if not selected:
            raise RuntimeError("No positive exact-label candidate targets were present in the source audit.")
        for target in selected:
            if (
                target.get("country_code") != "JP"
                or target.get("feature_code") != "ADM4"
                or target.get("raw_admin1_code") != "00"
                or target.get("source_identity_and_raw_codes_verified") is not True
            ):
                raise RuntimeError(
                    "Positive candidate target failed the exact Japan ADM4/raw-admin1-00 source identity guard: "
                    f"{target.get('geonames_id')}"
                )
    else:
        selected = [
            target for target in target_rows
            if str(target.get("geonames_id")) in EXPECTED_TARGET_IDS
        ]
        expected_ids = set(EXPECTED_TARGET_IDS)

    rows = []
    for target in selected:
        try:
            lat = float(target["source_latitude"])
            lon = float(target["source_longitude"])
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError(
                f"Target {target.get('geonames_id')} lacks valid source latitude/longitude."
            ) from error
        codes = sorted({
            str(candidate["area_code"]).zfill(5)
            for candidate in target.get("candidates", [])
            if re.fullmatch(r"\d{5}", str(candidate.get("area_code", "")))
        })
        if not codes:
            if include_all_positive:
                raise RuntimeError(
                    f"Positive candidate target {target.get('geonames_id')} has no valid five-digit area code."
                )
            continue
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
    if ids != expected_ids:
        raise RuntimeError(
            f"Expected target IDs {sorted(expected_ids, key=int)}; found ids={sorted(ids, key=int)}"
        )
    return sorted(rows, key=lambda row: int(row["geonames_id"]))


def polygon_context_status(observations: list[dict]) -> str:
    """Make missing spatial context explicit rather than silently dropping a target."""
    return (
        "CONTAINING_POLYGON_OBSERVED"
        if observations
        else "NO_CONTAINING_POLYGON_OBSERVED_IN_SELECTED_SNAPSHOTS"
    )


def select_all_japan_spatial_targets(audit: dict) -> list[dict]:
    """Select all source-verified Japan ADM4/raw-admin1-00 targets, regardless of name candidates."""
    targets = audit.get("target_results", [])
    if len(targets) != 126:
        raise RuntimeError(f"Expected 126 Japan targets from the source audit; got {len(targets)}.")
    seen = set()
    selected = []
    for target in targets:
        geonames_id = str(target.get("geonames_id", ""))
        if (
            target.get("country_code") != "JP"
            or target.get("feature_code") != "ADM4"
            or target.get("raw_admin1_code") != "00"
            or target.get("source_identity_and_raw_codes_verified") is not True
            or not re.fullmatch(r"\d+", geonames_id)
        ):
            raise RuntimeError(
                f"All-Japan spatial review rejected unverified/non-target row {geonames_id!r}."
            )
        if geonames_id in seen:
            raise RuntimeError(f"Duplicate GeoNames ID in all-Japan target list: {geonames_id}")
        seen.add(geonames_id)
        try:
            latitude = float(target["source_latitude"])
            longitude = float(target["source_longitude"])
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError(f"Missing/invalid coordinates for GeoNames ID {geonames_id}.") from error
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise RuntimeError(f"Coordinates out of valid geographic range for GeoNames ID {geonames_id}.")
        candidate_codes = sorted({
            str(candidate["area_code"]).zfill(5)
            for candidate in target.get("candidates", [])
            if re.fullmatch(r"\d{5}", str(candidate.get("area_code", "")))
        })
        selected.append({
            "geonames_id": geonames_id,
            "name": target["geonames_name"],
            "latitude": latitude,
            "longitude": longitude,
            "raw_admin1_code": target["raw_admin1_code"],
            "raw_admin2_code": target.get("raw_admin2_code", ""),
            "existing_exact_english_candidate_codes": candidate_codes,
        })
    if seen != {str(target.get("geonames_id")) for target in targets}:
        raise RuntimeError("All-Japan target identity set did not reconcile.")
    return sorted(selected, key=lambda row: int(row["geonames_id"]))


def build_estat_catalog_area_code_index(source_response: dict) -> dict[str, list[dict]]:
    """Index all catalog-page code/label/period rows without inventing detail fields."""
    pages = source_response.get("catalog_pages", [])
    if not pages:
        raise RuntimeError("e-Stat source-response payload contains no catalog pages.")
    index: dict[str, list[dict]] = {}
    total = 0
    for page in pages:
        response = page.get("response", {})
        bindings = response.get("results", {}).get("bindings", [])
        if int(page.get("row_count", -1)) != len(bindings):
            raise RuntimeError(
                f"e-Stat catalog page row count mismatch at offset {page.get('offset')}: "
                f"manifest={page.get('row_count')} actual={len(bindings)}"
            )
        for binding in bindings:
            code = binding_value(binding, "identifier").strip()
            period_uri = binding_value(binding, "period").strip()
            label_en = binding_value(binding, "labelEn").strip()
            label_ja = binding_value(binding, "labelJa").strip()
            if not re.fullmatch(r"\d{5}", code) or not period_uri or not label_en:
                raise RuntimeError(f"e-Stat catalog row missing a valid code, URI or English label: {binding}")
            index.setdefault(code, []).append({
                "area_code": code,
                "period_uri": period_uri,
                "label_en": label_en,
                "label_ja": label_ja,
            })
            total += 1
    if total == 0:
        raise RuntimeError("e-Stat source-response catalog pages contained zero rows.")
    for code, records in index.items():
        records.sort(key=lambda row: (row["period_uri"], row["label_en"], row["label_ja"]))
    return index


def perform_all_japan_1995_spatial_first_audit(
    audit_path: Path,
    e_stat_response_path: Path,
    polygon_manifest_path: Path,
    archive_root: Path,
    output_prefix: Path,
) -> dict:
    """Spatial-first, 1995-only evidence for all 126 source-verified Japan targets.

    This pass finds the official area polygon containing each source point, then
    attaches labels/period URIs that were already present in the pinned e-Stat
    catalog pages. It never creates a GeoNames crosswalk or parent link.
    """
    import csv

    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    targets = select_all_japan_spatial_targets(audit)
    e_stat_response = json.loads(e_stat_response_path.read_text(encoding="utf-8"))
    catalog_index = build_estat_catalog_area_code_index(e_stat_response)
    polygon_manifest = json.loads(polygon_manifest_path.read_text(encoding="utf-8"))
    snapshots = [
        item for item in polygon_manifest.get("source_snapshots", [])
        if item.get("snapshot_date") == CONTEXT_SNAPSHOT[0]
    ]
    if len(snapshots) != 47:
        raise RuntimeError(
            f"Expected all 47 nationwide 1995 boundary archives in the pinned manifest; got {len(snapshots)}."
        )
    expected_prefectures = {f"{number:02d}" for number in range(1, 48)}
    if {str(item.get("prefecture_code", "")) for item in snapshots} != expected_prefectures:
        raise RuntimeError("Pinned 1995 boundary archive set does not cover prefecture codes 01–47 exactly.")

    target_observations: dict[str, list[dict]] = {target["geonames_id"]: [] for target in targets}
    archive_summaries = []
    feature_total = 0
    points = [(target["geonames_id"], (target["longitude"], target["latitude"])) for target in targets]

    def polygon_bbox(polygon):
        coords = [
            coordinate
            for ring in polygon
            for coordinate in ring
            if isinstance(coordinate, (list, tuple)) and len(coordinate) >= 2
        ]
        if not coords:
            return None
        xs = [float(point[0]) for point in coords]
        ys = [float(point[1]) for point in coords]
        return min(xs), min(ys), max(xs), max(ys)

    for snapshot in sorted(snapshots, key=lambda row: str(row["prefecture_code"])):
        filename = str(snapshot["archive_filename"])
        if not re.fullmatch(r"N03-951001_\d{2}_GML\.zip", filename):
            raise RuntimeError(f"Unexpected archive filename in pinned manifest: {filename}")
        archive_path = archive_root / CONTEXT_SNAPSHOT[0] / filename
        archive_bytes = archive_path.read_bytes()
        actual_hash = sha256(archive_bytes)
        if (
            actual_hash != snapshot.get("archive_sha256")
            or len(archive_bytes) != int(snapshot.get("archive_bytes_size", -1))
        ):
            raise RuntimeError(f"Archive hash/size mismatch against pinned manifest: {filename}")
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            bad_member = archive.testzip()
            if bad_member:
                raise RuntimeError(f"CRC validation failed for {filename}/{bad_member}")
        features, member_names = parse_gml_archive(archive_bytes, snapshot)
        if not features:
            raise RuntimeError(f"Zero boundary features parsed from pinned 1995 archive {filename}.")
        feature_total += len(features)
        feature_hits = 0
        for feature in features:
            code = str(feature.get("area_code", "")).strip()
            if not re.fullmatch(r"\d{5}", code):
                continue
            for polygon in feature.get("polygons", []):
                bbox = polygon_bbox(polygon)
                if bbox is None:
                    continue
                xmin, ymin, xmax, ymax = bbox
                for geonames_id, point in points:
                    x, y = point
                    if not (xmin - 1e-9 <= x <= xmax + 1e-9 and ymin - 1e-9 <= y <= ymax + 1e-9):
                        continue
                    relation = geometry_location(point, {"type": "Polygon", "coordinates": polygon})
                    if relation not in {"INSIDE", "BOUNDARY"}:
                        continue
                    target = next(item for item in targets if item["geonames_id"] == geonames_id)
                    catalog_records = catalog_index.get(code, [])
                    english_labels = sorted({row["label_en"] for row in catalog_records if row["label_en"]})
                    japanese_labels = sorted({row["label_ja"] for row in catalog_records if row["label_ja"]})
                    period_uris = sorted({row["period_uri"] for row in catalog_records if row["period_uri"]})
                    target_candidates = target["existing_exact_english_candidate_codes"]
                    observation = {
                        "geonames_id": geonames_id,
                        "geonames_name": target["name"],
                        "latitude": target["latitude"],
                        "longitude": target["longitude"],
                        "raw_admin1_code": target["raw_admin1_code"],
                        "raw_admin2_code": target["raw_admin2_code"],
                        "snapshot_date": CONTEXT_SNAPSHOT[0],
                        "snapshot_prefecture_code": snapshot["prefecture_code"],
                        "containing_area_code": code,
                        "containing_prefecture_name": feature.get("prefecture_name", ""),
                        "containing_district_name": feature.get("district_name", ""),
                        "containing_municipality_name": feature.get("municipality_name", ""),
                        "point_relation": relation,
                        "archive_filename": filename,
                        "archive_sha256": actual_hash,
                        "dbf_text_encoding": feature.get("dbf_text_encoding", ""),
                        "dbf_encoding_source_member": feature.get("dbf_encoding_source_member", ""),
                        "estat_catalog_code_present": bool(catalog_records),
                        "estat_catalog_english_labels": "; ".join(english_labels),
                        "estat_catalog_japanese_labels_available": bool(japanese_labels),
                        "estat_catalog_japanese_labels": "; ".join(japanese_labels),
                        "estat_catalog_period_count": len(period_uris),
                        "estat_catalog_period_uris": "; ".join(period_uris),
                        "exact_english_name_candidate_codes": "; ".join(target_candidates),
                        "containing_code_matches_existing_exact_name_candidate": code in target_candidates,
                        "operational_parent_link_created": "false",
                    }
                    target_observations[geonames_id].append(observation)
                    feature_hits += 1
        archive_summaries.append({
            "snapshot_date": CONTEXT_SNAPSHOT[0],
            "prefecture_code": snapshot["prefecture_code"],
            "archive_filename": filename,
            "download_url": snapshot.get("download_url", ""),
            "archive_sha256": actual_hash,
            "archive_bytes_size": len(archive_bytes),
            "parsed_boundary_feature_count": len(features),
            "containing_feature_observation_count": feature_hits,
            "source_member_names": member_names,
        })

    target_results = []
    all_observations = []
    for target in targets:
        observations = sorted(
            target_observations[target["geonames_id"]],
            key=lambda row: (row["containing_area_code"], row["containing_municipality_name"]),
        )
        all_observations.extend(observations)
        codes = sorted({row["containing_area_code"] for row in observations})
        candidate_codes = target["existing_exact_english_candidate_codes"]
        code_records = [
            record for record in observations
        ]
        target_results.append({
            **target,
            "spatial_context_status": (
                "CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT"
                if observations else "NO_CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT"
            ),
            "containing_area_codes_1995": codes,
            "containing_area_names_1995": sorted({
                " ".join(
                    part for part in (
                        row["containing_prefecture_name"],
                        row["containing_district_name"],
                        row["containing_municipality_name"],
                    ) if part
                )
                for row in observations
            }),
            "containing_area_code_count_1995": len(codes),
            "observations": observations,
            "existing_exact_name_candidate_codes": candidate_codes,
            "spatial_code_matches_existing_exact_name_candidate": any(
                row["containing_code_matches_existing_exact_name_candidate"] for row in code_records
            ),
            "operational_parent_link_created": False,
        })

    distinct_codes = sorted({row["containing_area_code"] for row in all_observations})
    catalog_codes = {code for code in distinct_codes if code in catalog_index}
    observed_target_ids = {row["geonames_id"] for row in all_observations}
    targets_without_context = [
        target["geonames_id"] for target in target_results
        if target["spatial_context_status"] == "NO_CONTAINING_POLYGON_OBSERVED_IN_1995_SNAPSHOT"
    ]
    page_sources = [
        {
            "offset": page.get("offset"),
            "row_count": page.get("row_count"),
            "response_sha256": page.get("source", {}).get("response_sha256", ""),
        }
        for page in e_stat_response.get("catalog_pages", [])
    ]
    page_sources.sort(key=lambda row: int(row["offset"] or 0))
    result = {
        "report_version": 1,
        "selection_mode": "ALL_126_SOURCE_VERIFIED_JAPAN_ADM4_ADMIN1_00_TARGETS; SPATIAL_FIRST_1995_ONLY",
        "status": "PASS_PINNED_1995_BOUNDARY_SPATIAL_SCAN; AREA_CODE_CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target_count": len(targets),
        "target_source_identity_and_raw_code_matches": len(targets),
        "target_rows_with_polygon_context": sum(bool(target["observations"]) for target in target_results),
        "target_rows_without_polygon_context": len(targets_without_context),
        "target_ids_without_polygon_context": targets_without_context,
        "observation_count": len(all_observations),
        "distinct_containing_area_codes": len(distinct_codes),
        "containing_area_codes_present_in_e_stat_catalog": len(catalog_codes),
        "containing_area_codes_missing_from_e_stat_catalog": sorted(set(distinct_codes) - catalog_codes),
        "targets_whose_containing_area_code_matches_existing_exact_name_candidate": sum(
            bool(target["spatial_code_matches_existing_exact_name_candidate"]) for target in target_results
        ),
        "e_stat_catalog_result_row_count": sum(int(page["row_count"]) for page in page_sources),
        "e_stat_catalog_page_sources": page_sources,
        "source_snapshot_archive_count": len(archive_summaries),
        "source_snapshots": archive_summaries,
        "target_results": target_results,
        "operational_parent_links_created": 0,
        "limitations": [
            "The current 1995 area polygon containing a GeoNames point is only a spatial-first candidate; it does not prove the GeoNames feature is that administrative area.",
            "The source location may be a historical or feature reference point; no containment in the selected 1995 snapshot does not prove invalidity.",
            "The catalog page payload includes official English labels and period URIs; Japanese labels and parent references not present in the catalog page remain absent until a separate official detail query is made.",
            "A containing-area code may be at a different administrative level than the GeoNames feature; do not use it as the immediate parent without exact entity/level review.",
            "No names are used to derive containing polygons, and no operational parent links or raw code changes are performed.",
        ],
    }
    prefix = output_prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    (prefix.with_suffix(".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    fields = [
        "geonames_id", "geonames_name", "latitude", "longitude", "raw_admin1_code", "raw_admin2_code",
        "snapshot_date", "snapshot_prefecture_code", "containing_area_code", "containing_prefecture_name",
        "containing_district_name", "containing_municipality_name", "point_relation", "archive_filename",
        "archive_sha256", "dbf_text_encoding", "dbf_encoding_source_member", "estat_catalog_code_present",
        "estat_catalog_english_labels", "estat_catalog_japanese_labels_available", "estat_catalog_japanese_labels",
        "estat_catalog_period_count", "estat_catalog_period_uris", "exact_english_name_candidate_codes",
        "containing_code_matches_existing_exact_name_candidate", "operational_parent_link_created",
    ]
    with prefix.with_suffix(".csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(all_observations)
    summary_fields = [
        "geonames_id", "name", "latitude", "longitude", "raw_admin1_code", "raw_admin2_code",
        "existing_exact_english_candidate_codes", "spatial_context_status", "containing_area_codes_1995",
        "containing_area_names_1995", "containing_area_code_count_1995",
        "spatial_code_matches_existing_exact_name_candidate", "operational_parent_link_created",
    ]
    with prefix.with_suffix(".target-summary.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=summary_fields)
        writer.writeheader()
        for target in target_results:
            writer.writerow({
                "geonames_id": target["geonames_id"],
                "name": target["name"],
                "latitude": target["latitude"],
                "longitude": target["longitude"],
                "raw_admin1_code": target["raw_admin1_code"],
                "raw_admin2_code": target["raw_admin2_code"],
                "existing_exact_english_candidate_codes": ";".join(target["existing_exact_english_candidate_codes"]),
                "spatial_context_status": target["spatial_context_status"],
                "containing_area_codes_1995": ";".join(target["containing_area_codes_1995"]),
                "containing_area_names_1995": ";".join(target["containing_area_names_1995"]),
                "containing_area_code_count_1995": target["containing_area_code_count_1995"],
                "spatial_code_matches_existing_exact_name_candidate": str(target["spatial_code_matches_existing_exact_name_candidate"]).lower(),
                "operational_parent_link_created": "false",
            })
    (prefix.with_suffix(".manifest.json")).write_text(json.dumps({
        "status": result["status"],
        "generated_at_utc": result["generated_at_utc"],
        "selection_mode": result["selection_mode"],
        "e_stat_catalog_page_sources": page_sources,
        "e_stat_catalog_result_row_count": result["e_stat_catalog_result_row_count"],
        "source_snapshot_archive_count": len(archive_summaries),
        "source_archive_hashes": [
            {
                "snapshot_date": item["snapshot_date"],
                "prefecture_code": item["prefecture_code"],
                "archive_filename": item["archive_filename"],
                "download_url": item["download_url"],
                "archive_sha256": item["archive_sha256"],
                "archive_bytes_size": item["archive_bytes_size"],
            }
            for item in archive_summaries
        ],
        "operational_parent_links_created": 0,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "target_count": result["target_count"],
        "source_snapshot_archive_count": result["source_snapshot_archive_count"],
        "parsed_boundary_feature_count": feature_total,
        "observation_count": result["observation_count"],
        "target_rows_with_polygon_context": result["target_rows_with_polygon_context"],
        "target_rows_without_polygon_context": result["target_rows_without_polygon_context"],
        "target_ids_without_polygon_context": result["target_ids_without_polygon_context"],
        "distinct_containing_area_codes": result["distinct_containing_area_codes"],
        "containing_area_codes_present_in_e_stat_catalog": result["containing_area_codes_present_in_e_stat_catalog"],
        "targets_whose_containing_area_code_matches_existing_exact_name_candidate": result["targets_whose_containing_area_code_matches_existing_exact_name_candidate"],
        "operational_parent_links_created": 0,
    }, ensure_ascii=False, indent=2))
    return result


def perform_point_audit(audit_path: Path, output_prefix: Path, include_all_positive: bool = False) -> dict:
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    targets = candidate_targets(audit, include_all_positive=include_all_positive)
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
                diagnostic = archive_structure_diagnostic(fetched["archive_bytes"])
                raise RuntimeError(
                    f"Zero boundary features parsed from official MLIT archive "
                    f"{fetched['archive_filename']}; failing closed. "
                    f"Structure diagnostic={json.dumps(diagnostic, ensure_ascii=False)}"
                )
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
    target_observation_rows = [
        {
            **target,
            "polygon_context_status": polygon_context_status(target_observations[target["geonames_id"]]),
            "polygon_observations": target_observations[target["geonames_id"]],
        }
        for target in targets
    ]
    target_rows_with_polygon_context = sum(
        bool(target["polygon_observations"]) for target in target_observation_rows
    )
    target_ids_without_polygon_context = [
        target["geonames_id"] for target in target_observation_rows
        if not target["polygon_observations"]
    ]
    result = {
        "report_version": 2 if include_all_positive else 1,
        "selection_mode": "ALL_POSITIVE_ESTAT_LABEL_CANDIDATE_TARGETS" if include_all_positive else "SIX_NAMED_COLLISION_TARGETS",
        "status": "PASS_OFFICIAL_MLIT_HISTORICAL_BOUNDARY_RETRIEVAL_AND_POINT_TEST; CANDIDATES_ONLY; NO_PARENT_LINKS_APPROVED",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target_count": len(targets),
        "target_code_associations_tested": sum(len(target["candidate_area_codes"]) for target in targets),
        "distinct_candidate_area_codes_tested": len({code for target in targets for code in target["candidate_area_codes"]}),
        "target_ids": sorted(target_by_id, key=int),
        "candidate_codes_tested": len(candidate_stats),
        "target_rows_with_polygon_context": target_rows_with_polygon_context,
        "target_rows_without_polygon_context": len(target_observation_rows) - target_rows_with_polygon_context,
        "target_ids_without_polygon_context": target_ids_without_polygon_context,
        "source_catalog": source_manifest,
        "source_snapshots": source_snapshots,
        "source_snapshot_archive_count": len(source_snapshots),
        "target_observations": target_observation_rows,
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
    with prefix.with_suffix(".target-summary.csv").open("w", newline="", encoding="utf-8") as stream:
        fields = [
            "geonames_id", "geonames_name", "geonames_latitude", "geonames_longitude",
            "raw_admin1_code", "raw_admin2_code", "candidate_area_codes",
            "candidate_area_code_count", "polygon_context_status", "containing_polygon_observation_count",
            "containing_area_codes_observed", "containing_municipalities_observed",
            "candidate_codes_with_point_inside_polygon_snapshots", "operational_parent_link_created",
        ]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for target in result["target_observations"]:
            observations = target["polygon_observations"]
            target_candidates = [
                row for row in result["candidate_results"]
                if row["geonames_id"] == target["geonames_id"]
            ]
            writer.writerow({
                "geonames_id": target["geonames_id"],
                "geonames_name": target["name"],
                "geonames_latitude": target["latitude"],
                "geonames_longitude": target["longitude"],
                "raw_admin1_code": target["raw_admin1_code"],
                "raw_admin2_code": target["raw_admin2_code"],
                "candidate_area_codes": ";".join(target["candidate_area_codes"]),
                "candidate_area_code_count": len(target["candidate_area_codes"]),
                "polygon_context_status": target["polygon_context_status"],
                "containing_polygon_observation_count": len(observations),
                "containing_area_codes_observed": ";".join(sorted({str(row["containing_area_code"]) for row in observations if row["containing_area_code"]})),
                "containing_municipalities_observed": ";".join(sorted({str(row["containing_municipality_name"]) for row in observations if row["containing_municipality_name"]})),
                "candidate_codes_with_point_inside_polygon_snapshots": ";".join(sorted({
                    row["candidate_code"] for row in target_candidates
                    if row["point_inside_candidate_polygon_snapshots"]
                })),
                "operational_parent_link_created": "false",
            })
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
        "target_count": result["target_count"],
        "target_rows_with_polygon_context": result["target_rows_with_polygon_context"],
        "target_rows_without_polygon_context": result["target_rows_without_polygon_context"],
        "target_ids_without_polygon_context": result["target_ids_without_polygon_context"],
        "target_code_associations_tested": result["target_code_associations_tested"],
        "distinct_candidate_area_codes_tested": result["distinct_candidate_area_codes_tested"],
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
        "target_rows_with_polygon_observations": result["target_rows_with_polygon_context"],
        "target_rows_without_polygon_observations": result["target_rows_without_polygon_context"],
        "target_ids_without_polygon_observations": result["target_ids_without_polygon_context"],
        "candidate_codes_with_point_inside_candidate_polygon": sum(bool(c["point_inside_candidate_polygon_snapshots"]) for c in result["candidate_results"]),
        "operational_parent_links_created": 0,
        "source_snapshot_archives": len(result["source_snapshots"]),
    }, ensure_ascii=False, indent=2))
    return result


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        if argv and argv[0] == "--all-japan-1995-spatial-first":
            if len(argv) != 6:
                sys.stderr.write(
                    "Usage: geonames-japan-mlit-polygon-evidence-audit.py "
                    "--all-japan-1995-spatial-first <japan-estat-evidence-audit.json> "
                    "<japan-estat-evidence-audit.source-response.json> "
                    "<japan-mlit-polygon-audit.manifest.json> <polygon-source-archives-dir> <output-prefix>\n"
                )
                return 2
            perform_all_japan_1995_spatial_first_audit(
                Path(argv[1]), Path(argv[2]), Path(argv[3]), Path(argv[4]), Path(argv[5])
            )
            return 0
        if len(argv) not in {2, 3} or (len(argv) == 3 and argv[2] != "--all-positive-candidates"):
            sys.stderr.write(
                "Usage: geonames-japan-mlit-polygon-evidence-audit.py "
                "<japan-estat-evidence-audit.json> <output-prefix> [--all-positive-candidates]\n"
            )
            return 2
        include_all_positive = len(argv) == 3
        perform_point_audit(Path(argv[0]), Path(argv[1]), include_all_positive=include_all_positive)
    except Exception as error:
        sys.stderr.write(f"MLIT polygon evidence audit failed closed: {type(error).__name__}: {error}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
