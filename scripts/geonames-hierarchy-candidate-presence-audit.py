#!/usr/bin/env python3
"""Read-only audit of GeoNames admin crosswalk candidate presence.

The tool checks composite-key availability and verifies that IDs referenced by
resolved crosswalk entries occur in the sample as same-country administrative
features. It emits no parent_id assignments and does not approve parent links.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_SAMPLE_FIELDS = {
    "geonameid", "feature_class", "feature_code", "country_code",
    "admin1_code", "admin2_code",
}
ISSUE_FIELDS = [
    "child_geonames_id", "country_code", "feature_code",
    "raw_admin1_code", "raw_admin2_code", "issue",
]


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def read_crosswalk(path: Path) -> tuple[dict[str, dict[str, str]], int, int]:
    mapping: dict[str, dict[str, str]] = {}
    malformed = 0
    duplicate_keys = 0
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        for line in stream:
            line = line.rstrip("\r\n")
            if not line:
                continue
            fields = line.split("\t")
            if len(fields) < 4 or not fields[0] or not fields[3]:
                malformed += 1
                continue
            key = fields[0]
            if key in mapping:
                duplicate_keys += 1
                continue
            mapping[key] = {"name": fields[1], "ascii_name": fields[2], "geonames_id": fields[3]}
    return mapping, malformed, duplicate_keys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, type=Path, help="Local GeoNames source directory.")
    parser.add_argument(
        "--sample-relative-path",
        default="sample-output-20261010-163234/geonames_places_sample.tsv",
        help="Sample TSV path relative to --source-root.",
    )
    parser.add_argument("--output-dir", required=True, type=Path, help="New output directory outside the Git repository.")
    args = parser.parse_args()

    source_root = args.source_root.resolve()
    script_path = Path(__file__).resolve()
    repo_root = next((parent for parent in script_path.parents if (parent / ".git").exists()), None)
    output_dir = args.output_dir.resolve()
    if not source_root.is_dir():
        parser.error(f"Source root is not a directory: {source_root}")
    if is_within(output_dir, source_root):
        parser.error(f"Output directory must be outside the source root: {source_root}")
    if repo_root is not None and is_within(output_dir, repo_root):
        parser.error(f"Output directory must be outside the repository root: {repo_root}")
    if output_dir.exists():
        parser.error(f"Output directory already exists; refusing to overwrite: {output_dir}")

    sample_path = (source_root / args.sample_relative_path).resolve()
    if not is_within(sample_path, source_root):
        parser.error("--sample-relative-path must stay within --source-root.")

    admin1_path = source_root / "admin1CodesASCII.txt"
    admin2_path = source_root / "admin2Codes.txt"
    input_paths = {
        "sample": sample_path,
        "admin1": admin1_path,
        "admin2": admin2_path,
    }
    for key, path in input_paths.items():
        if not path.is_file():
            parser.error(f"Missing {key} input file: {path}")

    admin1, admin1_malformed, admin1_duplicates = read_crosswalk(admin1_path)
    admin2, admin2_malformed, admin2_duplicates = read_crosswalk(admin2_path)

    rows: list[dict[str, str]] = []
    by_id: dict[str, dict[str, str]] = {}
    malformed_sample_rows = 0
    duplicate_sample_ids = 0
    with sample_path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if not REQUIRED_SAMPLE_FIELDS.issubset(set(reader.fieldnames or [])):
            parser.error("Sample TSV is missing required column headers.")
        for row in reader:
            if None in row or any(row.get(name) is None for name in REQUIRED_SAMPLE_FIELDS):
                malformed_sample_rows += 1
                continue
            row = {key: (value or "").strip() for key, value in row.items()}
            rows.append(row)
            gid = row["geonameid"]
            if not gid or gid in by_id:
                duplicate_sample_ids += 1
            else:
                by_id[gid] = row

    countries = sorted({row["country_code"].upper() for row in rows if row["country_code"]})
    per_country: dict[str, Counter[str]] = {cc: Counter() for cc in countries}
    feature_code_counts: dict[str, Counter[str]] = defaultdict(Counter)
    issues: list[dict[str, str]] = []
    total = Counter()

    def record_issue(row: dict[str, str], issue: str) -> None:
        issues.append({
            "child_geonames_id": row["geonameid"],
            "country_code": row["country_code"].upper(),
            "feature_code": row["feature_code"],
            "raw_admin1_code": row["admin1_code"],
            "raw_admin2_code": row["admin2_code"],
            "issue": issue,
        })

    for row in rows:
        gid = row["geonameid"]
        cc = row["country_code"].upper()
        feature_class = row["feature_class"]
        feature_code = row["feature_code"]
        a1 = row["admin1_code"]
        a2 = row["admin2_code"]
        metrics = per_country[cc]
        metrics["sample_rows"] += 1
        if feature_class == "A":
            metrics["administrative_feature_rows"] += 1
        feature_code_counts[cc][feature_code] += 1

        if not a1:
            metrics["admin1_code_blank"] += 1
        else:
            metrics["admin1_code_present"] += 1
            if a1 == "00":
                metrics["admin1_raw_00_references"] += 1
            key1 = f"{cc}.{a1}"
            candidate1 = admin1.get(key1)
            if candidate1 is None:
                metrics["admin1_key_missing"] += 1
                if a1 == "00":
                    metrics["admin1_raw_00_key_missing"] += 1
            else:
                metrics["admin1_key_found"] += 1
                parent_id = candidate1["geonames_id"]
                parent = by_id.get(parent_id)
                if parent_id == gid:
                    metrics["admin1_candidate_self_reference"] += 1
                    record_issue(row, "ADMIN1_CROSSWALK_CANDIDATE_SELF_REFERENCE")
                elif parent is None:
                    metrics["admin1_candidate_id_not_in_sample"] += 1
                    record_issue(row, "ADMIN1_CROSSWALK_ID_NOT_PRESENT_IN_SAMPLE")
                elif parent["feature_class"] != "A":
                    metrics["admin1_candidate_not_admin_feature"] += 1
                    record_issue(row, "ADMIN1_CROSSWALK_ID_NOT_ADMIN_FEATURE")
                elif parent["country_code"].upper() != cc:
                    metrics["admin1_candidate_country_conflict"] += 1
                    record_issue(row, "ADMIN1_CROSSWALK_ID_COUNTRY_CONFLICT")
                else:
                    metrics["admin1_candidate_id_present_as_same_country_admin_feature"] += 1

        if not a2:
            metrics["admin2_code_blank"] += 1
        else:
            metrics["admin2_code_present"] += 1
            if not a1:
                metrics["admin2_uncheckable_due_to_blank_admin1_context"] += 1
            else:
                key2 = f"{cc}.{a1}.{a2}"
                candidate2 = admin2.get(key2)
                if candidate2 is None:
                    metrics["admin2_key_missing"] += 1
                else:
                    metrics["admin2_key_found"] += 1
                    parent_id = candidate2["geonames_id"]
                    parent = by_id.get(parent_id)
                    if parent_id == gid:
                        metrics["admin2_candidate_self_reference"] += 1
                        record_issue(row, "ADMIN2_CROSSWALK_CANDIDATE_SELF_REFERENCE")
                    elif parent is None:
                        metrics["admin2_candidate_id_not_in_sample"] += 1
                        record_issue(row, "ADMIN2_CROSSWALK_ID_NOT_PRESENT_IN_SAMPLE")
                    elif parent["feature_class"] != "A":
                        metrics["admin2_candidate_not_admin_feature"] += 1
                        record_issue(row, "ADMIN2_CROSSWALK_ID_NOT_ADMIN_FEATURE")
                    elif parent["country_code"].upper() != cc:
                        metrics["admin2_candidate_country_conflict"] += 1
                        record_issue(row, "ADMIN2_CROSSWALK_ID_COUNTRY_CONFLICT")
                    else:
                        metrics["admin2_candidate_id_present_as_same_country_admin_feature"] += 1

    for metrics in per_country.values():
        total.update(metrics)

    output_dir.mkdir(parents=True)
    issue_path = output_dir / "hierarchy-audit-exceptions.csv"
    with issue_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=ISSUE_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(sorted(
            issues,
            key=lambda row: (
                row["country_code"], row["child_geonames_id"],
                row["raw_admin1_code"], row["raw_admin2_code"], row["issue"]
            ),
        ))

    source_manifest = []
    for key, path in input_paths.items():
        size, digest = sha256_file(path)
        source_manifest.append({
            "key": key,
            "filename": path.name,
            "bytes": size,
            "sha256": digest,
            "hash_method": "Python hashlib SHA-256, calculated by this script",
        })

    admin2_missing_key = total["admin2_key_missing"]
    admin2_missing_context = total["admin2_uncheckable_due_to_blank_admin1_context"]
    report = {
        "report_version": "1.0",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "BLOCKED_SELF_REFERENCE_CANDIDATES_FOUND" if (total["admin1_candidate_self_reference"] + total["admin2_candidate_self_reference"]) else ("BLOCKED_CANDIDATE_PRESENCE_MISMATCHES" if issues else "PASS_CANDIDATE_PRESENCE_ONLY_NO_PARENT_LINKS_APPROVED"),
        "scope": {
            "implementation": "Read-only Python crosswalk candidate-presence audit",
            "parent_links_written": False,
            "source_files_modified": False,
            "database_operations": False,
            "source_data_transmitted": False,
        },
        "script": {
            "filename": script_path.name,
            "sha256": sha256_file(script_path)[1],
            "hash_method": "Python hashlib SHA-256, calculated by this script"
        },
        "input_manifest": source_manifest,
        "input_integrity": {
            "sample_rows": len(rows),
            "sample_unique_ids": len(by_id),
            "duplicate_sample_ids": duplicate_sample_ids,
            "malformed_sample_rows": malformed_sample_rows,
            "admin1_unique_keys": len(admin1),
            "admin1_malformed_rows": admin1_malformed,
            "admin1_duplicate_keys": admin1_duplicates,
            "admin2_unique_keys": len(admin2),
            "admin2_malformed_rows": admin2_malformed,
            "admin2_duplicate_keys": admin2_duplicates,
            "administrative_feature_rows": total["administrative_feature_rows"],
        },
        "total_metrics": dict(sorted(total.items())),
        "per_country_metrics": {
            cc: dict(sorted(metrics.items()))
            for cc, metrics in sorted(per_country.items())
        },
        "sample_feature_codes_by_country": {
            cc: dict(sorted(counts.items()))
            for cc, counts in sorted(feature_code_counts.items())
        },
        "admin1": {
            "nonblank_code_references": total["admin1_code_present"],
            "code_references_with_exact_crosswalk_key": total["admin1_key_found"],
            "code_references_without_exact_key": total["admin1_key_missing"],
            "raw_00_placeholder_candidates": total["admin1_raw_00_key_missing"],
            "unmatched_nonzero_code_references": total["admin1_key_missing"] - total["admin1_raw_00_key_missing"],
            "resolved_references_whose_candidate_id_is_present_as_same_country_administrative_feature": total["admin1_candidate_id_present_as_same_country_admin_feature"],
            "candidate_presence_issues": sum(count for name, count in total.items() if name.startswith("admin1_candidate_") and name != "admin1_candidate_id_present_as_same_country_admin_feature"),
        },
        "admin2": {
            "nonblank_code_references": total["admin2_code_present"],
            "references_with_exact_composite_crosswalk_key": total["admin2_key_found"],
            "references_missing_composite_crosswalk_key": admin2_missing_key,
            "references_uncheckable_due_to_blank_admin1_context": admin2_missing_context,
            "total_unresolved_admin2_rows": admin2_missing_key + admin2_missing_context,
            "resolved_references_whose_candidate_id_is_present_as_same_country_administrative_feature": total["admin2_candidate_id_present_as_same_country_admin_feature"],
            "candidate_presence_issues": sum(count for name, count in total.items() if name.startswith("admin2_candidate_") and name != "admin2_candidate_id_present_as_same_country_admin_feature"),
        },
        "exceptions": {
            "csv": issue_path.name,
            "rows": len(issues),
            "parent_ids_or_parent_links_written": False,
            "interpretation": "Only mismatches among found crosswalk candidate IDs are exported; unresolved codes remain in the aggregate counts and existing crosswalk exception exports.",
        },
        "policy": {
            "raw_00": "Unresolved placeholder/nonstandard-code candidate; not automatically invalid.",
            "unmatched_nonzero_codes": "Unresolved source reference; not automatically legacy or invalid.",
            "blank_admin1_with_nonblank_admin2": "The composite key cannot be checked; classify as unresolved missing admin1 context.",
            "crosswalk_candidate_id_present": "Evidence of source candidate availability only; does not approve a parent link.",
            "catalog_acceptance": "BLOCKED",
            "worldwide_completeness": "UNVERIFIED",
            "iso_authority_comparison": "UNVERIFIED",
        },
    }

    report_path = output_dir / "hierarchy-audit-summary.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": report["status"],
        "summary_file": report_path.name,
        "sample_rows": len(rows),
        "admin1_keys": len(admin1),
        "admin2_keys": len(admin2),
        "admin1_key_missing": report["admin1"]["code_references_without_exact_key"],
        "admin2_key_missing": admin2_missing_key,
        "admin2_blank_admin1_context": admin2_missing_context,
        "candidate_presence_issues": len(issues),
        "parent_links_written": False,
    }, indent=2))
    fatal_input = bool(malformed_sample_rows or duplicate_sample_ids or admin1_malformed or admin2_malformed or admin1_duplicates or admin2_duplicates)
    return 2 if fatal_input else (1 if issues else 0)


if __name__ == "__main__":
    raise SystemExit(main())
