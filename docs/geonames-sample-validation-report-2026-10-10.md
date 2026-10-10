# GeoNames five-country sample validation report

**Disposition: READY FOR OWNER REVIEW OF SAMPLE EVIDENCE; BLOCKED FOR CATALOG ACCEPTANCE.**  
**Input artifact:** `JobGrid-GeoNames-Sample-20261010-163234.zip`  
**Builder inspection date:** 2026-10-10  
**Scope:** uploaded sample artifact and internal consistency; no database writes/imports/migrations, production changes or merge.

## Validation stages — keep separate

### Stage A — Owner-laptop sample generation and artifact inspection

The owner reports running a local script against original `allCountries.zip`. The owner's local script reports **13,472,324 worldwide records scanned**, zero malformed 19-field rows, and a sample package of **25,685 selected geographic records**. The worldwide scan count and malformed-row count are attributed to the owner-local run; the isolated builder did **not** independently reproduce the full scan.

The uploaded sample ZIP was then inspected independently by the builder. The following results concern that **uploaded package and its extracted files**, not the original full GeoNames files.

## 1. Uploaded artifact integrity and limits

- ZIP size: **1,346,867 bytes**.
- Uploaded ZIP SHA-256: `feba409196d05d77e4a02e194c3223c2a1849231c8e80594934d9e99370ab4bf`.
- ZIP member integrity check: **PASS**.
- Contains 10 members, including `prepare_sample.py`, manifest/summary, selected place/country TSVs, crosswalk samples, exceptions and attribution/readme.
- Does **not** contain the original `allCountries.zip`, original `countryInfo`, or original full crosswalk sources. SHA-256 and byte-size entries declared for those originals in the sample manifest were not independently recomputed against original bytes.
- The sample manifest field `last_modified_utc` is produced from local filesystem `st_mtime`, not an HTTP `Last-Modified` header. Rename to `local_file_mtime_utc` or retain a separate field for server-provided metadata.
- GeoNames attribution and CC BY 4.0 notice are present.

The sample ZIP hash verifies only the package received for inspection. It does not prove source archive provenance or independently pin the original inputs.

## 2. Measured inspection of the extracted sample

| Check | Result | Scope |
|---|---:|---|
| Selected place rows, excluding header | 25,685 | Extracted sample |
| Distinct GeoNames IDs | 25,685 | Extracted sample |
| Duplicate IDs | 0 | Extracted sample |
| Invalid/unparsable/out-of-range coordinates | 0 | Extracted sample |
| Country metadata rows | 5 | Included sample |
| Admin1 crosswalk rows | 125 | Included sample |
| Admin2 crosswalk rows | 6,977 | Included sample |
| Exception rows | 24 | Included sample |
| Exception reason codes | 1 | Included sample |
| `admin1_crosswalk_not_found` by country | SG: 24; other countries: 0 | Included sample |

The accompanying summary reports **481,942 source rows across the five selected countries** before selection and these per-country figures. These counts are the owner-local script's reported outputs inspected in the package, not a separate independent scan by the builder.

| Country | Source rows reported by owner-local script | Administrative features selected | Populated-place records reported in source | Selected rows in sample |
|---|---:|---:|---:|---:|
| Kenya (KE) | 31,490 | 2,424 | 6,957 | 2,631 |
| United Kingdom (GB) | 109,181 | 11,895 | 43,712 | 12,096 |
| Japan (JP) | 103,762 | 4,697 | 50,801 | 4,899 |
| Brazil (BR) | 235,530 | 5,676 | 72,392 | 5,888 |
| Singapore (SG) | 1,979 | 1 | 387 | 171 |
| **Total** | **481,942** | **24,693** | **174,249** | **25,685** |

The selection is biased toward administrative features, up to 100 high-population populated places and up to 100 deterministic reservoir-sampled places per country, plus priority-name matches. It is not random, complete, or evidence of worldwide completeness.

## 3. Singapore crosswalk exceptions

All 24 entries in `exceptions.csv` use `admin1_crosswalk_not_found` and `country_code=SG`; code examples range from `SG.01` to `SG.05`. The builder independently repeated the admin1 lookup against the **included sample crosswalk** and reproduced the same 24 Singapore-only misses. No admin2 misses are present/reproduced in the included sample.

**Classification:** unresolved source-model/crosswalk exceptions requiring review, **not automatic invalid-record rejections**. Preserve original IDs and administrative codes. Do not fabricate an admin1 row, synthesize a parent relationship, or reject a geographic record solely because Singapore does not fit the conventional crosswalk model. Keep the relationship unresolved/needs-review until an appropriate authority or approved mapping rule resolves it. These checks do not use the original full crosswalk source.

## 4. Parser and mapping review

