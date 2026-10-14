#!/usr/bin/env python3
"""Compare the candidate ISCO-08 structure with the ILO-hosted primary CSV.

This check uses the official ILO file host directly because the current ILO
landing page still links some downloads through legacy www.ilo.org URLs.
No data are downloaded into the public web bundle or imported into a database.
"""
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


def read_csv_bytes(content: bytes, delimiter: str) -> list[dict[str, str]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    if not reader.fieldnames:
        fail("CSV has no header row.")
    reader.fieldnames = [name.strip().lstrip("\ufeff") for name in reader.fieldnames]
    rows: list[dict[str, str]] = []
    for raw in reader:
        row = {(key or "").strip().lstrip("\ufeff"): (value or "").strip()
               for key, value in raw.items() if key is not None}
        if any(row.values()):
            rows.append(row)
    return rows


def code_map(rows: list[dict[str, str]], label: str) -> dict[str, dict[str, str]]:
    for needed in ("Level", "ISCO 08 Code", "Title EN"):
        if not rows or needed not in rows[0]:
            fail(f"{label} is missing the required column {needed!r}.")
    groups: dict[str, dict[str, str]] = {}
    for row in rows:
        level = row.get("Level", "").strip()
        if level not in EXPECTED_COUNTS:
            continue
        code = row.get("ISCO 08 Code", "").strip()
        title = row.get("Title EN", "").strip()
        if len(code) != EXPECTED_CODE_WIDTH[level] or not code.isdigit():
            fail(f"{label}: invalid code {code!r} for level {level}.")
        key = f"{level}:{code}"
        if key in groups:
            fail(f"{label}: duplicate level/code {key}.")
        if not title:
            fail(f"{label}: blank title for {key}.")
        groups[key] = {"level": level, "code": code, "title": title}
    counts = {level: sum(row["level"] == level for row in groups.values())
              for level in EXPECTED_COUNTS}
    if counts != EXPECTED_COUNTS:
        fail(f"{label}: group counts were {counts}; expected {EXPECTED_COUNTS}.")
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
        official_rows = read_csv_bytes(official_bytes, ";")
        candidate_rows = read_csv_bytes(CANDIDATE.read_bytes(), ",")
    except (UnicodeDecodeError, csv.Error) as exc:
        fail(f"CSV parsing failed: {exc}")

    official = code_map(official_rows, "ILO source")
    candidate = code_map(candidate_rows, "Job Grid candidate CSV")

    code_keys = {key for key in official if key.startswith("4:")}
    candidate_unit_keys = {key for key in candidate if key.startswith("4:")}
    missing = sorted(code_keys - candidate_unit_keys)
    extra = sorted(candidate_unit_keys - code_keys)
    if missing or extra:
        fail(f"unit-group code set differs; missing={missing[:12]}, extra={extra[:12]}")

    mismatches: list[dict[str, str]] = []
    for key in sorted(official):
        if key not in candidate:
            fail(f"candidate file is missing hierarchical group {key}.")
        left = official[key]["title"]
        right = candidate[key]["title"]
        if left != right:
            mismatches.append({
                "level": official[key]["level"],
                "code": official[key]["code"],
                "ilo_title": left,
                "candidate_title": right,
            })

    # Compare every candidate's parent labels to the same official source rows.
    for row in candidate_rows:
        code = row.get("isco08_code", "").strip()
        if not re.fullmatch(r"\d{4}", code):
            continue
        hierarchy = [
            ("major_group_code", "major_group_title", "1", code[:1]),
            ("sub_major_group_code", "sub_major_group_title", "2", code[:2]),
            ("minor_group_code", "minor_group_title", "3", code[:3]),
        ]
        for code_field, title_field, level, parent_code in hierarchy:
            source = official.get(f"{level}:{parent_code}")
            if source is None:
                fail(f"missing official parent level={level} code={parent_code} for {code}.")
            if row.get(code_field, "").strip() != parent_code:
                fail(f"wrong candidate parent code for unit group {code}: {code_field}.")
            candidate_parent_title = row.get(title_field, "").strip()
            if candidate_parent_title != source["title"]:
                mismatches.append({
                    "level": level,
                    "code": parent_code,
                    "ilo_title": source["title"],
                    "candidate_title": candidate_parent_title,
                    "context_unit_group": code,
                })

    if mismatches:
        print(json.dumps({
            "result": "FAIL",
            "mismatch_count": len(mismatches),
            "first_mismatches": mismatches[:25],
            "source_url": SOURCE_URL,
            "source_sha256": official_hash,
        }, indent=2, ensure_ascii=False))
        raise SystemExit(1)

    # Ensure only the ISCO source fields were compared; mapping status remains a separate gate.
    unverified = sum(
        1 for row in candidate_rows
        if row.get("source_verification_status") != "requires_official_source_crosscheck"
        or row.get("category_mapping_status") != "pending"
        or row.get("job_grid_category_slug", "").strip()
        or row.get("publicly_active") != "false"
    )
    if unverified:
        fail(
            f"{unverified} candidate records do not retain the required "
            "pending/unmapped/inactive flags."
        )

    print(json.dumps({
        "result": "PASS",
        "source": "International Labour Organization official ISCO-08 CSV",
        "source_url": SOURCE_URL,
        "source_sha256": official_hash,
        "source_bytes": len(official_bytes),
        "group_counts": EXPECTED_COUNTS,
        "unit_group_codes_compared": len(candidate_unit_keys),
        "all_level_titles_compared": len(official),
        "hierarchy_labels_compared": len(candidate_unit_keys) * 3,
        "title_mismatches": 0,
        "job_grid_mapping": "PENDING (not part of source comparison)",
        "production_import_authorized": False,
        "publicly_active_records": 0,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
