# Independent GeoNames five-country archive verification — 2026-10-10

**Disposition: BLOCKED — required official country archives are not present in the checked owner input directory.**  
**PR:** #27, documentation/catalog design only.  
**No downloads of the worldwide archive were started; the local worldwide archive was not opened or parsed for this task.**

## 1. Scope and evidence stages

- **Stage A — owner-laptop sample generation and uploaded-artifact inspection:** Previously completed for the supplied `JobGrid-GeoNames-Sample-20261010-163234.zip`. The uploaded sample ZIP passed its integrity test; its extracted sample contained 25,685 place rows and 25,685 distinct GeoNames IDs, with no duplicate IDs or invalid sample coordinates in that output. All 24 listed `admin1_crosswalk_not_found` exceptions were Singapore (SG). These checks describe the supplied sample only.
- **Stage B — original official country-archive comparison:** Not completed. This task requires independent comparisons against `KE.zip`, `GB.zip`, `JP.zip`, `BR.zip`, and `SG.zip`. The local source directory did not contain those archives, so no archive checksums, ZIP tests, record parsing or ID/field comparisons were possible.

The owner's source manifest inside the supplied sample package lists a local `allCountries.zip` and associated source metadata, and the connected computer has a worldwide archive at `C:\Users\jonat\Downloads\allCountries.zip` and in the sample source folder. This is not a substitute for the five specific official country ZIPs requested for Stage B. The worldwide archive was intentionally not opened or parsed, and no worldwide download was initiated.

## 2. Input discovery

The following directories were inspected read-only on the owner's connected Windows computer:

- `C:\Users\jonat\OneDrive\Desktop\JobGrid-GeoNames`
- `C:\Users\jonat\Downloads`

The sample source folder contains `allCountries.zip`, `countryInfo.txt.txt`, `admin1CodesASCII.txt`, `admin2Codes.txt`, `readme.txt`, the generated sample ZIP and `sample-output-20261010-163234`. Neither checked directory listing contained any of the five country archives `KE.zip`, `GB.zip`, `JP.zip`, `BR.zip`, or `SG.zip`. This was a file-presence check only. Official URLs were not re-downloaded during this task.

## 3. Per-archive verification status

| Archive | Official source URL | Retrieved at (UTC) | Bytes | SHA-256 | ZIP integrity | Source rows parsed | Matched sample IDs | Missing sample IDs | Conflicting records | Ambiguous matches |
|---|---|---|---:|---|---|---:|---:|---:|---:|---:|
| KE.zip | https://download.geonames.org/export/dump/KE.zip | NOT RETRIEVED | NOT MEASURED | NOT MEASURED | NOT RUN | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| GB.zip | https://download.geonames.org/export/dump/GB.zip | NOT RETRIEVED | NOT MEASURED | NOT MEASURED | NOT RUN | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| JP.zip | https://download.geonames.org/export/dump/JP.zip | NOT RETRIEVED | NOT MEASURED | NOT MEASURED | NOT RUN | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| BR.zip | https://download.geonames.org/export/dump/BR.zip | NOT RETRIEVED | NOT MEASURED | NOT MEASURED | NOT RUN | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| SG.zip | https://download.geonames.org/export/dump/SG.zip | NOT RETRIEVED | NOT MEASURED | NOT MEASURED | NOT RUN | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED | NOT MEASURED |

**Actual Stage B totals:** official country archives present in checked input directory = 0 of 5; archives parsed = 0 of 5; source records compared = 0. Matched, missing, conflicting and ambiguous sample-record counts are **NOT MEASURED**, not zero, because no source records were available to compare.

## 4. Kenya candidates — sample-only observations, source verification pending

These values are retained from the earlier sample/crosswalk inspection and must not be described as matching the original `KE.zip`:

| Candidate | Sample GeoNames ID | Sample feature / country / admin1 | Included sample crosswalk reference | Stage B source result |
|---|---:|---|---|---|
| Nairobi | 184745 | PPLC / KE / `05` | Nairobi County ID 184742 | NOT VERIFIED — KE.zip absent |
| Kisumu | 191245 | PPLA / KE / `26` | Kisumu County ID 191242 | NOT VERIFIED — KE.zip absent |
| Mombasa candidate | 186301 | PPLA / KE / `37` | Mombasa County ID 186298 | NOT VERIFIED — KE.zip absent |
| Mombasa same-name alternative | 186300 | PPL / KE / `27` | Do not collapse by name | NOT VERIFIED — KE.zip absent |

When the official archive is supplied, compare GeoNames IDs and all 19 original fields byte/field-wise after documented text decoding; record matching rows and field-level conflicts. Use administrative codes and crosswalk identifiers for relationship review, not names alone. Do not infer a complete parent hierarchy from a matching admin code.

## 5. Singapore exceptions

The sample still contains 24 `admin1_crosswalk_not_found` exceptions, all for Singapore. Stage B could not test them against `SG.zip` because that archive was absent. Keep all 24 unresolved; do not reject records automatically, fabricate admin rows, or create parent links. Preserve source GeoNames IDs and administrative codes until a source-supported mapping establishes the relationship.

## 6. Manifest timestamp correction

The owner-supplied sample package's `source_manifest.json` uses the field `last_modified_utc`. Inspection of `prepare_sample.py` shows that value is calculated using Python `path.stat().st_mtime`, i.e. local filesystem modification time. It is **not** an HTTP `Last-Modified` response header.

The corrected field semantics are:
- Rename the existing value to `local_file_mtime_utc`.
- Use a separate `http_last_modified_utc` field only when a server actually supplied and the process recorded that header; otherwise it must remain null/not captured.
- Do not rewrite the historical evidence silently: this report and the repository's source manifest record the correction. The original uploaded evidence package has been retained unchanged.

## 7. Exact remaining blockers and next step

1. Provide the five official country ZIPs (`KE.zip`, `GB.zip`, `JP.zip`, `BR.zip`, `SG.zip`) in an approved transfer location. Do not provide or download the worldwide archive again for this step.
2. For each provided archive, record transfer/retrieval provenance, actual byte size and SHA-256; run ZIP integrity checks; parse its single expected text member and count rows/invalid rows/duplicate IDs.
3. Compare selected sample rows to source records by GeoNames ID, preserve all 19 fields, and report matched, source-missing, conflicting and ambiguous cases with row-level exception output.
4. Complete Nairobi, Kisumu and both Mombasa-candidate reviews against `KE.zip` using IDs/admin codes. Keep name-colliding records distinct.
5. Test the 24 Singapore exceptions against `SG.zip` plus appropriate source-model/crosswalk evidence without forcing a match.
6. Continue to require a current approved ISO authority snapshot and complete parent-reconciliation review before catalog acceptance.

**Recommendation:** **BLOCKED FOR INDEPENDENT SOURCE VERIFICATION** until the five official country ZIPs are provided. The prior sample evidence remains **READY FOR OWNER REVIEW**, but this report does not claim Stage B completion, a full-world scan reproduction, worldwide completeness, or production readiness.

PR #27 remains open, draft and unmerged. No migrations, seeds, database imports, production/Cloudflare/secrets/backup/recovery changes were performed. Phase 4C recovery readiness remains separately **BLOCKED**.
