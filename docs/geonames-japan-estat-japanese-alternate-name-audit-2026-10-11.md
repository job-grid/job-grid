# Japan exact Japanese-label / GeoNames alternate-name candidate audit — 2026-10-11

**Result: PASS — the 93 Japan targets without an exact normalized English-label candidate were checked against official e-Stat Japanese labels using exact complete alternate-name entries. No new area-code candidate was found. No parent links were created.**

## Latest verification

- [Phase 0 CI #444](https://github.com/job-grid/job-grid/actions/runs/38121685208) passed on code head `771b2acd402551b49ef5202cb62a14948df87ac5`. All nine Phase 0 jobs passed; application tests: **100 passed, 0 failed**.
- Phase 4C tooling validation [#414](https://github.com/job-grid/job-grid/actions/runs/38121685143) and backup-executor validation [#427](https://github.com/job-grid/job-grid/actions/runs/38121685180) also passed. The separate Phase 4C backup/recovery readiness gate remains blocked.
- The source-pinned row-level artifact is [available here](https://github.com/job-grid/job-grid/actions/runs/38121685208/artifacts/11695104233), retained until **2026-10-18 07:36:56 UTC**. It includes the 93-target Japanese alternate-name CSV, the full JSON report, source-response snapshots, existing e-Stat/MLIT data, and official historical boundary evidence.

## Source identity and scope

The run verified every one of the 126 Japan ADM4/raw-admin1-`00` targets against the official GeoNames `JP.zip` input and confirmed all 126 ID/name/country/feature/raw-code tuples matched exactly. No raw code was normalized or changed.

| Measure | Verified result |
|---|---:|
| Source-verified Japan targets | 126 / 126 |
| Targets without an exact normalized English e-Stat label candidate | 93 |
| Those targets with an exact Japanese-label/alternate-name candidate | **0** |
| Those targets with no exact Japanese-label/alternate-name candidate | 93 |
| New target-to-area-code candidate associations | **0** |
| New distinct candidate area codes | **0** |
| Operational parent links created | **0** |

### Pinned source details

- GeoNames official Japan archive: `https://download.geonames.org/export/dump/JP.zip`; retrieved over HTTPS at `2026-10-11T07:32:07Z`; HTTP 200; ZIP CRC passed. SHA-256: `b4294cb8e0a1abce0314f13d96af6310574393e5b8914e2337dfc2bb7a454ebd`.
- Official e-Stat Standard Area Code catalogue, retrieved from the publisher's SPARQL endpoint: 14,741 catalogue rows over four pages.
- Combined e-Stat source snapshot SHA-256: `0758e654c4b19e9a669847ef2e9a409b7d3a543552c9aa4c407fecc1b77b0d6b`.
- The run retrieved four batches of official historical detail records for the existing English-label candidates. The original English-label candidate results remain unchanged; no additional Japanese-alternate candidate area codes were discovered.

## Exact comparison rule

The audit compared each **complete comma-separated GeoNames alternate-name entry** from the official `JP.txt` row against an official e-Stat Japanese-language label (`label_ja`). A candidate would be recorded only when the complete strings were equal after Unicode NFC normalization and trimming leading/trailing whitespace.

It did **not** use substrings, transliteration, kana/kanji substitutions, approximate readings, fuzzy similarity, name proximity, coordinates or inferred parent references. The catalog lookup retained historical records and fetched the full source history for any matching area code.

## Interpretation

This is a **negative result for one discovery method only**. It does not show that the 93 GeoNames features have no parent, nor that the features are invalid. It shows that the alternate-name strings available in the pinned GeoNames Japan source did not exactly equal any official e-Stat Japanese labels for those unmatched targets under the stated rule.

GeoNames alternate-name entries are not themselves language-tagged in the `JP.txt` field. Exact equality, if it had occurred, would still have been candidate evidence rather than proof of a GeoNames entity crosswalk. Because there were no exact matches, this pass contributes no new parent candidates.

The existing **33 English-label candidate targets**, their 46 code associations, and the 122-archive spatial review remain separate evidence and are not changed by this result.

## Disposition and safeguards

- Keep all 93 targets without an English-label match unresolved.
- Keep all 126 Japan immediate-parent paths unresolved and both Kenya parent paths unresolved; total current immediate-parent blockers remain **128**.
- Preserve every raw `admin1=00` value.
- Do not create candidate crosswalks or parent links from this audit.
- Official ISO 3166-1 machine-readable comparison remains blocked; no paid source was purchased or access restriction bypassed.
- The original 25,685-row sample-selection algorithm remains unreproduced.
- Worldwide product/geographic completeness remains unverified.

PR #27 remains open, draft and unmerged. No database, migration, seed, import, production, deployment or live-state changes were made.
