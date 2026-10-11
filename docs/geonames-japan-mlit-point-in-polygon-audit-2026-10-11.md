# Japan MLIT historical-boundary point-in-polygon evidence audit — 2026-10-11

**Audit result: PASS — 6/6 collision targets received official boundary context, 65 official archives were retrieved/CRC-checked, and all 19 target-to-candidate-code combinations lacked a point-in-candidate-polygon hit in the selected snapshots. No parent link was created.** This is candidate-only spatial evidence, not a completed GeoNames entity crosswalk.

## Reproducible verification

- [Phase 0 CI #420](https://github.com/job-grid/job-grid/actions/runs/38117580528) passed on PR head `a8274fd46be72aea2aec1a448f1ae5313a494761`.
- Application validation: **98 tests passed, 0 failed**. Secret scanning, repository integrity, database migration validation, dependency scanning, worldwide source audit, Kenya legacy-key audit and existing parent-path audit also passed.
- [Full evidence artifact](https://github.com/job-grid/job-grid/actions/runs/38117580528/artifacts/11694226862), available until **2026-10-18 06:19 UTC**. It contains the row-level JSON/CSV, candidate-result CSV, source manifest, captured MLIT catalogue page and all 65 boundary archives.
- Official source catalogue: [MLIT N03 historical boundary data catalogue](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_2.html). Captured over HTTPS with HTTP 200; the raw catalogue HTML response SHA-256 is `837988488c33601d97308735b803d8b46f26fb191294c26ce690db0673e98abb`.
- The 65 exact archive names, download URLs, sizes and per-archive SHA-256 values are retained in `japan-mlit-polygon-audit.manifest.json` in the artifact. Ordered manifest fingerprint (snapshot date, prefecture, archive filename, archive hash and byte size per row): `16a2ee72a6b65844bc6a2fede779ab286f1c30179909d138b5ac42230c6319b0`.
- Polygon JSON SHA-256: `08fc73169f0dd4cb8597e9bd0a1034df0976f814ed57a052ec0fd79ac8e0e840`.
- Point-observation CSV SHA-256: `77bb354e4752f3d73f79ef41663bef2e7d3b9021fe1492e0153092d1df11142b`.
- Candidate-result CSV SHA-256: `a101da21ae5c7a3036fc22fa830ecbcc55ab3b503ad65b52a29e46566f324876`.
- No GeoNames archive or MLIT boundary archive was committed to repository history; the fingerprinted archive files are in the expiring workflow artifact.

## Summary

| Measure | Result |
|---|---:|
| Collision targets audited | 6 |
| Official boundary archives retrieved and CRC-checked | 65 |
| Target records with at least one point-in-polygon observation | 6 / 6 |
| Containing-polygon observations | 12 |
| Distinct target-to-candidate-code combinations tested | 19 |
| Candidate codes with a target point inside their polygon in selected snapshots | **0 / 19** |
| Operational parent links created | **0** |

For historic snapshots, archives were retrieved for the prefectures represented by the candidate codes (1965, 1970 and 1975); the 1995 archive coverage spans all 47 prefectures. A point not being inside a candidate polygon does not automatically prove the GeoNames record invalid: GeoNames coordinates can be feature reference points, and dates/levels may differ. Here, however, every target has positive polygon context in a **different** administrative area from the e-Stat name candidate(s), which is material conflicting evidence. It disqualifies these name candidates from approval on current evidence.

## Actual containing polygons for the six GeoNames points

The official MLIT boundary polygon containing each coordinate is recorded below. Codes are five-digit Japanese administrative-area codes from the exact source snapshot; no code was inferred from the GeoNames name.

| GeoNames ID | GeoNames label | Coordinate (lat, lon) | Containing area code | Official containing area (Japanese) | Snapshot dates |
|---|---|---|---|---|---|
| `1851030` | Takaoka-chō | `35.18333, 138.65` | `22210` | Shizuoka Prefecture · Fuji City (`静岡県 富士市`) | 1995-10-01 |
| `1851031` | Takaoka-chō | `35.03333, 137.08333` | `23211` | Aichi Prefecture · Toyota City (`愛知県 豊田市`) | 1995-10-01 |
| `1859673` | Kawanishi-machi | `36.1412, 136.14017` | `18201` | Fukui Prefecture · Fukui City (`福井県 福井市`) | 1995-10-01 |
| `1865064` | Asahi-mura | `37.21667, 138.38333` | `15544` | Niigata Prefecture · Nakakubiki District · Yoshikawa Town (`新潟県 中頸城郡 吉川町`) | 1965, 1970, 1975, 1995 |
| `1865066` | Asahi-mura | `35.96667, 139.88333` | `12208` | Chiba Prefecture · Noda City (`千葉県 野田市`) | 1995-10-01 |
| `1865067` | Asahi-mura | `35.96667, 138.0` | `20382` | Nagano Prefecture · Kamiina District · Tatsuno Town (`長野県 上伊那郡 辰野町`) | 1965, 1970, 1975, 1995 |

These observations conflict with the name-derived e-Stat candidate sets: the Takaoka-chō candidates both point to area code `45381` in Miyazaki; Kawanishi-machi candidates `06382` and `15481` are in Yamagata/Niigata; the five Asahi-mura candidates are in Yamagata, Ibaraki, Niigata, Nagano and Gifu. None of those 19 target-code pairs contained its target point in the selected historical or 1995 snapshots. For Asahi-mura IDs `1865064` and `1865067`, the observed area stays the same across four distinct snapshots, making the disagreement more than a single-date edge case.

## Candidate-code result by target

The full 19-row machine-readable table is in [`japan-mlit-polygon-audit.candidate-results.csv` in the artifact](https://github.com/job-grid/job-grid/actions/runs/38117580528/artifacts/11694226862). A blank `point_inside_candidate_polygon_snapshots` means no point hit for that target/candidate code in the selected snapshots.

| GeoNames ID | Candidate area code | Point-in-candidate-polygon hit |
|---|---|---|
| `1851030` | `45381` | None observed |
| `1851031` | `45381` | None observed |
| `1859673` | `06382` | None observed |
| `1859673` | `15481` | None observed |
| `1865064` | `06427`, `08401`, `15584`, `20451`, `21607` | None observed for all five |
| `1865066` | `06427`, `08401`, `15584`, `20451`, `21607` | None observed for all five |
| `1865067` | `06427`, `08401`, `15584`, `20451`, `21607` | None observed for all five |

## Disposition

1. **Do not approve any of these 19 name-derived target/code matches.** Every candidate combination lacks spatial support, and all six target points are observed inside a different official municipality area in the audited geometry snapshots.
2. **Do not conclude the GeoNames records are definitively wrong.** The sampled coordinate may not be a municipality centroid, and the selected historical snapshot coverage does not exhaust every date or administrative definition. The evidence establishes an identity/hierarchy conflict needing a better source-backed crosswalk, not the final truth for all historical records.
3. Keep all six raw `admin1=00` values unchanged, and retain their unresolved status. No immediate parent path is approved and no parent links were written.
4. The full acceptance gates remain: 126 Japan paths and 2 Kenya paths unresolved overall; official ISO 3166-1 machine-readable comparison blocked; the original sample-selection algorithm unreproduced; worldwide product completeness not established.

## Reproducible code and artifacts

- Read-only audit: `scripts/geonames-japan-mlit-polygon-evidence-audit.py`
- Regression tests, including mixed GML/Shapefile archives and declared Shift_JIS handling: `tests/test_geonames_japan_mlit_polygon_evidence_audit.py`
- CI job enforces six targets, 65 archive fingerprints, 19 candidate rows, observed polygon context for every target, and zero parent writes.
- [Phase 0 CI #420](https://github.com/job-grid/job-grid/actions/runs/38117580528) and [retained evidence artifact](https://github.com/job-grid/job-grid/actions/runs/38117580528/artifacts/11694226862).

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production, deployment or live-state changes were made.
