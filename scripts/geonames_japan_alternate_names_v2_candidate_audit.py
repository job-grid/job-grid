#!/usr/bin/env python3
"""Stream official GeoNames multilingual aliases for exact unresolved Japan ADM4 IDs."""
from __future__ import annotations
import argparse, csv, hashlib, json, re, sys, zipfile
from collections import Counter
from pathlib import Path, PurePosixPath

SOURCE_URL = "https://download.geonames.org/export/dump/alternateNamesV2.zip"
EXPECTED_TARGETS = 126
FEATURE_CODE = "ADM4"
RAW_ADMIN1_CODE = "00"
DISPOSITION = "PRESERVE_ADMIN_FEATURE_HIERARCHY_UNRESOLVED"
SCRIPT_RE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
ID_RE = re.compile(r"^[0-9]+$")
BOOL_VALUES = {"", "0", "1"}

def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def read_targets(path: Path, expected_count: int = EXPECTED_TARGETS) -> list[dict]:
    required = {"geonames_id", "name", "country_code", "feature_code", "raw_admin1_code", "raw_admin2_code", "owner_approved_disposition"}
    by_id: dict[str, dict] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("Disposition CSV lacks required Japan identity/raw-code columns.")
        for row in reader:
            if not (row.get("country_code") == "JP" and row.get("feature_code") == FEATURE_CODE and
                    row.get("raw_admin1_code") == RAW_ADMIN1_CODE and row.get("owner_approved_disposition") == DISPOSITION):
                continue
            gid = str(row.get("geonames_id", "")).strip()
            if not ID_RE.fullmatch(gid) or not str(row.get("name", "")).strip():
                raise ValueError("Selected Japan target has an invalid GeoNames ID or blank name.")
            candidate = {
                "geonames_id": gid, "name": row["name"], "country_code": row["country_code"],
                "feature_code": row["feature_code"], "raw_admin1_code": row["raw_admin1_code"],
                "raw_admin2_code": row.get("raw_admin2_code", ""),
                "owner_approved_disposition": row["owner_approved_disposition"],
            }
            prior = by_id.get(gid)
            if prior and prior != candidate:
                raise ValueError(f"Conflicting selected disposition rows for GeoNames ID {gid}.")
            by_id[gid] = candidate
    targets = sorted(by_id.values(), key=lambda row: int(row["geonames_id"]))
    if len(targets) != expected_count:
        raise ValueError(f"Expected {expected_count} unique unresolved Japan targets; got {len(targets)}.")
    return targets

def load_remote_manifest(path: Path, archive_path: Path) -> tuple[dict, str]:
    raw = path.read_bytes()
    manifest = json.loads(raw.decode("utf-8"))
    source = manifest.get("remote_source", {})
    if (source.get("source_url") != SOURCE_URL or source.get("http_status") != 200 or
        source.get("zip_crc_validation") != "PASS" or source.get("member_name") != "alternateNamesV2.txt"):
        raise ValueError("Multilingual-name source manifest is not a verified official GeoNames archive record.")
    digest = sha256_path(archive_path)
    if source.get("archive_sha256") != digest:
        raise ValueError("Multilingual-name archive SHA-256 differs from its retrieval manifest.")
    if source.get("archive_size_bytes") != archive_path.stat().st_size:
        raise ValueError("Multilingual-name archive size differs from its retrieval manifest.")
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Multilingual-name archive SHA-256 is invalid.")
    return source, hashlib.sha256(raw).hexdigest()

