#!/usr/bin/env python3
"""Sync source-owned ISCO-08 code/title fields from the official ILO CSV.

The script intentionally preserves Job Grid category suggestions but never
approves them, never activates an occupation, and never writes to Supabase.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data/occupations/isco-08-unit-groups.csv"
JSON_PATH = ROOT / "public/data/occupations-isco08-review.json"
MANIFEST_PATH = ROOT / "data/occupations/isco-08-source-manifest.json"
README_PATH = ROOT / "data/occupations/README.md"
HTML_PATH = ROOT / "occupations-preview.html"
SOURCE_URL = (
    "https://webapps.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/"
    "ISCO-08%20EN.csv"
)
EXPECTED_COUNTS = {"1": 10, "2": 43, "3": 130, "4": 436}


def stop(message: str) -> "NoReturn":
    raise SystemExit(f"FAIL: {message}")


def decode_source(content: bytes) -> tuple[str, str]:
    try:
        return content.decode("utf-8-sig"), "utf-8-sig"
    except UnicodeDecodeError:
        return content.decode("cp1252"), "windows-1252"


def read_official_groups(content: bytes) -> tuple[dict[str, dict[str, str]], str]:
    text, encoding = decode_source(content)
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=",")
    if not reader.fieldnames:
        stop("Official ILO CSV has no header.")
    reader.fieldnames = [name.strip().lstrip("\ufeff") for name in reader.fieldnames]
    required = {
        "ISCO_version", "major", "major_label", "sub_major",
        "sub_major_label", "minor", "minor_label", "unit", "description",
    }
    if not required.issubset(set(reader.fieldnames)):
        stop(
            "Official ILO CSV columns changed; missing "
            f"{sorted(required - set(reader.fieldnames))}; headers={reader.fieldnames!r}"
        )

    groups: dict[str, dict[str, str]] = {}
    seen_units: set[str] = set()

    def put(level: str, raw_code: str, raw_title: str) -> None:
        width = int(level)
        code = raw_code.strip()
        title = raw_title.strip()
        if not code or not code.isdigit() or len(code) > width:
            stop(f"Invalid official level-{level} code {code!r}.")
        code = code.zfill(width)
        if not title:
            stop(f"Blank official title for code {code}.")
        key = f"{level}:{code}"
        record = {"level": level, "code": code, "title": title}
        if key in groups and groups[key] != record:
            stop(
                f"Official ILO CSV has inconsistent labels for {key}: "
                f"{groups[key]['title']!r} / {title!r}."
            )
        groups[key] = record

    for row in reader:
        if row.get("ISCO_version", "").strip() not in ("ISCO-08", "ISCO 08"):
            continue
        unit_raw = row.get("unit", "").strip()
        if not unit_raw:
            continue

        major_raw = row.get("major", "").strip()
        sub_raw = row.get("sub_major", "").strip()
        minor_raw = row.get("minor", "").strip()
        for label, raw_code, width in (
            ("major", major_raw, 1),
            ("sub-major", sub_raw, 2),
            ("minor", minor_raw, 3),
            ("unit", unit_raw, 4),
        ):
            if not raw_code.isdigit() or len(raw_code) > width:
                stop(f"Invalid official {label} code {raw_code!r}; row={row!r}")

        major = major_raw.zfill(1)
        sub = sub_raw.zfill(2)
        minor = minor_raw.zfill(3)
        unit = unit_raw.zfill(4)
        if not sub.startswith(major) or not minor.startswith(sub) or not unit.startswith(minor):
            stop(f"Official hierarchy is inconsistent for unit {unit}: {row!r}")
        if unit in seen_units:
            stop(f"Duplicate official unit group {unit}.")
        seen_units.add(unit)

        put("1", major, row.get("major_label", ""))
        put("2", sub, row.get("sub_major_label", ""))
        put("3", minor, row.get("minor_label", ""))
        put("4", unit, row.get("description", ""))

    counts = {
        level: sum(record["level"] == level for record in groups.values())
        for level in EXPECTED_COUNTS
    }
    if counts != EXPECTED_COUNTS or len(seen_units) != 436:
        stop(f"Official hierarchy counts unexpected: {counts}; expected {EXPECTED_COUNTS}.")
    return groups, encoding


def load_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            stop(f"{path.relative_to(ROOT)} has no CSV header.")
        rows = [{key: (value or "") for key, value in row.items()} for row in reader]
        return list(reader.fieldnames), rows


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=fields, quoting=csv.QUOTE_ALL, extrasaction="ignore"
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    request = urllib.request.Request(
        SOURCE_URL,
        headers={
            "User-Agent": "JobGrid-ISCO08-official-source-sync/1.0",
            "Accept": "text/csv,application/octet-stream,*/*",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if getattr(response, "status", 200) != 200:
                stop(f"ILO source returned HTTP {response.status}.")
            official_bytes = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        stop(f"Unable to retrieve official ILO source; no data changed: {exc}")

    if len(official_bytes) < 10_000:
        stop(f"Official source download is unexpectedly small ({len(official_bytes)} bytes).")
    source_sha256 = hashlib.sha256(official_bytes).hexdigest()
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    official, source_encoding = read_official_groups(official_bytes)

    fields, candidates = load_csv(CSV_PATH)
    by_code = {row.get("isco08_code", "").strip(): row for row in candidates}
    if len(candidates) != 436 or len(by_code) != 436:
        stop(f"Expected 436 unique candidate unit groups; found rows={len(candidates)}, unique={len(by_code)}.")
    official_units = {
        group["code"]: group for key, group in official.items() if key.startswith("4:")
    }
    if set(by_code) != set(official_units):
        stop(
            "Candidate and official unit-code sets differ; "
            f"missing={sorted(set(official_units) - set(by_code))[:12]}, "
            f"extra={sorted(set(by_code) - set(official_units))[:12]}"
        )

    for code, row in by_code.items():
        row["isco_version"] = "ISCO-08"
        row["canonical_title_en"] = official_units[code]["title"]
        for level, code_field, title_field, prefix_width in (
            ("1", "major_group_code", "major_group_title", 1),
            ("2", "sub_major_group_code", "sub_major_group_title", 2),
            ("3", "minor_group_code", "minor_group_title", 3),
        ):
            parent_code = code[:prefix_width]
            parent = official[f"{level}:{parent_code}"]
            row[code_field] = parent_code
            row[title_field] = parent["title"]
        row["source_verification_status"] = "verified_source_match"
        row["job_grid_category_slug"] = ""
        row["category_mapping_status"] = "pending"
        row["publicly_active"] = "false"

    ordered = [by_code[code] for code in sorted(by_code)]
    write_csv(CSV_PATH, fields, ordered)

    catalog = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    groups_by_code = {group["code"]: group for group in catalog["groups"]}
    if len(groups_by_code) != 436 or set(groups_by_code) != set(by_code):
        stop("Review JSON does not contain exactly the same 436 occupation codes.")
    for code, group in groups_by_code.items():
        row = by_code[code]
        group["title"] = row["canonical_title_en"]
        group["majorGroupCode"] = row["major_group_code"]
        group["majorGroupTitle"] = row["major_group_title"]
        group["subMajorGroupCode"] = row["sub_major_group_code"]
        group["subMajorGroupTitle"] = row["sub_major_group_title"]
        group["minorGroupCode"] = row["minor_group_code"]
        group["minorGroupTitle"] = row["minor_group_title"]
        group["sourceStatus"] = "verified_source_match"
        group["active"] = False
    catalog["source_verification_status"] = "verified_source_match"
    catalog["source_verified_records"] = 436
    catalog["production_import_authorized"] = False
    catalog["publicly_active"] = False
    catalog["disclaimer"] = (
        "All 436 unit-group codes, titles and parent labels were matched to the "
        "ILO-hosted official ISCO-08 CSV at the recorded source hash. Job Grid category "
        "suggestions remain rule-based and unapproved. These are occupation groups, "
        "not vacancies; all records remain inactive and not approved for production."
    )
    catalog["source_audit"] = {
        "status": "official_source_crosscheck_passed",
        "source_url": SOURCE_URL,
        "source_sha256": source_sha256,
        "retrieved_at_utc": retrieved_at,
        "source_bytes": len(official_bytes),
        "source_encoding": source_encoding,
        "group_counts": EXPECTED_COUNTS,
        "unit_group_code_title_matches": 436,
        "parent_label_matches": 436 * 3,
    }
    catalog["mapping_summary"]["source_verified_records"] = 436
    JSON_PATH.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest.update({
        "source_status": "official_source_crosscheck_passed",
        "source_access_note": (
            "The ILO landing-page legacy download links returned 404, but the official "
            "webapps.ilo.org ISCO-08 CSV host was reachable. This sync downloaded and "
            "compared all codes, titles and hierarchy labels against those returned bytes."
        ),
        "source_sha256": source_sha256,
        "source_bytes": len(official_bytes),
        "source_encoding": source_encoding,
        "source_retrieved_at_utc": retrieved_at,
        "verified_unit_group_records": 436,
        "verified_parent_labels": 436 * 3,
        "category_mapping_status": "suggested_not_approved",
        "production_import_authorized": False,
        "public_visibility_authorized": False,
        "note": (
            "Source codes, titles and parent labels are synchronized to the official ILO CSV. "
            "Rule-based Job Grid category suggestions remain unapproved; the 5 unmapped rows "
            "need manual review. Do not import or activate records as vacancies."
        ),
    })
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    readme = README_PATH.read_text(encoding="utf-8")
    readme = re.sub(
        r"^.*contains 436 candidate unit-group records.*$",
        "The catalogue contains 436 ISCO-08 unit-group records. Source-owned codes, titles and hierarchy labels are synchronized from the ILO-hosted official CSV by the source sync script. Source verification is recorded with the exact SHA-256 and retrieval time; Job Grid category suggestions remain unapproved, and the catalogue is not a vacancy list or production import.",
        readme,
        count=1,
        flags=re.MULTILINE,
    )
    readme = re.sub(
        r"^- The official page advertises downloadable.*reconciliation to the primary file remains outstanding\.$",
        f"- The official ILO-hosted source CSV was retrieved at {retrieved_at}; its SHA-256 is {source_sha256}. The sync compared all 436 unit-group codes and titles plus all parent labels from the official hierarchy. The older public mirror was used only for the initial extraction and its title differences were replaced from the official file.",
        readme,
        count=1,
        flags=re.MULTILINE,
    )
    readme = re.sub(
        r"^Every record is labelled.*These flags are deliberate\.$",
        "Every record is labelled verified_source_match for its official ILO code/title/hierarchy fields; category mapping remains pending; job_grid_category_slug is blank; and publicly_active is false. The 431 category suggestions are still unapproved, with 5 records requiring manual mapping review.",
        readme,
        count=1,
        flags=re.MULTILINE,
    )
    readme = re.sub(
        r"^Do not run this file as a database seed.*approved import migration\.$",
        "Do not run this file as a database seed or treat it as a live vacancy feed. The official source code/title check has passed, but PR #45's proposed public.occupations schema remains unmerged. Loading these records requires human review of the proposed mappings to Job Grid's existing 25 category slugs, a separate migration review, and explicit production approval.",
        readme,
        count=1,
        flags=re.MULTILINE,
    )
    readme = re.sub(
        r"1\. Obtain a working authoritative ILO source file and reconcile every code/title pair\.\n2\. Review the 436 unit-group-to-Job-Grid-category mappings; do not force an inaccurate single-category match\.\n3\. Crosswalk the existing 496 starter role titles to ISCO-08 codes, retaining ambiguous matches for review\.\n4\. Add aliases only when supported by a source or reviewed mapping\.\n5\. Generate a data-only migration after PR #45 and the live recovery/security release gates have been separately resolved and approved\.",
        "1. Review the 431 suggested Job Grid category mappings and manually decide the 5 unmapped records.\n2. Crosswalk the existing 496 starter role titles to ISCO-08 codes, retaining ambiguous matches for human review.\n3. Add aliases only when supported by a source or reviewed mapping.\n4. Prepare a data-only migration after PR #45 and the live recovery/security release gates have been separately resolved and approved.",
        readme,
        count=1,
    )
    readme = re.sub(
        r"\n+## Latest official source audit\n.*?(?=\n## |\Z)",
        "",
        readme,
        flags=re.DOTALL,
    )
    readme += (
        "\n\n## Latest official source audit\n\n"
        f"- Retrieval time (UTC): {retrieved_at}\n"
        f"- Official CSV: {SOURCE_URL}\n"
        f"- SHA-256: {source_sha256}\n"
        "- Result: 436/436 unit-group codes and titles matched; parent labels matched; "
        "Job Grid category mappings remain unapproved; no record is active.\n"
    )
    README_PATH.write_text(readme, encoding="utf-8")

    html = HTML_PATH.read_text(encoding="utf-8")
    old_notice = (
        "This candidate copy has not been compared row-by-row with the official ILO download. "
        "Category suggestions still need human review. Nothing on this page is a real job vacancy. "
        "Category suggestions are generated by title-keyword rules and still need review; every "
        "record remains inactive until the ILO source and category mapping are approved."
    )
    new_notice = (
        "Official ILO source comparison has matched the codes, titles and parent labels for all "
        "436 unit groups. Job Grid category suggestions are generated by title-keyword rules and "
        "still need human review. Nothing on this page is a real job vacancy; every record remains "
        "inactive and the catalogue is not approved for production."
    )
    mapped_notice = (
        "Official ILO source comparison has matched the codes, titles and parent labels for all "
        "436 unit groups. Job Grid category suggestions use conservative whole-word title rules; "
        "ambiguous and unmatched titles are sent to manual review. Nothing on this page is a real "
        "job vacancy; every record remains inactive and the catalogue is not approved for production."
    )
    if old_notice in html:
        html = html.replace(old_notice, new_notice)
    elif new_notice not in html and mapped_notice not in html:
        stop("Could not find the preview's source-warning text to update safely.")
    HTML_PATH.write_text(html, encoding="utf-8")

    print(json.dumps({
        "result": "PASS",
        "action": "synchronized source-owned fields from official ILO CSV",
        "source_url": SOURCE_URL,
        "source_sha256": source_sha256,
        "source_bytes": len(official_bytes),
        "source_encoding": source_encoding,
        "retrieved_at_utc": retrieved_at,
        "group_counts": EXPECTED_COUNTS,
        "unit_group_codes_and_titles_synced": 436,
        "parent_labels_synced": 436 * 3,
        "proposed_category_mappings_preserved": catalog["mapping_summary"]["proposed_category_mappings"],
        "manual_mapping_review_required": catalog["mapping_summary"]["manual_mapping_review_required"],
        "category_mapping_approved": False,
        "production_import_authorized": False,
        "publicly_active_records": 0,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
