# GeoNames five-country sample validation report

**Disposition: BLOCKED FOR CATALOG ACCEPTANCE; READY FOR OWNER REVIEW OF SAMPLE EVIDENCE.**  
**Input artifact:** `JobGrid-GeoNames-Sample-20261010-163234.zip`  
**Local validation performed:** 2026-10-10  
**Scope:** sample artifact integrity and internal consistency; no database writes, imports, migrations, production changes or merge.

## 1. Artifact integrity and scope

- Uploaded ZIP size: **1,346,867 bytes**.
- SHA-256 of the uploaded ZIP: `feba409196d05d77e4a02e194c3223c2a1849231c8e80594934d9e99370ab4bf`.
- ZIP integrity test: **PASS** (all members readable; no ZIP CRC error).
- Members: 10, including parser `prepare_sample.py`, manifest, summary, selected place/country TSVs, admin1/admin2 crosswalk samples, attribution/readme and exceptions.
- The archive does **not** include the original `allCountries.zip`, countryInfo source, or full crosswalk files. The original source byte sizes/SHA-256 values in `source_manifest.json` were therefore inspected as declared metadata, not independently recomputed from original source bytes in this review.
- Manifest field `last_modified_utc` is generated from local filesystem `st_mtime` in `prepare_sample.py`, not an HTTP Last-Modified header. It should be renamed to `local_file_mtime_utc` unless HTTP headers are captured separately.
- GeoNames attribution and CC BY 4.0 notice are present.

## 2. Measured summary

The attached `summary.json` reports the scan of **13,472,324** worldwide rows, with **0** malformed 19-field rows. The selected five-country source populations reported by that script sum to **481,942** rows; the exported sample contains **25,685** unique selected place records.

Independent checks on the supplied output artifact confirmed:

| Check | Measured result |
|---|---:|
| Selected place rows (excluding header) | 25,685 |
| Distinct GeoNames IDs | 25,685 |
| Duplicate IDs in selected sample | 0 |
| Selected sample coordinates unparsable/out of range | 0 |
| Country metadata rows | 5 |
| Admin1 crosswalk sample rows | 125 |
| Admin2 crosswalk sample rows | 6,977 |
| Exception rows | 24 |
| Exception issue codes | 1 |
| Exception country | SG: 24; all other countries: 0 |

Per-country selected records (matches the supplied summary):

| Country | Source rows reported by scan | Administrative features selected | Populated-place records in source | Selected rows |
|---|---:|---:|---:|---:|
| Kenya (KE) | 31,490 | 2,424 | 6,957 | 2,631 |
| United Kingdom (GB) | 109,181 | 11,895 | 43,712 | 12,096 |
| Japan (JP) | 103,762 | 4,697 | 50,801 | 4,899 |
| Brazil (BR) | 235,530 | 5,676 | 72,392 | 5,888 |
| Singapore (SG) | 1,979 | 1 | 387 | 171 |
| **Total** | **481,942** | **24,693** | **174,249** | **25,685** |

The selected sample is intentionally biased toward all administrative features, up to 100 highest-population populated places and up to 100 deterministic reservoir-sampled populated places per country, plus name-priority matches. It is not a random or complete representation of all GeoNames records.

## 3. Singapore crosswalk exceptions

All 24 rows in `exceptions.csv` are `admin1_crosswalk_not_found` for `country_code=SG`; codes observed include `SG.01` through `SG.05`. I independently recalculated the same admin1 lookup against the included crosswalk sample and reproduced exactly **24** missing matches, all Singapore. No admin2 crosswalk exceptions are reported or reproduced.

**Classification:** source-model/crosswalk exceptions requiring review, not automatic invalid-place rejections. Preserve the original GeoNames IDs and admin codes. Do not fabricate an admin1 record or a parent relationship to make the crosswalk join succeed. Mark the administrative relationship unresolved/needs-review until an authoritative, appropriate Singapore geography source or approved mapping rule resolves it. Singapore's source model does not have to fit a conventional admin1 hierarchy.

## 4. Parser and mapping review

