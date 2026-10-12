#!/usr/bin/env python3
"""Build a worldwide GeoNames admin-code parent candidate index and row-level map.

This tool uses only exact country/admin-code composite keys from the source-pinned
destination candidate export. Names and proximity are never used to match parents.
Every result is a review-only source-code candidate; it creates no operational links.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

CURRENT_ADMIN_LEVELS = {f"ADM{i}": i for i in range(1, 5)}
ADMIN_TARGET_LEVELS = {f"ADM{i}": i for i in range(1, 6)}
CANDIDATE_STATUS = "PASS_SOURCE_CODE_PARENT_CANDIDATES_EXPORTED__REVIEW_ONLY__NO_LINKS"
REQUIRED_FIELDS = {
    "geonames_id", "name", "feature_class", "feature_code", "source_country_code_raw",
    "country_info_geonames_id", "country_assignment_status", "raw_admin1_code",
    "raw_admin2_code", "raw_admin3_code", "raw_admin4_code",
    "source_disposition", "record_status_proposal", "coordinate_validation_status",
    "source_record_identity_status",
}
RESOLUTION_FIELDS = [
    "geonames_id", "name", "source_country_code_raw", "country_info_geonames_id",
    "country_assignment_status", "feature_class", "feature_code", "source_disposition",
    "record_status_proposal", "coordinate_validation_status", "source_record_identity_status",
    "raw_admin1_code", "raw_admin2_code", "raw_admin3_code", "raw_admin4_code",
    "desired_parent_admin_level", "direct_parent_lookup_key_json",
    "direct_parent_resolution_status", "direct_parent_candidate_geonames_id",
    "direct_parent_candidate_name", "direct_parent_candidate_feature_code",
    "direct_parent_candidate_disposition", "direct_parent_candidate_quality_status",
    "candidate_ids_for_direct_key_json", "candidate_parent_path_geonames_ids_json",
    "candidate_parent_path_code_chain_complete", "candidate_parent_path_status",
    "parent_link_created", "operational_selectable",
]
INDEX_FIELDS = [
    "parent_admin_level", "source_country_code_raw", "raw_admin1_code", "raw_admin2_code",
    "raw_admin3_code", "raw_admin4_code", "composite_key_json", "composite_key_sha256",
    "composite_key_candidate_count", "composite_key_disposition",
    "parent_geonames_id", "parent_name", "parent_feature_code",
    "parent_source_disposition", "parent_record_status_proposal",
    "parent_coordinate_validation_status", "parent_source_record_identity_status",
    "parent_country_assignment_status", "parent_link_created",
]


def sha256_path(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_candidate_manifest(candidate_gzip: Path, summary_path: Path):
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    sources = summary.get("sources", {})
    counts = summary.get("counts", {})
    if summary.get("status") != "PASS_SOURCE_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED":
        raise ValueError("Destination candidate export status is not a successful candidate-only export.")
    expected_name = sources.get("candidate_export_filename")
    expected_size = sources.get("candidate_export_size_bytes")
    expected_sha = sources.get("candidate_export_sha256")
    actual_size, actual_sha = sha256_path(candidate_gzip)
    if expected_name != candidate_gzip.name:
        raise ValueError("Candidate export filename differs from its pinned summary.")
    if expected_size != actual_size or expected_sha != actual_sha:
        raise ValueError("Candidate export size/SHA-256 differs from its source-pinned summary.")
    expected_rows = counts.get("candidate_file_rows")
    if not isinstance(expected_rows, int) or expected_rows <= 0:
        raise ValueError("Candidate summary has no valid candidate_file_rows count.")
    if counts.get("duplicate_candidate_geonames_ids") != 0 or counts.get("invalid_candidate_ids") != 0:
        raise ValueError("The source candidate export does not pass identity uniqueness checks.")
    if counts.get("unique_candidate_source_ids") != expected_rows:
        raise ValueError("Candidate source ID count does not reconcile to candidate_file_rows.")
    return summary, {
        "candidate_export_filename": candidate_gzip.name,
        "candidate_export_size_bytes": actual_size,
        "candidate_export_sha256": actual_sha,
        "source_allcountries_text_sha256": sources.get("geonames_allcountries_text_sha256"),
        "source_allcountries_archive_sha256": sources.get("geonames_allcountries_archive_sha256"),
        "source_allcountries_retrieved_at_utc": sources.get("geonames_allcountries_retrieved_at_utc"),
        "country_info_sha256": sources.get("country_info_sha256"),
        "expected_candidate_rows": expected_rows,
    }


def codes_for(row):
    return [
        str(row.get("raw_admin1_code", "")),
        str(row.get("raw_admin2_code", "")),
        str(row.get("raw_admin3_code", "")),
        str(row.get("raw_admin4_code", "")),
    ]


def key_for(country_code: str, codes: list[str], level: int):
    """Return an exact composite key or an explicit raw-code failure status."""
    if not country_code.strip():
        return None, "BLOCKED_COUNTRY_CODE_MISSING"
    prefix = codes[:level]
    if len(prefix) != level:
        return None, "BLOCKED_ADMIN_CODE_DEPTH_UNAVAILABLE"
    if any(code.strip() == "00" for code in prefix):
        return None, "BLOCKED_RAW_ADMIN_CODE_00_SENTINEL"
    if any(not code.strip() for code in prefix):
        return None, "BLOCKED_RAW_ADMIN_CODE_GAP"
    return tuple([country_code, *prefix]), "KEY_READY"


def parent_quality_status(row):
    if not str(row.get("name", "")).strip():
        return "PARENT_NAME_EMPTY__HELD_FOR_REVIEW"
    if row.get("source_record_identity_status", "").startswith("BLOCKED"):
        return "PARENT_SOURCE_IDENTITY_BLOCKED"
    if row.get("coordinate_validation_status") == "INVALID_WGS84":
        return "PARENT_COORDINATES_INVALID__HELD_FOR_REVIEW"
    if row.get("record_status_proposal") != "candidate":
        return "PARENT_RECORD_STATUS_NOT_CANDIDATE"
    return "SOURCE_ROW_QUALITY_ACCEPTABLE_FOR_CANDIDATE_REVIEW"


def safe_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def csv_writer(path: Path, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    return gzip.open(path, "wt", encoding="utf-8", newline="", compresslevel=6), fields


def build_parent_code_index(candidate_gzip: Path, summary_path: Path, output_dir: Path):
    candidate_summary, source_meta = load_candidate_manifest(candidate_gzip, summary_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    source_fields = None
    candidate_rows_scanned = 0
    admin_rows_by_level = Counter()
    admin_rows_no_usable_key = Counter()
    by_level_key = {level: defaultdict(list) for level in range(1, 5)}
    admin_records = []

    with gzip.open(candidate_gzip, "rt", encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        source_fields = reader.fieldnames or []
        missing = REQUIRED_FIELDS - set(source_fields)
        if missing:
            raise ValueError("Candidate export missing required fields: " + ", ".join(sorted(missing)))
        for row in reader:
            candidate_rows_scanned += 1
            if not re.fullmatch(r"[0-9]+", str(row.get("geonames_id", ""))):
                raise ValueError("Candidate export contains an invalid GeoNames ID.")
            feature_code = str(row.get("feature_code", ""))
            level = CURRENT_ADMIN_LEVELS.get(feature_code) if row.get("feature_class") == "A" else None
            if level is None:
                continue
            admin_rows_by_level[level] += 1
            country_code = str(row.get("source_country_code_raw", ""))
            codes = codes_for(row)
            key, key_status = key_for(country_code, codes, level)
            record = {
                "level": level,
                "key": key,
                "key_status": key_status,
                "geonames_id": str(row["geonames_id"]),
                "name": str(row.get("name", "")),
                "feature_code": feature_code,
                "source_country_code_raw": country_code,
                "codes": codes,
                "source_disposition": str(row.get("source_disposition", "")),
                "record_status_proposal": str(row.get("record_status_proposal", "")),
                "coordinate_validation_status": str(row.get("coordinate_validation_status", "")),
                "source_record_identity_status": str(row.get("source_record_identity_status", "")),
                "country_assignment_status": str(row.get("country_assignment_status", "")),
            }
            admin_records.append(record)
            if key is None:
                admin_rows_no_usable_key[level] += 1
            else:
                by_level_key[level][key].append(record)

    if candidate_rows_scanned != source_meta["expected_candidate_rows"]:
        raise ValueError(
            f"Candidate rows scanned {candidate_rows_scanned} do not match pinned summary count {source_meta['expected_candidate_rows']}."
        )
    if source_fields is None:
        raise ValueError("Candidate source is empty.")

    index_path = output_dir / "worldwide-geonames-admin-code-parent-index.csv.gz"
    with gzip.open(index_path, "wt", encoding="utf-8", newline="", compresslevel=6) as stream:
        writer = csv.DictWriter(stream, fieldnames=INDEX_FIELDS, extrasaction="raise", lineterminator="\n")
        writer.writeheader()
        for record in admin_records:
            key = record["key"]
            group = by_level_key[record["level"]].get(key, []) if key is not None else []
            key_count = len(group)
            if key is None:
                disposition = record["key_status"]
            elif key_count == 1:
                disposition = "UNIQUE_EXACT_ADMIN_CODE_KEY__CANDIDATE_ONLY"
            else:
                disposition = "AMBIGUOUS_EXACT_ADMIN_CODE_KEY__NO_PARENT_PICK"
            writer.writerow({
                "parent_admin_level": record["level"],
                "source_country_code_raw": record["source_country_code_raw"],
                "raw_admin1_code": record["codes"][0],
                "raw_admin2_code": record["codes"][1],
                "raw_admin3_code": record["codes"][2],
                "raw_admin4_code": record["codes"][3],
                "composite_key_json": safe_json(list(key)) if key is not None else "",
                "composite_key_sha256": hashlib.sha256(safe_json(list(key)).encode("utf-8")).hexdigest() if key is not None else "",
                "composite_key_candidate_count": key_count,
                "composite_key_disposition": disposition,
                "parent_geonames_id": record["geonames_id"],
                "parent_name": record["name"],
                "parent_feature_code": record["feature_code"],
                "parent_source_disposition": record["source_disposition"],
                "parent_record_status_proposal": record["record_status_proposal"],
                "parent_coordinate_validation_status": record["coordinate_validation_status"],
                "parent_source_record_identity_status": record["source_record_identity_status"],
                "parent_country_assignment_status": record["country_assignment_status"],
                "parent_link_created": False,
            })

    resolution_path = output_dir / "worldwide-geonames-destination-parent-code-resolutions.csv.gz"
    direct_status_counts = Counter()
    path_status_counts = Counter()
    per_country_feature = Counter()
    resolution_rows = 0
    direct_unique_candidate_rows = 0
    complete_code_chain_rows = 0
    direct_ambiguous_rows = 0
    direct_missing_rows = 0
    child_rows_held = 0

    def lookup(row, level):
        codes = codes_for(row)
        country_code = str(row.get("source_country_code_raw", ""))
        key, key_status = key_for(country_code, codes, level)
        if key is None:
            return {"status": key_status, "key": None, "matches": []}
        matches = by_level_key[level].get(key, [])
        if not matches:
            return {"status": "NO_EXACT_ADMIN_PARENT_KEY", "key": key, "matches": []}
        if len(matches) > 1:
            return {"status": "AMBIGUOUS_EXACT_ADMIN_PARENT_KEY", "key": key, "matches": matches}
        parent = matches[0]
        quality = parent_quality_status(parent)
        if quality != "SOURCE_ROW_QUALITY_ACCEPTABLE_FOR_CANDIDATE_REVIEW":
            return {"status": "UNIQUE_KEY_PARENT_ROW_HELD_FOR_REVIEW", "key": key, "matches": matches}
        return {"status": "UNIQUE_EXACT_SOURCE_CODE_PARENT_CANDIDATE__REVIEW_ONLY", "key": key, "matches": matches}

    with gzip.open(candidate_gzip, "rt", encoding="utf-8", newline="") as source, gzip.open(
        resolution_path, "wt", encoding="utf-8", newline="", compresslevel=6
    ) as destination:
        reader = csv.DictReader(source)
        writer = csv.DictWriter(destination, fieldnames=RESOLUTION_FIELDS, extrasaction="raise", lineterminator="\n")
        writer.writeheader()
        for row in reader:
            resolution_rows += 1
            country_code = str(row.get("source_country_code_raw", ""))
            feature_class = str(row.get("feature_class", ""))
            feature_code = str(row.get("feature_code", ""))
            codes = codes_for(row)
            source_disposition = str(row.get("source_disposition", ""))
            record_status = str(row.get("record_status_proposal", ""))
            coordinate_status = str(row.get("coordinate_validation_status", ""))
            identity_status = str(row.get("source_record_identity_status", ""))
            desired_level = None
            direct = {"status": "NOT_IN_CURRENT_PARENT_SCOPE", "key": None, "matches": []}
            path_ids = []
            path_complete = False
            path_status = "NOT_IN_CURRENT_PARENT_SCOPE"

            admin_match = re.fullmatch(r"ADM([1-5])", feature_code) if feature_class == "A" else None
            if admin_match:
                child_level = int(admin_match.group(1))
                if child_level == 1:
                    country_id = str(row.get("country_info_geonames_id", ""))
                    assignment = str(row.get("country_assignment_status", ""))
                    if not country_code:
                        direct = {"status": "BLOCKED_COUNTRY_CODE_MISSING", "key": None, "matches": []}
                        path_status = "INCOMPLETE_COUNTRY_CODE_MISSING"
                    elif not country_id or assignment.startswith("HELD_") or "HISTORICAL" in assignment:
                        direct = {"status": "COUNTRY_ROOT_SOURCE_ID_MISSING_OR_HELD", "key": None, "matches": []}
                        path_status = "INCOMPLETE_COUNTRY_ROOT_IDENTITY_REVIEW"
                    else:
                        desired_level = 0
                        direct = {"status": "COUNTRY_SOURCE_ROOT_CANDIDATE__NOT_OPERATIONAL", "key": (country_code,), "matches": [{
                            "geonames_id": country_id,
                            "name": str(row.get("country_info_name", "")),
                            "feature_code": "COUNTRYINFO_SOURCE_ENTITY",
                            "source_disposition": "COUNTRY_SOURCE_IDENTITY_REVIEW_REQUIRED",
                            "record_status_proposal": "review_required",
                            "coordinate_validation_status": "",
                            "source_record_identity_status": "COUNTRY_SOURCE_ID_NOT_AN_INTERNAL_ID",
                            "country_assignment_status": assignment,
                        }]}
                        path_ids = [country_id]
                        path_status = "COUNTRY_ROOT_CANDIDATE__INTERNAL_MAPPING_REVIEW_REQUIRED"
                else:
                    desired_level = child_level - 1
                    direct = lookup(row, desired_level)
            elif feature_class == "P":
                if not any(code != "" for code in codes):
                    direct = {"status": "NO_SOURCE_ADMIN_CODE_ASSOCIATION", "key": None, "matches": []}
                    path_status = "NO_SOURCE_ADMIN_CODE_ASSOCIATION__COUNTRY_CONTEXT_ONLY"
                else:
                    deepest = max(i + 1 for i, code in enumerate(codes) if code != "")
                    desired_level = deepest
                    direct = lookup(row, deepest)
            elif feature_class == "A" and feature_code.startswith("ADM"):
                direct = {"status": "HISTORICAL_OR_UNSPECIFIED_ADMIN_LEVEL__REVIEW_ONLY", "key": None, "matches": []}
                path_status = "HISTORICAL_OR_UNSPECIFIED_ADMIN_LEVEL__NO_CURRENT_PARENT_ASSIGNMENT"

            if desired_level and desired_level > 0:
                country_id = str(row.get("country_info_geonames_id", ""))
                assignment = str(row.get("country_assignment_status", ""))
                if country_id:
                    path_ids = [country_id]
                path_complete = bool(country_id) and not assignment.startswith("HELD_") and "HISTORICAL" not in assignment
                if not country_id:
                    path_status = "INCOMPLETE_COUNTRY_ROOT_SOURCE_ID_MISSING"
                    path_complete = False
                elif assignment.startswith("HELD_") or "HISTORICAL" in assignment:
                    path_status = "INCOMPLETE_COUNTRY_ROOT_IDENTITY_REVIEW"
                    path_complete = False
                else:
                    path_status = "SOURCE_CODE_PATH_CANDIDATE__ANCESTORS_PENDING"
                for level in range(1, desired_level + 1):
                    ancestor = lookup(row, level)
                    if len(ancestor["matches"]) == 1:
                        candidate = ancestor["matches"][0]
                        if candidate["geonames_id"] not in path_ids:
                            path_ids.append(candidate["geonames_id"])
                    if ancestor["status"] != "UNIQUE_EXACT_SOURCE_CODE_PARENT_CANDIDATE__REVIEW_ONLY":
                        path_complete = False
                        path_status = f"INCOMPLETE_{ancestor['status']}_AT_ADMIN_LEVEL_{level}"
                        break
                if path_complete:
                    path_status = "SOURCE_CODE_CHAIN_COMPLETE__COUNTRY_IDENTITY_REVIEW_REQUIRED"
            elif desired_level == 0:
                path_complete = bool(path_ids)
            if direct["status"] == "UNIQUE_EXACT_SOURCE_CODE_PARENT_CANDIDATE__REVIEW_ONLY" or direct["status"] == "COUNTRY_SOURCE_ROOT_CANDIDATE__NOT_OPERATIONAL":
                direct_unique_candidate_rows += 1
            elif direct["status"] == "AMBIGUOUS_EXACT_ADMIN_PARENT_KEY":
                direct_ambiguous_rows += 1
            elif direct["status"] in {"NO_EXACT_ADMIN_PARENT_KEY", "BLOCKED_RAW_ADMIN_CODE_00_SENTINEL", "BLOCKED_RAW_ADMIN_CODE_GAP", "BLOCKED_COUNTRY_CODE_MISSING"}:
                direct_missing_rows += 1
            if record_status != "candidate" or identity_status.startswith("BLOCKED") or coordinate_status == "INVALID_WGS84":
                child_rows_held += 1
            direct_status_counts[direct["status"]] += 1
            path_status_counts[path_status] += 1
            per_country_feature[(country_code or "(blank)", feature_code, direct["status"])] += 1
            matches = direct["matches"]
            direct_record = matches[0] if len(matches) == 1 else {}
            writer.writerow({
                "geonames_id": row.get("geonames_id", ""),
                "name": row.get("name", ""),
                "source_country_code_raw": country_code,
                "country_info_geonames_id": row.get("country_info_geonames_id", ""),
                "country_assignment_status": row.get("country_assignment_status", ""),
                "feature_class": feature_class,
                "feature_code": feature_code,
                "source_disposition": source_disposition,
                "record_status_proposal": record_status,
                "coordinate_validation_status": coordinate_status,
                "source_record_identity_status": identity_status,
                "raw_admin1_code": codes[0],
                "raw_admin2_code": codes[1],
                "raw_admin3_code": codes[2],
                "raw_admin4_code": codes[3],
                "desired_parent_admin_level": desired_level if desired_level is not None else "",
                "direct_parent_lookup_key_json": safe_json(list(direct["key"])) if direct["key"] is not None else "",
                "direct_parent_resolution_status": direct["status"],
                "direct_parent_candidate_geonames_id": direct_record.get("geonames_id", ""),
                "direct_parent_candidate_name": direct_record.get("name", ""),
                "direct_parent_candidate_feature_code": direct_record.get("feature_code", ""),
                "direct_parent_candidate_disposition": direct_record.get("source_disposition", ""),
                "direct_parent_candidate_quality_status": parent_quality_status(direct_record) if direct_record else "",
                "candidate_ids_for_direct_key_json": safe_json([item["geonames_id"] for item in matches]),
                "candidate_parent_path_geonames_ids_json": safe_json(path_ids),
                "candidate_parent_path_code_chain_complete": path_complete,
                "candidate_parent_path_status": path_status,
                "parent_link_created": False,
                "operational_selectable": False,
            })

    if resolution_rows != candidate_rows_scanned or resolution_rows != source_meta["expected_candidate_rows"]:
        raise ValueError("Parent resolution row count does not reconcile to source candidate rows.")
    index_size, index_sha = sha256_path(index_path)
    resolution_size, resolution_sha = sha256_path(resolution_path)
    index_totals = {
        "admin_code_index_rows": len(admin_records),
        "current_admin_rows_by_level": {str(level): admin_rows_by_level[level] for level in range(1, 5)},
        "admin_rows_without_usable_code_key_by_level": {str(level): admin_rows_no_usable_key[level] for level in range(1, 5)},
        "code_key_groups_by_level": {str(level): len(by_level_key[level]) for level in range(1, 5)},
        "ambiguous_code_key_groups_by_level": {
            str(level): sum(1 for group in by_level_key[level].values() if len(group) > 1) for level in range(1, 5)
        },
    }
    report = {
        "schema_version": 1,
        "audit": "worldwide-geonames-destination-parent-code-candidate-index",
        "generated_at_utc": utc_now(),
        "status": CANDIDATE_STATUS,
        "sources": {
            **source_meta,
            "candidate_summary_filename": summary_path.name,
            "admin_code_index_filename": index_path.name,
            "admin_code_index_size_bytes": index_size,
            "admin_code_index_sha256": index_sha,
            "parent_resolution_filename": resolution_path.name,
            "parent_resolution_size_bytes": resolution_size,
            "parent_resolution_sha256": resolution_sha,
        },
        "scope": {
            "match_rule": "exact source country code + complete raw admin-code prefix; no name/proximity fallback",
            "raw_codes_normalized_or_rewritten": False,
            "parentage_verified_as_national_authority_relationship": False,
            "candidates_are_operational_parent_links": False,
        },
        "counts": {
            "candidate_source_rows": candidate_rows_scanned,
            "parent_resolution_rows_written": resolution_rows,
            "rows_accounted_for": resolution_rows,
            "rows_not_accounted_for": candidate_rows_scanned - resolution_rows,
            "admin_rows_indexed": len(admin_records),
            "admin_rows_by_level": {str(level): admin_rows_by_level[level] for level in range(1, 5)},
            "admin_rows_without_usable_code_key_by_level": {str(level): admin_rows_no_usable_key[level] for level in range(1, 5)},
            "index_key_groups_by_level": {str(level): len(by_level_key[level]) for level in range(1, 5)},
            "ambiguous_index_key_groups_by_level": {
                str(level): sum(1 for group in by_level_key[level].values() if len(group) > 1) for level in range(1, 5)
            },
            "rows_with_unique_direct_parent_candidate": direct_unique_candidate_rows,
            "rows_with_ambiguous_direct_parent_key": direct_ambiguous_rows,
            "rows_with_missing_or_blocked_direct_parent_key": direct_missing_rows,
            "rows_held_by_child_quality_or_identity": child_rows_held,
            "direct_parent_resolution_status_totals": dict(sorted(direct_status_counts.items())),
            "parent_path_status_totals": dict(sorted(path_status_counts.items())),
            "direct_resolution_by_country_code_feature_code_status": [
                {"source_country_code_raw": country, "feature_code": feature, "direct_parent_resolution_status": status, "rows": count}
                for (country, feature, status), count in sorted(per_country_feature.items())
            ],
            "operational_parent_links_created": 0,
            "operational_selectable_rows": 0,
            "database_or_production_changes": False,
        },
        "interpretation": {
            "parent_resolution": "Source-code candidates only; identical codes do not establish the national authority's legal hierarchy.",
            "country_root": "countryInfo GeoNames IDs are source identity candidates, not internal country UUIDs.",
            "ambiguous_keys": "All candidates remain visible in the separate index; no first-match winner is selected.",
            "raw_admin_code_00": "Conservatively blocks parent-key construction unless a separately reviewed country-specific rule is approved.",
            "selection": "All rows remain non-selectable until internal IDs, country identity, source hierarchy, permissions and API policy are separately reviewed.",
        },
    }
    summary_path = output_dir / "worldwide-geonames-admin-parent-code-candidate-summary.json"
    summary_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report, index_path, resolution_path, summary_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-gzip", required=True, type=Path)
    parser.add_argument("--candidate-summary", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report, index_path, resolution_path, summary_path = build_parent_code_index(
            args.candidate_gzip, args.candidate_summary, args.output_dir)
    except (OSError, UnicodeError, csv.Error, gzip.BadGzipFile, json.JSONDecodeError, ValueError) as exc:
        print(f"BLOCKED_ADMIN_PARENT_CODE_CANDIDATE_EXPORT: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({
        "status": report["status"],
        "index_path": str(index_path),
        "resolution_path": str(resolution_path),
        "summary_path": str(summary_path),
        **report["counts"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
