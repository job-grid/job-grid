#!/usr/bin/env python3
"""Independently recreate the GeoNames place-sample selection.

This implementation deliberately does not import or execute prepare_sample.py.
It uses a sorted bounded list for top-population selection rather than the
original script's heap. Reservoir sampling uses Python's seeded random.Random
for reproducible draws, so this is a separate selection implementation but
not a cross-language or independent PRNG implementation.
"""
from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import io
import json
import random
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COUNTRIES = ("KE", "GB", "JP", "BR", "SG")
PRIORITY_NAMES = {
    "KE": {"nairobi", "kisumu", "mombasa"},
    "GB": {"london"},
    "JP": {"tokyo"},
    "BR": {"brasilia"},
    "SG": {"singapore"},
}
COLUMNS = [
    "geonameid", "name", "asciiname", "alternatenames", "latitude",
    "longitude", "feature_class", "feature_code", "country_code", "cc2",
    "admin1_code", "admin2_code", "admin3_code", "admin4_code",
    "population", "elevation", "dem", "timezone", "modification_date",
]
SAMPLE_HEADER = COLUMNS + ["sample_reason"]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def norm(value: str) -> str:
    return " ".join((value or "").strip().casefold().split())


def add_selected(
    selected: dict[str, dict[str, Any]], row: list[str], reason: str
) -> None:
    geo_id = row[0]
    if geo_id not in selected:
        selected[geo_id] = {"row": row, "reasons": set()}
    selected[geo_id]["reasons"].add(reason)


