# Japan spatially supported single-code candidates — 2026-10-11

**Disposition: prioritized for exact entity/period review only. No candidate crosswalk or parent link was approved.**

## Verification basis

- The source-pinned expanded audit is in [Phase 0 CI #427](https://github.com/job-grid/job-grid/actions/runs/38118581041); all nine Phase 0 jobs passed, with 98 tests passing and zero failures.
- Official inputs: the GeoNames Japan archive, the e-Stat Standard Area Code history/candidate responses, and 122 CRC-checked official MLIT N03 boundary archives. The full raw row-level output and 122 archive hashes are in [the CI artifact](https://github.com/job-grid/job-grid/actions/runs/38118581041/artifacts/11693823197), available until 2026-10-18.
- Candidate rule: exact normalized English-label equality to discover e-Stat area-code candidates; independent point-in-polygon test against the official MLIT boundary geometry for the selected snapshots. Each listed candidate has a single distinct e-Stat area-code candidate for that GeoNames target.
- This is spatial corroboration, not an entity-ID crosswalk. It does not approve a parent edge or prove that the GeoNames feature and e-Stat administrative entity are identical.

## Results

| Measure | Result |
|---|---:|
| Positive-label candidate targets reviewed | 33 |
| Single-code candidate targets in source list | 29 |
| Candidate associations with point inside candidate polygon | 14 |
| Supported in four selected snapshots | 9 |
| Supported in two selected snapshots | 4 |
| Supported in one selected snapshot | 1 |
| Candidate associations without candidate-polygon containment | 31 |
| Target lacking any containing-polygon context in selected snapshots | 1 (GeoNames ID 1864225) |
| Operational parent links written | **0** |

## Prioritized positive spatial-evidence queue

Each entry below has an exact e-Stat English-label candidate, an official Japanese label and parent reference in the captured e-Stat history, and MLIT point-in-polygon hits on the listed snapshots. The “snapshot hits” column counts selected boundary dates only; it is not a statement that an administrative definition existed unchanged throughout every intervening year.

| GeoNames ID | GeoNames label | e-Stat area code | Official Japanese candidate label | e-Stat parent code / label | MLIT point-in-polygon snapshots | Evidence tier |
|---:|---|---:|---|---|---|---|
| 1850471 | Tawaramoto-chō | 29363 | 田原本町 | 29360 / Shiki-gun (磯城郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1850496 | Tatsuno-machi | 20382 | 辰野町 | 20380 / Kamiina-gun (上伊那郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1851931 | Shirahama-machi | 12465 | 白浜町 | 12460 / Awa-gun (安房郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1853828 | Ōsawano-machi | 16301 | 大沢野町 | 16300 / Kaminiikawa-gun (上新川郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1854370 | Okegawa-machi | 11302 | 桶川町 | 11300 / Kitaadachi-gun (北足立郡) | 1965, 1970 | Two snapshots |
| 1854628 | Ogōri-machi | 40502 | 小郡町 | 40500 / Mii-gun (三井郡) | 1965, 1970 | Two snapshots |
| 1854978 | Nonoichi-machi | 17344 | 野々市町 | 17340 / Ishikawa-gun (石川郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1857469 | Matsutō-machi | 17341 | 松任町 | 17340 / Ishikawa-gun (石川郡) | 1965, 1970 | Two snapshots |
| 1858533 | Kubokawa-chō | 39404 | 窪川町 | 39400 / Takaoka-gun (高岡郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1860320 | Kamojima-chō | 36441 | 鴨島町 | 36440 / Oe-gun (麻植郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1864261 | Echigawa-chō | 25424 | 愛知川町 | 25420 / Echi-gun (愛知郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 1865498 | Akasaki-chō | 31369 | 赤碕町 | 31360 / Tōhaku-gun (東伯郡) | 1965, 1970, 1975, 1995 | Four snapshots |
| 2112526 | Iwanuma-machi | 04381 | 岩沼町 | 04380 / Natori-gun (名取郡) | 1965, 1970 | Two snapshots |
| 2113163 | Abiko-machi | 12304 | 我孫子町 | 12300 / Higashikatsushika-gun (東葛飾郡) | 1965 | One snapshot |

## Interpretation and guardrails

1. These 14 target/code associations should be reviewed first for exact source identity, feature semantics, applicable historical period and administrative level. Four-snapshot support is stronger geographic corroboration than one-snapshot support, but it is not a different approval rule.
2. The e-Stat parent references are source-recorded administrative ancestry candidates. They are not yet crosswalked to a matching GeoNames parent ID, and an administrative parent cannot be written without that separate identity/level review.
3. The 15 remaining single-code target candidates and all four multi-code targets must not be silently promoted. The six earlier collision records have documented conflicting containment evidence; GeoNames IDs 1851030, 1851031, 1859673, 1865064, 1865066 and 1865067 remain unresolved.
4. GeoNames ID 1864225 (Ei-chō) still has no containing-polygon observation in the selected snapshots. Keep it explicitly unresolved. Do not infer a polygon or ancestor from the name.
5. Keep raw admin1 value 00 unchanged. No operational parent link or crosswalk acceptance is implied by this report.

## Evidence sources

- [Full expanded spatial audit report](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-mlit-positive-candidate-spatial-audit-2026-10-11.md)
- [Focused six-collision spatial report](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-mlit-point-in-polygon-audit-2026-10-11.md)
- [Expanded e-Stat/MLIT code evidence report](https://github.com/job-grid/job-grid/blob/docs/country-catalog-foundation/docs/geonames-japan-mlit-candidate-code-evidence-2026-10-11.md)
- [Phase 0 CI #427 artifact with complete row-level evidence](https://github.com/job-grid/job-grid/actions/runs/38118581041/artifacts/11693823197)

PR #27 remains open, draft and unmerged. ISO 3166-1 comparison, reproduction of the original 25,685-row sample-selection algorithm, the 128 unresolved immediate-parent paths, and Phase 4C backup/recovery readiness remain separate acceptance blockers.