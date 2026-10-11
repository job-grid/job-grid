# e-Stat grandparent-context and GeoNames ADM1-code consistency audit — 2026-10-11

**Result: PASS for source retrieval, exact-period reconciliation, candidate-code comparison and output integrity. No candidate identity or parent link was approved.**

## Verification

- [Phase 0 CI #477](https://github.com/job-grid/job-grid/actions/runs/38137803936) passed on code head `fda45f66230e745b479b339f86ea1315c2a499d1`; all nine Phase 0 jobs passed.
- Application validation: **122 tests passed, 0 failed**, including all eight new tests for exact Japanese labels and hierarchy-consistency status handling.
- Phase 4C tooling validation [#447](https://github.com/job-grid/job-grid/actions/runs/38137803919) and backup-executor validation [#460](https://github.com/job-grid/job-grid/actions/runs/38137803923) passed. This does **not** resolve the independent Phase 4C backup/recovery readiness blocker.
- The full [CI #477 evidence artifact](https://github.com/job-grid/job-grid/actions/runs/38137803936/artifacts/11702177180) is retained until **2026-10-18 12:10:22 UTC**. It contains the report JSON, candidate-result CSV, 117-row parent-context and disposition CSVs, source-response JSON, source manifests and other Japan evidence produced by the same CI run.
- The new audit was source-derived from the exact-period parent-candidate expansion; no manual candidate list was used to generate the 91 candidate rows.

## Scope and source reconciliation

| Read-only measure | Result |
|---|---:|
| Official e-Stat parent-period references re-queried | 117 |
| e-Stat URI query batches | 3 |
| e-Stat detail response rows | 125 |
| GeoNames Japan ADM1–ADM3 records checked for source integrity | 2,338 |
| GeoNames ADM1 features eligible for parent-label candidate lookup | 47 |
| Exact Japanese-label GeoNames parent candidate rows | 91 |
| Candidate rows using GeoNames ADM1 records (not applicable to this ADM1-code check) | 36 |
| Candidate rows using GeoNames ADM2 records with an ADM1 code to compare | 55 |
| ADM2 candidate rows whose raw `admin1_code` matches one unique ADM1 label candidate for the e-Stat parent/grandparent context | 46 |
| ADM2 candidate rows whose raw `admin1_code` conflicts with that unique ADM1 label candidate | 9 |
| Ambiguous parent references narrowed to one code-coherent and one conflicting candidate | 3 |
| Operational parent links created | **0** |

All three e-Stat requests returned HTTP 200 and have recorded query and response SHA-256 fingerprints. The requested parent-period URI set has SHA-256 `4b2025242632eaff6c8dd73f98f0e39440c9f3cf673722832920b32d627b72be`.

### Input identity and fingerprints

- Official GeoNames `JP.zip`: archive SHA-256 `b4294cb8e0a1abce0314f13d96af6310574393e5b8914e2337dfc2bb7a454ebd`.
- Extracted `JP.txt`: SHA-256 `4fdef2efadc8a13091501f6ff00c8809b2f6cf2a658d352ad0e38807370ae67b`; **103,762** source rows scanned; zero malformed/wrong-shape rows; 2,338 eligible Japan ADM1–ADM3 records.
- Parent-candidate expansion JSON: SHA-256 `a06ed9e6f76426f77fb668a2030997502c6534b46f51cd03d7c572e2eafeb276`.
- Official endpoint: [Japan Statistical LOD SPARQL](https://data.e-stat.go.jp/lod/sparql/alldata/query).

## Ambiguous parent references — narrowed, not resolved

The hierarchy check asks whether an exact-label GeoNames ADM2 candidate's own raw `admin1_code` is consistent with a unique, exact Japanese-label GeoNames ADM1 candidate for the e-Stat parent's own official parent reference. It is a namespace consistency check. It does not prove either GeoNames record is the actual e-Stat entity.

| e-Stat parent reference | Official e-Stat grandparent context | Code-coherent GeoNames ADM2 candidate | Candidate conflicting with that context | Disposition |
|---|---|---|---|---|
| `25420` / `愛知郡` (Echi-gun) | `25000` / Shiga-ken (`滋賀県`); exact Japanese-label ADM1 candidate ID `1852553`, raw admin1 code `35` | `1864254` (Echi-gun), raw admin1 code `35` | `1865696` (Aichi-gun), raw admin1 code `01` | One code-coherent candidate for review; neither approved |
| `34300` / `安芸郡` (Aki-gun) | `34000` / Hiroshima-ken (`広島県`); exact Japanese-label ADM1 candidate ID `1862413`, raw admin1 code `11` | `1865442` (Aki-gun), raw admin1 code `11` | `1865443` (Aki Gun), raw admin1 code `20` | One code-coherent candidate for review; neither approved |
| `39300` / `安芸郡` (Aki-gun) | `39000` / Kochi-ken (`高知県`); exact Japanese-label ADM1 candidate ID `1859133`, raw admin1 code `20` | `1865443` (Aki Gun), raw admin1 code `20` | `1865442` (Aki-gun), raw admin1 code `11` | One code-coherent candidate for review; neither approved |

All 91 parent candidate rows still matched through complete GeoNames alternate-name tokens only; none matched a primary or ASCII name. The GeoNames alternate-name field is not language-tagged. Therefore, even the three code-coherent candidates remain dependent on a weak identity discovery signal and must not be treated as verified crosswalks.

## Interpretation

1. The three historically ambiguous references now have a clear *review priority*: the candidate whose GeoNames ADM1 namespace code agrees with the single exact-label ADM1 candidate for the official e-Stat parent context is more internally coherent than the namesake candidate whose code conflicts.
2. This is not a substitute for independent entity identity evidence. Both the ADM2 match and the ADM1 grandparent match came from untagged alternate-name entries, so the code coherence is not independent proof that those GeoNames entities are identical to the e-Stat records.
3. The **46 coherent** rows are candidates for review, not a set of approved parents. The **9 conflicting** rows are negative consistency evidence under this particular hierarchy context, not proof that the GeoNames records are globally invalid.
4. The 36 ADM1 candidate rows are intentionally marked not applicable to an ADM1-code parent namespace comparison.
5. The remaining no-match references and all historical-period conflicts remain unresolved. No code values, raw admin fields or hierarchy edges were changed.

## Acceptance disposition

- No GeoNames parent ID was selected; zero operational parent links were written.
- All 128 immediate parent paths remain unresolved: 126 Japan records (raw `admin1=00`) and two Kenya ADM3 records.
- ISO 3166-1 current-source comparison remains blocked.
- Independent reproduction of the original 25,685-row sample-selection algorithm remains unverified.
- Worldwide product/geographic completeness and Phase 4C backup/recovery readiness remain blocked or unverified.

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production or deployment changes were made.
