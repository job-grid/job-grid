# Japan official administrative-code candidate audit — 2026-10-11

**Result: source retrieval and all 126 target identity checks PASS; candidate discovery is useful for owner review; all 126 operational parent paths remain unresolved.** No operational parent links were created.

## Verification run

- Workflow: [Phase 0 CI #389](https://github.com/job-grid/job-grid/actions/runs/38102914474) — passed.
- Tests on the same code head: **96 passed, 0 failed**.
- Japan evidence artifact: [row-level CSV, JSON, source response and manifests](https://github.com/job-grid/job-grid/actions/runs/38102914474/artifacts/11688387884), available until **2026-10-18** under GitHub Actions artifact retention.
- GeoNames JP source: [official JP.zip](https://download.geonames.org/export/dump/JP.zip). Retrieved over HTTPS on 2026-10-11 at 01:41:27 UTC; HTTP 200; ZIP integrity passed; archive SHA-256 `f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58`; 103,762 source rows; zero malformed rows. All 126 target GeoNames IDs matched source name, country code, feature code, raw admin1 and raw admin2 fields exactly.
- Official Japanese source: [e-Stat Standard Area Code List](https://data.e-stat.go.jp/lod/sac), via [official Statistical LOD SPARQL endpoint](https://data.e-stat.go.jp/lod/sparql/alldata/query). The captured query covered **14,741 code-history rows over four pages** and retrieved historical detail for **156 period URIs across four small batches**. Combined e-Stat response snapshot SHA-256: `ca52a59ef64294e9af01c303ebad7f4408ac0156031c885538e4aeb6f4c17f33`. The e-Stat source describes administrative-code history and changes; it is supporting evidence, not a GeoNames ID crosswalk.

## Candidate counts

| Measure | Result |
|---|---:|
| Japan targets with GeoNames identity/raw-code check passed | 126 / 126 |
| Target records with one distinct e-Stat area-code candidate | 29 |
| Target records with multiple distinct e-Stat area-code candidates | 4 |
| Target records with no exact normalized English-label candidate | 93 |
| Distinct e-Stat area codes seen among candidates | 35 |
| Target-to-area-code candidate associations | 46 |
| Matching historical period rows counted across target records | 200 |
| Historical candidate detail rows retrieved | 156 |
| Operational parent links created | **0** |

Candidates are counted by distinct official area code, not by every dated version of the same code. The dated periods, effective dates, Japanese/English labels, parent references, predecessor/successor links and administrative-class values are retained in the workflow artifact.

## Four ambiguous targets requiring manual identity review

| GeoNames ID | GeoNames name | Distinct e-Stat area-code candidates | Status |
|---|---|---|---|
| `1859673` | Kawanishi-machi | `06382`, `15481` | Multiple candidates; disambiguation required |
| `1865064` | Asahi-mura | `06427`, `08401`, `15584`, `20451`, `21607` | Multiple candidates; disambiguation required |
| `1865066` | Asahi-mura | `06427`, `08401`, `15584`, `20451`, `21607` | Multiple candidates; disambiguation required |
| `1865067` | Asahi-mura | `06427`, `08401`, `15584`, `20451`, `21607` | Multiple candidates; disambiguation required |

A separate cross-target collision also requires identity review: GeoNames IDs `1851030` and `1851031` are both named `Takaoka-chō` and each discovers e-Stat area code `45381`. This illustrates why a label/code candidate cannot be treated as a unique GeoNames entity match automatically.

## Interpretation and decisions

1. The audit only uses exact normalized English-label equality for candidate discovery. It uses no fuzzy similarity, proximity, coordinates, or “first result” shortcut.
2. The 29 single-area-code candidates are **not** approved GeoNames entity matches. Their historical period and parent records still need identity and administrative-level review.
3. The 93 no-match targets remain unresolved. This does not prove that a record is invalid; labels may differ, historic records may predate the source coverage, or the standard-area-code system may represent a different entity/level.
4. Japan raw admin1 `00` was preserved for all targets. GeoNames describes admin1 `00` as a general feature with no specific admin1 code defined. No raw values were normalized.
5. **All 126 parent paths remain blocked.** The audit creates candidate evidence only; it does not establish a complete GeoNames ADM hierarchy path, and no operational parent links were written.
6. The current official ISO machine-readable snapshot/comparison remains blocked separately. The original 25,685-row sample-selection algorithm also remains unreproduced.

## Reproducibility and next review

The audit implementation is `scripts/geonames-japan-estat-evidence-audit.mjs`, with synthetic regression tests in `tests/geonames-japan-estat-evidence-audit.test.js` and CI enforcement in `.github/workflows/ci.yml`. A new PR run re-fetches both official source inputs, captures query/response fingerprints, verifies all target IDs/raw fields, and regenerates row-level candidate output.

**Next:** review the four ambiguous targets and the two-GeoNames-ID / one-area-code Takaoka collision; then inspect the 29 single-area-code cases against original GeoNames record context and the date/parent history. Only an exact, level-aligned, source-backed entity crosswalk plus a complete path can qualify for owner approval. Until then, retain all 126 raw records as unresolved and do not write parent links.

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production, deployment, or recovery change was made by this audit.
