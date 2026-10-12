#!/usr/bin/env python3
"""Build a review-only, compressed GeoNames location-candidate package.

The package is a data-preparation artifact, not a live DB import. It preserves
GeoNames IDs and country scope; administrative labels are optional exact-code
lookups, not approval of parent links. Source archives remain outside Git.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, TextIO

ALL_COUNTRIES_FIELDS = 19
ALTERNATE_NAMES_FIELDS = 10
ID_RE = re.compile(r"^[0-9]+$")
COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
CURRENT_PLACE_CODES = {
    "PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5",
    "PPLC", "PPLCD", "PPLF", "PPLG", "PPLL", "PPLR", "PPLS",
}

CANDIDATE_FIELDS = [
    "geoname_id", "name", "ascii_name", "country_code", "feature_code",
    "latitude", "longitude", "population", "admin1_code", "admin1_name",
    "admin2_code", "admin2_name",
]
ALIAS_FIELDS = [
    "alternate_name_id", "geoname_id", "language", "alternate_name",
    "is_preferred", "is_short", "is_colloquial", "is_historic",
    "valid_from", "valid_to",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_admin_crosswalk(path: Path, level: int) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for line_no, raw in enumerate(stream, 1):
            line = raw.rstrip("\r\n")
            if not line or line.startswith("#"):
                continue
            fields = line.split("\t")
            if len(fields) != 4:
                raise ValueError(f"{path.name}:{line_no}: expected 4 fields, got {len(fields)}")
            code, name, ascii_name, geoname_id = fields
            if not code:
                raise ValueError(f"{path.name}:{line_no}: empty code")
            result[code] = {
                "name": name.strip(),
                "ascii_name": ascii_name.strip(),
                "geoname_id": geoname_id.strip(),
            }
    return result


def open_zip_member(path: Path, member_name: str):
    archive = zipfile.ZipFile(path, "r")
    matches = [member for member in archive.infolist() if member.filename == member_name]
    if len(matches) != 1:
        archive.close()
        raise ValueError(f"{path.name}: expected exactly one {member_name!r} member, found {len(matches)}")
    return archive, matches[0]


def gzip_csv_writer(path: Path, fieldnames: list[str]) -> tuple[Any, Any, Any]:
    raw = path.open("wb")
    stream = gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=6, mtime=0)
    text_stream = __import__("io").TextIOWrapper(stream, encoding="utf-8", newline="")
    writer = csv.DictWriter(text_stream, fieldnames=fieldnames, extrasaction="raise")
    writer.writeheader()
    return raw, text_stream, writer


def close_gzip_writer(raw: Any, text_stream: Any) -> None:
    try:
        text_stream.flush()
        text_stream.close()
    finally:
        raw.close()


def parse_place_rows(
    source_dir: Path,
    candidates_path: Path,
    admin1: dict[str, dict[str, str]],
    admin2: dict[str, dict[str, str]],
) -> tuple[set[str], dict[str, Any]]:
    candidates_path.parent.mkdir(parents=True, exist_ok=True)
    source = source_dir / "allCountries.zip"
    archive, member = open_zip_member(source, "allCountries.txt")
    candidate_ids: set[str] = set()
    country_counts: Counter[str] = Counter()
    feature_counts: Counter[str] = Counter()
    excluded_features = malformed_rows = bad_ids = bad_country = duplicate_ids = coordinate_omissions = 0
    rows_read = 0
    raw, text_stream, writer = gzip_csv_writer(candidates_path, CANDIDATE_FIELDS)
    try:
        with archive.open(member, "r") as stream:
            for line_no, bline in enumerate(stream, 1):
                rows_read += 1
                try:
                    line = bline.decode("utf-8").rstrip("\r\n")
                except UnicodeDecodeError as exc:
                    malformed_rows += 1
                    raise ValueError(f"allCountries.txt:{line_no}: invalid UTF-8") from exc
                fields = line.split("\t")
                if len(fields) != ALL_COUNTRIES_FIELDS:
                    malformed_rows += 1
                    raise ValueError(f"allCountries.txt:{line_no}: expected 19 fields, got {len(fields)}")
                (
                    geoname_id, name, ascii_name, alternate_names, latitude, longitude,
                    feature_class, feature_code, country_code, cc2, admin1_code,
                    admin2_code, admin3_code, admin4_code, population, elevation,
                    dem, timezone, modification_date,
                ) = fields
                country_code = country_code.strip().upper()
                feature_code = feature_code.strip().upper()
                if feature_class.strip().upper() != "P" or feature_code not in CURRENT_PLACE_CODES:
                    excluded_features += 1
                    continue
                if not ID_RE.fullmatch(geoname_id.strip()):
                    bad_ids += 1
                    continue
                if not COUNTRY_RE.fullmatch(country_code):
                    bad_country += 1
                    continue
                geoname_id = geoname_id.strip()
                if geoname_id in candidate_ids:
                    duplicate_ids += 1
                    continue
                candidate_ids.add(geoname_id)
                country_counts[country_code] += 1
                feature_counts[feature_code] += 1

                lat_out, lon_out = "", ""
                try:
                    lat, lon = float(latitude), float(longitude)
                    if -90 <= lat <= 90 and -180 <= lon <= 180:
                        lat_out, lon_out = str(lat), str(lon)
                    else:
                        coordinate_omissions += 1
                except (TypeError, ValueError):
                    coordinate_omissions += 1

                key1 = f"{country_code}.{admin1_code}" if admin1_code else ""
                key2 = f"{country_code}.{admin1_code}.{admin2_code}" if admin1_code and admin2_code else ""
                writer.writerow({
                    "geoname_id": geoname_id,
                    "name": name,
                    "ascii_name": ascii_name,
                    "country_code": country_code,
                    "feature_code": feature_code,
                    "latitude": lat_out,
                    "longitude": lon_out,
                    "population": population if population.isdigit() else "",
                    "admin1_code": admin1_code,
                    "admin1_name": admin1.get(key1, {}).get("name", ""),
                    "admin2_code": admin2_code,
                    "admin2_name": admin2.get(key2, {}).get("name", ""),
                })
    finally:
        close_gzip_writer(raw, text_stream)
        archive.close()

    stats = {
        "source_member": member.filename,
        "source_member_bytes": member.file_size,
        "rows_read": rows_read,
        "candidate_rows_written": len(candidate_ids),
        "excluded_non_candidate_features": excluded_features,
        "malformed_rows": malformed_rows,
        "invalid_candidate_ids": bad_ids,
        "invalid_candidate_country_codes": bad_country,
        "duplicate_candidate_ids_skipped": duplicate_ids,
        "candidate_rows_without_valid_coordinate_pair": coordinate_omissions,
        "candidate_rows_by_country": dict(sorted(country_counts.items())),
        "candidate_rows_by_feature_code": dict(sorted(feature_counts.items())),
    }
    return candidate_ids, stats


def parse_alias_rows(
    source_dir: Path,
    aliases_path: Path,
    candidate_ids: set[str],
) -> dict[str, Any]:
    source = source_dir / "alternateNamesV2.zip"
    archive, member = open_zip_member(source, "alternateNamesV2.txt")
    rows_read = rows_written = malformed_rows = invalid_alias_ids = not_candidate_targets = 0
    alias_ids: set[str] = set()
    languages: Counter[str] = Counter()
    historic_rows = 0
    raw, text_stream, writer = gzip_csv_writer(aliases_path, ALIAS_FIELDS)
    try:
        with archive.open(member, "r") as stream:
            for line_no, bline in enumerate(stream, 1):
                rows_read += 1
                try:
                    line = bline.decode("utf-8").rstrip("\r\n")
                except UnicodeDecodeError as exc:
                    malformed_rows += 1
                    raise ValueError(f"alternateNamesV2.txt:{line_no}: invalid UTF-8") from exc
                fields = line.split("\t")
                if len(fields) != ALTERNATE_NAMES_FIELDS:
                    malformed_rows += 1
                    raise ValueError(f"alternateNamesV2.txt:{line_no}: expected 10 fields, got {len(fields)}")
                alias_id, geoname_id, language, name, preferred, short, colloquial, historic, valid_from, valid_to = fields
                alias_id, geoname_id = alias_id.strip(), geoname_id.strip()
                if not ID_RE.fullmatch(alias_id) or not ID_RE.fullmatch(geoname_id):
                    invalid_alias_ids += 1
                    continue
                if geoname_id not in candidate_ids:
                    not_candidate_targets += 1
                    continue
                if alias_id in alias_ids:
                    raise ValueError(f"alternateNamesV2.txt:{line_no}: duplicate alternate-name ID {alias_id}")
                alias_ids.add(alias_id)
                norm_language = language.strip().lower()
                languages[norm_language or "(blank)"] += 1
                is_historic = historic.strip().lower() in {"1", "true", "yes"}
                historic_rows += int(is_historic)
                writer.writerow({
                    "alternate_name_id": alias_id,
                    "geoname_id": geoname_id,
                    "language": norm_language,
                    "alternate_name": name,
                    "is_preferred": "true" if preferred.strip().lower() in {"1", "true", "yes"} else "false",
                    "is_short": "true" if short.strip().lower() in {"1", "true", "yes"} else "false",
                    "is_colloquial": "true" if colloquial.strip().lower() in {"1", "true", "yes"} else "false",
                    "is_historic": "true" if is_historic else "false",
                    "valid_from": valid_from,
                    "valid_to": valid_to,
                })
                rows_written += 1
    finally:
        close_gzip_writer(raw, text_stream)
        archive.close()

    return {
        "source_member": member.filename,
        "source_member_bytes": member.file_size,
        "rows_read": rows_read,
        "alias_rows_for_candidate_places_written": rows_written,
        "rows_skipped_because_target_not_in_place_candidates": not_candidate_targets,
        "invalid_alias_or_target_ids": invalid_alias_ids,
        "malformed_rows": malformed_rows,
        "duplicate_alias_ids": 0,
        "historic_alias_rows_retained_and_flagged": historic_rows,
        "language_row_counts": dict(sorted(languages.items())),
    }


def audit_output(path: Path) -> dict[str, Any]:
    return {"filename": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def build(source_dir: Path, output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    required = ["allCountries.zip", "alternateNamesV2.zip", "admin1CodesASCII.txt", "admin2Codes.txt"]
    missing = [name for name in required if not (source_dir / name).is_file()]
    if missing:
        raise FileNotFoundError("Missing source files: " + ", ".join(missing))
    admin1 = load_admin_crosswalk(source_dir / "admin1CodesASCII.txt", 1)
    admin2 = load_admin_crosswalk(source_dir / "admin2Codes.txt", 2)
    candidates_path = output_dir / "location-candidates.csv.gz"
    aliases_path = output_dir / "location-alternate-names.csv.gz"
    candidate_ids, candidate_stats = parse_place_rows(source_dir, candidates_path, admin1, admin2)
    alias_stats = parse_alias_rows(source_dir, aliases_path, candidate_ids)
    report = {
        "schema_version": 1,
        "status": "CANDIDATE_PACKAGE_READY_FOR_REVIEW",
        "created_at_utc": utc_now(),
        "source_files": {name: {"bytes": (source_dir / name).stat().st_size, "sha256": sha256(source_dir / name)} for name in required},
        "candidate_export": candidate_stats,
        "alternate_name_export": alias_stats,
        "outputs": {
            "location_candidates": audit_output(candidates_path),
            "location_alternate_names": audit_output(aliases_path),
        },
        "release_boundary": {
            "live_database_writes": 0,
            "parent_links_approved": 0,
            "place_records_marked_operational": 0,
            "iso_authority_verified": False,
            "note": "This artifact prepares candidate records only. Country identity, candidate inclusion policy, place type and optional display parents need review before a production import. The source snapshot may differ from the uploaded ZIP bytes.",
        },
    }
    write_json(output_dir / "location-candidate-build-report.json", report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = build(args.source_dir, args.output_dir)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        print(json.dumps({"status": "BLOCKED_SOURCE_VALIDATION", "error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps({
        "status": report["status"],
        "candidates": report["candidate_export"]["candidate_rows_written"],
        "aliases": report["alternate_name_export"]["alias_rows_for_candidate_places_written"],
        "outputs": report["outputs"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
