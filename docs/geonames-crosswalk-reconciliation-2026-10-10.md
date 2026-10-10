# GeoNames crosswalk exception reconciliation — 2026-10-10

**Disposition: ROW-LEVEL EXPORTS GENERATED; HIERARCHY AND CATALOG ACCEPTANCE REMAIN BLOCKED.**

## Aggregate counts

| Measure | Count |
|---|---:|
| Sample rows | 25,685 |
| Full admin1 crosswalk keys | 3,865 |
| Full admin2 crosswalk keys | 47,642 |
| Admin1 unmatched references / unique records | 2,333 / 2,333 |
| Admin2 unmatched references / unique records | 240 / 240 |
| Records in both categories | 157 |
| Unique records in either category | 2,416 |

The two exception counts are not additive distinct-record counts. There are 157 overlapping records and 2,416 unique affected records in the union.

| Country | Admin1 unmatched | Admin2 unmatched |
|---|---:|---:|
| KE | 26 | 5 |
| GB | 3 | 29 |
| JP | 2,161 | 206 |
| BR | 1 | 0 |
| SG | 142 | 0 |

## Singapore overlap

The previous 24 Singapore admin1_crosswalk_not_found IDs overlap exactly with 24 of the broader 142 Singapore admin1 misses. Prior-only: 0. Broader-only: 118, all raw code 00. The overlap records have raw codes 01–05 (01:4, 02:7, 03:7, 04:3, 05:3). All 142 remain unresolved. Exact overlap IDs are in this report's JSON.

## Row-level exports

- docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin1_references.csv
- docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin1_references.json
- docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin2_references.csv
- docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/unmatched_admin2_references.json

Each export contains GeoNames ID, name, country code, feature code, raw admin1/admin2 codes, missing-reference category, proposed review classification, crosswalk lookup key and raw missing code. Records are deterministically sorted. No parent ID is proposed or synthesized.

Raw 00 remains an unresolved placeholder/nonstandard candidate. Unmatched nonzero codes are missing-reference or possible version-dependent cases; they are not asserted legacy. Preserve raw codes, do not automatically reject records, and keep same-name records distinct by ID.

## Preserved five-country evidence

| Archive | Bytes | SHA-256 | ZIP CRC | Source rows | Exact sample matches |
|---|---:|---|---|---:|---:|
| KE.zip | 859,668 | d7335182356ab6609f93c1f66527195acd75bf72a841915b337858d65a172f43 | PASS | 31,490 | 2,631 |
| GB.zip | 3,639,180 | eefc08df408aa4c3218151b5d9ca73768555fafac676a2ce5d612e2007c1f32a | PASS | 109,181 | 12,096 |
| JP.zip | 4,959,247 | f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58 | PASS | 103,762 | 4,899 |
| BR.zip | 7,177,385 | 4a9ddffb465ccad219127146f0678087cfece414ca0240bee53a5ea6750eebd8 | PASS | 235,530 | 5,888 |
| SG.zip | 69,019 | 7e18942c0241144089da0b9bea659c96fadc201573be9d25a02442eb7b7f09d8 | PASS | 1,979 | 171 |
| Total | — | — | PASS 5/5 | 481,942 | 25,685 |

All 25,685 sample rows matched by ID and all 19 original fields. Historical isolated-builder DNS failures are separate from the later successful owner-computer comparison. JP (1).zip is byte-identical to JP.zip; JP.zip was the comparison input.

local_file_mtime_utc is filesystem path.stat().st_mtime metadata. http_last_modified_utc remains null because no actual HTTP response header was captured. Worldwide scan reproduction, current owner-approved ISO comparison and global completeness remain UNVERIFIED. Catalog acceptance and Phase 4C remain BLOCKED.
