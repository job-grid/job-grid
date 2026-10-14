#!/usr/bin/env python3
"""Compare the Job Grid candidate catalogue with the ILO-hosted ISCO-08 CSV."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = ROOT / "data/occupations/isco-08-unit-groups.csv"
SOURCE_URL = (
    "https://webapps.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/"
    "ISCO-08%20EN.csv"
)
EXPECTED_COUNTS = {"1": 10, "2": 43, "3": 130, "4": 436}
EXPECTED_CODE_WIDTH = {"1": 1, "2": 2, "3": 3, "4": 4}


def fail(message: str) -> "NoReturn":
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_csv_bytes(
    content: bytes, delimiter: str
) -> tuple[list[dict[str, str]], str]:
    # The ILO-hosted source contains legacy Windows-1252 bytes; use UTF-8
    # whenever possible, with CP1252 fallback for the official file.
    try:
        text = content.decode("utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        text = content.decode("cp1252")
        encoding = "windows-1252"
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    if not reader.fieldnames:
        fail("CSV has no header row.")
    reader.fieldnames = [name.strip().lstrip("\ufeff") for name in reader.fieldnames]
    rows: list[dict[str, str]] = []
    for raw in reader:
        row = {
            (key or "").strip().lstrip("\ufeff"): (value or "").strip()
            for key, value in raw.items()
            if key is not None
        }
        if any(row.values()):
            rows.append(row)
    return rows, encoding


def add_group(
    groups: dict[str, dict[str, str]],
    level: str,
    code: str,
    title: str,
    source_label: str,
) -> None:
    code = code.strip()
    title = title.strip()
    if len(code) != EXPECTED_CODE_WIDTH[level] or not code.isdigit():
        fail(f"{source_label}: invalid level-{level} code {code!r}.")
    if not title:
        fail(f"{source_label}: blank title for level {level}, code {code}.")
    key = f"{level}:{code}"
    record = {"level": level, "code": code, "title": title}
    if key in groups and groups[key] != record:
        fail(
            f"{source_label}: inconsistent title/parent labels for {key}: "
            f"{groups[key]['title']!r} vs {title!r}."
        )
    groups[key] = record


def parse_official_source(rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    # The ILO's current CSV format contains a row per unit group, with the
    # full hierarchy columns: major/major_label/.../unit/description.
    required = {
        "ISCO_version", "major", "major_label", "sub_major",
        "sub_major_label", "minor", "minor_label", "unit", "description",
    }
    actual = set(rows[0]) if rows else set()
    if not required.issubset(actual):
        fail(
            "ILO source columns did not match the expected official hierarchy format. "
            f"Missing={sorted(required - actual)}; headers={sorted(actual)}."
        )

    groups: dict[str, dict[str, str]] = {}
    seen_units: set[str] = set()
    for row in rows:
        if row.get("ISCO_version", "").strip() not in ("ISCO-08", "ISCO 08"):
            # Ignore unrelated rows, but do not silently accept malformed ISCO rows.
            continue
        major_raw = row.get("major", "").strip()
        sub_major_raw = row.get("sub_major", "").strip()
        minor_raw = row.get("minor", "").strip()
        unit_raw = row.get("unit", "").strip()
        if not unit_raw:
            continue

        # The ILO CSV exports these code columns as numbers, so leading zeroes
        # in Major Group 0 can be dropped. Restore each fixed width (1/2/3/4).
        raw_codes = (
            ("major", major_raw, 1),
            ("sub-major", sub_major_raw, 2),
            ("minor", minor_raw, 3),
            ("unit", unit_raw, 4),
        )
        for label, raw_code, width in raw_codes:
            if not raw_code.isdigit() or len(raw_code) > width:
                fail(f"ILO source: invalid {label} code {raw_code!r}; row={row!r}.")
        major = major_raw.zfill(1)
        sub_major = sub_major_raw.zfill(2)
        minor = minor_raw.zfill(3)
        unit = unit_raw.zfill(4)

        if not sub_major.startswith(major):
            fail(f"ILO source: unit {unit} has invalid sub-major parent {sub_major}.")
        if not minor.startswith(sub_major):
            fail(f"ILO source: unit {unit} has invalid minor parent {minor}.")
        if not unit.startswith(minor):
            fail(f"ILO source: invalid unit/parent hierarchy {unit}/{minor}.")
        if unit in seen_units:
            fail(f"ILO source: duplicate unit-group code {unit}.")
        seen_units.add(unit)
        add_group(groups, "1", major, row.get("major_label", ""), "ILO source")
        add_group(groups, "2", sub_major, row.get("sub_major_label", ""), "ILO source")
        add_group(groups, "3", minor, row.get("minor_label", ""), "ILO source")
        add_group(groups, "4", unit, row.get("description", ""), "ILO source")

    counts = {
        level: sum(record["level"] == level for record in groups.values())
        for level in EXPECTED_COUNTS
    }
    if counts != EXPECTED_COUNTS:
        fail(
            "ILO source hierarchy counts did not match ISCO-08. "
            f"Counts={counts}; expected={EXPECTED_COUNTS}."
        )
    if len(seen_units) != 436:
        fail(f"ILO source contains {len(seen_units)} unique unit groups, not 436.")
    return groups


def parse_candidate_source(rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    for needed in ("isco_version", "isco08_code", "canonical_title_en"):
        if not rows or needed not in rows[0]:
            fail(
                f"Job Grid candidate CSV is missing {needed!r}; "
                f"headers={list(rows[0]) if rows else []!r}."
            )
    groups: dict[str, dict[str, str]] = {}
    for row in rows:
        level = ""
        code = ""
        title = ""
        if row.get("isco_version", "").strip() != "ISCO-08":
            fail("Job Grid candidate CSV contains a non-ISCO-08 record.")
        code = row.get("isco08_code", "").strip()
        if not re.fullmatch(r"\d{4}", code):
            fail(f"Job Grid candidate CSV has invalid unit-group code {code!r}.")
        title = row.get("canonical_title_en", "").strip()
        add_group(groups, "4", code, title, "Job Grid candidate CSV")
        for code_field, title_field, level in (
            ("major_group_code", "major_group_title", "1"),
            ("sub_major_group_code", "sub_major_group_title", "2"),
            ("minor_group_code", "minor_group_title", "3"),
        ):
            parent_code = row.get(code_field, "").strip()
            parent_title = row.get(title_field, "").strip()
            expected_prefix = code[:EXPECTED_CODE_WIDTH[level]]
            if parent_code != expected_prefix:
                fail(
                    f"Job Grid candidate code {code} has wrong {level}-level parent "
                    f"{parent_code!r}; expected {expected_prefix!r}."
                )
            add_group(groups, level, parent_code, parent_title, "Job Grid candidate CSV")
    counts = {
        level: sum(record["level"] == level for record in groups.values())
        for level in EXPECTED_COUNTS
    }
    if counts != EXPECTED_COUNTS:
        fail(
            "Job Grid candidate hierarchy counts differ. "
            f"Counts={counts}; expected={EXPECTED_COUNTS}."
        )
    return groups


def main() -> None:
    try:
        request = urllib.request.Request(
            SOURCE_URL,
            headers={
                "User-Agent": "JobGrid-ISCO08-source-validation/1.0",
                "Accept": "text/csv,application/octet-stream,*/*",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                fail(f"ILO primary source returned HTTP {status}.")
            official_bytes = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        fail(
            "could not download the ILO-hosted primary CSV. "
            "This is an unverified-source result, not a pass. "
            f"URL={SOURCE_URL}; detail={exc}"
        )

    if len(official_bytes) < 10_000:
        fail(f"ILO source response was unexpectedly small ({len(official_bytes)} bytes).")
    official_hash = hashlib.sha256(official_bytes).hexdigest()

    try:
        official_rows, official_encoding = read_csv_bytes(official_bytes, ",")
        candidate_rows, candidate_encoding = read_csv_bytes(CANDIDATE.read_bytes(), ",")
    except (UnicodeDecodeError, csv.Error) as exc:
        fail(f"CSV parsing failed: {exc}")

    official = parse_official_source(official_rows)
    candidate = parse_candidate_source(candidate_rows)

    mismatches = []
    for key in sorted(official):
        if key not in candidate:
            mismatches.append({
                "group": key, "issue": "missing_candidate_record",
                "ilo_title": official[key]["title"],
            })
            continue
        if candidate[key]["title"] != official[key]["title"]:
            mismatches.append({
                "group": key,
                "issue": "title_mismatch",
                "ilo_title": official[key]["title"],
                "candidate_title": candidate[key]["title"],
            })

    candidate_only = sorted(set(candidate) - set(official))
    for key in candidate_only:
        mismatches.append({
            "group": key,
            "issue": "extra_candidate_parent_or_unit",
            "candidate_title": candidate[key]["title"],
        })

    # Also confirm the explicit per-row hierarchy fields correspond to the codes.
    for row in candidate_rows:
        code = row.get("isco08_code", "").strip()
        if not re.fullmatch(r"\d{4}", code):
            continue
        for code_field, title_field, level, parent_code in (
            ("major_group_code", "major_group_title", "1", code[:1]),
            ("sub_major_group_code", "sub_major_group_title", "2", code[:2]),
            ("minor_group_code", "minor_group_title", "3", code[:3]),
        ):
            source = official.get(f"{level}:{parent_code}")
            if source is None:
                mismatches.append({
                    "group": f"{level}:{parent_code}",
                    "issue": f"missing_official_parent_for_{code}",
                })
            elif (
                row.get(code_field, "").strip() != parent_code
                or row.get(title_field, "").strip() != source["title"]
            ):
                mismatches.append({
                    "group": f"{level}:{parent_code}",
                    "context_unit_group": code,
                    "issue": "candidate_parent_label_mismatch",
                    "ilo_title": source["title"],
                    "candidate_title": row.get(title_field, "").strip(),
                })

    if mismatches:
        print(json.dumps({
            "result": "FAIL",
            "mismatch_count": len(mismatches),
            "first_mismatches": mismatches[:25],
            "source_url": SOURCE_URL,
            "source_sha256": official_hash,
            "source_encoding": official_encoding,
        }, indent=2, ensure_ascii=False))
        raise SystemExit(1)

    bad_flags = sum(
        1 for row in candidate_rows
        if row.get("source_verification_status") != "requires_official_source_crosscheck"
        or row.get("category_mapping_status") != "pending"
        or row.get("job_grid_category_slug", "").strip()
        or row.get("publicly_active") != "false"
    )
    if bad_flags:
        fail(
            f"{bad_flags} candidate records do not retain the required "
            "pending/unmapped/inactive flags."
        )

    print(json.dumps({
        "result": "PASS",
        "source": "International Labour Organization official ISCO-08 CSV",
        "source_url": SOURCE_URL,
        "source_sha256": official_hash,
        "source_bytes": len(official_bytes),
        "source_encoding": official_encoding,
        "candidate_encoding": candidate_encoding,
        "group_counts": EXPECTED_COUNTS,
        "unit_group_codes_compared": 436,
        "all_level_titles_compared": len(official),
        "title_mismatches": 0,
        "hierarchy_labels_compared": 436 * 3,
        "job_grid_mapping": "PENDING (separate review gate)",
        "production_import_authorized": False,
        "publicly_active_records": 0,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