Observed positive behaviors:
- Preserves the 19 original GeoNames fields and stores `sample_reason` separately.
- Preserves source IDs, country codes and admin1–admin4 codes.
- Checks 19-field row shape, missing IDs, duplicate IDs and coordinate parsing/ranges.
- Selects only the five requested country codes and records selection reasons.
- Does not invent parents or perform a database import.
- Preserves Brazil's numeric code `076` as text and uses `GB` for the United Kingdom.

Caveats:
1. The timestamp named `last_modified_utc` comes from local filesystem mtime, not verified server metadata.
2. The sample run's zero duplicate/coordinate anomalies are measured for selected output; they do not demonstrate that every source row is eligible or correct.
3. Crosswalk checks cover selected populated places and are not parent-hierarchy validation. Presence in a crosswalk does not establish the full parent-child path.
4. Priority matching intentionally retains same-name candidates. There are 11 Brasília name matches across source IDs and admin codes; do not collapse by name.
5. Two Mombasa candidates remain distinct: ID `186300` (PPL, admin1 `27`) and ID `186301` (PPLA, admin1 `37`). The latter's code matches a supplied sample crosswalk entry for Mombasa County ID `186298`; this is a candidate match, not proof of a complete hierarchy.
6. The builder did not retrieve the original source files, verify original-source hashes, independently rescan the full input, or obtain a current approved ISO authority snapshot.

## 5. Source-ID spot checks within the uploaded sample

| Place candidate | GeoNames ID | Feature | Country/admin codes | Sample observation |
|---|---:|---|---|---|
| Nairobi | 184745 | PPLC | KE / admin1 05 | ID present; code matches sample Nairobi County crosswalk ID 184742 |
| Kisumu | 191245 | PPLA | KE / admin1 26 | ID present; code matches sample Kisumu County crosswalk ID 191242 |
| Mombasa candidate | 186301 | PPLA | KE / admin1 37 | ID present; code matches sample Mombasa County crosswalk ID 186298 |
| London | 2643743 | PPLC | GB / admin1 ENG / admin2 GLA | Candidate present; not full hierarchy validation |
| Tokyo | 1850147 | PPLC | JP / admin1 40 | Candidate present; not full hierarchy validation |
| Brasília capital candidate | 3469058 | PPLC | BR / admin1 07 / admin2 5300108 | Candidate present; same-name records remain distinct |
| Singapore | 1880252 | PPLC | SG / admin codes blank | Candidate present; no synthetic parent required |

Names alone must not resolve identity. Retain GeoNames IDs and feature/admin context; leave uncertain relationships unresolved.

## Stage B — Independent source-pinned reproducibility remains incomplete

The separate isolated builder environment attempted nine official GeoNames URLs: the KE, GB, JP, BR and SG archives, `countryInfo.txt`, `admin1CodesASCII.txt`, `admin2Codes.txt`, and `readme.txt`. All retrieval attempts failed with DNS resolution errors. The failures are recorded in `docs/geonames-sample-validation/source-manifest.json` and `docs/geonames-sample-validation/results/validation-report.json`; they accurately describe **builder-side retrieval**, not the owner-laptop sample generation.

The following are still not independently verified:
1. Original-source SHA-256 values and byte sizes against the original bytes.
2. The owner's reported 13,472,324-record scan and zero malformed-row count.
3. Reproduction of the sample selection from the source-pinned original input and matching script version.
4. Comparison against a separately obtained, current, owner-approved ISO authority snapshot.
5. Complete parent hierarchy and source relationship reconciliation.

No-source counts remain unavailable in the isolated builder manifest/report; they must not be interpreted as zero. The package-level integrity PASS is not a source archive checksum verification.

## 6. Exact acceptance blockers and recommendation

**READY FOR OWNER REVIEW OF SAMPLE EVIDENCE:** ZIP integrity passed; extracted sample IDs and coordinates passed the listed basic checks; the 24 SG admin1 crosswalk misses were reproduced against the included sample crosswalk and explicitly classified as unresolved exceptions. Preserve original IDs/codes and do not invent parents.

**BLOCKED FOR CATALOG ACCEPTANCE** until all of the following are addressed:
- Provide original source files or independently trustworthy source-pinned snapshots; verify their exact checksums and byte sizes.
- Reproduce the owner-local full scan and sample selection from pinned original inputs, with parser/version/input hashes recorded.
- Obtain and record an approved current ISO authority snapshot and compare candidate fields.
- Have the owner approve feature-code inclusion, selectability and exception policies.
- Resolve or explicitly classify hierarchy links from source IDs and approved geographic authorities; report unresolved parent relationships rather than inferring them from names/crosswalk presence.
- Correct or clarify the manifest time field so local mtime is not presented as server Last-Modified metadata.

No database operations, migrations, seeds, imports, production/Cloudflare/secrets/backup/recovery changes, or PR merge were performed. PR #27 remains open, draft, and unmerged. Phase 4C recovery readiness remains separately **BLOCKED**.

GeoNames is supplied under CC BY 4.0 and without a guarantee of accuracy, timeliness or completeness. This five-country sample establishes neither worldwide completeness nor production readiness.
