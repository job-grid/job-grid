# GeoNames hierarchy candidate-presence audit — 2026-10-11

**Audit result: PASS for crosswalk candidate presence only. Overall country catalog acceptance remains BLOCKED.**

The audit now distinguishes expected administrative identity matches from genuine bad self-reference candidates. The earlier 7,102-case self-reference warning was a false positive: the 125 admin1 matches and 6,977 admin2 matches correspond to active `ADM1` and `ADM2` feature records whose own code resolves back to their own GeoNames ID. This is an identity lookup, **not a parent relationship**. The corrected audit detects zero genuine self-reference issues and writes no parent links.

## Scope and provenance

The exact committed script `scripts/geonames-hierarchy-candidate-presence-audit.py` was fetched from PR #27 branch commit `c973a6ac1449a39d0b8e221cdeebda73a2ede73c`, copied byte-for-byte to the owner-connected Windows computer, and executed against the owner-local GeoNames sample and full admin crosswalks.

- Execution time: **2026-10-11 01:05:47 EAT** (`2026-10-10T22:05:47.796268Z`)
- Script SHA-256: `efa73e88752ac68c69516d85975e73783386358983cbcbbb0674a05a5387d765`
- Script Git blob SHA-1: `8b89ac6f2bb1408268b4796df32abc138f7865c2`
- Sample TSV: 4,626,293 bytes; SHA-256 `1932181885967f3079dfefd5d16b4df4c00b6e62e4213bede7aa49bfc44ab9ad`
- `admin1CodesASCII.txt`: 151,583 bytes; SHA-256 `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a`
- `admin2Codes.txt`: 2,366,368 bytes; SHA-256 `e1b500f4f0e13b3119ff15df84ce3c28982e899bb4183ee033f802a280c377d3`
- Result: `PASS_CANDIDATE_PRESENCE_ONLY_NO_PARENT_LINKS_APPROVED`; exit code `0`.

## Input integrity

| Check | Measured result |
|---|---:|
| Sample rows / unique IDs | 25,685 / 25,685 |
| Duplicate IDs / malformed sample rows | 0 / 0 |
| Full admin1 crosswalk keys | 3,865 |
| Full admin2 crosswalk keys | 47,642 |
| Malformed / duplicate admin1 crosswalk rows | 0 / 0 |
| Malformed / duplicate admin2 crosswalk rows | 0 / 0 |
| Administrative feature rows in sample | 24,693 |

## Candidate-presence results

| Check | Admin1 | Admin2 |
|---|---:|---:|
| Non-empty code references | 25,653 | 20,685 |
| References with exact crosswalk key | 23,320 | 20,445 |
| Missing key or context | 2,333 | 240 |
| Candidate ID found as a distinct same-country administrative feature | 23,195 | 13,468 |
| Expected active ADM feature identity matches | 125 | 6,977 |
| Genuine self-reference issues | 0 | 0 |
| Other candidate-presence mismatches | 0 | 0 |

The 125 ADM1 and 6,977 ADM2 identity matches are not exported as hierarchy exceptions. A wrong-level candidate that self-references is still blocked by the script and is covered by a synthetic regression test. Distinct candidate IDs prove availability only; they do not establish semantically correct parentage.

## Unresolved crosswalk references remain

Admin1 has **2,333** references without an exact key: **2,284** raw `00` placeholder/nonstandard candidates and **49** unmatched nonzero references. These are unresolved, not automatically invalid records or confirmed legacy codes.

Admin2 has **240** unresolved cases: **239** absent composite keys and **one** row without the admin1 context needed to form a complete key. The latter remains classified as `UNRESOLVED_MISSING_ADMIN1_CONTEXT`; no synthetic lookup key is emitted.

| Country | Sample rows | Admin1 keys found | Admin1 unresolved | Admin2 keys found | Admin2 missing-key cases | Admin2 missing-context cases | ADM1 identity matches | ADM2 identity matches |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| KE | 2,631 | 2,605 | 26 | 32 | 5 | 0 | 47 | 32 |
| GB | 12,096 | 12,092 | 3 | 12,004 | 29 | 0 | 4 | 185 |
| JP | 4,899 | 2,736 | 2,161 | 2,554 | 205 | 1 | 47 | 1,190 |
| BR | 5,888 | 5,887 | 1 | 5,855 | 0 | 0 | 27 | 5,570 |
| SG | 171 | 0 | 142 | 0 | 0 | 0 | 0 | 0 |

The admin1 unresolved counts are reference-row counts; country totals include rows with non-empty admin1 code. The admin1 total is 2,333.

## Unresolved reference triage — aggregate only

The row-level unmatched-reference exports were reviewed by country, classification, and feature code. The aggregate counts below are recorded in the machine-readable report's `unresolved_reference_triage` section. The row-level files remain the source of record for individual exceptions; this report intentionally does not reproduce personal/record-level data.

### Admin1: 2,333 unresolved references

