# Japan positive-candidate spatial review — 2026-10-11

**Result: source retrieval, target coverage and validation PASS. The review remains candidate-only; no parent links were approved.**

## Latest verification

- [Phase 0 CI #431](https://github.com/job-grid/job-grid/actions/runs/38120664025) passed on code head `12239f2a34cd2052458ceade57d79e2788ccf70a`: **98 tests passed, 0 failed**. All nine Phase 0 jobs passed.
- The run printed the e-Stat historical periods for all 14 spatially supported associations, using only the current retrieved source-verified target/code records. The log enables a period-by-period comparison of exact English/Japanese labels, effective dates, parent references and predecessor/successor URIs.
- Separate Phase 4C tooling validation [#401](https://github.com/job-grid/job-grid/actions/runs/38120664006) and backup-executor validation [#414](https://github.com/job-grid/job-grid/actions/runs/38120664002) passed. The separate backup/recovery readiness gate remains blocked.
- The full row-level Japan audit artifact is [available here](https://github.com/job-grid/job-grid/actions/runs/38120664025/artifacts/11695675663) until **2026-10-18 07:17:18 UTC**. It includes the 33-row target summary, 116 containment observations, 46 candidate-code results, source manifest, query-response snapshots and 122 downloaded boundary archives with per-archive hashes.

## Scope and source fingerprints

The audit selected all positive exact-English-label candidate targets from the already source-verified Japan ADM4 raw-admin1-00 set. Selection is derived from the official e-Stat candidate report, not from a manually entered ID list. Candidate discovery uses exact normalized English-label equality only.

- Positive-candidate target records selected: **33**
- Distinct e-Stat area-code candidates: **35**
- Target-to-candidate-code associations reviewed: **46**
- Historical/current MLIT boundary archives retrieved and CRC-checked: **122**
- Archive set: the 1965, 1970 and 1975 snapshots for the 25 prefecture prefixes represented by the candidate codes, plus the nationwide 1995 snapshot covering all 47 prefectures.
- Targets with at least one official containing-polygon observation: **32 of 33**
- Targets without a containing-polygon observation in the selected snapshots: **1**
- Target-to-code candidate associations where the target point was inside the named candidate code's polygon in at least one selected snapshot: **14 of 46**
- Operational parent links created: **0**

Source identities and fingerprints:
- Official GeoNames Japan archive, retrieved over HTTPS on 2026-10-11 at 06:36:04 UTC; HTTP 200; ZIP CRC validation passed. Archive SHA-256: b4294cb8e0a1abce0314f13d96af6310574393e5b8914e2337dfc2bb7a454ebd.
- Official e-Stat Standard Area Code catalogue: 14,741 code-history rows over four paginated responses, with 156 historical period detail rows retrieved in four batches. Combined e-Stat snapshot SHA-256: ca52a59ef64294e9af01c303ebad7f4408ac0156031c885538e4aeb6f4c17f33.
- The exact MLIT boundary download URLs, archive SHA-256 values and sizes are preserved in the artifact manifest. The raw GeoNames and MLIT archives were not committed to repository history.

## Fourteen positive spatial associations — priority for identity and period review

The completed [Phase 0 CI #429 run](https://github.com/job-grid/job-grid/actions/runs/38120352368) printed the following **14 target-to-code associations** with point-in-polygon containment in the selected official boundary snapshots. Each target has one distinct e-Stat area-code candidate in the current exact-label report. That reduces namesake ambiguity but does not prove the GeoNames ID represents that administrative entity or that an immediate parent path is acceptable.

The parent-area code shown here is the e-Stat candidate-history reference retained in the exact-label candidate evidence, **not an approved operational parent edge**.

| GeoNames ID | GeoNames name | Candidate area code | Containment snapshots | Exact-name periods / history periods | Historical parent-area code reference |
|---|---|---|---|---:|---|
| `1850471` | Tawaramoto-chō | `29363` | 1965, 1970, 1975, 1995 | 1 / 1 | `29360` |
| `1850496` | Tatsuno-machi | `20382` | 1965, 1970, 1975, 1995 | 1 / 1 | `20380` |
| `1851931` | Shirahama-machi | `12465` | 1965, 1970, 1975, 1995 | 2 / 2 | `12460` |
| `1853828` | Ōsawano-machi | `16301` | 1965, 1970, 1975, 1995 | 5 / 5 | `16300` |
| `1854370` | Okegawa-machi | `11302` | 1965, 1970 | 2 / 2 | `11300` |
| `1854628` | Ogōri-machi | `40502` | 1965, 1970 | 3 / 3 | `40500` |
| `1854978` | Nonoichi-machi | `17344` | 1965, 1970, 1975, 1995 | 9 / 9 | `17340` |
| `1857469` | Matsutō-machi | `17341` | 1965, 1970 | 3 / 3 | `17340` |
| `1858533` | Kubokawa-chō | `39404` | 1965, 1970, 1975, 1995 | 2 / 2 | `39400` |
| `1860320` | Kamojima-chō | `36441` | 1965, 1970, 1975, 1995 | 2 / 2 | `36440` |
| `1864261` | Echigawa-chō | `25424` | 1965, 1970, 1975, 1995 | 8 / 8 | `25420` |
| `1865498` | Akasaki-chō | `31369` | 1965, 1970, 1975, 1995 | 2 / 2 | `31360` |
| `2112526` | Iwanuma-machi | `04381` | 1965, 1970 | 2 / 2 | `04380` |
| `2113163` | Abiko-machi | `12304` | 1965 | 2 / 2 | `12300` |

All 14 official e-Stat period histories report administrative class `Town` and their Japanese labels are consistent with the English candidate labels shown above. The code rows `04381`, `11302`, `12304`, `17341` and `40502` also appear in MLIT's 1965/1970 source lists, documented in the separate [administrative-code evidence report](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-mlit-candidate-code-evidence-2026-10-11.md).

### Exact-name e-Stat period overlap with spatial observations

CI #431 matched each of the 14 spatial association rows to the same source-verified GeoNames target and the same e-Stat area-code candidate, then returned every period record for that code. The cross-check below treats a spatial snapshot as temporally supported only if its date falls inside a period whose English label exactly matches the target name. The dates are source dates; a blank end date is kept as blank rather than invented.

| GeoNames ID | Code | Official Japanese label | Exact-name period coverage in e-Stat | Spatial snapshots that overlap an exact-name period | Assessment |
|---|---|---|---|---|---|
| `1850471` | `29363` | 田原本町 | From 1970-04-01; end date blank | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1850496` | `20382` | 辰野町 | From 1970-04-01; end date blank | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1851931` | `12465` | 白浜町 | 1970-04-01 to 2006-03-20 (2 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1853828` | `16301` | 大沢野町 | 1970-04-01 to 2005-04-01 (5 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1854370` | `11302` | 桶川町 | 1970-04-01 to 1970-11-03 (2 period records) | 1970 | Spatial + period-supported candidate |
| `1854628` | `40502` | 小郡町 | 1970-04-01 to 1972-04-01 (3 period records) | 1970 | Spatial + period-supported candidate |
| `1854978` | `17344` | 野々市町 | 1970-04-01 to 2011-11-11 (9 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1857469` | `17341` | 松任町 | 1970-04-01 to 1970-10-10 (3 period records) | 1970-10-01 snapshot | Spatial + period-supported candidate |
| `1858533` | `39404` | 窪川町 | 1970-04-01 to 2006-03-20 (2 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1860320` | `36441` | 鴨島町 | 1970-04-01 to 2004-10-01 (2 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1864261` | `25424` | 愛知川町 | 1970-04-01 to 2006-02-13 (8 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `1865498` | `31369` | 赤碕町 | 1970-04-01 to 2004-09-01 (2 period records) | 1970, 1975, 1995 | Spatial + period-supported candidate |
| `2112526` | `04381` | 岩沼町 | 1970-04-01 to 1971-11-01 (2 period records) | 1970 | Spatial + period-supported candidate |
| `2113163` | `12304` | 我孫子町 | 1970-04-01 to 1970-07-01 (2 period records) | None in an e-Stat-covered period; spatial hit is 1965 only | Historical-only spatial candidate; e-Stat-period overlap unresolved |

**Result:** **13 of 14** spatial associations have at least one selected snapshot within an e-Stat exact-name period. The remaining association is GeoNames ID `2113163` (Abiko-machi): its boundary point hit is from 1965, while the captured e-Stat history for code `12304` begins on 1970-04-01 and ends 1970-07-01. This is a source-coverage boundary, not proof against the candidate; MLIT's 1965 code list independently records `千葉県東葛飾郡我孫子町` for code `12304`. The 1965 hits for the other 13 rows are likewise pre-e-Stat-history observations and are not counted as e-Stat period overlaps; their later snapshot overlaps are what support their period check.

These are strong, source-backed **review candidates**, not accepted GeoNames entity crosswalks. Spatial containment plus matching English/Japanese administrative labels and a matching effective period reduces ambiguity, but does not independently prove that each GeoNames ID denotes that exact administrative unit or that the historical parent reference is the correct immediate GeoNames parent.

**Next disposition:** retain 13 as `SPATIALLY_AND_TEMPORALLY_SUPPORTED_CANDIDATE_REQUIRES_OWNER_CROSSWALK_APPROVAL`; retain Abiko ID `2113163` as `HISTORICAL_SPATIAL_SUPPORT_PRE_ESTAT_PERIOD_REQUIRES_ENTITY_REVIEW`. Do not write parent links without explicit owner approval of the entity crosswalk and complete path.

## Spatial result and disposition

Fourteen target-to-code associations have positive point-in-polygon evidence in at least one of the captured official boundary snapshots. This makes those associations useful for further identity and period review; it does **not** establish that an e-Stat code is the matching GeoNames entity or that its parent is the correct immediate parent for the GeoNames feature.

Thirty-two targets received polygon context. GeoNames ID 1864225, Ei-chō, received no containing-polygon observation in the selected snapshots. This is recorded explicitly as unresolved in the generated target-summary CSV and JSON rather than omitted or treated as proof that the record is invalid.

The broad review also reran the six earlier collision targets; the six-case findings and limitations are retained in the [focused point-in-polygon report](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-mlit-point-in-polygon-audit-2026-10-11.md). The new full-positive candidate run supplements that report; it does not overwrite or weaken the earlier review.

## Interpretation

1. A point-in-polygon hit is geographic evidence only. Entity identity, administrative level, historical validity and the complete immediate-parent path still require a source-backed crosswalk.
2. No spatial hit does not automatically invalidate a GeoNames record. The point could represent a feature reference point; selected archive dates and area definitions are not an exhaustive history of every possible entity.
3. Missing polygon context remains an unresolved state; the audit does not infer a polygon, parent or substitute code.
4. All raw admin1 values of 00 remain unchanged, and all 33 target/code candidate outcomes remain non-operational evidence only.

## Acceptance status

- All 126 Japanese target IDs still pass source identity/raw-code checks against the official GeoNames Japan archive.
- All 126 Japanese immediate-parent paths remain unresolved.
- The two Kenyan immediate-parent paths (GeoNames IDs 192705 and 7800132) remain unresolved.
- The official ISO 3166-1 machine-readable comparison remains blocked.
- The original 25,685-row sample-selection algorithm remains unreproduced.
- Worldwide product/geographic completeness remains unverified.

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production, deployment or live-state change was made. No parent link was created.
