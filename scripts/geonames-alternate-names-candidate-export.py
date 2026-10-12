#!/usr/bin/env python3
"""Stream GeoNames alternateNamesV2 into a source-pinned country/destination alias package.

Aliases are joined only by exact GeoNames ID to either the pinned countryInfo source
IDs or the source-pinned place/admin candidate export. Raw values, language, flags
and effective dates are preserved. This does not approve internal identity matches,
selectability, administrative parentage, or database writes.
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

SOURCE_URL = "https://download.geonames.org/export/dump/alternateNamesV2.zip"
COUNTRY_INFO_URL = "https://download.geonames.org/export/dump/countryInfo.txt"
ID_RE = re.compile(r"^[0-9]+$")
SOURCE_FIELDS = 10
OUTPUT_FIELDS = [
    "alternate_name_id", "geonames_id", "record_scope_kind", "source_country_code_raw", "language_code", "alternate_name",
    "is_preferred_name", "is_short_name", "is_colloquial", "is_historic",
    "valid_from", "valid_to", "source_snapshot_sha256",
]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def read_candidate_scope(path: Path):
    """Load unique candidate IDs and raw country codes from the compressed source export."""
    candidate_country = {}
    country_totals = Counter()
    with gzip.open(path, "rt", encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {"geonames_id", "source_country_code_raw", "name"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("Candidate export lacks required identity/country/name columns.")
        for row in reader:
            gid = str(row.get("geonames_id", "")).strip()
            if not ID_RE.fullmatch(gid):
                raise ValueError("Candidate export contains an invalid GeoNames ID.")
            if gid in candidate_country:
                raise ValueError(f"Candidate export contains duplicate GeoNames ID {gid}.")
            raw_code = str(row.get("source_country_code_raw", ""))
            code_bucket = raw_code.strip().upper() or "(blank)"
            candidate_country[gid] = (raw_code, code_bucket)
            country_totals[code_bucket] += 1
    if not candidate_country:
        raise ValueError("Candidate destination export is empty.")
    return candidate_country, country_totals


def read_country_area_scope(country_info_path: Path, country_manifest_path: Path):
    """Read fingerprinted countryInfo IDs without treating codes as internal IDs."""
    manifest = json.loads(country_manifest_path.read_text(encoding="utf-8"))
    rows = [x for x in manifest.get("remote_sources", []) if x.get("source_role") == "country-metadata"]
    if len(rows) != 1:
        raise ValueError("Expected exactly one country-metadata source manifest entry.")
    source = rows[0]
    size, digest = sha256_path(country_info_path)
    if source.get("source_url") != COUNTRY_INFO_URL or source.get("http_status") != 200:
        raise ValueError("CountryInfo source provenance is invalid.")
    if source.get("size_bytes") != size or source.get("sha256") != digest:
        raise ValueError("CountryInfo source bytes do not match the pinned manifest.")
    result = {}
    seen_codes = set()
    row_count = 0
    malformed = 0
    with country_info_path.open("r", encoding="utf-8-sig", newline="") as stream:
        for line in stream:
            if not line or line.startswith("#"):
                continue
            fields = line.rstrip("\r\n").split("\t")
            if (len(fields) != 19 or not fields[4].strip()
                    or not ID_RE.fullmatch(fields[16].strip())
                    or not re.fullmatch(r"[A-Z]{2}", fields[0].strip().upper())):
                malformed += 1
                continue
            row_count += 1
            gid, code = fields[16].strip(), fields[0].strip().upper()
            if gid in result or code in seen_codes:
                raise ValueError("CountryInfo contains duplicate source IDs or alpha-2 codes.")
            result[gid] = code
            seen_codes.add(code)
    if malformed or row_count == 0:
        raise ValueError(f"CountryInfo malformed rows={malformed} or empty.")
    return result, {
        "source_url": COUNTRY_INFO_URL,
        "retrieved_at_utc": source.get("retrieved_at_utc"),
        "http_status": 200,
        "size_bytes": size,
        "sha256": digest,
        "rows": row_count,
    }


def source_manifest_record(manifest_path: Path, archive_path: Path):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source = manifest.get("remote_source", {})
    size, digest = sha256_path(archive_path)
    if source.get("source_url") != SOURCE_URL or source.get("http_status") != 200:
        raise ValueError("AlternateNamesV2 official-source retrieval metadata is invalid.")
    if source.get("zip_crc_validation") != "PASS":
        raise ValueError("AlternateNamesV2 ZIP CRC validation did not pass.")
    if source.get("size_bytes") != size or source.get("sha256") != digest:
        raise ValueError("AlternateNamesV2 source byte size/SHA-256 mismatches its manifest.")
    if not source.get("retrieved_at_utc"):
        raise ValueError("AlternateNamesV2 retrieval timestamp is missing.")
    return {
        "source_url": SOURCE_URL,
        "retrieved_at_utc": source["retrieved_at_utc"],
        "http_status": 200,
        "http_last_modified_header": source.get("http_last_modified_header"),
        "etag": source.get("etag"),
        "zip_crc_validation": "PASS",
        "archive_filename": archive_path.name,
        "archive_size_bytes": size,
        "archive_sha256": digest,
    }


def export_aliases(candidate_gzip: Path, country_info_path: Path, country_info_manifest_path: Path,
                   archive_path: Path, manifest_path: Path, output_dir: Path):
    candidate_country, country_totals = read_candidate_scope(candidate_gzip)
    country_area_country, country_area_source = read_country_area_scope(country_info_path, country_info_manifest_path)
    country_area_counts = Counter(country_area_country.values())
    if set(candidate_country).intersection(country_area_country):
        raise ValueError("A GeoNames ID appears in both country/area and destination candidate scopes.")
    source_meta = source_manifest_record(manifest_path, archive_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    aliases_path = output_dir / "worldwide-geonames-country-and-destination-alternate-names.csv.gz"
    candidate_ids_with_aliases = set()
    country_area_ids_with_aliases = set()
    alias_ids_seen = set()
    duplicate_alias_ids = 0
    malformed_rows = 0
    source_rows = 0
    exported_rows = 0
    aliases_by_language = Counter()
    alias_country_rows = Counter()
    blank_language_rows = 0
    flag_malformed_rows = 0
    member_digest = hashlib.sha256()
    member_name = "alternateNamesV2.txt"

    with zipfile.ZipFile(archive_path, "r") as archive:
        matches = [name for name in archive.namelist()
                   if name == "alternateNamesV2.txt" or name.endswith("/alternateNamesV2.txt")]
        if len(matches) != 1:
            raise ValueError("Archive must contain exactly one alternateNamesV2.txt member.")
        member_name = matches[0]
        with archive.open(member_name, "r") as raw_stream, gzip.open(
            aliases_path, "wt", encoding="utf-8", newline="", compresslevel=6
        ) as output_stream:
            writer = csv.DictWriter(output_stream, fieldnames=OUTPUT_FIELDS, extrasaction="raise", lineterminator="\n")
            writer.writeheader()
            for raw in raw_stream:
                member_digest.update(raw)
                source_rows += 1
                try:
                    fields = raw.decode("utf-8").rstrip("\r\n").split("\t")
                except UnicodeDecodeError:
                    malformed_rows += 1
                    continue
                if len(fields) != SOURCE_FIELDS:
                    malformed_rows += 1
                    continue
                alias_id, geonames_id, language, name = [str(x) for x in fields[:4]]
                if not ID_RE.fullmatch(alias_id) or not ID_RE.fullmatch(geonames_id) or not name:
                    malformed_rows += 1
                    continue
                flags = [str(x).strip() for x in fields[4:8]]
                if any(x not in {"", "0", "1"} for x in flags):
                    flag_malformed_rows += 1
                if geonames_id in candidate_country:
                    record_scope_kind = "destination_place_or_admin"
                    source_country_code, country_code_bucket = candidate_country[geonames_id]
                    candidate_ids_with_aliases.add(geonames_id)
                elif geonames_id in country_area_country:
                    record_scope_kind = "country_area"
                    source_country_code = country_area_country[geonames_id]
                    country_code_bucket = source_country_code.strip().upper() or "(blank)"
                    country_area_ids_with_aliases.add(geonames_id)
                else:
                    continue
                if alias_id in alias_ids_seen:
                    duplicate_alias_ids += 1
                else:
                    alias_ids_seen.add(alias_id)
                alias_country_rows[(country_code_bucket, record_scope_kind)] += 1
                language = language.strip()
                if language:
                    aliases_by_language[language] += 1
                else:
                    blank_language_rows += 1
                writer.writerow({
                    "alternate_name_id": alias_id,
                    "geonames_id": geonames_id,
                    "record_scope_kind": record_scope_kind,
                    "source_country_code_raw": source_country_code,
                    "language_code": language,
                    "alternate_name": name,
                    "is_preferred_name": flags[0],
                    "is_short_name": flags[1],
                    "is_colloquial": flags[2],
                    "is_historic": flags[3],
                    "valid_from": fields[8],
                    "valid_to": fields[9],
                    "source_snapshot_sha256": source_meta["archive_sha256"],
                })
                exported_rows += 1

    if malformed_rows:
        raise ValueError(f"Source alias rows malformed/invalid={malformed_rows}; export blocked.")
    if flag_malformed_rows:
        raise ValueError(f"Source alias boolean flags invalid in {flag_malformed_rows} row(s); export blocked.")
    if duplicate_alias_ids:
        raise ValueError(f"Duplicate alternateName IDs within country/area and destination scope: {duplicate_alias_ids}.")
    if exported_rows == 0:
        raise ValueError("No alternate-name rows matched the country/area or destination source IDs.")
    if exported_rows != len(alias_ids_seen):
        raise ValueError("Exported alias rows do not reconcile to unique scoped alternate-name IDs.")
    if not candidate_ids_with_aliases.issubset(candidate_country):
        raise ValueError("Alias coverage includes a GeoNames ID outside the candidate scope.")
    member_sha = member_digest.hexdigest()

    aliases_by_destination_code = Counter(candidate_country[gid][1] for gid in candidate_ids_with_aliases)
    aliases_by_country_area_code = Counter(country_area_country[gid] for gid in country_area_ids_with_aliases)
    destination_per_code = []
    for code, total in sorted(country_totals.items()):
        ids_with_aliases = aliases_by_destination_code[code]
        destination_per_code.append({
            "source_country_code_raw": "" if code == "(blank)" else code,
            "source_country_code_bucket": code,
            "record_scope_kind": "destination_place_or_admin",
            "source_scope_records": total,
            "source_scope_records_with_aliases": ids_with_aliases,
            "source_scope_records_without_aliases": total - ids_with_aliases,
            "matching_alias_rows": alias_country_rows[(code, "destination_place_or_admin")],
            "alias_coverage_ratio": round(ids_with_aliases / total, 6) if total else 0.0,
        })

    country_area_per_code = []
    for code, total in sorted(country_area_counts.items()):
        ids_with_aliases = aliases_by_country_area_code[code]
        country_area_per_code.append({
            "source_country_alpha2_raw": code,
            "record_scope_kind": "country_area",
            "source_scope_records": total,
            "source_scope_records_with_aliases": ids_with_aliases,
            "source_scope_records_without_aliases": total - ids_with_aliases,
            "matching_alias_rows": alias_country_rows[(code, "country_area")],
            "alias_coverage_ratio": round(ids_with_aliases / total, 6) if total else 0.0,
        })

    report = {
        "schema_version": 1,
        "audit": "geonames-alternateNamesV2-to-destination-candidate-crosswalk",
        "generated_at_utc": utc_now(),
        "status": "PASS_ALIAS_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED",
        "scope": {
            "candidate_export": candidate_gzip.name,
            "country_area_source": "pinned GeoNames countryInfo.txt; country source identifiers only",
            "candidate_ids_are_internal_catalog_ids": False,
            "candidate_ids_are_source_geonames_ids": True,
            "raw_language_names_flags_dates_preserved": True,
            "aliases_not_approved_for_selectability_or_identity_merge": True,
        },
        "sources": {
            "alternate_names_source": source_meta,
            "alternate_names_member_name": member_name,
            "alternate_names_member_sha256": member_sha,
            "country_info_source": country_area_source,
            "destination_candidate_export_size_bytes": candidate_gzip.stat().st_size,
            "destination_candidate_export_sha256": sha256_path(candidate_gzip)[1],
        },
        "counts": {
            "alternate_names_source_rows_scanned": source_rows,
            "malformed_or_invalid_source_rows": malformed_rows,
            "invalid_boolean_flag_rows": flag_malformed_rows,
            "destination_candidate_ids": len(candidate_country),
            "country_area_source_ids": len(country_area_country),
            "source_scope_record_ids": len(candidate_country) + len(country_area_country),
            "candidate_ids_with_aliases": len(candidate_ids_with_aliases),
            "candidate_ids_without_aliases": len(candidate_country) - len(candidate_ids_with_aliases),
            "candidate_id_alias_coverage_ratio": round(len(candidate_ids_with_aliases) / len(candidate_country), 6),
            "country_area_source_ids_with_aliases": len(country_area_ids_with_aliases),
            "country_area_source_ids_without_aliases": len(country_area_country) - len(country_area_ids_with_aliases),
            "source_scope_ids_with_aliases": len(candidate_ids_with_aliases | country_area_ids_with_aliases),
            "source_scope_ids_without_aliases": len(candidate_country) + len(country_area_country) - len(candidate_ids_with_aliases | country_area_ids_with_aliases),
            "matching_alias_rows_exported": exported_rows,
            "unique_matching_alternate_name_ids": len(alias_ids_seen),
            "duplicate_matching_alternate_name_ids": duplicate_alias_ids,
            "blank_language_rows_exported": blank_language_rows,
            "language_codes_in_export": len(aliases_by_language),
            "top_language_codes_by_alias_rows": [
                {"language_code": code, "alias_rows": count} for code, count in aliases_by_language.most_common(50)
            ],
            "operational_selectable_rows": 0,
            "database_or_production_changes": False,
        },
        "per_source_country_code": destination_per_code,
        "per_country_area_alpha2": country_area_per_code,
        "interpretation": {
            "alias_relationship": "GeoNames source alternate-name ID linked to source GeoNames feature ID only; does not assert internal place identity",
            "language_code_policy": "Preserve original language code; do not translate or relabel language",
            "effective_dates": "Preserve raw from/to values; blank values remain blank and are not interpreted as timeless legal truth",
            "canonical_names": "Original allCountries name and alternateNamesV2 remain separate fields/sources",
            "country_assignment": "Destination rows retain raw source codes and country/area rows retain countryInfo alpha-2 codes; neither implies an approved internal country mapping",
            "source_completeness": "All rows in alternateNamesV2 are scanned and every valid matching alias row is exported; this says nothing about names missing from GeoNames",
            "operational_selectability": False,
            "database_or_production_changes": False,
        },
    }
    summary_path = output_dir / "worldwide-geonames-country-and-destination-alternate-name-summary.json"
    summary_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report, aliases_path, summary_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-gzip", required=True, type=Path)
    parser.add_argument("--country-info", required=True, type=Path)
    parser.add_argument("--country-info-manifest", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report, output, summary = export_aliases(args.candidate_gzip, args.country_info, args.country_info_manifest, args.archive, args.source_manifest, args.output_dir)
    except (OSError, UnicodeError, json.JSONDecodeError, zipfile.BadZipFile, ValueError) as exc:
        print(f"BLOCKED_ALTERNATE_NAME_CANDIDATE_EXPORT: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"status": report["status"], "summary_path": str(summary), "alias_file": str(output), **report["counts"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
