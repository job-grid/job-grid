#!/usr/bin/env python3
"""Stream GeoNames alternateNamesV2 into a source-pinned destination alias review package.

Only aliases whose GeoNames ID exists in the source-pinned destination candidate CSV
are exported. Raw values, language, flags and effective dates are preserved. This
does not approve aliases, internal identity matches, selectability, or database writes.
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
ID_RE = re.compile(r"^[0-9]+$")
SOURCE_FIELDS = 10
OUTPUT_FIELDS = [
    "alternate_name_id", "geonames_id", "language_code", "alternate_name",
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
            code = str(row.get("source_country_code_raw", "")).strip().upper() or "(blank)"
            candidate_country[gid] = code
            country_totals[code] += 1
    if not candidate_country:
        raise ValueError("Candidate destination export is empty.")
    return candidate_country, country_totals


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


def export_aliases(candidate_gzip: Path, archive_path: Path, manifest_path: Path, output_dir: Path):
    candidate_country, country_totals = read_candidate_scope(candidate_gzip)
    source_meta = source_manifest_record(manifest_path, archive_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    aliases_path = output_dir / "worldwide-geonames-destination-alternate-names.csv.gz"
    candidate_ids_with_aliases = set()
    alias_ids_seen = set()
    duplicate_alias_ids = 0
    malformed_rows = 0
    source_rows = 0
    exported_rows = 0
    aliases_by_language = Counter()
    alias_country_rows = Counter()
    alias_country_ids = {code: set() for code in country_totals}
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
                if geonames_id not in candidate_country:
                    continue
                if alias_id in alias_ids_seen:
                    duplicate_alias_ids += 1
                else:
                    alias_ids_seen.add(alias_id)
                candidate_ids_with_aliases.add(geonames_id)
                country_code = candidate_country[geonames_id]
                alias_country_rows[country_code] += 1
                alias_country_ids.setdefault(country_code, set()).add(geonames_id)
                language = language.strip()
                if language:
                    aliases_by_language[language] += 1
                else:
                    blank_language_rows += 1
                writer.writerow({
                    "alternate_name_id": alias_id,
                    "geonames_id": geonames_id,
                    "language_code": language,
                    "alternate_name": name,
                    "is_preferred_name": flags[0],
                    "is_short_name": flags[1],
                    "is_colloquial": flags[2],
                    "is_historic": flags[3],
                    "valid_from": fields[8],
                    "valid_to": fields[9],
                    "source_snapshot_sha256": "PENDING_MEMBER_SHA256",
                })
                exported_rows += 1

    if malformed_rows:
        raise ValueError(f"Source alias rows malformed/invalid={malformed_rows}; export blocked.")
    if flag_malformed_rows:
        raise ValueError(f"Source alias boolean flags invalid in {flag_malformed_rows} row(s); export blocked.")
    if duplicate_alias_ids:
        raise ValueError(f"Duplicate alternateName IDs within destination scope: {duplicate_alias_ids}.")
    if exported_rows == 0:
        raise ValueError("No alternate-name rows matched the destination candidate IDs.")
    if exported_rows != len(alias_ids_seen):
        raise ValueError("Exported alias rows do not reconcile to unique scoped alternate-name IDs.")
    if not candidate_ids_with_aliases.issubset(candidate_country):
        raise ValueError("Alias coverage includes a GeoNames ID outside the candidate scope.")
    member_sha = member_digest.hexdigest()

    # Re-stream and set the exact uncompressed-member digest on each output row is not
    # necessary: the manifest and summary bind the complete export to this source member.
    # The source_snapshot_sha256 column stores the archive digest as the import join anchor.
    temp_path = aliases_path.with_suffix(".csv.gz.tmp")
    # Replace the placeholder with the real archive digest without holding the full export in memory.
    with gzip.open(aliases_path, "rt", encoding="utf-8", newline="") as src, gzip.open(
        temp_path, "wt", encoding="utf-8", newline="", compresslevel=6
    ) as dst:
        reader = csv.DictReader(src)
        writer = csv.DictWriter(dst, fieldnames=OUTPUT_FIELDS, extrasaction="raise", lineterminator="\n")
        writer.writeheader()
        for row in reader:
            row["source_snapshot_sha256"] = source_meta["archive_sha256"]
            writer.writerow(row)
    temp_path.replace(aliases_path)

    per_country = []
    for code, total in sorted(country_totals.items()):
        ids_with_aliases = len(alias_country_ids.get(code, set()))
        per_country.append({
            "source_country_code_raw": code,
            "candidate_records": total,
            "candidate_records_with_one_or_more_aliases": ids_with_aliases,
            "candidate_records_without_aliases_in_snapshot": total - ids_with_aliases,
            "matching_alias_rows": alias_country_rows[code],
            "alias_coverage_ratio": round(ids_with_aliases / total, 6) if total else 0.0,
        })

    report = {
        "schema_version": 1,
        "audit": "geonames-alternateNamesV2-to-destination-candidate-crosswalk",
        "generated_at_utc": utc_now(),
        "status": "PASS_ALIAS_SCOPE_RECONCILED__CANDIDATES_ONLY__NOT_IMPORTED",
        "scope": {
            "candidate_export": candidate_gzip.name,
            "candidate_ids_are_internal_catalog_ids": False,
            "candidate_ids_are_source_geonames_ids": True,
            "raw_language_names_flags_dates_preserved": True,
            "aliases_not_approved_for_selectability_or_identity_merge": True,
        },
        "sources": {
            "alternate_names_source": source_meta,
            "alternate_names_member_name": member_name,
            "alternate_names_member_sha256": member_sha,
            "candidate_export_size_bytes": candidate_gzip.stat().st_size,
            "candidate_export_sha256": sha256_path(candidate_gzip)[1],
        },
        "counts": {
            "alternate_names_source_rows_scanned": source_rows,
            "malformed_or_invalid_source_rows": malformed_rows,
            "invalid_boolean_flag_rows": flag_malformed_rows,
            "destination_candidate_ids": len(candidate_country),
            "candidate_ids_with_aliases": len(candidate_ids_with_aliases),
            "candidate_ids_without_aliases": len(candidate_country) - len(candidate_ids_with_aliases),
            "candidate_id_alias_coverage_ratio": round(len(candidate_ids_with_aliases) / len(candidate_country), 6),
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
        "per_source_country_code": per_country,
        "interpretation": {
            "alias_relationship": "GeoNames source alternate-name ID linked to source GeoNames feature ID only; does not assert internal place identity",
            "language_code_policy": "Preserve original language code; do not translate or relabel language",
            "effective_dates": "Preserve raw from/to values; blank values remain blank and are not interpreted as timeless legal truth",
            "canonical_names": "Original allCountries name and alternateNamesV2 remain separate fields/sources",
            "country_assignment": "Inherits the destination exporter source-code bucket only; no approved internal country mapping is implied",
            "source_completeness": "All rows in alternateNamesV2 are scanned and every valid matching alias row is exported; this says nothing about names missing from GeoNames",
            "operational_selectability": False,
            "database_or_production_changes": False,
        },
    }
    summary_path = output_dir / "worldwide-geonames-destination-alternate-name-summary.json"
    summary_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report, aliases_path, summary_path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-gzip", required=True, type=Path)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report, output, summary = export_aliases(args.candidate_gzip, args.archive, args.source_manifest, args.output_dir)
    except (OSError, UnicodeError, json.JSONDecodeError, zipfile.BadZipFile, ValueError) as exc:
        print(f"BLOCKED_ALTERNATE_NAME_CANDIDATE_EXPORT: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"status": report["status"], "summary_path": str(summary), "alias_file": str(output), **report["counts"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
