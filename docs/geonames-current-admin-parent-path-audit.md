# Current administrative parent-path audit tooling — 2026-10-11

**Status: repeatable read-only audit added; no parent links approved or written.**

## Purpose

The 128 current administrative exception records (126 Japan ADM4, 2 Kenya ADM3) remain blocked from current selectors until their parent paths are evidenced. The new script audits an explicitly supplied GeoNames allCountries.txt snapshot using exact country/admin-code composite keys. It does not infer from labels, coordinates, proximity, other records with similar names, or feature level alone.

## Run

From the repository root, against an extracted source dump:

```sh
node scripts/geonames-current-admin-parent-path-audit.mjs /absolute/path/to/allCountries.txt
```

Optional second and third arguments select the dispositions CSV and output prefix:

```sh
node scripts/geonames-current-admin-parent-path-audit.mjs /path/to/allCountries.txt docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/owner-approved-dispositions.csv /path/to/output/current-admin-parent-path-audit
```

The script writes a row-level CSV plus a JSON summary. The JSON records the source-file SHA-256, byte size, modification time, line count and filename. These values pin the exact local bytes used for the audit; they do **not** claim that the source is the latest official snapshot or substitute for remote HTTP retrieval metadata.

## Exact-code rules

- Confirm that the target GeoNames ID exists exactly once and that source country and feature code match the approved exception export.
- Compare the source row's raw admin1/admin2 values with the existing exception export before calculating candidate parents. If either differs, stop that row for source/version review.
- Resolve each required level only by the exact composite key built from the same country and the raw admin code fields needed for that level, with the parent feature code exactly ADM1, ADM2 or ADM3.
- Preserve raw codes without normalization. An empty code or raw 00 blocks the ancestor lookup; it is never changed to blank, zero, a guessed code or a synthetic parent.
- Missing keys and non-unique keys are blockers. No name, proximity or “first match” fallback is allowed.
- A complete path is labelled CANDIDATE_PATH_FOUND_REQUIRES_OWNER_APPROVAL. Candidate IDs in the report are evidence only. The report always states that zero operational parent links were created.

## External evidence already checked manually

Four official GeoNames record pages demonstrate why feature class alone is insufficient to create an ancestor chain:

- [Yao-chō, Japan — GeoNames ID 1848521](https://www.geonames.org/1848521/yao-cho.html) is marked ADM4, but its displayed administrative hierarchy lists Japan and Yao-chō without intermediate ADM1–ADM3 records.
- [Uji-chō, Japan — GeoNames ID 1849371](https://www.geonames.org/1849371/uji-cho.html) is marked ADM4, but its displayed administrative hierarchy lists Japan and Uji-chō without intermediate ADM1–ADM3 records.\n- [Kiambururu Sub-Location, Kenya — GeoNames ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html) is marked ADM3, but its displayed administrative hierarchy lists Kenya and Kiambururu without intermediate ADM1 or ADM2 records.\n- [Imenti Central, Kenya — GeoNames ID 7800132](https://www.geonames.org/7800132/imenti-central.html) is marked ADM3, but its displayed administrative hierarchy lists Kenya and Imenti Central without intermediate ADM1 or ADM2 records.

The [official GeoNames feature-code reference](https://www.geonames.org/export/codes.html) defines the administrative feature levels. GeoNames' [place hierarchy service documentation](https://www.geonames.org/export/place-hierarchy.html) describes the separate hierarchy view. A missing intermediate record must be treated as a source-evidence gap, not filled from a feature-code definition.

The existing exception export still reports 126 Japan records with raw admin1 00, plus two Kenya records with nonzero codes whose exact crosswalk keys were absent from the audited inputs. These four pages are representative manual checks, covering both Kenyan targets and two Japanese targets; they are not evidence that every record in the 128-record set has been individually reviewed.

## Current decision boundary

This tooling does not modify source files, exception exports, migrations, schemas, seeds, imports, databases, deployment or production. It does not certify ISO authority codes or worldwide completeness. Any candidate parent path remains subject to owner review and explicit approval before any operational relationship is written.

## Live source-pinned audit result — 2026-10-11

**Result: all 128 records remain blocked; no candidate administrative parent paths were found.**

GitHub Actions run [38097159134](https://github.com/job-grid/job-grid/actions/runs/38097159134) fetched the official Japan, Kenya and GeoNames hierarchy archives over HTTPS. All three HTTP responses returned 200; ZIP CRC validation passed; HTTP Last-Modified values and SHA-256 hashes were captured.

| Input | Retrieved (UTC) | HTTP Last-Modified (UTC) | Size | SHA-256 |
|---|---|---|---:|---|
| JP.zip | 2026-10-11 00:04:19 | 2026-10-10 01:54:47 | 4,959,247 bytes | `f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58` |
| KE.zip | 2026-10-11 00:04:21 | 2026-10-10 01:54:48 | 859,668 bytes | `d7335182356ab6609f93c1f66527195acd75bf72a841915b337858d65a172f43` |
| hierarchy.zip | 2026-10-11 00:04:23 | 2026-10-10 02:03:54 | 2,133,112 bytes | `a43d26e35691045be9fcbac87e51c2942cd08e5e63b4883a985e92b96cc19e8b` |

The combined Japan/Kenya country text has 135,252 lines, SHA-256 `092a1832f995f1aa2e9de7071b6f1fcd4b5afb151d3ec18306e3a8e13fbe95e2`. The extracted hierarchy text has 519,230 lines, SHA-256 `f81fdc85602678e22135fde1084d12f31f087bfe53e30897f686a70f57bc6c5f`.

### Actual row-level results

- 128 current admin targets reviewed: 126 Japan ADM4 and 2 Kenya ADM3.
- Exact admin-code path candidates requiring owner review: **0**.
- Targets with a direct hierarchy.zip edge of type ADM: **0**; targets with any direct hierarchy edge: **0**.
- All 126 Japanese records remain blocked because their raw admin1 code is `00`; do not normalize it or synthesize a parent.
- Both Kenyan records remain blocked because no exact same-country ADM1 composite-key match was found: Kiambururu Sub-Location (GeoNames ID 192705, raw admin1 `01`) and Imenti Central (ID 7800132, raw admin1 `03`). Neither ID has a direct `ADM` hierarchy edge in the downloaded hierarchy snapshot.
- Operational parent links written: **0**. No live database, migration, seed, import, production or deployment changes.

The detailed 128-row CSV, JSON summary and source retrieval manifest are available in the [seven-day workflow artifact](https://github.com/job-grid/job-grid/actions/runs/38097159134/artifacts/11687045546) (expires 2026-10-18). The source archives themselves were not committed or included in the artifact.

The official GeoNames README says hierarchy.zip stores parent ID, child ID and relationship type; `ADM` entries model the hierarchy represented by admin1–4 codes, while toponym-to-admin relationships are reconstructed from the source admin codes. For these 128 specific targets, the independent hierarchy dump did not supply a direct ADM edge, so it provides no override for the missing/placeholder codes. This is evidence against fabricating an ancestry chain, not a claim that GeoNames' full hierarchy dataset is globally complete.

These archives are the bytes fetched during this CI run, with real retrieval timestamps, Last-Modified headers, ETags and hashes. The checksums pin those downloaded bytes; they do not assert an immutable GeoNames release ID. Current ISO authority comparison and worldwide completeness remain unverified.