def select_rows(source_zip: Path) -> tuple[list[list[str]], dict[str, Any]]:
    # Separate implementation: keep each country's top 100 in a sorted list.
    # A row's unique GeoNames ID supplies a deterministic tiebreaker.
    top: dict[str, list[tuple[int, int, list[str]]]] = {cc: [] for cc in COUNTRIES}
    reservoir: dict[str, list[list[str]]] = {cc: [] for cc in COUNTRIES}
    rng = {
        cc: random.Random(20261010 + sum(map(ord, cc)))
        for cc in COUNTRIES
    }
    seen_ids: dict[str, str] = {}
    selected: dict[str, dict[str, Any]] = {}
    population_seen: Counter[str] = Counter()
    per_country: dict[str, dict[str, Any]] = {
        cc: {
            "source_records": 0,
            "administrative_features": 0,
            "populated_places": 0,
            "other_features": 0,
            "priority_name_matches": 0,
            "selected_records": 0,
        }
        for cc in COUNTRIES
    }
    scanned = malformed = duplicate_ids = invalid_coordinates = 0

    with zipfile.ZipFile(source_zip, "r") as archive:
        members = [name for name in archive.namelist()
                   if name.lower().endswith("allcountries.txt")]
        if not members:
            members = [name for name in archive.namelist()
                       if name.lower().endswith(".txt")]
        if not members:
            raise RuntimeError("No text data member found in source ZIP.")
        source_member = members[0]
        with archive.open(source_member, "r") as raw:
            with io.TextIOWrapper(
                raw, encoding="utf-8", errors="strict", newline=""
            ) as stream:
                for line_number, line in enumerate(stream, 1):
                    scanned += 1
                    if scanned % 1_000_000 == 0:
                        print(f"Independently scanned {scanned:,} rows", flush=True)
                    fields = line.rstrip("\r\n").split("\t")
                    if len(fields) != 19:
                        malformed += 1
                        continue
                    country = fields[8].strip().upper()
                    if country not in COUNTRIES:
                        continue

                    per_country[country]["source_records"] += 1
                    geo_id = fields[0].strip()
                    if not geo_id:
                        continue
                    if geo_id in seen_ids:
                        duplicate_ids += 1
                        continue
                    seen_ids[geo_id] = country

                    try:
                        latitude = float(fields[4])
                        longitude = float(fields[5])
                        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                            raise ValueError("coordinate out of range")
                    except (ValueError, TypeError):
                        invalid_coordinates += 1

                    names = {norm(fields[1]), norm(fields[2])}
                    if names & PRIORITY_NAMES[country]:
                        per_country[country]["priority_name_matches"] += 1
                        add_selected(selected, fields, "priority_name_match")

                    feature_class = fields[6].strip()
                    if feature_class == "A":
                        per_country[country]["administrative_features"] += 1
                        add_selected(selected, fields, "administrative_feature")
                    elif feature_class == "P":
                        per_country[country]["populated_places"] += 1
                        try:
                            population = max(0, int(fields[14] or "0"))
                        except ValueError:
                            population = 0
                        entry = (population, int(geo_id), fields)
                        top_list = top[country]
                        if len(top_list) < 100:
                            bisect.insort(top_list, entry)
                        elif entry > top_list[0]:
                            top_list.pop(0)
                            bisect.insort(top_list, entry)

                        population_seen[country] += 1
                        reservoir_list = reservoir[country]
                        if len(reservoir_list) < 100:
                            reservoir_list.append(fields)
                        else:
                            index = rng[country].randrange(population_seen[country])
                            if index < 100:
                                reservoir_list[index] = fields
                    else:
                        per_country[country]["other_features"] += 1

    for country in COUNTRIES:
        for _, _, row in top[country]:
            add_selected(selected, row, "top_population_sample")
        for row in reservoir[country]:
            add_selected(selected, row, "deterministic_reservoir_sample")
        for item in selected.values():
            if item["row"][8].strip().upper() == country:
                per_country[country]["selected_records"] += 1

    ordered_items = sorted(
        selected.values(),
        key=lambda item: (item["row"][8], int(item["row"][0])),
    )
    return [item["row"] + [";".join(sorted(item["reasons"]))]
            for item in ordered_items], {
        "source_member": source_member,
        "worldwide_rows_scanned": scanned,
        "malformed_worldwide_rows": malformed,
        "duplicate_ids_across_selected_countries": duplicate_ids,
        "invalid_coordinates_across_selected_countries": invalid_coordinates,
        "selected_sample_rows": len(ordered_items),
        "selected_sample_unique_ids": len({item["row"][0] for item in ordered_items}),
        "countries": per_country,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allcountries-zip", required=True, type=Path)
    parser.add_argument("--expected-sample", required=True, type=Path)
    parser.add_argument("--output-tsv", required=True, type=Path)
    parser.add_argument("--report-json", required=True, type=Path)
    args = parser.parse_args()

    source_zip = args.allcountries_zip.resolve()
    expected_path = args.expected_sample.resolve()
    output_path = args.output_tsv.resolve()
    report_path = args.report_json.resolve()
    if not source_zip.is_file() or not expected_path.is_file():
        parser.error("Source archive and expected sample must both exist.")
    if output_path in (source_zip, expected_path) or report_path in (source_zip, expected_path, output_path):
        parser.error("Output/report paths must not overwrite any input.")
    if output_path.exists() or report_path.exists():
        parser.error("Refusing to overwrite existing output or report files.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    started = datetime.now(timezone.utc)
    rows, summary = select_rows(source_zip)
    with output_path.open("x", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream, delimiter="\t", lineterminator="\n")
        writer.writerow(SAMPLE_HEADER)
        writer.writerows(rows)

    with expected_path.open("rb") as stream:
        expected_hash = hashlib.sha256(stream.read()).hexdigest()
    reproduced_hash = sha256_file(output_path)
    summary.update({
        "report_type": "independent_geonames_sample_selection_reproduction",
        "started_utc": started.isoformat(),
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "source_zip_bytes": source_zip.stat().st_size,
        "source_zip_sha256": sha256_file(source_zip),
        "expected_sample_filename": expected_path.name,
        "expected_sample_sha256": expected_hash,
        "reproduced_sample_filename": output_path.name,
        "reproduced_sample_sha256": reproduced_hash,
        "sample_tsv_byte_identical": expected_hash == reproduced_hash,
        "implementation_note": (
            "Separately authored selection code using a sorted top-100 list "
            "instead of the original script's heap; reservoir draws use the "
            "same seeded Python random.Random algorithm for reproducibility."
        ),
        "limitations": [
            "This independently reimplements selection logic but is not a cross-language PRNG check.",
            "A matching five-country sample does not establish worldwide geographic catalog completeness.",
            "The output is a validation artifact, not a database import.",
        ],
    })
    report_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "worldwide_rows_scanned": summary["worldwide_rows_scanned"],
        "malformed_worldwide_rows": summary["malformed_worldwide_rows"],
        "selected_sample_rows": summary["selected_sample_rows"],
        "selected_sample_unique_ids": summary["selected_sample_unique_ids"],
        "expected_sample_sha256": expected_hash,
        "reproduced_sample_sha256": reproduced_hash,
        "sample_tsv_byte_identical": summary["sample_tsv_byte_identical"],
        "output_tsv": str(output_path),
        "report_json": str(report_path),
    }, indent=2), flush=True)
    return 0 if summary["sample_tsv_byte_identical"] and summary["malformed_worldwide_rows"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
