# Global GeoNames source audit of unresolved crosswalk exceptions — 2026-10-11

**Result: PASS for full current-source scan and source identity/raw-code reconciliation. Catalog acceptance remains BLOCKED.**

**Latest verified run:** [Phase 0 CI #357](https://github.com/job-grid/job-grid/actions/runs/38099570891)  
**Latest detailed artifact:** [Row-level CSV, JSON summary and source manifest](https://github.com/job-grid/job-grid/actions/runs/38099570891/artifacts/11687251080) (retention follows GitHub Actions artifact policy)  
**Machine-readable aggregate:** [Global audit summary JSON](geonames-global-exception-source-audit-2026-10-11.json)

## What was checked

CI fetched the official worldwide GeoNames `allCountries.zip`, captured HTTP retrieval metadata, tested ZIP integrity, extracted `allCountries.txt`, and scanned all rows. It then compared each unique ID in the committed row-level unresolved crosswalk-exception export against the global source, checking exact GeoNames ID, name, country code, feature code, raw admin1 code and raw admin2 code.

| Validation | Result |
|---|---:|
| HTTP status / ZIP CRC | 200 / PASS |
| Full source row count | 13,472,324 |
| Malformed or wrong-shape rows | 0 |
| Unique crosswalk exception IDs | 2,416 |
| Exact source identity and raw admin-code matches | 2,416 |
| Missing or duplicate target source IDs | 0 |
| Identity or raw-code drift | 0 |
| Parent IDs or links assigned | 0 |

Per-country unique exception IDs all matched: Brazil 1; Great Britain 32; Japan 2,215; Kenya 26; Singapore 142.

## GeoNames country-code and feature-class footprint — follow-up run

The audit utility now computes aggregate coverage metrics while streaming the same official source. The verified Phase 0 CI #357 run retrieved the archive at `2026-10-11T00:47:56Z`; the archive and extracted-text hashes match the source fingerprints reported above.

| Aggregate source measure | Result |
|---|---:|
| Rows with 19 tab-separated fields and a non-empty ID | 13,472,324 |
| Malformed or wrong-shape rows | 0 |
| Distinct raw country-code buckets, including the blank bucket | 254 |
| Distinct nonblank raw country-code buckets | 253 |
| Rows with a blank country-code field | 7,112 |
| Nonblank country-code fields with a format other than two uppercase ASCII letters | 0 |

The raw country-code buckets describe values in GeoNames. They are **not** an ISO 3166-1 current country list: a two-letter uppercase format does not show that a code is currently assigned by ISO, and some source identifiers can be reserved, temporary, or source-specific.

The 19-field source scan's feature-class counts are:

| Raw feature class | Rows |
|---|---:|
| Blank | 5,002 |
| A | 543,994 |
| H | 2,611,651 |
| L | 495,399 |
| P | 5,231,964 |
| R | 58,269 |
| S | 2,547,222 |
| T | 1,839,114 |
| U | 15,720 |
| V | 123,989 |
| **Total** | **13,472,324** |

These counts characterize only the contents of this GeoNames snapshot. They do not certify all real-world places are represented, that every raw code is current/official, or that Job Grid's product has worldwide geographic coverage.

## Source fingerprint

- URL: `https://download.geonames.org/export/dump/allCountries.zip`
- Actual retrieval time in the latest verified run: `2026-10-11T00:47:56Z`
- HTTP status: 200
- HTTP Last-Modified: `Sat, 10 Oct 2026 01:58:39 GMT` (`2026-10-10T01:58:39Z`)
- ETag: `"19275ced-65d72cdb3f7da"`
- Archive size: 422,010,093 bytes
- Archive SHA-256: `3b6ba297e83d5cd6717a41cfe72b6cd85d167b0d0ff06069b2c33d410d6abe15`
- Extracted `allCountries.txt`: 1,788,663,996 bytes; SHA-256 `e563a236d3fcbfb24414534b4fcc8feff4c4230fced91dbaf8d28a9be8242532`; 13,472,324 lines.
- Exception export SHA-256: `671dd8a432e7f1dc8e20a25413e5dac87882a08fa73583d05de2af019664ca25`.

The workflow artifact contains the full 2,416-row source-comparison CSV, JSON summary and retrieval manifest. The large source archive and extracted file were not committed or uploaded as artifacts.

## Interpretation and remaining gates

This run independently reproduces the previously reported 13,472,324-line full source scan count and confirms the current identity/raw-code fields for every affected exception ID. It does **not** reproduce the selection algorithm for the separate 25,685-row sample, prove worldwide geographic coverage is complete, restore absent crosswalk keys, or approve parentage.

The parent-path check was independently run against the official Japan/Kenya country archives and the official hierarchy archive: **126 Japan ADM4 records still contain raw admin1 `00`, and two Kenyan ADM3 records still lack a matching ADM1 composite key and direct `ADM` hierarchy edge**. Current ISO authority comparison and product/worldwide completeness remain unverified.

CI at tested code commit `3043d2e14747c0637b9533cf8005067f033d9667`: Phase 0 passed with 83 tests / 0 failures; Phase 4C tooling validation and backup-executor validation passed. No raw codes were normalized, no parent links were written, and no schema, migration, seed, import, live database, production or deployment changes occurred.
