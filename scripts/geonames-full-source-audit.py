#!/usr/bin/env python3
"""Read-only streaming audit of the four full GeoNames source exports."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PARSER_VERSION = "job-grid-geonames-full-source-audit/1.0.0"
ALL_COUNTRIES_FIELDS = 19
ALTERNATE_NAMES_FIELDS = 10
CROSSWALK_FIELDS = 4
ID_RE = re.compile(r"^[0-9]+$")
COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
PLACE_CANDIDATES = {"PPL","PPLA","PPLA2","PPLA3","PPLA4","PPLA5","PPLC","PPLCD","PPLF","PPLG","PPLL","PPLR","PPLS"}
ADMIN_CANDIDATES = {"ADM1","ADM2","ADM3","ADM4","ADM5","ADMD"}
UPLOADED_SIZES = {
    "allCountries.zip": 422010093,
    "alternateNamesV2.zip": 204826020,
    "admin1CodesASCII.txt": 151583,
    "admin2Codes.txt": 2366368,
}

def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def file_record(path, retrieved):
    size = path.stat().st_size
    expected = UPLOADED_SIZES[path.name]
    return {
        "filename": path.name, "bytes": size, "sha256": sha256(path),
        "retrieved_at_utc": retrieved,
        "official_source_url": "https://download.geonames.org/export/dump/" + path.name,
        "uploaded_attachment_bytes": expected,
        "uploaded_attachment_size_matches": size == expected,
        "uploaded_attachment_sha256": None,
        "uploaded_attachment_byte_identity_confirmed": False,
    }

def zip_member(path, expected_name):
    archive = zipfile.ZipFile(path, "r")
    found = [info for info in archive.infolist() if info.filename == expected_name]
    if len(found) != 1:
        archive.close()
        raise ValueError(f"{path.name}: expected exactly one {expected_name} member, found {len(found)}")
    return archive, found[0]

def parse_crosswalk(path):
    rows = malformed = invalid_ids = 0
    codes, ids, country_prefixes = Counter(), Counter(), Counter()
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for raw in stream:
            line = raw.rstrip("\r\n")
            if not line or line.startswith("#"):
                continue
            rows += 1
            fields = line.split("\t")
            if len(fields) != CROSSWALK_FIELDS or not fields[0].strip():
                malformed += 1
                continue
            code, gid = fields[0].strip(), fields[3].strip()
            codes[code] += 1
            country_prefixes[code.split(".", 1)[0]] += 1
            if ID_RE.fullmatch(gid):
                ids[gid] += 1
            else:
                invalid_ids += 1
    return {
        "rows": rows, "unique_code_keys": len(codes),
        "duplicate_code_key_groups": sum(v > 1 for v in codes.values()),
        "duplicate_code_key_rows_beyond_first": sum(v - 1 for v in codes.values() if v > 1),
        "duplicate_geoname_id_groups": sum(v > 1 for v in ids.values()),
        "invalid_geoname_id_rows": invalid_ids, "malformed_rows": malformed,
        "country_prefixes": dict(sorted(country_prefixes.items())),
    }, set(codes)

def audit(source_dir, output_dir, retrieved_at=None):
    retrieved = retrieved_at or now_utc()
    output_dir.mkdir(parents=True, exist_ok=True)
    required = ["allCountries.zip", "alternateNamesV2.zip", "admin1CodesASCII.txt", "admin2Codes.txt"]
    missing = [name for name in required if not (source_dir / name).is_file()]
    if missing:
        raise FileNotFoundError("Missing source files: " + ", ".join(missing))
    files = {name: file_record(source_dir / name, retrieved) for name in required}

    admin1, admin1_keys = parse_crosswalk(source_dir / "admin1CodesASCII.txt")
    admin2, admin2_keys = parse_crosswalk(source_dir / "admin2Codes.txt")
    missing_admin1_children = Counter()
    for key in admin2_keys:
        parts = key.split(".")
        parent = ".".join(parts[:2]) if len(parts) >= 3 else ""
        if not parent or parent not in admin1_keys:
            missing_admin1_children[parent or "(unparseable)"] += 1
    admin2["unique_keys_without_admin1_key"] = len(missing_admin1_children)
    admin2["sample_missing_admin1_keys"] = [
        {"key": key, "child_keys": count} for key, count in missing_admin1_children.most_common(30)
    ]

    all_ids = set()
    all_rows = schema_rows = malformed = invalid_ids = duplicate_ids = 0
    invalid_coordinates = blank_country = nonstandard_country = 0
    class_counts, feature_counts, country_counts = Counter(), Counter(), Counter()
    country_features = defaultdict(Counter)
    a1_refs = a1_misses = a2_refs = a2_misses = 0
    a1_miss_keys, a2_miss_keys = Counter(), Counter()
    place_candidates = admin_candidates = 0
    kj_candidates = Counter()
    archive, member = zip_member(source_dir / "allCountries.zip", "allCountries.txt")
    try:
        with archive.open(member, "r") as stream:
            member_hash = hashlib.sha256()
            for raw in stream:
                member_hash.update(raw)
                all_rows += 1
                try:
                    line = raw.decode("utf-8").rstrip("\r\n")
                except UnicodeDecodeError:
                    malformed += 1
                    continue
                fields = line.split("\t")
                if len(fields) != ALL_COUNTRIES_FIELDS:
                    malformed += 1
                    continue
                schema_rows += 1
                gid = fields[0].strip()
                if not ID_RE.fullmatch(gid):
                    invalid_ids += 1
                elif gid in all_ids:
                    duplicate_ids += 1
                else:
                    all_ids.add(gid)
                country = fields[8].strip().upper()
                fclass = fields[6].strip().upper() or "(blank)"
                fcode = fields[7].strip().upper() or "(blank)"
                ckey = country or "(blank)"
                class_counts[fclass] += 1
                feature_counts[f"{fclass}.{fcode}"] += 1
                country_counts[ckey] += 1
                country_features[ckey][f"{fclass}.{fcode}"] += 1
                if not country:
                    blank_country += 1
                elif not COUNTRY_RE.fullmatch(country):
                    nonstandard_country += 1
                try:
                    lat, lon = float(fields[4]), float(fields[5])
                    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                        invalid_coordinates += 1
                except (ValueError, TypeError):
                    invalid_coordinates += 1
                if fclass == "P" and fcode in PLACE_CANDIDATES:
                    place_candidates += 1
                    if country in {"KE", "JP"}:
                        kj_candidates[f"{country}:{fcode}"] += 1
                if fclass == "A" and fcode in ADMIN_CANDIDATES:
                    admin_candidates += 1
                a1, a2 = fields[10].strip(), fields[11].strip()
                if COUNTRY_RE.fullmatch(country) and a1:
                    a1_refs += 1
                    key = f"{country}.{a1}"
                    if key not in admin1_keys:
                        a1_misses += 1
                        a1_miss_keys[key] += 1
                if COUNTRY_RE.fullmatch(country) and a1 and a2:
                    a2_refs += 1
                    key = f"{country}.{a1}.{a2}"
                    if key not in admin2_keys:
                        a2_misses += 1
                        a2_miss_keys[key] += 1
        zip_crc = "PASS"
    finally:
        archive.close()

    aliases_archive, aliases_member = zip_member(source_dir / "alternateNamesV2.zip", "alternateNamesV2.txt")
    alias_rows = alias_schema = alias_malformed = alias_bad_ids = alias_duplicate_ids = 0
    alias_ids = set()
    alias_target_bad = alias_target_unresolved = 0
    languages, flags = Counter(), Counter()
    try:
        with aliases_archive.open(aliases_member, "r") as stream:
            alias_hash = hashlib.sha256()
            for raw in stream:
                alias_hash.update(raw)
                alias_rows += 1
                try:
                    line = raw.decode("utf-8").rstrip("\r\n")
                except UnicodeDecodeError:
                    alias_malformed += 1
                    continue
                fields = line.split("\t")
                if len(fields) != ALTERNATE_NAMES_FIELDS:
                    alias_malformed += 1
                    continue
                alias_schema += 1
                aid, gid, language = fields[0].strip(), fields[1].strip(), fields[2].strip().lower()
                if not ID_RE.fullmatch(aid):
                    alias_bad_ids += 1
                elif aid in alias_ids:
                    alias_duplicate_ids += 1
                else:
                    alias_ids.add(aid)
                if not ID_RE.fullmatch(gid):
                    alias_target_bad += 1
                elif gid not in all_ids:
                    alias_target_unresolved += 1
                languages[language or "(blank)"] += 1
                for label, value in zip(("preferred", "short", "colloquial", "historic"), fields[4:8]):
                    if value.strip().lower() in {"1", "true", "yes"}:
                        flags[label] += 1
        alias_crc = "PASS"
    finally:
        aliases_archive.close()

    report = {
        "schema_version": 1, "parser_version": PARSER_VERSION, "created_at_utc": retrieved,
        "status": "PASS_WITH_REVIEW_COUNTS",
        "files": files,
        "uploaded_attachment_comparison": {
            "uploaded_file_sizes_came_from_attachment_metadata": True,
            "uploaded_sha256_available": False,
            "equal_size_proves_identical_bytes": False,
            "note": "This run fingerprints official files downloaded in CI. It compares their sizes with uploaded attachments but cannot prove byte identity without attachment SHA-256 values."
        },
        "all_countries": {
            "archive_member": member.filename, "archive_member_bytes": member.file_size,
            "archive_member_sha256": member_hash.hexdigest(), "zip_member_crc_validation": zip_crc,
            "physical_rows": all_rows, "rows_with_19_fields": schema_rows,
            "malformed_or_wrong_field_count_rows": malformed, "invalid_geoname_id_rows": invalid_ids,
            "unique_valid_geoname_ids": len(all_ids), "duplicate_geoname_id_rows": duplicate_ids,
            "invalid_or_missing_coordinate_rows": invalid_coordinates, "blank_country_code_rows": blank_country,
            "nonstandard_country_code_rows": nonstandard_country,
            "distinct_nonblank_country_codes": len([key for key in country_counts if key != "(blank)"]),
            "country_code_row_counts": dict(sorted(country_counts.items())),
            "feature_class_counts": dict(class_counts.most_common()),
            "top_100_feature_code_counts": dict(feature_counts.most_common(100)),
            "current_populated_place_candidate_rows": place_candidates,
            "current_admin_area_candidate_rows": admin_candidates,
            "kenya": {"all_rows": country_counts.get("KE", 0), "feature_code_counts": dict(country_features["KE"].most_common())},
            "japan": {"all_rows": country_counts.get("JP", 0), "feature_code_counts": dict(country_features["JP"].most_common())},
            "kenya_japan_place_candidate_rows_by_code": dict(sorted(kj_candidates.items())),
            "admin1_reference_rows_checked": a1_refs, "admin1_reference_keys_not_found": a1_misses,
            "unique_unmatched_admin1_keys": len(a1_miss_keys),
            "sample_unmatched_admin1_keys": [{"key": k, "rows": v} for k, v in a1_miss_keys.most_common(30)],
            "admin2_reference_rows_checked": a2_refs, "admin2_reference_keys_not_found": a2_misses,
            "unique_unmatched_admin2_keys": len(a2_miss_keys),
            "sample_unmatched_admin2_keys": [{"key": k, "rows": v} for k, v in a2_miss_keys.most_common(30)],
        },
        "alternate_names": {
            "archive_member": aliases_member.filename, "archive_member_bytes": aliases_member.file_size,
            "archive_member_sha256": alias_hash.hexdigest(), "zip_member_crc_validation": alias_crc,
            "physical_rows": alias_rows, "rows_with_10_fields": alias_schema,
            "malformed_or_wrong_field_count_rows": alias_malformed,
            "invalid_alternate_name_id_rows": alias_bad_ids, "unique_valid_alternate_name_ids": len(alias_ids),
            "duplicate_alternate_name_id_rows": alias_duplicate_ids,
            "invalid_target_geoname_id_rows": alias_target_bad,
            "target_geoname_id_not_found_in_allCountries_snapshot": alias_target_unresolved,
            "english_language_rows": languages.get("en", 0), "blank_language_rows": languages.get("(blank)", 0),
            "top_20_language_counts": dict(languages.most_common(20)), "flagged_rows": dict(flags),
            "target_reference_note": "Missing targets are unresolved cross-file references, not automatic proof that an alias or place is invalid."
        },
        "admin1_crosswalk": admin1, "admin2_crosswalk": admin2,
        "source_summary": {
            "allCountries_rows": all_rows, "allCountries_valid_19_field_rows": schema_rows,
            "alternateNamesV2_rows": alias_rows, "alternateNamesV2_valid_10_field_rows": alias_schema,
            "admin1_rows": admin1["rows"], "admin1_unique_code_keys": admin1["unique_code_keys"],
            "admin2_rows": admin2["rows"], "admin2_unique_code_keys": admin2["unique_code_keys"],
            "allCountries_zip_crc": zip_crc, "alternateNamesV2_zip_crc": alias_crc,
            "malformed_rows_in_main_or_alias_files": malformed + alias_malformed,
            "duplicate_source_id_rows": duplicate_ids + alias_duplicate_ids,
        },
        "decision_boundary": {
            "database_writes": 0, "parent_links_created": 0, "records_marked_operational": 0,
            "iso_authority_verified": False,
        },
        "interpretation": [
            "These counts describe the official bytes fetched during this CI run, not a claim of worldwide completeness.",
            "The four uploaded files are compared by byte size only; exact byte identity is unconfirmed because attachment SHA-256 values were not computed.",
            "Feature codes and candidate counts do not automatically approve records for Job Grid selection.",
            "Unmatched administrative code keys are exact code-presence checks, not final invalid-record counts. Preserve raw codes and investigate exceptions separately.",
            "Alternate-name rows are aliases linked to existing GeoNames IDs, not separate places to insert into the catalog.",
            "No database, seed, import, migration, or deployment was touched. ISO authority verification remains false."
        ]
    }
    for name, item in files.items():
        item["sha256_match_uploaded"] = None
        item["size_comparison"] = "MATCH_BY_SIZE_ONLY" if item["uploaded_attachment_size_matches"] else "SIZE_DIFFERS_FROM_UPLOAD"
    (output_dir / "geonames-full-source-audit.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = [
        "# GeoNames full-source audit", "",
        f"Status: **{report['status']}**",
        f"Captured at UTC: {retrieved}", "",
        "| Source | Rows | Valid schema rows |", "|---|---:|---:|",
        f"| allCountries | {all_rows:,} | {schema_rows:,} |",
        f"| alternateNamesV2 | {alias_rows:,} | {alias_schema:,} |",
        f"| admin1CodesASCII | {admin1['rows']:,} | {admin1['rows'] - admin1['malformed_rows']:,} |",
        f"| admin2Codes | {admin2['rows']:,} | {admin2['rows'] - admin2['malformed_rows']:,} |", "",
        f"- Distinct country codes in allCountries: {report['all_countries']['distinct_nonblank_country_codes']:,}",
        f"- Kenya rows: {country_counts.get('KE', 0):,}; Japan rows: {country_counts.get('JP', 0):,}",
        f"- Current populated-place candidates: {place_candidates:,} (not auto-approved)",
        f"- Current administrative candidates: {admin_candidates:,} (not auto-approved)",
        f"- Unmatched admin1 reference rows: {a1_misses:,}; unmatched admin2 reference rows: {a2_misses:,}",
        f"- Alias targets absent from allCountries snapshot: {alias_target_unresolved:,}",
        f"- ZIP CRC: allCountries {zip_crc}; alternateNamesV2 {alias_crc}", "",
        "Uploaded attachment byte identity is not confirmed; the audit reports size comparisons only. No database writes, parent links, operational approvals, or ISO authority assertions were made."
    ]
    (output_dir / "geonames-full-source-audit.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--retrieved-at-utc", default=None)
    args = parser.parse_args()
    try:
        report = audit(args.source_dir, args.output_dir, args.retrieved_at_utc)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({"status": "BLOCKED_SOURCE_VALIDATION", "error": str(error)}), file=sys.stderr)
        return 2
    print(json.dumps({
        "status": report["status"], "source_summary": report["source_summary"],
        "kenya_rows": report["all_countries"]["kenya"]["all_rows"],
        "japan_rows": report["all_countries"]["japan"]["all_rows"],
        "files": {name: {"bytes": item["bytes"], "sha256": item["sha256"], "uploaded_size_matches": item["uploaded_attachment_size_matches"], "uploaded_byte_identity_confirmed": False} for name, item in report["files"].items()},
    }, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
