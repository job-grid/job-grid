# Independent worldwide GeoNames verification — 2026-10-10

**Status:** PASS for separate implementation scan and sample-record reconciliation; source-origin verification, ISO comparison, hierarchy approval and catalog acceptance remain open.

## 1. Scope and method

A separately authored PowerShell/.NET streaming verifier was executed on the owner-connected Windows computer against the existing local GeoNames `allCountries.zip` and the original sample package. This verifier did not reuse `prepare_sample.py`. It opened the archive read-only, counted every row in `allCountries.txt`, validated the 19-field shape, and independently matched the existing 25,685-row sample to the worldwide archive by GeoNames ID, comparing all 19 original source fields as exact decoded strings.

The verifier also recalculated byte sizes and SHA-256 hashes for the five local GeoNames inputs using PowerShell `Get-FileHash`, then compared the original and repeat-run sample outputs by byte size and SHA-256.

Local evidence files on the owner computer:
- Verifier: `C:\Users\jonat\OneDrive\Desktop\JobGrid-GeoNames\independent_verify_20261010.ps1`
- Machine-readable summary: `C:\Users\jonat\OneDrive\Desktop\JobGrid-GeoNames\independent-reproduction-20261010-run2\independent-reproduction-summary.json`
- Run log: `C:\Users\jonat\OneDrive\Desktop\JobGrid-GeoNames\independent-verification-run.log`

The repository report contains aggregate measurements only and does not contain an ISO snapshot or ISO row-level code content.

## 2. Worldwide scan and sample comparison

| Measure | Independently measured result |
|---|---:|
| Worldwide rows scanned | 13,472,324 |
| Malformed worldwide rows | 0 |
| Source records across the five sample-country archives | 481,942 |
| Duplicate GeoNames IDs across selected-country source records | 0 |
| Invalid coordinates across selected-country source records | 0 |
| Existing sample rows reconciled to the worldwide archive | 25,685 |
| Sample IDs found in the worldwide archive | 25,685 |
| Exact matches across all 19 original fields | 25,685 |
| Missing sample IDs | 0 |
| Field-conflicting sample records | 0 |
| Duplicate source hits for sample IDs | 0 |

This is meaningful independent implementation evidence: the full local archive was scanned by a separate PowerShell/.NET implementation, and the extant sample records were compared against the full worldwide data member rather than only against the five country ZIPs.

### Per-country counts

| Country archive | Source rows | Existing sample rows | Exact 19-field matches |
|---|---:|---:|---:|
| KE | 31,490 | 2,631 | 2,631 |
| GB | 109,181 | 12,096 | 12,096 |
| JP | 103,762 | 4,899 | 4,899 |
| BR | 235,530 | 5,888 | 5,888 |
| SG | 1,979 | 171 | 171 |
| **Total** | **481,942** | **25,685** | **25,685** |

## 3. Independently recalculated source manifest

The five byte sizes and SHA-256 hashes were recalculated locally using a separate PowerShell command and match the values in the previous local manifest.

| Input | Bytes | SHA-256 |
|---|---:|---|
| `allCountries.zip` | 422,010,093 | `3b6ba297e83d5cd6717a41cfe72b6cd85d167b0d0ff06069b2c33d410d6abe15` |
| `countryInfo.txt.txt` | 31,680 | `c5997ea659df5bcf42509eb937064d172b2a998bb873608603e8421d714a9974` |
| `admin1CodesASCII.txt` | 151,583 | `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a` |
| `admin2Codes.txt` | 2,366,368 | `e1b500f4f0e13b3119ff15df84ce3c28982e899bb4183ee033f802a280c377d3` |
| `readme.txt` | 8,843 | `b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5` |

This confirms local byte-level consistency with the earlier manifest. It **does not independently prove** that the files were obtained directly from the official URLs at a particular time: the official URLs were not re-fetched during this verification, no remote HTTP `Last-Modified` headers were recorded, and exact remote retrieval timestamps remain unavailable. Do not treat local filesystem modification times as server timestamps.

## 4. Original sample versus the repeat-run outputs

Seven original/repeat output files were compared using file byte sizes and independently computed SHA-256 values. All seven are byte-identical:

| Output file | Bytes | Comparison |
|---|---:|---|
| `geonames_places_sample.tsv` | 4,626,293 | PASS |
| `countryInfo_sample.tsv` | 1,008 | PASS |
| `admin1CodesASCII_sample.txt` | 4,507 | PASS |
| `admin2Codes_sample.txt` | 338,166 | PASS |
| `exceptions.csv` | 1,690 | PASS |
| `ATTRIBUTION.txt` | 387 | PASS |
| `geonames_readme_source.txt` | 8,843 | PASS |

The seven matches establish byte-for-byte output identity between the original and repeat outputs from the same `prepare_sample.py` implementation. They are a repeatability measurement, **not** an independent reimplementation of the sample-selection algorithm.

## 5. Updated disposition

- **PASS:** A separately authored PowerShell/.NET implementation scanned the full local worldwide archive and independently validated the existing sample records against the archive.
- **PASS:** All five local GeoNames input hashes and byte sizes were recalculated and matched their prior manifest values.
- **PASS:** Seven original/repeat sample-output and attribution files were byte-identical.
- **NOT VERIFIED:** Official-source origin and exact remote retrieval timestamps; HTTP `Last-Modified` remains null unless a real response header is captured.
- **NOT PERFORMED:** A fresh independent implementation of the sample-selection algorithm.
- **UNVERIFIED:** Current ISO 3166 authority comparison and worldwide geographic completeness.
- **BLOCKED:** Country-catalog acceptance, unresolved crosswalk interpretations and parent-hierarchy decisions remain. Preserve raw IDs/codes; do not infer missing parents or accept unresolved references automatically.
- **SEPARATELY BLOCKED:** Phase 4C recovery readiness.

PR #27 remains open, draft and unmerged. These read-only checks changed no source archive, database, production environment, secrets, Cloudflare configuration, deployment or backup/recovery system.
