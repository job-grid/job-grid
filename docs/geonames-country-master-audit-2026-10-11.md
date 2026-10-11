# GeoNames country-master identity audit — 2026-10-11

## Result

**GeoNames country identity join: PASS WITH REVIEW ITEMS.** The audit scanned the current owner-held GeoNames allCountries.zip and the directly rechecked GeoNames countryInfo file. Complete source rows, individual names, codes and record identifiers were not included in the aggregate report.

| Aggregate check | Result |
|---|---:|
| Country metadata rows | 252 |
| Malformed country metadata rows | 0 |
| Duplicate country identifiers or duplicate alpha-2/alpha-3/numeric groups | 0 |
| Worldwide source rows scanned | 13,472,324 |
| Malformed worldwide rows | 0 |
| Country-level PCLI records | 193 |
| Country metadata identities matched to PCLI | 193 |
| Country metadata identities matched to any recognized current/territorial/historical country-related feature | 252 |
| Country metadata identities with no recognized country-related feature | 0 |
| Historical political-feature matches in country metadata | 2 |
| Current/territory feature records outside country metadata | 3 |
| Numeric-code-format anomalies needing review | 1 |

## Interpretation

A PCLI-only comparison would have been misleading: PCLI represents independent political entities, not every country-related record. The audit therefore checks the broader GeoNames political feature set as well. All 252 country metadata identities mapped to a recognized country-related source feature. The 59 records in country metadata that are not PCLI rows are explained by other country-related feature types, not automatically treated as missing or invalid countries.

Two metadata identities currently map to historical political-feature rows, one numeric-code-format anomaly remains for review, and three additional current/territory-style features exist outside the country metadata file. Those are recorded as review items, not grounds to invent replacements, delete source records or reclassify a territory. Source IDs, raw values and feature types remain unchanged.

The aggregate-only JSON records the exact source sizes and SHA-256 fingerprints used for this run. It contains no names, code tuples, GeoNames IDs, or row-level mismatches. The raw source files and any detail output remain local/private.

## What this closes — and what it does not

This closes the structural and source-identity join check between GeoNames country metadata and recognized country-related entities in the current GeoNames worldwide dump, subject to the three territory-scope review items and historical/numeric review categories.

**It does not close the official ISO 3166-1 authority comparison.** No official ISO country-code snapshot was used by this audit. The separately approved ISO comparison must be run locally, using permitted official material, under the existing ISO authority and validation protocol. Do not send ISO non-Open-Data country-code source rows or tuples to AI tools, upload them to GitHub, scrape around access controls, or purchase paid access without separate authorization.

This audit also does not establish complete worldwide geographic product coverage, approve administrative parent paths, authorize a migration/import/seed, or clear Phase 4C backup/restore readiness. The 128 unresolved administrative parent-path records remain excluded from the initial operational administrative catalog under the existing exclusion manifest. The country catalog proposal stays open and unmerged until its other acceptance gates pass.