# Independent GeoNames five-country archive verification — 2026-10-10

**Stage C sample-record comparison: PASS (owner-laptop source archives).**  
**Administrative crosswalk reconciliation: PARTIALLY MEASURED; unresolved references remain.**  
**Catalog acceptance: BLOCKED. PR #27 remains open, draft and unmerged.**

## 1. Scope and provenance

The five country ZIPs were present in the owner's connected Windows folder `C:\Users\jonat\OneDrive\Desktop\JobGrid-GeoNames`. We inspected them in place without modifying files. Hashes, ZIP CRC integrity checks, source row counts, and record comparisons were run against the owner-provided files on that computer.

The owner downloaded the archives from the official GeoNames URLs listed below. This verification did not re-fetch those URLs, capture remote HTTP `Last-Modified` headers, or establish exact remote retrieval timestamps. Values below are measured file evidence from the owner computer, not a fresh HTTP-origin snapshot.

The worldwide `allCountries.zip` was **not** opened or parsed for this task; no worldwide archive download was started.

## 2. Five-country archive results

Each archive opened successfully; Python `zipfile.testzip()` returned no corrupt member. Each ZIP contained `readme.txt` and the corresponding country `.txt` data file. All parsed source rows had the expected 19 tab-separated fields and unique GeoNames IDs.

| Archive | Official GeoNames URL | Bytes | SHA-256 | Source rows | Exact sample matches | ZIP CRC |
|---|---|---:|---|---:|---:|---|
| `KE.zip` | https://download.geonames.org/export/dump/KE.zip | 859,668 | `d7335182356ab6609f93c1f66527195acd75bf72a841915b337858d65a172f43` | 31,490 | 2,631 | PASS |
| `GB.zip` | https://download.geonames.org/export/dump/GB.zip | 3,639,180 | `eefc08df408aa4c3218151b5d9ca73768555fafac676a2ce5d612e2007c1f32a` | 109,181 | 12,096 | PASS |
| `JP.zip` | https://download.geonames.org/export/dump/JP.zip | 4,959,247 | `f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58` | 103,762 | 4,899 | PASS |
| `BR.zip` | https://download.geonames.org/export/dump/BR.zip | 7,177,385 | `4a9ddffb465ccad219127146f0678087cfece414ca0240bee53a5ea6750eebd8` | 235,530 | 5,888 | PASS |
| `SG.zip` | https://download.geonames.org/export/dump/SG.zip | 69,019 | `7e18942c0241144089da0b9bea659c96fadc201573be9d25a02442eb7b7f09d8` | 1,979 | 171 | PASS |

**Totals:** 481,942 source records parsed; all 25,685 sample records were found by GeoNames ID and matched exactly across all 19 original fields. Missing sample IDs: **0**. Conflicting source fields: **0**. Ambiguous ID matches: **0**. Duplicate IDs in source archives: **0**. Malformed 19-field source rows: **0**.

| Country | Source rows | Sample rows | Exact 19-field matches |
|---|---:|---:|---:|
| KE | 31,490 | 2,631 | 2,631 |
| GB | 109,181 | 12,096 | 12,096 |
| JP | 103,762 | 4,899 | 4,899 |
| BR | 235,530 | 5,888 | 5,888 |
| SG | 1,979 | 171 | 171 |
| **Total** | **481,942** | **25,685** | **25,685** |

The duplicate `JP (1).zip` has 4,959,247 bytes and SHA-256 `f0e39e6f0df79934c69adc9e8ade4ab415f16d3e57840ea8580c3b9d32adfd58`, identical to `JP.zip`; it is a duplicate download.

### Method

The country data member was parsed as UTF-8 tab-separated text. Each sample row was matched against source records by `geonameid`; all 19 original fields were compared as exact decoded field strings. This is a sample-to-country-archive result, not a reproduction of the worldwide sample-generation run.

## 3. Administrative crosswalk reconciliation