Positive findings:
- The parser preserves the 19 original GeoNames fields and adds a separate `sample_reason`; it preserves source IDs, country codes and admin1–admin4 codes.
- It checks for exactly 19 fields, missing IDs, duplicate IDs and coordinate parse/range errors while scanning.
- It only selects rows for the five requested country codes and explicitly records selection reasons.
- It does not construct city parents or perform a database import.
- Country numeric codes remain strings in the TSV: Brazil is `076`, not integer `76`.
- UK appears as GeoNames/ISO candidate alpha-2 `GB`, not `UK`.

Issues and caveats:
1. The script's source manifest labels local filesystem modification time as `last_modified_utc`; that is not verified server Last-Modified metadata.
2. The parser treats malformed/duplicate IDs and bad coordinates as exceptions but does not reject every such row from the selected sample by an explicit eligibility policy. For this run, reported selected-sample duplicate/coordinate issues are zero.
3. Admin crosswalk checks are performed only for selected populated places (feature class `P`), and parent links are not resolved. Crosswalk presence is not proof of a valid parent-child relationship.
4. Priority matching by name intentionally selects every same-name candidate, not only a unique target. Brazil produced 11 `Brasília` records across different IDs and administrative codes; retain these as separate source records and resolve target identity by source ID/context, not name alone.
5. Kenya produced two `Mombasa` name matches: GeoNames ID `186300` (feature `PPL`, admin1 `27`) and ID `186301` (feature `PPLA`, admin1 `37`). The latter's admin1 code matches the supplied crosswalk entry for Mombasa County (GeoNames ID `186298`); do not collapse the records solely because names match.
6. This review did not independently retrieve the original source files, validate the source hashes against the original bytes, or compare country codes against a separately obtained current ISO authority snapshot.

## 5. Source-ID checks

The sample contains these priority candidates:

| Place | GeoNames ID | Feature | Country/admin codes | Result |
|---|---:|---|---|---|
| Nairobi | 184745 | PPLC | KE / admin1 05 | ID present; admin1 code matches Nairobi County crosswalk ID 184742 |
| Kisumu | 191245 | PPLA | KE / admin1 26 | ID present; admin1 code matches Kisumu County crosswalk ID 191242 |
| Mombasa candidate | 186301 | PPLA | KE / admin1 37 | ID present; admin1 code matches Mombasa County crosswalk ID 186298 |
| London | 2643743 | PPLC | GB / admin1 ENG / admin2 GLA | Sample candidate present; not a complete hierarchy audit |
| Tokyo | 1850147 | PPLC | JP / admin1 40 | Sample candidate present; not a complete hierarchy audit |
| Brasília capital candidate | 3469058 | PPLC | BR / admin1 07 / admin2 5300108 | Sample candidate present; other same-name records remain distinct |
| Singapore | 1880252 | PPLC | SG / admin codes blank | Sample candidate present; no synthetic parent required |

The other Mombasa and Brasília name matches are retained; canonical selection requires source ID plus feature/admin context and, where necessary, owner-reviewed mapping rules.

## 6. Recommendation and next steps

1. Accept the 24 Singapore entries as **unresolved crosswalk exceptions**, not invalid geographic records.
2. Keep all original IDs and codes. Do not synthesize Singapore admin1 entries or city parents.
3. Amend the manifest timestamp field and add regression tests that lock in the 24-SG-only exception classification and the Kenya ID/admin-code checks.
4. Before catalog acceptance, validate original source SHA-256 values using the original files or trusted captured download metadata; obtain and record an approved current ISO source snapshot; formalize feature-code inclusion and relationship eligibility rules.
5. Keep this a sample validation only. No database migrations/imports were performed. No production or Cloudflare changes were made. PR #27 must remain unmerged pending owner approval. Phase 4C recovery readiness remains BLOCKED until its independent prerequisites are approved and verified.

GeoNames data is licensed under CC BY 4.0 and supplied without a guarantee of accuracy, timeliness or completeness. This five-country sample does not establish worldwide completeness or legal/geopolitical status.
