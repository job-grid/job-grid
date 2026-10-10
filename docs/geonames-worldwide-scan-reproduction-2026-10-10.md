# Worldwide GeoNames scan repeat-run evidence — 2026-10-10

**Disposition: SAME-OWNER-COMPUTER COUNTS REPRODUCED; INDEPENDENT REPRODUCTION AND CATALOG ACCEPTANCE REMAIN BLOCKED.**

## What was run

On 2026-10-10, the original owner-computer `prepare_sample.py` was run again against the existing local GeoNames source files, with output written to a separate folder named `reproduction-run-20261010-1807`. The prior sample output directory was not used as the output target.

The run completed at `2026-10-10T18:23:24.870125Z` and reported:

| Measure | Repeat-run result |
|---|---:|
| Worldwide rows scanned from `allCountries.txt` | 13,472,324 |
| Malformed worldwide rows | 0 |
| Selected sample records | 25,685 |
| Duplicate IDs within the five selected country scans | 0 |
| Invalid coordinates in selected-country source records | 0 |
| Country metadata rows selected | 5 |
| Admin1 crosswalk rows in the sample | 125 |
| Admin2 crosswalk rows in the sample | 6,977 |
| Unmatched admin1 references in the sample | 24 |
| Unmatched admin2 references in the sample | 0 |
| Five-country archive source rows (reported by the separate comparison) | 481,942 |
| Sample rows previously reported exact by ID + all 19 fields against country archives | 25,685 |

The repeat run's primary counts match the prior owner-computer run. It is a second execution of the **same script on the same computer with the same local input files**, so it is a repeatability check, not an independent implementation or cross-platform verification. A byte-for-byte comparison of the selected sample output files against the prior run was not measured and must not be claimed.

## Source files and checksums recorded by this run

| Input | Bytes | SHA-256 |
|---|---:|---|
| `allCountries.zip` | 422,010,093 | `3b6ba297e83d5cd6717a41cfe72b6cd85d167b0d0ff06069b2c33d410d6abe15` |
| `countryInfo.txt.txt` | 31,680 | `c5997ea659df5bcf42509eb937064d172b2a998bb873608603e8421d714a9974` |
| `admin1CodesASCII.txt` | 151,583 | `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a` |
| `admin2Codes.txt` | 2,366,368 | `e1b500f4f0e13b3119ff15df84ce3c28982e899bb4183ee033f802a280c377d3` |
| `readme.txt` | 8,843 | `b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5` |

These are SHA-256 values produced by the owner-computer script from the local files during this run. Independent verification of the original-source hashes remains outstanding.

**Timestamp caveat:** the script writes filesystem `st_mtime` into a field named `last_modified_utc`. Those values are local filesystem metadata, not verified server HTTP `Last-Modified` headers. Treat them only as `local_file_mtime_utc`; `http_last_modified_utc` remains null unless a response header is captured. The original sample package was not rewritten to mask this issue.

## Per-country counts from the repeated scan

| Country | Source rows | Admin features | Populated places | Other features | Priority-name matches | Selected sample rows |
|---|---:|---:|---:|---:|---:|---:|
| Kenya (KE) | 31,490 | 2,424 | 6,957 | 22,109 | 14 | 2,631 |
| United Kingdom (GB) | 109,181 | 11,895 | 43,712 | 53,574 | 2 | 12,096 |
| Japan (JP) | 103,762 | 4,697 | 50,801 | 48,264 | 3 | 4,899 |
| Brazil (BR) | 235,530 | 5,676 | 72,392 | 157,462 | 14 | 5,888 |
| Singapore (SG) | 1,979 | 1 | 387 | 1,591 | 1 | 171 |
| **Total** | **481,942** | — | — | — | **34** | **25,685** |

The 24 admin1 exceptions remain Singapore cases. This repeat run does not approve an administrative representation or parent hierarchy.

## Next acceptance gates

1. Run the full-source scan using a separate implementation or independently controlled runtime against pinned input hashes.
2. Compare the fresh selected sample and relevant output files byte-for-byte (or compare canonical parsed records and emit a diff); this has not yet been done.
3. Obtain owner approval for a current ISO authority snapshot. Candidate official source: [ISO 3166 Maintenance Agency / Online Browsing Platform information](https://committee.iso.org/iso-3166-country-codes.html). ISO says the Online Browsing Platform is the up-to-date source; its [ISO 3166-1:2020 standard page](https://www.iso.org/standard/72482.html) says the edition was reviewed and confirmed in 2025 and remains current. No ISO snapshot has been downloaded, hashed, owner-approved or compared in this run.
4. Resolve crosswalk and parent-hierarchy decisions without inventing records or links.

**Current status:** same-owner-computer repeat counts matched; independent worldwide reproduction UNVERIFIED; current owner-approved ISO comparison UNVERIFIED; worldwide completeness UNVERIFIED; catalog acceptance BLOCKED; Phase 4C separately BLOCKED.

## Follow-up: independent PowerShell/.NET verification — 2026-10-10

This section supersedes the earlier pending-status statements above where they said that a separate implementation scan or the output-byte comparison had not been measured.

A separately authored PowerShell/.NET streaming verifier ran against the existing local `allCountries.zip` and compared the original selected sample against the full `allCountries.txt` member. It measured **13,472,324** worldwide rows, **0** malformed worldwide rows, and **25,685/25,685** sample records exactly matching by GeoNames ID and all 19 original fields. Missing sample IDs, field conflicts and duplicate source hits were all **0**.

The verifier independently recalculated local input-file sizes and SHA-256 values and found that they match the existing manifest. Seven original/repeat output and attribution files were also compared byte-for-byte; **7/7 were identical**. Full per-file details appear in [the independent verification report](geonames-worldwide-independent-verification-2026-10-10.md) and its [machine-readable summary](geonames-worldwide-independent-verification-2026-10-10.json).

**Remaining limits:** the official GeoNames URLs were not re-fetched for this follow-up; no HTTP `Last-Modified` headers or exact remote retrieval timestamps were captured; the sample-selection algorithm itself was not independently reimplemented; worldwide geographic completeness is not established. The ISO snapshot is still not captured or compared. Parent-hierarchy and crosswalk policy decisions remain open, so **catalog acceptance remains BLOCKED**. Phase 4C recovery readiness remains separately BLOCKED.

No source archive, database, production configuration, secrets, Cloudflare settings, deployment or recovery system was changed.
