# Japan positive-candidate spatial review — 2026-10-11

**Result: source retrieval, target coverage and validation PASS. The review remains candidate-only; no parent links were approved.**

## Latest verification

- [Phase 0 CI #427](https://github.com/job-grid/job-grid/actions/runs/38118581041) passed on the current code head.
- Application tests: **98 passed, 0 failed**. All nine Phase 0 jobs passed, including database migration validation, repository integrity, dependency scanning, secret scanning, global source audit, Kenya legacy-key audit and the two Japan hierarchy-evidence audits.
- Separate Phase 4C tooling validation [#397](https://github.com/job-grid/job-grid/actions/runs/38118581047) and backup-executor validation [#410](https://github.com/job-grid/job-grid/actions/runs/38118581077) passed. The separate backup/recovery readiness gate remains blocked.
- The full row-level Japan audit artifact is [available here](https://github.com/job-grid/job-grid/actions/runs/38118581041/artifacts/11693823197) until **2026-10-18 06:40:50 UTC**. It includes the 33-row target-summary CSV, 116 containment observations, 46 target/code results, official source manifest, query-response snapshots and the 122 downloaded boundary archives with their per-archive hashes.

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
