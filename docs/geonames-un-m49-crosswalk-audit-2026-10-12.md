# GeoNames country codes vs official UN M49 alpha-code table — 2026-10-12

**Audit disposition: PASS WITH 4 SOURCE-CODE REVIEW ITEMS.** The automated public UN M49 alpha-code cross-check passed its structural and unit tests. This does not close every country-catalog acceptance gate and no code was changed automatically.

## Measured result

Phase 0 CI run [#38186018959](https://github.com/job-grid/job-grid/actions/runs/38186018959), job **Phase 0 CI / Country-area code crosswalk audit**, completed successfully and uploaded [row-level evidence and the source manifest](https://github.com/job-grid/job-grid/actions/runs/38186018959/artifacts/11719920819).

| Measure | Result |
|---|---:|
| GeoNames countryInfo rows parsed | 252 |
| Coded country/area rows in the UN M49 table | 248 |
| Exact alpha-2 + alpha-3 pairs matched, GeoNames → UN M49 | 248 |
| Exact alpha-2 + alpha-3 pairs matched, UN M49 → GeoNames | 248 |
| GeoNames pairs not present in UN M49 | 4 |
| Alpha-2 matches with conflicting alpha-3 | 0 |
| Alpha-3 matches with conflicting alpha-2 | 0 |
| UN M49 pairs missing from GeoNames or conflicting | 0 |
| Duplicate GeoNames or UN alpha-code groups | 0 |
| GeoNames numeric-3 values equal to M49 numerical codes on exact-pair rows (diagnostic only) | 248 |
| Rows requiring manual review | 4 |

The four GeoNames-only pairs are preserved as review cases in the artifact. They are **not** treated as invalid records, assigned replacement codes, or marked selectable. The row-level artifact is retained temporarily by GitHub Actions.

## Captured source provenance

| Source | Retrieval time (UTC) | HTTP | Bytes | SHA-256 |
|---|---|---:|---:|---|
| [GeoNames countryInfo.txt](https://download.geonames.org/export/dump/countryInfo.txt) | 2026-10-11T23:53:58Z | 200 | 31,680 | `c5997ea659df5bcf42509eb937064d172b2a998bb873608603e8421d714a9974` |
| [UNSD M49 overview](https://unstats.un.org/unsd/methodology/m49/overview/) | 2026-10-11T23:53:59Z | 200 | 1,721,575 | `b9048114f6e7f2abda83bf03d4263c9d7cd1bd7230e3d0461025ee7839a7a1fb` |

GeoNames retrieval metadata included Last-Modified `Sun, 11 Oct 2026 03:06:52 GMT` and ETag `"7bc0-65d87df9028a7"`. The UN response did not expose Last-Modified or ETag in this retrieval. CI verified the downloaded sizes and SHA-256 values against the same-run source manifest.

## Correct interpretation

The join uses only exact pairs of ISO-assigned alpha-2 and alpha-3 codes displayed by the official UN table. Names are not identity keys. UN M49 numeric values are statistical identifiers maintained by UNSD, so equality with GeoNames numeric values is diagnostic only, not proof of ISO numeric-3 conformity.

This is a reproducible public cross-check and avoids requiring the paid ISO Country Codes Collection for this pass. It is **not** a downloaded ISO collection or direct ISO-published machine-readable snapshot. The direct ISO-package provenance gate therefore remains open; exceptional or conflicting rows still need reviewed disposition.

## Remaining country and destination work

This code comparison does not establish complete destination coverage or resolve the place hierarchy. The four out-of-table code pairs require individual review from the artifact; entity classification/selectability policy, remaining crosswalk and association cases, country-specific administrative parent paths, localized names, destination feature coverage and source-update policy remain open. Kiambururu remains unresolved by GeoNames identity and must not be force-matched to the similarly named Githunguri Location.

No source codes were rewritten. No database schema, migration, seed, import, production write or deployment was performed. The wider PR #27 Phase 0 run was still in progress when this job completed; see the run page for overall CI status.
