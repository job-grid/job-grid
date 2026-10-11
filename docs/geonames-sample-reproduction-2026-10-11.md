# GeoNames sample-selection reproduction — 2026-10-11

**Result: same-script reproduction PASS; independent second implementation remains outstanding.** This was a read-only source-data validation run. It did not import data into any database or change production systems.

## Source inputs verified

The original script was recovered from the owner computer under `JobGrid-GeoNames/sample-output-20261010-163234/prepare_sample.py`. The input files are in the adjacent `JobGrid-GeoNames` folder. SHA-256 values were recalculated with Windows `Get-FileHash` and match all five hashes in the original `source_manifest.json`.

| Input | Bytes | SHA-256 |
|---|---:|---|
| `allCountries.zip` | 422,010,093 | `3b6ba297e83d5cd6717a41cfe72b6cd85d167b0d0ff06069b2c33d410d6abe15` |
| `countryInfo.txt.txt` | 31,680 | `c5997ea659df5bcf42509eb937064d172b2a998bb873608603e8421d714a9974` |
| `admin1CodesASCII.txt` | 151,583 | `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a` |
| `admin2Codes.txt` | 2,366,368 | `e1b500f4f0e13b3119ff15df84ce3c28982e899bb4183ee033f802a280c377d3` |
| `readme.txt` | 8,843 | `b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5` |

The `allCountries.zip` SHA-256 matches the archive hash independently recorded by the official-source GitHub Actions audit. The other four inputs match the original local manifest; the manifest by itself does not establish their original HTTP retrieval headers or source retrieval time.

## Reproduction procedure and results

The recovered `prepare_sample.py` was run against those inputs with output directed to a new folder, `reproduction-run-20261011-next`. The original output folder and the original sample ZIP were left unchanged.

| Measure | Original summary | Reproduction |
|---|---:|---:|
| Worldwide source rows scanned | 13,472,324 | 13,472,324 |
| Malformed worldwide rows | 0 | 0 |
| Selected sample rows | 25,685 | 25,685 |
| Country metadata rows | 5 | 5 |
| Admin1 sample crosswalk rows | 125 | 125 |
| Admin2 sample crosswalk rows | 6,977 | 6,977 |
| Unmatched sample admin1 references | 24 | 24 |
| Unmatched sample admin2 references | 0 | 0 |
| Duplicate IDs / invalid coordinates | 0 / 0 | 0 / 0 |

Reproduced sample rows by country: KE 2,631; GB 12,096; JP 4,899; BR 5,888; SG 171. The 24 admin1 exceptions are Singapore cases and remain exceptions; this report does not reclassify or repair them.

## Byte-for-byte artifact comparison

Seven deterministic generated files were compared by SHA-256 against the original output folder. All seven matched exactly.

| File | SHA-256 | Match |
|---|---|---|
| `geonames_places_sample.tsv` | `1932181885967f3079dfefd5d16b4df4c00b6e62e4213bede7aa49bfc44ab9ad` | PASS |
| `countryInfo_sample.tsv` | `8e7628dfa838afc74f93483dbb8b9c281e2fa77b3129367a8096e6ac130e8dd2` | PASS |
| `admin1CodesASCII_sample.txt` | `3a0aa67fc25787dd97216b4ca64089d0c887127f5db45affae59508dba5ca5d0` | PASS |
| `admin2Codes_sample.txt` | `6d735fc9f9d245f3236964794b60c66f17c49b50279493266d49653d2fa8504` | PASS |
| `exceptions.csv` | `59ff1367c89c90c032b0fe1e447149d51de3a3ff95ec67e3ab76ad1c63970018` | PASS |
| `ATTRIBUTION.txt` | `545396a1d12390886a242d8e2a19415da92e261ada3b5cc34c14d07446488a16` | PASS |
| `geonames_readme_source.txt` | `b1957379b6c1242c700c98ac9a8aa0a09f56c3c0a50ee72175527005f48ef2c5` | PASS |

The owner-supplied ZIP `JobGrid-GeoNames-Sample-20261010-163234.zip` has SHA-256 `feba409196d05d77e4a02e194c3223c2a1849231c8e80594934d9e99370ab4bf`. Its ten members—including the script, both timestamp-bearing JSON reports, and the seven generated files above—were verified to match the original extracted output folder. The newly rerun `source_manifest.json` and `summary.json` contain new generation timestamps; the key input hashes and measured summary fields match, but those files are therefore not claimed to be byte-identical across runs.

## What this proves—and what it does not

- **Proven:** the recovered original script can be rerun on the same recorded input bytes, reproduces the same 25,685-record selection, and yields byte-identical content for all seven deterministic output artifacts.
- **Not proven:** an independent reimplementation of the sample-selection algorithm; official HTTP Last-Modified metadata for every local input; global geographic catalog completeness; country administrative parent-path correctness; current ISO 3166-1 conformity; or real backup/restore readiness.
- The original script's `last_modified_utc` manifest field is populated from local filesystem `st_mtime`, not a captured HTTP `Last-Modified` header. Treat it as a local filesystem timestamp only.
- The sample is a validation sample for five countries, using all administrative features plus bounded population/reservoir samples and priority-name matches. It is not a globally complete place catalog.

No source inputs, existing sample files, database, migrations, seeds, imports, production configuration, or deployments were changed. The reproduction outputs live in a separate local folder.
