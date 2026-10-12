#!/usr/bin/env python3
"""Build a streamed GeoNames place/admin candidate package; never enables live selection.

Scope:
- every feature-class P row (current candidates, historical/noncurrent, or explicit review hold);
- every feature-class A row whose feature code starts with ADM (current ADM1-ADM5 candidate, or review hold).

Raw source IDs/codes and names are retained. Country code matches countryInfo metadata only;
it does not verify ISO assignment, administrative parentage, product selectability, or completeness
of real-world destinations. Output is a review artifact, not a database seed.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ID_RE = re.compile(r"^[0-9]+$")
CURRENT_PLACE_CODES = {
    "PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5",
    "PPLC", "PPLCD", "PPLF", "PPLG", "PPLL", "PPLR", "PPLS",
}
NONCURRENT_PLACE_CODES = {"PPLCH", "PPLH", "PPLQ", "PPLW"}
CURRENT_ADMIN_CODES = {"ADM1", "ADM2", "ADM3", "ADM4", "ADM5"}
FIELD_COUNT = 19
OUTPUT_FIELDS = [
    "geonames_id", "name", "ascii_name", "alternate_names_inline",
    "latitude_raw", "longitude_raw", "coordinate_validation_status", "feature_class", "feature_code",
    "source_country_code_raw", "country_info_geonames_id",
    "country_info_name", "country_info_alpha3_raw", "country_info_numeric3_raw",
    "country_assignment_status", "candidate_kind", "source_disposition",
    "record_status_proposal", "proposed_selectable_as_destination",
    "operational_selectable", "parent_resolution_status",
    "raw_admin1_code", "raw_admin2_code", "raw_admin3_code", "raw_admin4_code",
    "population_raw", "source_modified_date", "source_record_identity_status",
    "parent_link_created"
]


def sha256_path(path: Path) -> tuple[int, str]:
    d = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            size += len(block)
            d.update(block)
    return size, d.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def verify_country_info(path: Path, manifest_path: Path):
    manifest = read_json(manifest_path)
    records = [x for x in manifest.get("remote_sources", []) if x.get("source_role") == "country-metadata"]
    if len(records) != 1:
        raise ValueError("Exactly one fingerprinted GeoNames country-metadata source is required.")
    source = records[0]
    size, digest = sha256_path(path)
    if source.get("http_status") != 200 or size != source.get("size_bytes") or digest != source.get("sha256"):
        raise ValueError("GeoNames countryInfo byte count or SHA-256 does not match the source manifest.")
    by_alpha2 = {}
    by_id = {}
    rows = 0
    malformed = 0
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        if not raw or raw.startswith("#"):
            continue
        fields = raw.split("\t")
        if len(fields) != FIELD_COUNT or not fields[4].strip() or not ID_RE.fullmatch(fields[16].strip()):
            malformed += 1
            continue
        rows += 1
        alpha2 = fields[0].strip().upper()
        row = {
            "alpha2": alpha2, "alpha3": fields[1].strip().upper(),
            "numeric3": fields[2].strip(), "name": fields[4].strip(),
            "geonames_id": fields[16].strip()
        }
        if alpha2 in by_alpha2:
            raise ValueError(f"Duplicate countryInfo alpha-2 identifier {alpha2}.")
        if row["geonames_id"] in by_id:
            raise ValueError(f"Duplicate countryInfo GeoNames ID {row['geonames_id']}.")
        by_alpha2[alpha2] = row
        by_id[row["geonames_id"]] = row
    if malformed or rows == 0:
        raise ValueError(f"countryInfo has malformed rows={malformed} or is empty.")
    return by_alpha2, by_id, {"rows": rows, "bytes": size, "sha256": digest, **source}


def coordinate_status(latitude: str, longitude: str):
    """Classify coordinates without dropping any source row."""
    lat, lon = (latitude or "").strip(), (longitude or "").strip()
    if not lat or not lon:
        return "MISSING_WGS84"
    try:
        lat_value, lon_value = float(lat), float(lon)
    except (TypeError, ValueError, OverflowError):
        return "INVALID_WGS84"
    if not math.isfinite(lat_value) or not math.isfinite(lon_value):
        return "INVALID_WGS84"
    if not (-90 <= lat_value <= 90 and -180 <= lon_value <= 180):
        return "INVALID_WGS84"
    return "VALID_WGS84"


def classify_country(code: str, country_by_code: dict, exception_by_id: dict):
    raw = (code or "").strip().upper()
    if not raw:
        return None, "BLANK_SOURCE_COUNTRY_CODE"
    row = country_by_code.get(raw)
    if not row:
        return None, "NO_COUNTRYINFO_ALPHA2_MATCH"
    exception = exception_by_id.get(row["geonames_id"])
    if exception and exception.get("catalog_role") == "historical_reference":
        return row, "SOURCE_CODE_MATCHES_HISTORICAL_ENTITY__HOLD"
    if exception and exception.get("catalog_role") == "current_destination_area":
        return row, "SOURCE_CODE_MATCHES_SPECIAL_DESTINATION_AREA__REVIEW_CROSSWALK"
    return row, "COUNTRYINFO_ALPHA2_MATCH_ONLY__NOT_AN_APPROVED_INTERNAL_LINK"


def classify_feature(feature_class: str, feature_code: str):
    fc, code = feature_class.strip(), feature_code.strip()
    if fc == "P":
        if code in CURRENT_PLACE_CODES:
            return "populated_place", "CURRENT_PLACE_CANDIDATE", "candidate"
        if code in NONCURRENT_PLACE_CODES:
            return "populated_place", "HELD_HISTORICAL_OR_NONCURRENT_PLACE", "review_required"
        if code.startswith("PPL"):
            return "populated_place", "HELD_OTHER_PPL_FAMILY_TYPE", "review_required"
        return "populated_feature", "HELD_OTHER_POPULATED_FEATURE_TYPE", "review_required"
    if fc == "A" and code.startswith("ADM"):
        if code in CURRENT_ADMIN_CODES:
            return "administrative_area", "CURRENT_ADMINISTRATIVE_AREA_CANDIDATE", "candidate"
        return "administrative_area", "HELD_HISTORICAL_OR_UNSPECIFIED_ADMIN_LEVEL", "review_required"
    return None


def export_candidates(all_countries: Path, country_info_path: Path, country_manifest_path: Path,
                      master_report_path: Path, exception_manifest_path: Path, output_dir: Path):
    country_by_code, _, country_source = verify_country_info(country_info_path, country_manifest_path)
    master = read_json(master_report_path)
    if master.get("status") not in {
        "PASS_GEO_NAMES_COUNTRY_IDENTITY_AUDIT",
        "PASS_GEO_NAMES_COUNTRY_IDENTITY_WITH_REVIEW_ITEMS"
    }:
        raise ValueError("The source-pinned global country-master audit did not pass.")
    source = master.get("sources", {}).get("all_countries_archive", {})
    expected_member_sha = source.get("member_sha256")
    if not re.fullmatch(r"[a-f0-9]{64}", str(expected_member_sha or "")):
        raise ValueError("The global source audit did not provide an allCountries member checksum.")
    exception_manifest = read_json(exception_manifest_path)
    if exception_manifest.get("schema_version") != 1:
        raise ValueError("Country-code exception manifest version is unsupported.")
    exception_by_id = {str(x["geonames_id"]): x for x in exception_manifest.get("records", [])}
    if len(exception_by_id) != len(exception_manifest.get("records", [])):
        raise ValueError("Country-code exception manifest contains duplicate source IDs.")

    output_dir.mkdir(parents=True, exist_ok=True)
    gz_path = output_dir / "worldwide-geonames-destination-candidates.csv.gz"
    all_digest = hashlib.sha256()
    source_rows = scope_rows = emitted_rows = malformed_rows = invalid_id_rows = 0
    duplicate_ids = 0
    disposition_counts = Counter()
    country_assignment_counts = Counter()
    coordinate_status_counts = Counter()
    empty_canonical_name_rows = 0
    invalid_coordinate_rows = 0
    missing_coordinate_rows = 0
    record_quality_hold_rows = 0
    by_code = defaultdict(Counter)
    seen_ids = set()

    with all_countries.open("rb") as source_stream, gzip.open(gz_path, "wt", encoding="utf-8", newline="", compresslevel=6) as dest_stream:
        writer = csv.DictWriter(dest_stream, fieldnames=OUTPUT_FIELDS, extrasaction="raise", lineterminator="\n")
        writer.writeheader()
        for raw in source_stream:
            all_digest.update(raw)
            source_rows += 1
            try:
                fields = raw.decode("utf-8").rstrip("\r\n").split("\t")
            except UnicodeDecodeError:
                malformed_rows += 1
                continue
            if len(fields) != FIELD_COUNT:
                malformed_rows += 1
                continue
            fc, code = fields[6].strip(), fields[7].strip()
            classified = classify_feature(fc, code)
            if classified is None:
                continue
            scope_rows += 1
            geonames_id = fields[0].strip()
            if not ID_RE.fullmatch(geonames_id):
                invalid_id_rows += 1
                continue
            if geonames_id in seen_ids:
                duplicate_ids += 1
            else:
                seen_ids.add(geonames_id)

            kind, disposition, proposed_status = classified
            name = fields[1].strip()
            coordinates = coordinate_status(fields[4], fields[5])
            coordinate_status_counts[coordinates] += 1
            if coordinates == "INVALID_WGS84":
                invalid_coordinate_rows += 1
                disposition = "HELD_INVALID_WGS84_COORDINATES"
                proposed_status = "review_required"
                record_quality_hold_rows += 1
            elif coordinates == "MISSING_WGS84":
                missing_coordinate_rows += 1
            if not name:
                empty_canonical_name_rows += 1
                disposition = "HELD_MISSING_CANONICAL_NAME"
                proposed_status = "review_required"
                record_quality_hold_rows += 1
            source_country = fields[8].strip()
            country, country_status = classify_country(source_country, country_by_code, exception_by_id)
            if country_status == "SOURCE_CODE_MATCHES_HISTORICAL_ENTITY__HOLD":
                # Historical country code must not turn children into current destination options.
                if proposed_status == "candidate":
                    disposition = "HELD_PARENT_COUNTRY_ENTITY_HISTORICAL"
                    proposed_status = "review_required"
            if country_status in {"BLANK_SOURCE_COUNTRY_CODE", "NO_COUNTRYINFO_ALPHA2_MATCH"} and proposed_status == "candidate":
                disposition = "HELD_COUNTRY_ASSIGNMENT_UNRESOLVED"
                proposed_status = "review_required"

            if proposed_status == "candidate":
                catalog_status = "candidate"
            else:
                catalog_status = "review_required"

            out = {
                "geonames_id": geonames_id,
                "name": fields[1], "ascii_name": fields[2],
                "alternate_names_inline": fields[3],
                "latitude_raw": fields[4], "longitude_raw": fields[5],
                "coordinate_validation_status": coordinates,
                "feature_class": fc, "feature_code": code,
                "source_country_code_raw": source_country,
                "country_info_geonames_id": country["geonames_id"] if country else "",
                "country_info_name": country["name"] if country else "",
                "country_info_alpha3_raw": country["alpha3"] if country else "",
                "country_info_numeric3_raw": country["numeric3"] if country else "",
                "country_assignment_status": country_status,
                "candidate_kind": kind,
                "source_disposition": disposition,
                "record_status_proposal": catalog_status,
                "proposed_selectable_as_destination": "false",
                "operational_selectable": "false",
                "parent_resolution_status": "UNVERIFIED_RAW_CODES_ONLY" if any(fields[i].strip() for i in (10, 11, 12, 13)) else "NO_PARENT_INFERRED",
                "raw_admin1_code": fields[10], "raw_admin2_code": fields[11],
                "raw_admin3_code": fields[12], "raw_admin4_code": fields[13],
                "population_raw": fields[14],
                "source_modified_date": fields[18],
                "source_record_identity_status": "BLOCKED_EMPTY_CANONICAL_NAME" if not name else "SOURCE_ID_SHAPE_VALID__IDENTITY_REVIEW_PENDING",
                "parent_link_created": "false",
            }
            writer.writerow(out)
            emitted_rows += 1
            disposition_counts[disposition] += 1
            country_assignment_counts[country_status] += 1
            by_code[source_country or "(blank)"][disposition] += 1
            by_code[source_country or "(blank)"]["scope_rows"] += 1

    if source_rows != int(master["counts"]["all_countries_rows_scanned"]):
        raise ValueError(f"AllCountries rows scanned mismatch: exporter={source_rows}, identity audit={master['counts']['all_countries_rows_scanned']}.")
    if all_digest.hexdigest() != expected_member_sha:
        raise ValueError("The streamed allCountries.txt digest changed since the pinned global audit.")
    if scope_rows != emitted_rows + invalid_id_rows:
        raise ValueError("Destination selector scope does not reconcile to emitted rows plus invalid source IDs.")
    if invalid_id_rows or duplicate_ids or malformed_rows:
        raise ValueError(f"Candidate export blocked: malformed={malformed_rows}, invalid IDs={invalid_id_rows}, duplicate IDs={duplicate_ids}.")
    if len(seen_ids) != emitted_rows:
        raise ValueError("Candidate IDs did not reconcile to output row count.")
    if sum(disposition_counts.values()) != emitted_rows:
        raise ValueError("Every candidate row must have exactly one source disposition.")
    if sum(v["scope_rows"] for v in by_code.values()) != emitted_rows:
        raise ValueError("Per-country candidate scope totals do not reconcile to the row-level export.")

    bucket_rows = []
    for raw_code, values in sorted(by_code.items()):
        bucket_rows.append({"source_country_code": raw_code, **dict(sorted(values.items()))})
    report = {
        "schema_version": 1,
        "audit": "geonames-global-destination-candidate-export",
        "generated_at_utc": utc_now(),
        "status": "PASS_SOURCE_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED",
        "scope": {
            "include_all_feature_class_P_rows": True,
            "include_feature_class_A_with_ADM_prefix": True,
            "disposition_rules": {
                "current_place_candidates": sorted(CURRENT_PLACE_CODES),
                "held_historical_noncurrent_place_codes": sorted(NONCURRENT_PLACE_CODES),
                "other_PPL_family": "review-held",
                "other_feature_class_P": "review-held",
                "current_administrative_candidates": sorted(CURRENT_ADMIN_CODES),
                "historical_or_unspecified_administrative_types": "review-held"
            },
            "rows_outside_this_selector_scope": "All other source rows are omitted from this destination-candidate file and remain represented in the global source scan/feature-class audit."
        },
        "sources": {
            "geonames_allcountries_text_sha256": all_digest.hexdigest(),
            "geonames_allcountries_archive_sha256": source.get("sha256"),
            "geonames_allcountries_retrieved_at_utc": source.get("retrieved_at_utc"),
            "country_info_sha256": country_source["sha256"],
            "country_info_source_url": country_source["source_url"],
            "exception_manifest": exception_manifest_path.name,
        },
        "counts": {
            "allcountries_source_rows_scanned": source_rows,
            "destination_scope_rows": scope_rows,
            "candidate_file_rows": emitted_rows,
            "disposition_totals": dict(sorted(disposition_counts.items())),
            "source_country_assignment_totals": dict(sorted(country_assignment_counts.items())),
            "distinct_source_country_code_buckets_in_scope": len(by_code),
            "duplicate_candidate_geonames_ids": duplicate_ids,
            "invalid_candidate_ids": invalid_id_rows,
            "malformed_source_lines": malformed_rows,
            "empty_canonical_name_rows": empty_canonical_name_rows,
            "invalid_coordinate_rows": invalid_coordinate_rows,
            "missing_coordinate_rows": missing_coordinate_rows,
            "coordinate_validation_status_totals": dict(sorted(coordinate_status_counts.items())),
            "record_quality_hold_rows": record_quality_hold_rows,
            "unique_candidate_source_ids": len(seen_ids),
            "operational_selectable_rows": 0,
            "parent_links_created": 0,
            "rows_with_verified_parent_links": 0,
            "worldwide_real_world_destination_completeness": "NOT_ESTABLISHED",
        },
        "destination_scope_by_source_country_code": bucket_rows,
        "interpretation": {
            "scope_source_rows_account_for": "all feature-class P rows plus all class-A rows with ADM-prefixed feature codes",
            "country_assignment": "source-country code joined to GeoNames countryInfo alpha-2 metadata only; does not establish ISO authority, jurisdiction policy or verified internal-country identity",
            "administrative_parentage": "raw admin1-admin4 fields retained only; no parent paths are inferred or written",
            "operational_selectability": "false for every exported row until internal UUID, approved country mapping, place identity, feature scope and UI/security policy are implemented",
            "database_or_production_changes": False
        }
    }
    report_path = output_dir / "worldwide-geonames-destination-candidate-export-summary.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report, gz_path, report_path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--all-countries-text", required=True, type=Path)
    p.add_argument("--country-info", required=True, type=Path)
    p.add_argument("--country-info-manifest", required=True, type=Path)
    p.add_argument("--country-master-audit", required=True, type=Path)
    p.add_argument("--exception-dispositions", required=True, type=Path)
    p.add_argument("--output-dir", required=True, type=Path)
    a = p.parse_args()
    try:
        report, csv_gz, summary = export_candidates(a.all_countries_text, a.country_info, a.country_info_manifest,
            a.country_master_audit, a.exception_dispositions, a.output_dir)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, gzip.BadGzipFile) as exc:
        print(f"BLOCKED_DESTINATION_CANDIDATE_EXPORT: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"status": report["status"], "summary_path": str(summary), "candidate_file": str(csv_gz), **report["counts"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
