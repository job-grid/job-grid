#!/usr/bin/env python3
"""Compare a locally held, current ISO 3166-1 country-code CSV with GeoNames countryInfo.

Compliance boundary:
- This script does not download ISO content or send data anywhere.
- Keep the ISO snapshot and any private mismatch detail file outside Git.
- The default JSON report contains only counts and a SHA-256/file-size manifest.
- Do not paste the ISO snapshot, country names, code tuples, or private detail output into AI tools.
- This is a deterministic comparison, not a decision engine: mismatches remain review cases.

The CSV must be the current ISO 3166-1 country-code list, not ISO 3166-2 subdivisions
or ISO 3166-3 formerly used codes. Supply the exact CSV column labels with CLI flags.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ALPHA2_RE = re.compile(r"^[A-Z]{2}$")
ALPHA3_RE = re.compile(r"^[A-Z]{3}$")
NUMERIC3_RE = re.compile(r"^[0-9]{3}$")


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def clean(value: Any) -> str:
    return str(value or "").strip()


def read_iso_rows(
    path: Path, alpha2_column: str, alpha3_column: str, numeric_column: str
) -> tuple[list[dict[str, str]], int, Counter[str]]:
    rows: list[dict[str, str]] = []
    invalid_rows = 0
    duplicates: Counter[str] = Counter()
    seen = {"alpha2": Counter(), "alpha3": Counter(), "numeric3": Counter()}

    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fieldnames = reader.fieldnames or []
        headers = set(fieldnames)
        if len(fieldnames) != len(headers):
            raise ValueError("Snapshot CSV has duplicate column headers.")
        required = {alpha2_column, alpha3_column, numeric_column}
        missing = sorted(required - headers)
        if missing:
            raise ValueError(
                "Snapshot CSV is missing configured column headers. "
                "Adjust --alpha2-column, --alpha3-column, and --numeric-column."
            )

        for row in reader:
            if None in row or any(row.get(column) is None for column in required):
                invalid_rows += 1
                continue
            alpha2 = clean(row.get(alpha2_column)).upper()
            alpha3 = clean(row.get(alpha3_column)).upper()
            numeric3 = clean(row.get(numeric_column))
            if not (ALPHA2_RE.fullmatch(alpha2) and ALPHA3_RE.fullmatch(alpha3) and NUMERIC3_RE.fullmatch(numeric3)):
                invalid_rows += 1
                continue
            rows.append({"alpha2": alpha2, "alpha3": alpha3, "numeric3": numeric3})
            seen["alpha2"][alpha2] += 1
            seen["alpha3"][alpha3] += 1
            seen["numeric3"][numeric3] += 1

    for key, counts in seen.items():
        duplicates[key] = sum(1 for count in counts.values() if count > 1)
    return rows, invalid_rows, duplicates


def read_geonames_country_info(path: Path) -> tuple[list[dict[str, str]], int, int]:
    """Read GeoNames countryInfo fields ISO, ISO3 and ISO-Numeric (columns 1-3)."""
    rows: list[dict[str, str]] = []
    malformed = 0
    no_codes = 0

    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for raw_line in stream:
            line = raw_line.rstrip("\r\n")
            if not line or line.startswith("#"):
                continue
            fields = line.split("\t")
            # GeoNames countryInfo rows currently define 19 tab-separated fields.
            # Reject truncated rows rather than silently accepting a 3-field fragment.
            if len(fields) != 19:
                malformed += 1
                continue
            alpha2, alpha3, numeric3 = (clean(value) for value in fields[:3])
            # Empty or non-ISO-like values are retained as review candidates,
            # but not treated as verified ISO identifiers.
            if not (alpha2 or alpha3 or numeric3):
                no_codes += 1
                continue
            rows.append(
                {
                    "alpha2": alpha2.upper(),
                    "alpha3": alpha3.upper(),
                    "numeric3": numeric3,
                }
            )
    return rows, malformed, no_codes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iso-csv", required=True, type=Path, help="Local ISO 3166-1 current-code CSV; do not commit it.")
    parser.add_argument("--country-info", required=True, type=Path, help="Local GeoNames countryInfo.txt file.")
    parser.add_argument("--output", required=True, type=Path, help="Aggregate JSON report path; keep it free of country names/codes.")
    parser.add_argument("--source-url", required=True, help="Official source URL used to obtain the snapshot.")
    parser.add_argument("--retrieved-at-utc", required=True, help="Actual retrieval time in ISO-8601 UTC (e.g. 2026-10-10T19:00:00Z).")
    parser.add_argument("--alpha2-column", default="Alpha-2 code", help="Exact CSV header for alpha-2.")
    parser.add_argument("--alpha3-column", default="Alpha-3 code", help="Exact CSV header for alpha-3.")
    parser.add_argument("--numeric-column", default="Numeric code", help="Exact CSV header for numeric-3.")
    parser.add_argument("--private-details-path", type=Path, help="Optional local-only CSV containing specific code mismatches; never commit or paste into AI tools.")
    args = parser.parse_args()

    for path in (args.iso_csv, args.country_info):
        if not path.is_file():
            parser.error(f"Input file not found: {path}")

    repo_root = Path(__file__).resolve().parents[1]
    iso_path = args.iso_csv.resolve()
    country_info_path = args.country_info.resolve()
    output_path = args.output.resolve()
    private_details_path = args.private_details_path.resolve() if args.private_details_path is not None else None

    if iso_path == country_info_path:
        parser.error("ISO snapshot and GeoNames countryInfo input must be different files.")
    if output_path in {iso_path, country_info_path}:
        parser.error("aggregate report path must not overwrite either input file.")
    if private_details_path is not None:
        if private_details_path in {iso_path, country_info_path}:
            parser.error("row-level mismatch details path must not overwrite an input file.")
        if private_details_path == output_path:
            parser.error("row-level mismatch details and aggregate report must use different output paths.")

    restricted_paths = [
        ("ISO source snapshot", args.iso_csv),
        ("aggregate report", args.output),
    ]
    if args.private_details_path is not None:
        restricted_paths.append(("row-level mismatch details", args.private_details_path))
    for label, path in restricted_paths:
        resolved_path = path.resolve()
        try:
            resolved_path.relative_to(repo_root)
        except ValueError:
            continue
        parser.error(f"{label} must be stored outside the repository root: {repo_root}")

    parsed_source_url = urlparse(args.source_url)
    official_host = (parsed_source_url.hostname or "").lower()
    is_iso_host = official_host == "iso.org" or official_host.endswith(".iso.org")
    if parsed_source_url.scheme != "https" or not parsed_source_url.netloc:
        parser.error("--source-url must be an HTTPS URL identifying the actual official source used.")
    if not is_iso_host or parsed_source_url.username or parsed_source_url.password:
        parser.error("--source-url must use an official ISO-controlled hostname under iso.org and must not embed credentials.")

    try:
        retrieved_at = datetime.fromisoformat(args.retrieved_at_utc.replace("Z", "+00:00"))
        if retrieved_at.tzinfo is None or retrieved_at.utcoffset() != timedelta(0):
            raise ValueError("retrieval timestamp must include UTC timezone")
    except (ValueError, AttributeError):
        parser.error("--retrieved-at-utc must be an actual ISO-8601 UTC timestamp, e.g. 2026-10-10T19:00:00Z.")

    try:
        iso_rows, iso_invalid, iso_duplicates = read_iso_rows(
            args.iso_csv, args.alpha2_column, args.alpha3_column, args.numeric_column
        )
        geonames_rows, geonames_malformed, geonames_empty = read_geonames_country_info(args.country_info)
    except (OSError, UnicodeError, csv.Error, ValueError) as exc:
        print(f"INPUT_ERROR: {exc}", file=sys.stderr)
        return 2

    iso_by_alpha2 = {row["alpha2"]: row for row in iso_rows}
    iso_alpha2_set = set(iso_by_alpha2)
    geonames_alpha2_counts = Counter(
        row["alpha2"] for row in geonames_rows if ALPHA2_RE.fullmatch(row["alpha2"])
    )
    geonames_alpha2_set = set(geonames_alpha2_counts)

    alpha2_matches = 0
    alpha3_conflicts = 0
    numeric_conflicts = 0
    geonames_rows_without_iso_alpha2_match = 0
    invalid_geonames_alpha2 = 0
    private_mismatches: list[dict[str, str]] = []

    for row in geonames_rows:
        alpha2 = row["alpha2"]
        if not ALPHA2_RE.fullmatch(alpha2):
            invalid_geonames_alpha2 += 1
            continue
        iso_row = iso_by_alpha2.get(alpha2)
        if iso_row is None:
            geonames_rows_without_iso_alpha2_match += 1
            private_mismatches.append({
                "case": "geonames_alpha2_not_in_iso_snapshot",
                "alpha2": alpha2,
                "geonames_alpha3": row["alpha3"],
                "iso_alpha3": "",
                "geonames_numeric3": row["numeric3"],
                "iso_numeric3": "",
            })
            continue

        alpha2_matches += 1
        if row["alpha3"] != iso_row["alpha3"]:
            alpha3_conflicts += 1
            private_mismatches.append({
                "case": "alpha3_conflict_for_matching_alpha2",
                "alpha2": alpha2,
                "geonames_alpha3": row["alpha3"],
                "iso_alpha3": iso_row["alpha3"],
                "geonames_numeric3": row["numeric3"],
                "iso_numeric3": iso_row["numeric3"],
            })
        if row["numeric3"] != iso_row["numeric3"]:
            numeric_conflicts += 1
            private_mismatches.append({
                "case": "numeric3_conflict_for_matching_alpha2",
                "alpha2": alpha2,
                "geonames_alpha3": row["alpha3"],
                "iso_alpha3": iso_row["alpha3"],
                "geonames_numeric3": row["numeric3"],
                "iso_numeric3": iso_row["numeric3"],
            })

    iso_rows_without_geonames_alpha2_match = len(iso_alpha2_set - geonames_alpha2_set)

    snapshot_integrity_issues = bool(iso_invalid or any(iso_duplicates.values()) or not iso_rows)
    geonames_input_quality_issues = bool(
        geonames_malformed or geonames_empty or invalid_geonames_alpha2 or not geonames_rows
    )
    code_conflicts = bool(alpha3_conflicts or numeric_conflicts)
    if snapshot_integrity_issues:
        comparison_status = "BLOCKED_INVALID_SNAPSHOT"
    elif geonames_input_quality_issues:
        comparison_status = "BLOCKED_INVALID_GEONAMES_INPUT"
    elif alpha2_matches == 0:
        comparison_status = "BLOCKED_NO_SHARED_ALPHA2_CODES"
    elif code_conflicts:
        comparison_status = "MISMATCHES_FOUND_REVIEW_REQUIRED"
    else:
        comparison_status = "PASS_SHARED_CODE_FIELDS_UNMATCHED_CANDIDATES_REVIEW_REQUIRED"

    snapshot_bytes, snapshot_sha256 = sha256_file(args.iso_csv)
    report = {
        "report_type": "iso_3166_1_current_code_comparison",
        "status": comparison_status,
        "source_snapshot": {
            "source_url": args.source_url,
            "scope_assertion_by_operator": "ISO_3166_1_CURRENT_CODES_ONLY",
            "snapshot_scope_independently_verified": False,
            "retrieved_at_utc_asserted_by_operator": args.retrieved_at_utc,
            "filename": args.iso_csv.name,
            "bytes": snapshot_bytes,
            "sha256": snapshot_sha256,
            "snapshot_content_written_to_report": False,
        },
        "inputs": {
            "geonames_country_info_filename": args.country_info.name,
            "geoNames_country_info_source_sha256": sha256_file(args.country_info)[1],
        },
        "counts": {
            "iso_valid_rows": len(iso_rows),
            "iso_invalid_rows_excluded": iso_invalid,
            "iso_duplicate_alpha2_groups": iso_duplicates["alpha2"],
            "iso_duplicate_alpha3_groups": iso_duplicates["alpha3"],
            "iso_duplicate_numeric3_groups": iso_duplicates["numeric3"],
            "geonames_country_info_code_rows": len(geonames_rows),
            "geonames_malformed_rows": geonames_malformed,
            "geonames_rows_with_no_codes": geonames_empty,
            "geonames_invalid_alpha2_rows": invalid_geonames_alpha2,
            "unique_geonames_alpha2_candidates": len(geonames_alpha2_set),
            "geonames_rows_with_alpha2_found_in_iso": alpha2_matches,
            "geonames_rows_without_iso_alpha2_match": geonames_rows_without_iso_alpha2_match,
            "iso_alpha2_codes_without_geonames_country_info_match": iso_rows_without_geonames_alpha2_match,
            "alpha3_conflict_rows_for_matching_alpha2": alpha3_conflicts,
            "numeric3_conflict_rows_for_matching_alpha2": numeric_conflicts,
        },
        "interpretation": [
            "Counts are a deterministic comparison summary, not an authorization to change catalog data.",
            "No code tuple, country name, or row-level ISO content is included in this report.",
            "Unmatched GeoNames-only codes remain review cases; they are not automatically invalid.",
            "No source data is uploaded, downloaded, or transmitted by this script.",
        ],
        "governance": {
            "database_operations": False,
            "migrations_or_seeds": False,
            "production_or_deployment_changes": False,
            "source_snapshot_committed_by_script": False,
        },
    }

    if args.private_details_path:
        args.private_details_path.parent.mkdir(parents=True, exist_ok=True)
        with args.private_details_path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=[
                "case", "alpha2", "geonames_alpha3", "iso_alpha3", "geonames_numeric3", "iso_numeric3"
            ])
            writer.writeheader()
            writer.writerows(private_mismatches)
        report["private_details"] = {
            "written_locally": True,
            "filename": args.private_details_path.name,
            "warning": "Contains specific code values. Keep outside Git and never paste into AI tools.",
        }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": report["status"],
        "report_path": str(args.output),
        "iso_snapshot_bytes": snapshot_bytes,
        "iso_snapshot_sha256": snapshot_sha256,
        "counts": report["counts"],
        "note": "Aggregate only; no country names or code values printed.",
    }, indent=2))
    if snapshot_integrity_issues or geonames_input_quality_issues or alpha2_matches == 0:
        return 2
    return 1 if code_conflicts else 0


if __name__ == "__main__":
    raise SystemExit(main())
