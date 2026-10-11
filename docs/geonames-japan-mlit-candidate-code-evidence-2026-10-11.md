# Japan MLIT administrative-code evidence audit — 2026-10-11

**Result: five official MLIT code-table snapshots were retrieved and fingerprinted; 34 of 35 e-Stat area-code candidates appear in at least one captured MLIT table. One code remains unsupported by these snapshots. No GeoNames crosswalk or operational parent was approved.**

## Verification run and artifact

- [Phase 0 CI #399](https://github.com/job-grid/job-grid/actions/runs/38104465597) passed on branch head `b31027f705ff833f9d620ba40ad63e4b330567b2`.
- Application validation: **98 tests passed, 0 failed**.
- Japan evidence artifact: [CSV/JSON, source-response snapshots, GeoNames manifest and five MLIT source pages](https://github.com/job-grid/job-grid/actions/runs/38104465597/artifacts/11688913666), retained until **2026-10-18 02:15:13 UTC**.
- The artifact-validation step parsed both JSON reports as valid JSON; read the MLIT CSV with a CSV parser; required 35 distinct e-Stat candidate codes; required five MLIT source fingerprints; and confirmed every evidence row says no operational parent link was created.

## Source snapshots

All five pages were retrieved over HTTPS with HTTP 200 at **2026-10-11 02:15:12 UTC**. SHA-256 hashes below identify the exact HTML bytes captured by CI; parsed row totals mean distinct five-digit codes parsed from the page tables.

| Snapshot | Publisher page | Parsed five-digit code rows | Response SHA-256 |
|---|---|---:|---|
| Current page snapshot (no dated filename) | [MLIT AdminAreaCd](https://nlftp.mlit.go.jp/ksj/jpgis/codelist/AdminAreaCd.html) | 2,493 | `ca224043e864cc293c63657fd63cb86cee94fe38553d902f6e179909910a89da` |
| 1990-10-01 | [MLIT AdministrativeAreaCd](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_901001.html) | 3,384 | `71070b4ec95acd80e3d5c7aa416141cfafa87ae282650a58839f054ab6cfac79` |
| 1975-10-01 | [MLIT AdministrativeAreaCd](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_751001.html) | 3,374 | `ddfe82c895c2a6f5645aec8618eb374e4d50b27eba0ab23805c34dbec0f51cd3` |
| 1970-10-01 | [MLIT AdministrativeAreaCd](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_701001.html) | 3,370 | `ba3438afb842b73304324aeb740b5abc41e85611ef73aa8ed77c31db4e7ff4c0` |
| 1965-10-01 | [MLIT AdministrativeAreaCd](https://nlftp.mlit.go.jp/ksj/gmlold/codelist/AdministrativeAreaCd_651001.html) | 3,328 | `91ad9504e7710444433cb1559c298696aceaa526f687bd175a80c9034372f735` |

Combined snapshot fingerprint (ordered by source list above):

`7993f1c215e77e71d443ac2fcb144c8ed72e3eedc0e1eb99295a857ed0d6e7bc`

This is the ordered hash of source identifiers and their response hashes, not a hash of a combined source file.

## Candidate-code coverage

| Measure | Result |
|---|---:|
| Distinct e-Stat candidate area codes | 35 |
| Found in one or more captured MLIT code tables | 34 |
| Not found in these five tables | 1 |
| Officially described code rows retained in the CI artifact | 197 |
| Operational parent links created | **0** |

Only code **`22360`** was not found in the captured MLIT code tables. e-Stat records it as `Fuji-gun` / `富士郡`, administrative class **District**, parent area code `22000` (`Shizuoka-ken` / `静岡県`). Its two source history periods are `1970-04-01` through `2010-03-23`, and the dated record at `2010-03-23`. Absence from these five MLIT lists is a **source-coverage/level mismatch**, not proof that the e-Stat record is invalid. The GeoNames target ID `1864128` remains unresolved.

## Additional historical codes recovered

Six codes previously absent from the current, 1990 and 1975 snapshots were found in the 1970 and/or 1965 MLIT lists:

| Candidate code | Official description in Japanese | Snapshot(s) found |
|---|---|---|
| `04381` | 宮城県名取郡岩沼町 | 1970, 1965 |
| `11302` | 埼玉県北足立郡桶川町 | 1970, 1965 |
| `12304` | 千葉県東葛飾郡我孫子町 | 1965 |
| `17341` | 石川県石川郡松任町 | 1970, 1965 |
| `34301` | 広島県安芸郡安芸町 | 1970, 1965 |
| `40502` | 福岡県三井郡小郡町 | 1970, 1965 |

These descriptions corroborate the administrative identity represented by the source code at those historical dates. The GeoNames record and code still require exact entity identity and time/level review before a crosswalk can be approved.

## Critical collision review

- **Code `45381`:** MLIT lists Miyazaki Prefecture, Higashimorokata-gun, Takaoka-machi (`宮崎県東諸県郡高岡町`) across the historic snapshots. GeoNames IDs `1851030` and `1851031` both match the English label by name, but their points are `35.18333, 138.65` and `35.03333, 137.08333`. The name-only code match is rejected for those target IDs; no substitute parent is inferred.
- **Codes `06382` and `15481`:** the historic code lists identify different Kawanishi-machi namesakes in Yamagata (`山形県東置賜郡川西町`) and Niigata (`新潟県中魚沼郡川西町`). Neither is approved for GeoNames ID `1859673` from code/name alone.
- **Asahi-mura:** the five candidates `06427`, `08401`, `15584`, `20451` and `21607` correspond to distinct historically recorded municipalities in Yamagata, Ibaraki, Niigata, Nagano and Gifu. The same five code names are suggested for three different GeoNames IDs, which is evidence of namesake ambiguity rather than a ready-made crosswalk.

The code descriptions are official administrative labels, **not a GeoNames ID crosswalk and not polygon-containment proof**. MLIT's historical code tables provide source-backed context; they do not themselves approve any Job Grid parent edge.

## Acceptance disposition

All 126 Japan targets passed source identity/raw-code checks against the retrieved GeoNames Japan source. However, all 126 immediate parent paths remain unresolved. The raw admin1 value `00` remains unchanged. The row-level MLIT source output is retained in the [CI #399 artifact](https://github.com/job-grid/job-grid/actions/runs/38104465597/artifacts/11688913666); the audited candidates and historical periods are in that artifact's `mlit-code-evidence.csv`, `mlit-code-evidence.json` and `japan-estat-evidence-audit.csv/json`.

Official ISO 3166-1 comparison remains blocked and the original sample-selection algorithm remains unreproduced. No database, migration, seed, import, production, deployment or merge was performed.
