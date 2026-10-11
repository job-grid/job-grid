# GeoNames local input versus current official source recheck — 2026-10-11

**Result:** three of four small source files match the current official bytes exactly. The global `admin2Codes.txt` has one changed row outside the five-country sample scope; the sample's 6,977 selected admin2 row strings still match in content and order after line-ending normalization. This current fetch does not establish the exact historical download timestamp of the original local inputs.

## Source retrieval and hashes

Windows `curl.exe` fetched each file from its official HTTPS URL into a new local recheck folder. The source files themselves were not added to the repository.

| Input | Retrieved (UTC) | HTTP Last-Modified | Bytes | Current SHA-256 | Original hash match |
|---|---|---|---:|---|---|
| `countryInfo.txt` | 2026-10-11 14:58:07.876Z | Sun, 11 Oct 2026 03:06:52 GMT | 31,680 | `c5997ea659df5bcf42509eb937064d172b2a998bb873608603e8421d714a9974` | PASS |
| `admin1CodesASCII.txt` | 2026-10-11 14:58:12.066Z | Sun, 11 Oct 2026 03:00:13 GMT | 151,583 | `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a` | PASS |
| `admin2Codes.txt` | 2026-10-11 14:58:13.556Z | Sun, 11 Oct 2026 03:00:13 GMT | 2,366,370 | `eb276b1e444d67f45a396217acc9473bd1685f82e575c34f13ba94e42701639f` | **DIFFERS** |
| `readme.txt` | 2026-10-11 14:58:17.150Z | Sun, 11 Oct 2026 02:49:19 GMT | 8,843 | `b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5` | PASS |

The original local `admin2Codes.txt` was 2,366,368 bytes with SHA-256 `e1b500f4f0e13b3119ff15df84ce3c28982e899bb4183ee033f802a280c377d3`. Both old and current files contain 47,642 rows. A row-set comparison finds one removed line and one added line, both under country code `IR`; there are no other distinct row-content changes between the two versions.

## Five-country admin2 crosswalk scope

The current official source was filtered for the same five sample-country codes and compared row-by-row with the original `admin2Codes_sample.txt` after normalizing line endings.

| Country | Original sample rows | Current official rows |
|---|---:|---:|
| KE | 32 | 32 |
| GB | 185 | 185 |
| JP | 1,190 | 1,190 |
| BR | 5,570 | 5,570 |
| SG | 0 | 0 |
| **Total** | **6,977** | **6,977** |

All 6,977 current rows match the original row text in the same order. The initial helper-output byte hash differed because the helper wrote LF line endings while the original Windows-generated file uses CRLF; the file sizes differed by exactly one byte per line (6,977 bytes). An ordinal line-by-line comparison found no content or ordering differences. Do not treat that line-ending-only hash difference as changed source data.

## Interpretation and limitations

- The source SHA-256 hashes for `countryInfo`, `admin1CodesASCII`, and `readme` match the currently served official bytes exactly.
- The full admin2 file has advanced since the original local snapshot, but the one replaced row is under `IR`, outside the five-country sample scope. The 6,977 sampled admin2 rows are content- and order-identical.
- The independently captured Last-Modified and ETag values describe this recheck, not the earlier local downloads. The old local manifest timestamps are filesystem mtimes and remain not historical HTTP retrieval evidence.
- The `allCountries.zip` SHA-256 also matches the separate official-source GitHub Actions retrieval documented in the global source audit.
- This report does not establish worldwide catalog completeness, accept administrative parent links, complete the ISO comparison, or clear Phase 4C backup/restore readiness.

The aggregate report is available in [machine-readable JSON](geonames-input-source-recheck-2026-10-11.json). It contains source hashes/response metadata and row-level counts, not source archive contents.

No original inputs or sample files were changed; the recheck downloads are stored outside the repository. No database, migration, seed, import, production or deployment operation was performed.