The owner's full crosswalk files were inspected: `admin1CodesASCII.txt` contains **3,865 unique code keys** and `admin2Codes.txt` contains **47,642 unique code keys**.

The following row-by-row audit checks whether non-empty raw admin1/admin2 codes in the 25,685 sample rows have exact code keys in those files. The sample includes administrative features and populated-place/locality rows. This is a **reference-key existence check**, not a determination that every code has an authoritative meaning or that the entire place parent graph is correct.

| Country | Sample rows | Admin1 code present | Admin1 key found | Admin1 key missing | Admin2 code present | Admin2 key found | Admin2 key missing |
|---|---:|---:|---:|---:|---:|---:|---:|
| KE | 2,631 | 2,631 | 2,605 | 26 | 37 | 32 | 5 |
| GB | 12,096 | 12,095 | 12,092 | 3 | 12,033 | 12,004 | 29 |
| JP | 4,899 | 4,897 | 2,736 | 2,161 | 2,760 | 2,554 | 206 |
| BR | 5,888 | 5,888 | 5,887 | 1 | 5,855 | 5,855 | 0 |
| SG | 171 | 142 | 0 | 142 | 0 | 0 | 0 |
| **Total** | **25,685** | **25,653** | **23,320** | **2,333** | **20,685** | **20,445** | **240** |

Among admin2 references whose exact key was found, this audit found **0** cases where the admin1 key was missing. That narrow result does **not** prove a complete place hierarchy.

Unmatched admin1 raw-code counts from the row-level lookup:

| Country | Unmatched raw code values and counts |
|---|---|
| KE | `00: 1`, `01: 2`, `02: 8`, `03: 4`, `06: 1`, `07: 2`, `08: 6`, `09: 2` |
| GB | `00: 3` |
| JP | `00: 2,161` |
| BR | `00: 1` |
| SG | `00: 118`, `01: 4`, `02: 7`, `03: 7`, `04: 3`, `05: 3` |

### Required handling of unresolved codes

- **Placeholder/nonstandard candidates such as `00`:** preserve raw codes and source rows; require an owner-approved interpretation rule before mapping.
- **Unmatched nonzero codes:** treat as missing-reference or possible legacy/version-dependent candidates. No temporal evidence establishes that a given code is legacy, so do not label it as such without further evidence.
- **Missing crosswalk entries:** record as exceptions, not as automatic invalid-record rejections.
- **Unresolved parent links:** do not synthesize administrative records or parent IDs.
- **Same-name entities:** retain distinct GeoNames IDs and feature/admin context; never merge by name alone.

The existing sample `exceptions.csv` has 24 Singapore `admin1_crosswalk_not_found` rows. The broader exact-key lookup identified 142 sample rows with non-empty Singapore admin1 codes absent from the full admin1 crosswalk, including 118 `00` values and 24 code values in `01`–`05`. The individual-ID overlap between the prior 24-row exception list and these 142 code-reference misses has **not** been established; do not assume the sets are identical.

A durable per-record crosswalk-exception CSV/JSON has **not yet been persisted**. The aggregate counts above were computed by iterating each sample row, but the full exception rows still need to be exported for review and owner decisions.

## 4. Kenya candidate records

The five-country comparison confirms the source rows and original fields for these IDs:

| Candidate | GeoNames ID | Country / feature / admin1 | Source-row comparison | Handling |
|---|---:|---|---|---|
| Nairobi | 184745 | KE / PPLC / `05` | Exact match to `KE.zip` | Crosswalk candidate: Nairobi County ID 184742; continue full hierarchy review |
| Kisumu | 191245 | KE / PPLA / `26` | Exact match to `KE.zip` | Crosswalk candidate: Kisumu County ID 191242; continue full hierarchy review |
| Mombasa candidate | 186301 | KE / PPLA / `37` | Exact match to `KE.zip` | Crosswalk candidate: Mombasa County ID 186298; continue full hierarchy review |
| Mombasa same-name alternative | 186300 | KE / PPL / `27` | Exact match to `KE.zip` | Keep distinct; do not collapse by name |

