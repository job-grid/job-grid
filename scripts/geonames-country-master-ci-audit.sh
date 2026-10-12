#!/usr/bin/env bash
set -euo pipefail

work="$1"
if [[ -z "$work" ]]; then
  echo "Pass the existing GeoNames global source workspace as the first argument." >&2
  exit 2
fi
audit="$work/country-master-audit"
mkdir -p "$audit"

url="https://download.geonames.org/export/dump/countryInfo.txt"
source="$work/countryInfo.txt"
headers="$audit/countryInfo.headers"
status="$(curl --silent --show-error --location --fail --retry 3 --retry-all-errors \
  --dump-header "$headers" --output "$source" --write-out '%{http_code}' "$url")"
test "$status" = "200"
test -s "$source"
retrieved_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

python - "$headers" "$source" "$url" "$retrieved_at" "$status" "$work/source-manifest.json" "$audit/country-master-source-manifest.json" <<'PY'
import hashlib
import json
import sys
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

headers_path, source_path, url, retrieved_at, status, world_manifest_path, output_path = sys.argv[1:]
raw_headers = Path(headers_path).read_text(encoding="iso-8859-1", errors="replace")
last_block = {}
current = {}
current_status = None
for line in raw_headers.replace("\r\n", "\n").split("\n"):
    if line.startswith("HTTP/"):
        if current_status == "200":
            last_block = current
        pieces = line.split()
        current_status = pieces[1] if len(pieces) > 1 else None
        current = {}
    elif ":" in line and current_status:
        key, value = line.split(":", 1)
        current[key.strip().lower()] = value.strip()
if current_status == "200":
    last_block = current

source = Path(source_path)
last_modified_raw = last_block.get("last-modified")
last_modified_utc = None
if last_modified_raw:
    try:
        dt = parsedate_to_datetime(last_modified_raw)
        if dt.tzinfo is not None:
            last_modified_utc = dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        pass

digest = hashlib.sha256()
with source.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)

world = json.loads(Path(world_manifest_path).read_text(encoding="utf-8"))
records = list(world.get("remote_sources", []))
records.append({
    "source_role": "country-metadata",
    "filename": source.name,
    "source_url": url,
    "retrieved_at_utc": retrieved_at,
    "http_status": int(status),
    "http_last_modified_header": last_modified_raw,
    "http_last_modified_utc": last_modified_utc,
    "etag": last_block.get("etag"),
    "sha256": digest.hexdigest(),
    "size_bytes": source.stat().st_size,
})
Path(output_path).write_text(
    json.dumps({"manifest_version": 1, "remote_sources": records}, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps({key: records[-1][key] for key in [
    "source_role", "source_url", "retrieved_at_utc", "http_status",
    "http_last_modified_utc", "etag", "sha256", "size_bytes"
]}))
PY

python scripts/geonames-country-catalog-audit.py \
  --all-countries-zip "$work/allCountries.zip" \
  --country-info "$source" \
  --output "$audit/geonames-country-catalog-aggregate.json" \
  | tee "$audit/geonames-country-catalog-summary.stdout.json"

python - "$audit/geonames-country-catalog-aggregate.json" "$audit/country-master-source-manifest.json" "$audit/geonames-destination-source-coverage.json" >> "$GITHUB_STEP_SUMMARY" <<'PY'
import csv
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
manifest = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
coverage = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
c = report["counts"]
if report.get("status") not in {
    "PASS_GEO_NAMES_COUNTRY_IDENTITY_AUDIT",
    "PASS_GEO_NAMES_COUNTRY_IDENTITY_WITH_REVIEW_ITEMS",
}:
    raise SystemExit("GeoNames country master audit blocked; inspect aggregate report.")
if c["country_info_malformed_rows"] != 0 or c["country_info_ids_without_recognized_country_feature"] != 0:
    raise SystemExit("Country metadata shape/identity join failed.")
if c["country_info_duplicate_geoname_id_groups"] != 0 or c["country_info_duplicate_alpha2_groups"] != 0 or c["country_info_duplicate_alpha3_groups"] != 0 or c["country_info_duplicate_numeric3_groups"] != 0:
    raise SystemExit("Country metadata contains duplicate identities or code groups.")
if c["all_countries_malformed_rows"] != 0 or c["recognized_country_entity_duplicate_geoname_id_groups"] != 0:
    raise SystemExit("Worldwide source schema/identity checks failed.")
if report["interpretation"]["iso3166_authority_comparison"] != "NOT_PERFORMED" or report["interpretation"]["admin_parent_links_created"] != 0:
    raise SystemExit("Audit report violated the ISO or no-parent-write boundary.")
remote = manifest.get("remote_sources", [])
if not any(x.get("source_role") == "country-metadata" and x.get("http_status") == 200 for x in remote):
    raise SystemExit("Country metadata retrieval provenance is missing.")
print("## GeoNames country-master identity audit")
print(f"- Status: {report['status']}")
print(f"- Country metadata rows: {c['country_info_rows']}; malformed: {c['country_info_malformed_rows']}")
print(f"- Worldwide rows scanned: {c['all_countries_rows_scanned']}; malformed: {c['all_countries_malformed_rows']}")
print(f"- Country IDs joined to recognized country-related features: {c['country_info_ids_matching_any_recognized_country_feature']} / {c['country_info_rows']}")
print(f"- Historical/numeric-format review items: {c['country_info_ids_matching_historical_political_feature']} historical matches; {c['country_info_invalid_numeric3_rows']} numeric-format anomaly(s)")
print(f"- Additional current/territory feature rows outside country metadata (scope review only): {c['current_or_territory_feature_ids_without_country_info']}")
print("- ISO alpha-code cross-check: see separate UN M49 crosswalk audit; direct ISO package not captured.")
print("- No parent links, database writes or selectable destinations were created.")
print("## GeoNames destination source coverage (candidates, not product-complete destinations)")
rows = coverage.get("country_coverage_rows", [])
if not rows:
    raise SystemExit("Destination coverage report has no country-code rows.")
if sum(int(row.get("source_rows", 0)) for row in rows) != c["all_countries_rows_scanned"]:
    raise SystemExit("Per-country destination source totals do not reconcile to the worldwide row count.")
if sum(int(row.get("current_place_candidate_rows", 0)) for row in rows) != coverage.get("current_place_candidate_rows"):
    raise SystemExit("Per-country current place candidate totals do not reconcile.")
if coverage.get("selectable_destinations_approved") is not False or coverage.get("worldwide_destination_completeness") != "NOT_ESTABLISHED_BY_SOURCE_COUNTS_ALONE":
    raise SystemExit("Destination audit improperly claims approval or completeness.")
print(f"- Source country-code buckets (including blank): {coverage['source_country_code_buckets_including_blank']}")
print(f"- Buckets with current place candidates: {coverage['source_country_code_buckets_with_current_place_candidates']}")
print(f"- GeoNames current place candidate rows: {coverage['current_place_candidate_rows']}")
print(f"- Populated feature rows (class P): {coverage['populated_feature_class_rows']}")
print(f"- Historical/non-current place rows held out: {coverage['historical_or_noncurrent_place_rows']}")
for level in range(1, 6):
    print(f"- ADM{level} rows: {coverage[f'current_admin{level}_rows']}")
print(f"- Country metadata alpha-2 codes with no source place candidates: {coverage['country_info_alpha2_codes_without_current_place_candidates']}")
print("- This is a GeoNames source-distribution report, not proof of official hierarchy, selectability, or worldwide destination completeness.")
PY
