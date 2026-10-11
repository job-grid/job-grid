# Japan spatial-first 1995 area-code and e-Stat period-history audit — 2026-10-11

**Result: PASS for source retrieval, spatial context, e-Stat period-history reconciliation and report integrity. Candidate evidence only; no GeoNames parent link was approved or written.**

## Verification

- [Phase 0 CI #455](https://github.com/job-grid/job-grid/actions/runs/38130133489) completed successfully on code head `4165ebc51a818a648f1d17aa29794d8efa5c7ce1`.
- Application validation: **105 tests passed, 0 failed**. All nine Phase 0 jobs passed, including the expanded 33-target spatial audit, all-126 Japan spatial-first scan, e-Stat history/parent detail audit, Kenya audit, global source audit, database migration validation, secret scanning, dependency scanning and repository integrity.
- Separate Phase 4C tooling validation [#425](https://github.com/job-grid/job-grid/actions/runs/38130133499) and backup-executor validation [#438](https://github.com/job-grid/job-grid/actions/runs/38130133514) passed. The independent Phase 4C backup/recovery readiness gate remains blocked.
- The complete [CI #455 row-level artifact](https://github.com/job-grid/job-grid/actions/runs/38130133489/artifacts/11698329785) is available until **2026-10-18 10:05:54 UTC**. It contains the spatial-first JSON/CSV, all 126 target summaries, target-to-code associations, 105 area-code histories, parent references, detailed e-Stat response snapshots, manifests and MLIT/GeoNames source fingerprints.

## Scope and pinned sources

The audit used the pinned official GeoNames Japan `JP.zip`, the official e-Stat Standard Area Code List/SPARQL catalogue and the official MLIT N03 administrative-boundary dataset.

- The GeoNames `JP.zip` source was retrieved over HTTPS, HTTP 200, ZIP CRC passed; archive SHA-256 `b4294cb8e0a1abce0314f13d96af6310574393e5b8914e2337dfc2bb7a454ebd`.
- The captured official e-Stat catalog comprised **14,741 code-history rows across four pages**. The combined source-response snapshot SHA-256 for this run is `0758e654c4b19e9a669847ef2e9a409b7d3a543552c9aa4c407fecc1b77b0d6b`.
- The spatial-first run retrieved and CRC-checked **47 MLIT N03 archives** for the nationwide 1995-10-01 snapshot. Per-archive download URLs, sizes, SHA-256 values and source metadata are retained in the artifact manifest.
- Every target was checked against the GeoNames Japan archive identity/raw-code source; raw `admin1=00` values were retained unchanged.

## Spatial-first coverage

| Measure | Result |
|---|---:|
| Source-verified Japan target records reviewed | 126 |
| Targets with a containing MLIT municipality polygon in the 1995 snapshot | 120 |
| Targets without containing-polygon context in that snapshot | 6 |
| Nationwide 1995 MLIT archives retrieved and CRC-checked | 47 |
| Distinct containing area codes derived from spatial evidence | 105 |
| Those codes found in the official e-Stat code-history catalog | 105 / 105 |
| Target-to-location-code associations | 120 |
| Location-derived codes with at least one e-Stat period covering 1995-10-01 | 105 / 105 |
| Location-derived codes with an official parent reference containing an area code for that period | 105 / 105 |
| Spatially observed target codes matching a previous exact-English-name candidate | 9 / 126 |
| Operational parent links created | **0** |

The six GeoNames IDs without containing-polygon context in the selected 1995 snapshot are:

`1855578`, `1857181`, `1861055`, `1864225`, `2128976`, and `2129599`.

These records remain unresolved. No missing polygon was synthesized, and the absence of a containing polygon in one selected snapshot is not evidence that the GeoNames record is invalid.

## Historical-period reconciliation

The spatially observed 105 area codes produced **557 requested catalog period URIs**, all **557 were reconciled**, and the official endpoint returned **593 detail rows** across **12 SHA-256-fingerprinted query batches**. Published period start/end values and parent references are kept by exact period URI, not collapsed to a single current name.

For each code, the output retains historical English/Japanese labels, administrative class, periods covering the 1995 snapshot, parent area codes and labels across history, and previous/succeeding period references. The report validator checked that:
- the 126 target IDs and 120 spatial target/code associations reconcile;
- all 105 area-code candidates exist in the pinned official e-Stat catalog;
- requested catalog period URIs equal reconciled period rows;
- the CSV period-history row count matches the reconciled report;
- all source batches have SHA-256 fingerprints; and
- every output preserves `operational_parent_link_created=false`.

## Interpretation

This adds official hierarchy evidence to spatially derived location-code candidates. It does **not** identify a GeoNames parent ID. A polygon containing the point can support location review; an e-Stat parent reference is the official ancestor for the stated e-Stat period. Neither fact independently proves that the GeoNames feature is the e-Stat administrative entity or identifies the right GeoNames parent feature.

Nine spatial-first target codes overlap a prior exact-English-name candidate. That agreement supports prioritizing those records for review, but it does not supersede source-backed entity-level crosswalking. The spatial-first codes for targets without English-name matches remain candidate-only as well. The distinct prior review of the 14 spatially supported single-code name candidates is documented in the [prioritization queue](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-spatially-supported-single-code-candidates-2026-10-11.md).

## Acceptance disposition

- All 126 Japan immediate-parent paths remain unresolved; raw `admin1=00` remains unchanged.
- Both Kenya immediate-parent paths (GeoNames IDs `192705` and `7800132`) remain unresolved.
- The 105 official e-Stat parent-reference records are evidence for identity review only; no GeoNames parent ID or operational edge was selected.
- ISO 3166-1 current-source comparison remains blocked.
- Independent reproduction of the original 25,685-row sample-selection algorithm remains unverified.
- Worldwide geographic/product completeness and independent Phase 4C backup/recovery readiness remain unverified/blocked.

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production, deployment or live-state changes were made.