def build_report(archive_path: Path, targets_path: Path, source_manifest_path: Path,
                 expected_target_count: int = EXPECTED_TARGETS) -> dict:
    archive_path, targets_path, source_manifest_path = Path(archive_path), Path(targets_path), Path(source_manifest_path)
    targets = read_targets(targets_path, expected_target_count)
    source, source_manifest_sha256 = load_remote_manifest(source_manifest_path, archive_path)
    target_by_id = {row["geonames_id"]: row for row in targets}
    aliases_by_target: dict[str, list[dict]] = {gid: [] for gid in target_by_id}
    target_alias_ids: set[str] = set()
    language_counts: Counter[str] = Counter()
    source_rows_scanned = malformed_source_rows = malformed_target_rows = blank_source_rows = 0
    with zipfile.ZipFile(archive_path, "r") as archive:
        members = [name for name in archive.namelist() if PurePosixPath(name).name == "alternateNamesV2.txt"]
        if len(members) != 1 or members[0] != "alternateNamesV2.txt":
            raise ValueError("Expected exactly one root member named alternateNamesV2.txt.")
        info = archive.getinfo(members[0])
        if info.file_size <= 0 or info.file_size != source.get("member_uncompressed_size_bytes"):
            raise ValueError("Multilingual-name archive member size disagrees with its manifest.")
        with archive.open(members[0], "r") as raw_stream:
            for line_number, raw_line in enumerate(raw_stream, 1):
                source_rows_scanned += 1
                raw = raw_line.rstrip(b"\r\n")
                if not raw:
                    blank_source_rows += 1
                    continue
                fields = raw.split(b"\t")
                gid = fields[1].decode("ascii", errors="ignore") if len(fields) > 1 else ""
                is_target = gid in target_by_id
                if len(fields) != 10:
                    malformed_source_rows += 1
                    if is_target:
                        malformed_target_rows += 1
                    continue
                if not ID_RE.fullmatch(fields[0].decode("ascii", errors="ignore")) or not ID_RE.fullmatch(gid):
                    malformed_source_rows += 1
                    if is_target:
                        malformed_target_rows += 1
                    continue
                if not is_target:
                    continue
                try:
                    alias_id = fields[0].decode("ascii", errors="strict")
                    language = fields[2].decode("utf-8", errors="strict").strip()
                    name = fields[3].decode("utf-8", errors="strict")
                    flags = [field.decode("ascii", errors="strict").strip() for field in fields[4:8]]
                    valid_from = fields[8].decode("utf-8", errors="strict")
                    valid_to = fields[9].decode("utf-8", errors="strict")
                except UnicodeDecodeError:
                    malformed_source_rows += 1
                    malformed_target_rows += 1
                    continue
                if not name.strip() or any(flag not in BOOL_VALUES for flag in flags):
                    malformed_source_rows += 1
                    malformed_target_rows += 1
                    continue
                language_is_japanese = language.lower().split("-", 1)[0] == "ja"
                untagged_japanese_script = not language and bool(SCRIPT_RE.search(name))
                if not (language_is_japanese or untagged_japanese_script):
                    continue
                if alias_id in target_alias_ids:
                    raise ValueError(f"Duplicate alternateName ID in Japan target scope: {alias_id}.")
                target_alias_ids.add(alias_id)
                language_counts[language or "(blank)"] += 1
                aliases_by_target[gid].append({
                    "alternate_name_id": alias_id, "geonames_id": gid, "language_code": language,
                    "alternate_name": name, "is_preferred_name": flags[0], "is_short_name": flags[1],
                    "is_colloquial": flags[2], "is_historic": flags[3], "valid_from": valid_from, "valid_to": valid_to,
                    "source_line_number": line_number, "source_row_sha256": hashlib.sha256(raw).hexdigest(),
                    "source_archive_sha256": source["archive_sha256"],
                })
    if malformed_target_rows:
        raise ValueError(f"Found {malformed_target_rows} malformed alternate-name source rows attached to target IDs; cannot certify complete target-alias extraction.")
    target_results = []
    for target in targets:
        aliases = sorted(aliases_by_target[target["geonames_id"]],
                         key=lambda alias: (int(alias["alternate_name_id"]), alias["alternate_name"]))
        target_results.append({**target, "source_identity_scope_verified": True,
                               "selected_japanese_alias_count": len(aliases), "aliases": aliases,
                               "operational_parent_link_created": False})
    total_aliases = sum(len(row["aliases"]) for row in target_results)
    target_with_aliases = sum(bool(row["aliases"]) for row in target_results)
    return {
        "report_version": 1,
        "status": "PASS_SOURCE_PINNED_MULTILINGUAL_TARGET_ALIAS_EXTRACTION__CANDIDATES_ONLY__NO_PARENT_LINKS_APPROVED",
        "matching_rule": "Only alternateNamesV2 records attached by exact GeoNames ID to unresolved Japan ADM4 targets are considered. Included names have language code ja (including regional ja-* codes) or no language code and Japanese/Han script. Exact normalized equality to an official e-Stat Japanese label is required for candidate discovery; no entity identity or parent path is approved.",
        "generated_at_utc": source.get("retrieved_at_utc"), "target_count": len(target_results),
        "source_rows_scanned": source_rows_scanned, "malformed_source_rows": malformed_source_rows,
        "malformed_target_rows": malformed_target_rows, "blank_source_rows": blank_source_rows,
        "summary": {
            "target_count": len(target_results), "targets_with_selected_japanese_aliases": target_with_aliases,
            "targets_without_selected_japanese_aliases": len(target_results) - target_with_aliases,
            "selected_japanese_alias_rows": total_aliases, "selected_alias_language_counts": dict(sorted(language_counts.items())),
            "source_rows_scanned": source_rows_scanned, "malformed_source_rows": malformed_source_rows,
            "malformed_target_rows": malformed_target_rows, "blank_source_rows": blank_source_rows,
            "operational_parent_links_created": 0,
        },
        "source": {**source, "source_manifest_sha256": source_manifest_sha256,
                   "source_manifest_filename": source_manifest_path.name, "dispositions_sha256": sha256_path(targets_path),
                   "dispositions_filename": targets_path.name,
                   "member_uncompressed_size_bytes": source.get("member_uncompressed_size_bytes")},
        "target_results": target_results, "operational_parent_links_created": 0, "database_or_production_changes": False,
    }

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--targets", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = build_report(args.archive, args.targets, args.source_manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], **report["summary"],
                      "archive_sha256": report["source"]["archive_sha256"]}, ensure_ascii=False, indent=2))
    if report["operational_parent_links_created"] != 0 or report["database_or_production_changes"] is not False:
        raise RuntimeError("Safety boundary violation.")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Japan alternateNamesV2 candidate audit failed closed: {error}", file=sys.stderr)
        raise SystemExit(1)
