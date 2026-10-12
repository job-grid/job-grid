# GeoNames full-source measurement — 13 October 2026

**Disposition:** the full parser pass ran successfully against the official GeoNames files downloaded by GitHub Actions. ZIP CRC checks passed. The first workflow attempt failed only after parsing, when the report step tried to open a console-summary file before creating its output directory. That CI wiring defect was fixed and a follow-up run is publishing the detailed JSON/Markdown artifact.

## Measured source rows

Captured during CI at `2026-10-12T22:05:13Z`. These are measurements of the official files downloaded in that CI run, not a claim that the two uploaded ZIPs are byte-identical to the download.

| Source | Measured data rows | Schema/uniqueness result |
|---|---:|---|
| `allCountries.zip` / `allCountries.txt` | **13,472,373** | All rows had 19 fields; 0 malformed rows; 0 duplicate/invalid source-ID rows in the aggregate check; ZIP CRC passed |
| `alternateNamesV2.zip` / `alternateNamesV2.txt` | **19,220,617** | All rows had 10 fields; 0 malformed rows; 0 duplicate source-ID rows in the aggregate check; ZIP CRC passed |
| `admin1CodesASCII.txt` | **3,865** | 3,865 unique code keys |
| `admin2Codes.txt` | **47,642** | 47,642 unique code keys |

The source dump contains **31,490 Kenya rows** and **103,762 Japan rows**. These are GeoNames source-feature counts, not counts of approved or selectable Job Grid locations.

## Source fingerprints captured by CI

| File | Downloaded bytes | SHA-256 |
|---|---:|---|
| `allCountries.zip` | 422,018,834 | `6ec08373799b4c4a88138ae9829682586aee2a71cf6260ef0ad736d5fd3904e0` |
| `alternateNamesV2.zip` | 204,830,371 | `c1b23e68e7ae5b345ac21c53846964affdfcdba4ae1e22838ef0509e8538eefe` |
| `admin1CodesASCII.txt` | 151,583 | `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a` |
| `admin2Codes.txt` | 2,366,368 | `0dbb9988fa9388021efe026ed16de0b89f56314f2dfd0abb4a51e17b8c55f29f` |

Official download source: [GeoNames export dump](https://download.geonames.org/export/dump/).

## Comparison with the four uploaded attachments

| File | Uploaded byte size | CI download byte size | Result |
|---|---:|---:|---|
| `allCountries.zip` | 422,010,093 | 422,018,834 | Different size by +8,741 bytes |
| `alternateNamesV2.zip` | 204,826,020 | 204,830,371 | Different size by +4,351 bytes |
| `admin1CodesASCII.txt` | 151,583 | 151,583 | Size match only |
| `admin2Codes.txt` | 2,366,368 | 2,366,368 | Size match only |

The authoring workspace could not calculate SHA-256 for the uploaded raw attachments. Equal text-file size does **not** prove identical bytes, and the two ZIP archives are demonstrably not the same lengths as the CI downloads. Therefore, the row counts above are verified for the CI-downloaded current source snapshot; the exact row counts inside the uploaded ZIP byte streams remain unverified. The captured SHA-256 values above must not be labelled as hashes of the uploaded attachments.

## How this moves Job Grid forward

- Use `scripts/geonames-full-source-audit.py` to repeat the full source measurement with row counts, file hashes, ZIP integrity, unique identifiers, country-specific counts, alias-to-feature references, and exact administrative-code crosswalk misses.
- Preserve alternate names as searchable aliases of a source place ID; do not create a new place for every alternate spelling.
- Treat feature types and source-code matches as candidates/evidence, not automatic permission to select a place or to invent a parent link.
- Keep the raw dumps out of Git. The archives are over 600 MB combined and are mutable source inputs; the compact audit report and hashes are the durable repository artifacts.
- No live database import, migration, seed, or deployment is authorized or performed by this audit. Catalog acceptance and the approved Job Grid Supabase target remain separate gates.

GeoNames rows are source evidence; they are not a warranty of completeness or a substitute for the owner-approved ISO authority comparison.
