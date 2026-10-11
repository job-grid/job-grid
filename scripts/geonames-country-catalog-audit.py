#!/usr/bin/env python3
"""Audit GeoNames countryInfo metadata against PCLI entities in allCountries.zip.

The aggregate report intentionally contains no country names, ISO code tuples, or
GeoNames IDs. Keep source files and any future row-level mismatch exports local.
This is an identity/shape audit, not an ISO 3166 authority comparison and not a
claim of worldwide product completeness.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXPECTED_FIELDS = 19
ALPHA2_RE = re.compile(r"^[A-Z]{2}$")
ALPHA3_RE = re.compile(r"^[A-Z]{3}$")
NUMERIC3_RE = re.compile(r"^[0-9]{3}$")
ID_RE = re.compile(r"^[0-9]+$")
CURRENT_COUNTRY_FEATURE_CODES = {"PCL", "PCLD", "PCLF", "PCLI", "PCLIX", "PCLS", "TERR"}
HISTORICAL_COUNTRY_FEATURE_CODES = {"PCLH"}


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def duplicate_group_count(values: list[str]) -> int:
    counts = Counter(value for value in values if value)
    return sum(1 for count in counts.values() if count > 1)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_country_info(path: Path) -> tuple[dict[str, Any], set[str]]:
    ids: list[str] = []
    alpha2: list[str] = []
    alpha3: list[str] = []
    numeric3: list[str] = []
    malformed_rows = 0
    missing_id_rows = 0
    blank_alpha2_rows = 0
    blank_alpha3_rows = 0
    blank_numeric3_rows = 0
    invalid_alpha2_rows = 0
    invalid_alpha3_rows = 0
    invalid_numeric3_rows = 0
    row_count = 0

    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for raw_line in stream:
            line = raw_line.rstrip("\r\n")
            if not line or line.startswith("#"):
                continue
            row_count += 1
            fields = line.split("\t")
            if len(fields) != EXPECTED_FIELDS:
                malformed_rows += 1
                continue

            a2, a3, numeric = (fields[0].strip().upper(), fields[1].strip().upper(), fields[2].strip())
            geoname_id = fields[16].strip()
            if not ID_RE.fullmatch(geoname_id):
                missing_id_rows += 1
            else:
                ids.append(geoname_id)

            if not a2:
                blank_alpha2_rows += 1
            elif not ALPHA2_RE.fullmatch(a2):
                invalid_alpha2_rows += 1
            else:
                alpha2.append(a2)

            if not a3:
                blank_alpha3_rows += 1
            elif not ALPHA3_RE.fullmatch(a3):
                invalid_alpha3_rows += 1
            else:
                alpha3.append(a3)

            if not numeric:
                blank_numeric3_rows += 1
            elif not NUMERIC3_RE.fullmatch(numeric):
                invalid_numeric3_rows += 1
            else:
                numeric3.append(numeric)

    metrics = {
        "country_info_rows": row_count,
        "country_info_malformed_rows": malformed_rows,
        "country_info_rows_missing_numeric_geoname_id": missing_id_rows,
        "country_info_duplicate_geoname_id_groups": duplicate_group_count(ids),
        "country_info_blank_alpha2_rows": blank_alpha2_rows,
        "country_info_blank_alpha3_rows": blank_alpha3_rows,
        "country_info_blank_numeric3_rows": blank_numeric3_rows,
        "country_info_invalid_alpha2_rows": invalid_alpha2_rows,
        "country_info_invalid_alpha3_rows": invalid_alpha3_rows,
        "country_info_invalid_numeric3_rows": invalid_numeric3_rows,
        "country_info_duplicate_alpha2_groups": duplicate_group_count(alpha2),
        "country_info_duplicate_alpha3_groups": duplicate_group_count(alpha3),
        "country_info_duplicate_numeric3_groups": duplicate_group_count(numeric3),
    }
    return metrics, set(ids)


def scan_country_entities(path: Path) -> tuple[dict[str, Any], set[str], set[str], set[str], set[str], str, str, str]:
    archive_size, archive_sha = sha256_file(path)
    country_entity_ids: list[str] = []
    current_country_ids: list[str] = []
    historical_country_ids: list[str] = []
    pcli_ids: list[str] = []
    malformed_rows = 0
    total_rows = 0
    member_digest = hashlib.sha256()
    member_name = ""

    with zipfile.ZipFile(path, "r") as archive:
        candidates = [name for name in archive.namelist() if name == "allCountries.txt" or name.endswith("/allCountries.txt")]
        if len(candidates) != 1:
            raise ValueError("Archive must contain exactly one allCountries.txt member.")
        member_name = candidates[0]
        with archive.open(member_name, "r") as member:
            for raw_line in member:
                member_digest.update(raw_line)
                total_rows += 1
                try:
                    line = raw_line.decode("utf-8").rstrip("\r\n")
                except UnicodeDecodeError:
                    malformed_rows += 1
                    continue
                fields = line.split("\t")
                if len(fields) != EXPECTED_FIELDS:
                    malformed_rows += 1
                    continue
                if fields[6] != "A":
                    continue
                feature_code = fields[7]
                if feature_code == "PCLI":
                    geoname_id = fields[0].strip()
                    if ID_RE.fullmatch(geoname_id):
                        pcli_ids.append(geoname_id)
                    else:
                        malformed_rows += 1
                if feature_code in CURRENT_COUNTRY_FEATURE_CODES or feature_code in HISTORICAL_COUNTRY_FEATURE_CODES:
                    geoname_id = fields[0].strip()
                    if not ID_RE.fullmatch(geoname_id):
                        malformed_rows += 1
                        continue
                    country_entity_ids.append(geoname_id)
                    if feature_code in CURRENT_COUNTRY_FEATURE_CODES:
                        current_country_ids.append(geoname_id)
                    else:
                        historical_country_ids.append(geoname_id)

    metrics = {
        "all_countries_rows_scanned": total_rows,
        "all_countries_malformed_rows": malformed_rows,
        "pcli_rows": len(pcli_ids),
        "pcli_duplicate_geoname_id_groups": duplicate_group_count(pcli_ids),
        "current_or_territory_country_feature_rows": len(current_country_ids),
        "current_or_territory_duplicate_geoname_id_groups": duplicate_group_count(current_country_ids),
        "historical_political_feature_rows": len(historical_country_ids),
        "historical_political_duplicate_geoname_id_groups": duplicate_group_count(historical_country_ids),
        "recognized_country_entity_rows": len(country_entity_ids),
        "recognized_country_entity_duplicate_geoname_id_groups": duplicate_group_count(country_entity_ids),
    }
    return (
        metrics,
        set(country_entity_ids),
        set(current_country_ids),
        set(historical_country_ids),
        set(pcli_ids),
        member_digest.hexdigest(),
        archive_sha,
        member_name,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all-countries-zip", required=True, type=Path)
    parser.add_argument("--country-info", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    for path in (args.all_countries_zip, args.country_info):
        if not path.is_file():
            parser.error(f"Required input file does not exist: {path.name}")

    try:
        country_bytes, country_sha = sha256_file(args.country_info)
        country_metrics, country_ids = read_country_info(args.country_info)
        entity_metrics, country_entity_ids, current_country_ids, historical_country_ids, pcli_ids, member_sha, archive_sha, member_name = scan_country_entities(args.all_countries_zip)
        archive_bytes = args.all_countries_zip.stat().st_size
    except (OSError, UnicodeError, zipfile.BadZipFile, ValueError) as exc:
        print(f"BLOCKED_INPUT: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    counts = {**country_metrics, **entity_metrics}
    counts["country_info_ids_matching_pcli"] = len(country_ids & pcli_ids)
    counts["country_info_ids_not_pcli"] = len(country_ids - pcli_ids)
    counts["pcli_ids_without_country_info"] = len(pcli_ids - country_ids)
    counts["country_info_ids_matching_current_or_territory_feature"] = len(country_ids & current_country_ids)
    counts["country_info_ids_matching_historical_political_feature"] = len(country_ids & historical_country_ids)
    counts["country_info_ids_matching_any_recognized_country_feature"] = len(country_ids & country_entity_ids)
    counts["country_info_ids_without_recognized_country_feature"] = len(country_ids - country_entity_ids)
    counts["current_or_territory_feature_ids_without_country_info"] = len(current_country_ids - country_ids)

    structural_issues = (
        counts["country_info_rows"] == 0
        or counts["country_info_malformed_rows"] > 0
        or counts["country_info_rows_missing_numeric_geoname_id"] > 0
        or counts["country_info_duplicate_geoname_id_groups"] > 0
        or counts["country_info_blank_alpha2_rows"] > 0
        or counts["country_info_blank_alpha3_rows"] > 0
        or counts["country_info_blank_numeric3_rows"] > 0
        or counts["country_info_invalid_alpha2_rows"] > 0
        or counts["country_info_invalid_alpha3_rows"] > 0
        or counts["country_info_duplicate_alpha2_groups"] > 0
        or counts["country_info_duplicate_alpha3_groups"] > 0
        or counts["country_info_duplicate_numeric3_groups"] > 0
        or counts["all_countries_rows_scanned"] == 0
        or counts["all_countries_malformed_rows"] > 0
        or counts["pcli_rows"] == 0
        or counts["pcli_duplicate_geoname_id_groups"] > 0
        or counts["current_or_territory_duplicate_geoname_id_groups"] > 0
        or counts["historical_political_duplicate_geoname_id_groups"] > 0
        or counts["recognized_country_entity_duplicate_geoname_id_groups"] > 0
        or counts["country_info_ids_without_recognized_country_feature"] > 0
        or counts["pcli_ids_without_country_info"] > 0
    )
    review_items = (
        counts["country_info_invalid_numeric3_rows"] > 0
        or counts["country_info_ids_matching_historical_political_feature"] > 0
        or counts["current_or_territory_feature_ids_without_country_info"] > 0
    )

    report = {
        "schema_version": 1,
        "audit": "geonames-country-info-vs-country-feature-identity",
        "generated_at_utc": utc_now(),
        "status": "BLOCKED_REVIEW_REQUIRED" if structural_issues else ("PASS_GEO_NAMES_COUNTRY_IDENTITY_WITH_REVIEW_ITEMS" if review_items else "PASS_GEO_NAMES_COUNTRY_IDENTITY_AUDIT"),
        "sources": {
            "country_info": {
                "filename": args.country_info.name,
                "bytes": country_bytes,
                "sha256": country_sha,
                "raw_rows_or_country_values_in_report": False,
            },
            "all_countries_archive": {
                "filename": args.all_countries_zip.name,
                "bytes": archive_bytes,
                "sha256": archive_sha,
                "member_name": member_name,
                "member_sha256": member_sha,
                "raw_rows_or_country_values_in_report": False,
            },
        },
        "counts": counts,
        "interpretation": {
            "country_info_to_recognized_country_feature_id_join": "PASS" if counts["country_info_ids_without_recognized_country_feature"] == 0 else "BLOCKED",
            "current_or_territory_feature_to_country_info_id_join": "PASS" if counts["current_or_territory_feature_ids_without_country_info"] == 0 else "REVIEW_SCOPE_ONLY",
            "pcli_to_country_info_id_join": "PASS" if counts["pcli_ids_without_country_info"] == 0 else "BLOCKED",
            "numeric3_format_review_required": counts["country_info_invalid_numeric3_rows"],
            "historical_country_metadata_rows_review_required": counts["country_info_ids_matching_historical_political_feature"],
            "iso3166_authority_comparison": "NOT_PERFORMED",
            "catalog_acceptance": "BLOCKED_PENDING_ISO_REVIEW_AND_OTHER_ACCEPTANCE_GATES",
            "worldwide_product_completeness": "NOT_ESTABLISHED_BY_THIS_AUDIT",
            "admin_parent_links_created": 0,
            "raw_country_code_tuples_in_report": False,
            "source_rows_in_report": False,
        },
        "limitations": [
            "This is a GeoNames country metadata to recognized country/political-feature identity and shape audit only.",
            "PCLI is only the independent-political-entity subset; countryInfo entries may be represented by other country-level or territorial feature codes.",
            "Historical political entities and numeric-code format anomalies remain review items, not automatic replacements or deletions.",
            "It does not use an ISO 3166 snapshot and does not close the separate ISO authority comparison gate.",
            "It does not establish that Job Grid has complete worldwide geographic product coverage.",
            "The aggregate report intentionally omits country names, ISO code tuples, and GeoNames IDs.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "counts": counts, "report_path": str(args.output)}, indent=2))
    return 1 if structural_issues else 0


if __name__ == "__main__":
    raise SystemExit(main())