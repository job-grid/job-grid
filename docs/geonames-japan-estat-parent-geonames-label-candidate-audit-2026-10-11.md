# Exact Japanese-label candidates for spatially observed e-Stat parent references — 2026-10-11

**Result: PASS for source retrieval, exact-label candidate generation and report reconciliation. Candidate identities only; no GeoNames parent ID was accepted and no parent link was written.**

## Verification and source provenance

- [Phase 0 CI #460](https://github.com/job-grid/job-grid/actions/runs/38131206378) passed on code head `0b71e79a89c542b1a9267c72d88a1320676804fd`.
- Application tests: **112 passed, 0 failed**. All nine Phase 0 jobs passed, including the new e-Stat/GeoNames Japan parent-label candidate audit. Separate Phase 4C tooling validation [#430](https://github.com/job-grid/job-grid/actions/runs/38131206466) and backup-executor validation [#443](https://github.com/job-grid/job-grid/actions/runs/38131206377) passed; the independent Phase 4C backup/recovery readiness blocker remains separate.
- The complete row-level artifact is [CI #460 artifact #11699411321](https://github.com/job-grid/job-grid/actions/runs/38131206378/artifacts/11699411321), available until **2026-10-18 10:21:52 UTC**. It contains the parent-reference JSON/CSV, candidate-match CSV, all 126 spatial-first Japan target summaries, official period history, source response snapshots and manifests.
- GeoNames Japan source: `JP.zip`, official URL `https://download.geonames.org/export/dump/JP.zip`, retrieved over HTTPS at `2026-10-11T10:14:06Z`, HTTP 200, ZIP CRC validation PASS. Archive SHA-256: `b4294cb8e0a1abce0314f13d96af6310574393e5b8914e2337dfc2bb7a454ebd`.
- Extracted `JP.txt` SHA-256: `4fdef2efadc8a13091501f6ff00c8809b2f6cf2a658d352ad0e38807370ae67b`. The scan processed **103,762 rows**, with **0 malformed/wrong-shape rows** and **0 duplicate IDs among eligible Japan administrative records**. It retained **2,338** same-country class-A records with feature codes ADM1, ADM2 or ADM3 for the exact-label candidate check.
- The input spatial-first e-Stat period/history report SHA-256 is `648cfe966736cbbe5d5a441a1d9d22485e6cc0d0068ccfe138fb64454707bd2b`. It contains the already verified **126** Japan targets, **105** distinct location-derived area codes, **120** target/code associations and **557** reconciled official e-Stat period records.

## Matching rule

For each unique pair of official e-Stat parent area code and exact period URI, the audit compared the official Japanese parent label (`label_ja`) to complete GeoNames Japan ADM1–ADM3 entries:
- primary name;
- ASCII name;
- each complete comma-delimited alternate-name token.

Comparison is exact Unicode NFC normalization with outer whitespace trimmed. The audit performs no substring match, transliteration, fuzzy spelling match, geographic-proximity match, or automatic parent inference. GeoNames `JP.txt` alternate-name entries are not language-tagged, so an exact Japanese-string match to an alternate-name token is still only a candidate signal.

## Results

The e-Stat period-history input produced **91 unique parent references** keyed by parent area code plus period URI. Those references span **75 distinct e-Stat parent area codes**.

| Candidate-only measure | Result |
|---|---:|
| Unique official e-Stat parent references | 91 |
| References with a Japanese parent label | 91 |
| References with conflicting Japanese labels for the same code/period URI | 0 |
| References with exactly one GeoNames administrative label candidate | 67 |
| References with multiple GeoNames candidates | 2 |
| References with no exact GeoNames Japanese-label candidate | 22 |
| References without a Japanese label | 0 |
| GeoNames candidate rows | 71 |
| Distinct GeoNames candidate IDs | 63 |
| Operational parent links created | **0** |

All **71/71 candidate rows matched only through a complete alternate-name token**. No candidate row matched via GeoNames primary name or ASCII name. The 71 rows include **36 ADM1 rows and 35 ADM2 rows**; no ADM3 candidate was returned by this exact-label method. The match count should not be interpreted as 71 confirmed parent entities. Some GeoNames IDs reappear against more than one historical e-Stat parent reference.

### Two references requiring disambiguation

| e-Stat parent code | Official label (English / Japanese) | GeoNames candidates | Why unresolved |
|---|---|---|---|
| `25420` | Echi-gun / `愛知郡` | `1864254` Echi-gun (ADM2); `1865696` Aichi-gun (ADM2) | Two Japan ADM2 records share an exact Japanese alternate-name token. The source evidence does not establish which, if either, is the same historical entity. |
| `39300` | Aki-gun / `安芸郡` | `1865442` Aki-gun (ADM2); `1865443` Aki Gun (ADM2) | Two Japan ADM2 records share the exact Japanese alternate-name token. Neither is selected. |

Both matches are via GeoNames alternate-name tokens, not primary names, and remain unresolved.

### 22 parent references with no exact candidate

The 22 unmatched parent references span 14 distinct e-Stat parent area codes and 15 distinct Japanese labels (some area-code/period references repeat across history):

| Parent code | Official English label | Official Japanese label |
|---|---|---|
| `01630` | Tokachi-shicho | `十勝支庁` |
| `01630` | Tokachi-sogoshinkokyoku | `十勝総合振興局` |
| `08500` | Makabe-gun | `真壁郡` |
| `15540` | Nakakubiki-gun | `中頸城郡` |
| `15600` | Sado-gun | `佐渡郡` |
| `16300` | Kaminiikawa-gun | `上新川郡` |
| `19320` | Higashiyatsushiro-gun | `東八代郡` |
| `28420` | Shikama-gun | `飾磨郡` |
| `32300` | Yatsuka-gun | `八束郡` |
| `36420` | Awa-gun | `阿波郡` |
| `36440` | Oe-gun | `麻植郡` |
| `37300` | Okawa-gun | `大川郡` |
| `38460` | Higashiuwa-gun | `東宇和郡` |
| `40560` | Yamato-gun | `山門郡` |
| `46360` | Hioki-gun | `日置郡` |

Zero exact candidates is the result of this narrow method only; it does not prove a GeoNames parent is absent. The official parent reference may be historical, may use a label not preserved in GeoNames alternate names, or may correspond to a feature outside the searched ADM1–ADM3 level set.

## Disposition and remaining acceptance gates

1. The **67 one-candidate references are not approved crosswalks**. Because all matches are untagged alternate-name entries, each still needs independent entity, geography, historical-period and level review.
2. The two ambiguous cases (`25420` / `愛知郡` and `39300` / `安芸郡`) remain unresolved; no arbitrary candidate was chosen.
3. All 22 no-match references remain unresolved; no missing candidate was inferred.
4. The audit did not create GeoNames parent IDs or operational parent edges. All **128 immediate parent paths remain unresolved**: 126 Japan and two Kenya records.
5. The ISO 3166-1 current-source comparison remains blocked. Independent reproduction of the original 25,685-row sample-selection algorithm remains unverified. Worldwide product/geographic completeness and Phase 4C backup/recovery readiness remain blocked/unverified.

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production, deployment or live-state change was performed.