| Classification | Rows |
|---|---:|
| Raw code `00` — unresolved placeholder/nonstandard candidate | 2,284 |
| Unmatched nonzero code — missing or version-dependent reference | 49 |
| **Total** | **2,333** |

The 49 nonzero-code cases are split between Kenya (25) and Singapore (24). Their feature-code breakdown is Kenya: 10 `ADMD`, 7 `ADM1H`, 6 `ADM2H`, 2 `ADM3`; Singapore: 22 `PPL`, 2 `PPLX`.

Across all 2,333 admin1-unresolved rows, the feature-code counts are: `ADMD` 1,104; `ADM4H` 678; `ADM2H` 171; `ADM4` 126; `ADM3H` 89; `PPLX` 81; `PPL` 54; `ADMDH` 7; `ADM1H` 7; `PCLI` 5; `PPLL` 4; `ZN` 3; `ADM3` 2; and `PPLH` 2.

### Admin2: 240 unresolved references/context cases

| Classification | Rows |
|---|---:|
| Raw code `00` — unresolved placeholder/nonstandard candidate | 2 |
| Unmatched code — missing or version-dependent reference | 237 |
| Missing admin1 context, so no complete composite key can be formed | 1 |
| **Total** | **240** |

By feature code, the 240 cases are 220 `ADM2H`, 15 `ADM3H`, and 5 `ADMD`. By country and feature code: GB has 27 `ADM2H` and 2 `ADMD`; JP has 188 `ADM2H`, 15 `ADM3H`, and 3 `ADMD`; KE has 5 `ADM2H`.

The official [GeoNames Feature Codes reference](https://www.geonames.org/export/codes.html) defines `ADM1H`, `ADM2H`, `ADM3H`, and `ADM4H` as historical administrative divisions at their respective levels. It defines `ADMD` as an administrative division whose level is undifferentiated, and `ADMDH` as a historical administrative division whose level is undifferentiated. These definitions help prioritize review; **they do not prove that any specific row is invalid, current, selectable, or safe to assign a parent**.

**Disposition:** keep every unresolved row, its raw code, GeoNames ID, feature code, and existing source context. Do not normalize `00`, relabel nonzero codes as legacy without evidence, reject rows automatically, or infer parent IDs. The remaining 2,333 admin1 and 240 admin2 cases stay **UNRESOLVED / REVIEW REQUIRED** pending approved inclusion, version, and country-specific hierarchy policies.

## Candidate feature-level check — 2026-10-11

A further read-only check profiled the feature codes of **distinct same-country administrative candidate IDs** returned by the two crosswalks. Expected identity matches are excluded because they are not parent candidates.

| Crosswalk level | Distinct candidate rows checked | Observed feature codes | Rows with unexpected code in this sample |
|---|---:|---|---:|
| Admin1 | 23,195 | `ADM1`: 23,195 | 0 |
| Admin2 | 13,468 | `ADM2`: 13,468 | 0 |

Admin1 by country: BR `ADM1` 5,860; GB `ADM1` 12,088; JP `ADM1` 2,689; KE `ADM1` 2,558. No distinct admin1 candidates were found for SG because its sample admin1 references remain unmatched.

Admin2 by country: BR `ADM2` 285; GB `ADM2` 11,819; JP `ADM2` 1,364. KE's exact admin2 crosswalk rows in the selected sample are identity matches, not distinct candidate parents; no distinct admin2 candidates were found for SG.

The results are consistent with the level-specific feature codes in the official [GeoNames Feature Codes reference](https://www.geonames.org/export/codes.html), which describes `ADM1` as a first-order administrative division and `ADM2` as a second-order subdivision. This is a **feature-level consistency check only**: it does not establish that each candidate is the semantically correct parent of each child, prove a complete hierarchy path, or authorize parent assignments. No parent IDs or links were written.

The aggregate counts and source/script fingerprints are recorded in `hierarchy_candidate_feature_level_profile` in the JSON report.

## Acceptance decision

- **PASS:** Audit integrity and candidate-presence check on the hashed sample/crosswalk inputs.
- **NOT APPROVED:** Parent hierarchy; no parent links or parent IDs were created.
- **BLOCKED:** Catalog acceptance while 2,333 admin1 and 240 admin2 references remain unresolved and feature/selectability rules are not approved.
- **UNVERIFIED:** Current ISO authority comparison, source-origin/remote retrieval metadata, worldwide geographic completeness, and full parent-hierarchy correctness.
- **SEPARATELY BLOCKED:** Phase 4C backup/recovery readiness.

The ISO source-access check is documented in [the ISO authority protocol](iso-authority-approval-and-validation-protocol-2026-10-10.md). No paid ISO subscription was purchased, and no ISO source snapshot was captured or compared. The official ISO source-choice approval alone does not satisfy that gate.

PR #27 remains open, draft and unmerged. No parent links, database operations, migrations, seeds, imports, source-file changes, production changes, deployments, secrets/Cloudflare changes or backup/recovery actions occurred.