Source-row matching confirms the IDs and values; it does not independently approve all parent-link rules.

## 5. Manifest timestamp semantics

The `last_modified_utc` field in the originally supplied sample manifest is populated from local filesystem `path.stat().st_mtime`, not an HTTP response header. The correct name is `local_file_mtime_utc`. Keep `http_last_modified_utc` null unless a real server header was captured. The original sample evidence ZIP remains unchanged.

## 6. Remaining blockers

1. Persist a row-level CSV/JSON for all unmatched admin1/admin2 references with GeoNames ID, feature code, country code, raw admin codes, and an exception classification.
2. Obtain owner decisions for `00`, unmatched nonzero codes, Singapore's absent admin1 crosswalk, and the policy for unresolved parents.
3. Independently reproduce the owner-reported **13,472,324-record** worldwide scan from pinned source bytes and parser/script version; the full `allCountries.zip` was not parsed in this task.
4. Obtain and compare a current owner-approved ISO authority snapshot.
5. Approve feature-code inclusion, selectability, and global hierarchy/exception policies.

**Conclusion:** the five-country sample-record comparison is **PASS**. Administrative hierarchy reconciliation is still incomplete, and catalog acceptance remains **BLOCKED**. PR #27 stays open, draft, and unmerged. No migrations, seeds, database imports, production/Cloudflare/secrets/backup/recovery changes were performed. Phase 4C recovery readiness remains separately **BLOCKED**.


## Reconciliation update — row-level exception exports persisted — 2026-10-10

This update supersedes the earlier statement in §3 that row-level exception exports had not yet been persisted and the earlier statement that the prior Singapore exception ID overlap had not been established.

The row-level CSV and JSON files are now present under `docs/geonames-sample-validation/results/crosswalk-reconciliation-20261010/`, alongside `summary.json`. The exports contain 2,333 admin1 references and 240 admin2 references. ID-set reconciliation reports 157 GeoNames IDs in both sets and 2,416 unique IDs in their union.

The previous 24 Singapore exception IDs have an exact **24/24 ID overlap** with the broader set of 142 Singapore admin1 misses; zero prior IDs are missing from the broader set, and 118 IDs are additional. The 142 records include 118 raw `00` values and 24 nonzero-code rows with raw values `01`–`05`. These remain unresolved pending owner-approved interpretation. Preserve original codes, do not automatically reject the rows, and do not fabricate administrative entities or parent links.

The exports close the row-level packaging gate only. Owner review, crosswalk policy decisions, source-pinned reproduction of the worldwide scan, current approved ISO comparison, global hierarchy decisions, and catalog acceptance remain outstanding. Phase 4C remains separately BLOCKED.


## Owner-computer scan repeat run — 2026-10-10

A second run of the original local `prepare_sample.py` finished in a separate output directory and reported 13,472,324 worldwide rows scanned, zero malformed rows and 25,685 selected rows. The input manifest records `allCountries.zip` at 422,010,093 bytes, SHA-256 `3b6ba297e83d5cd6717a41cfe72b6cd85d167b0d0ff06069b2c33d410d6abe15`, plus hashes for the country metadata, full crosswalks and readme. Detailed values appear in `docs/geonames-worldwide-scan-reproduction-2026-10-10.md/json`.

This is a repeated execution of the same implementation on the same computer, not an independent reproduction. Byte-for-byte comparison of the selected sample output files is NOT MEASURED. Full independent reproduction and worldwide completeness remain UNVERIFIED.

The source manifest’s `last_modified_utc` was populated from local filesystem `st_mtime`; it is not a captured HTTP header. Use the meaning `local_file_mtime_utc` and leave `http_last_modified_utc` null absent an actual response header. The original sample package was not altered.
