# GeoNames hierarchy candidate-presence audit — 2026-10-10

**Result:** PASS for source candidate presence; no crosswalk candidate ID presence mismatches were found. Parent relationships remain unapproved, and catalog acceptance remains BLOCKED.

## Scope

A read-only audit was run on the owner-connected Windows computer against the existing 25,685-row GeoNames sample and the full `admin1CodesASCII.txt` and `admin2Codes.txt` crosswalk files. It checked exact composite-key existence, and for each found key checked whether the associated GeoNames ID was present in the sample as a same-country feature-class `A` administrative record.

No source file was modified, no parent ID was written, and no database operation was performed. Aggregate evidence is in [the JSON report](geonames-hierarchy-candidate-presence-audit-2026-10-10.json).

## Results

| Check | Result |
|---|---:|
| Sample rows / unique IDs | 25,685 / 25,685 |
| Duplicate IDs in sample | 0 |
| Full admin1 crosswalk keys | 3,865 |
| Full admin2 crosswalk keys | 47,642 |
| Malformed rows / duplicate keys in admin1 crosswalk | 0 / 0 |
| Malformed rows / duplicate keys in admin2 crosswalk | 0 / 0 |
| Administrative feature rows present in sample | 24,693 |
| Admin1 references with a key found | 23,320 |
| Found admin1 references whose candidate ID exists as same-country administrative feature | 23,320 |
| Admin2 references with a key found | 20,445 |
| Found admin2 references whose candidate ID exists as same-country administrative feature | 20,445 |
| Candidate ID presence mismatches | 0 |

This confirms that the administrative source records referenced by those resolved crosswalk entries are available in the selected sample and use the expected country context. It does **not** confirm the semantic correctness of every place-to-parent relationship and does not approve or create any parent links.

## Unresolved crosswalk references

Admin1 has **2,333** non-empty raw-code references without an exact key: **2,284** are raw `00` placeholder/nonstandard candidates and **49** are unmatched nonzero references. Do not treat these automatically as invalid records or confirmed legacy codes.

Admin2 has **20,685** non-empty references: **20,445** exact composite keys were found, **239** complete composite keys were absent, and **one** additional row cannot form a complete key because the raw admin1 code is blank. It remains in the 240-row unresolved admin2 export but is now classified as `UNRESOLVED_MISSING_ADMIN1_CONTEXT`, with its raw values retained and no synthetic lookup key emitted.

Singapore's 142 admin1 misses remain unresolved; the earlier 24 exceptions overlap exactly with the broader set, and 118 additional records use raw admin1 code `00`.

## Per-country summary

| Country | Sample rows | Admin1 keys found | Admin1 unresolved | Admin2 keys found | Admin2 missing-key cases | Admin2 missing-context cases |
|---|---:|---:|---:|---:|---:|---:|
| KE | 2,631 | 2,605 | 26 | 32 | 5 | 0 |
| GB | 12,096 | 12,092 | 3 | 12,004 | 29 | 0 |
| JP | 4,899 | 2,736 | 2,161 | 2,554 | 205 | 1 |
| BR | 5,888 | 5,887 | 1 | 5,855 | 0 | 0 |
| SG | 171 | 0 | 142 | 0 | 0 | 0 |

The admin1 “unresolved” counts are reference-row counts; the per-country values include rows with non-empty admin1 code. The admin1 total missing-key reference count is 2,333.

## Disposition

- **PASS:** Crosswalk candidate IDs for resolved admin1/admin2 references are present in the sample as same-country administrative features.
- **PARTIAL / UNRESOLVED:** 2,333 admin1 references and 240 admin2 reference/context cases remain open.
- **UNVERIFIED:** Official source-origin/remote retrieval metadata, current ISO authority comparison, global geographic completeness, and full parent-hierarchy correctness.
- **BLOCKED:** Catalog acceptance and feature-code/selectability policy decisions.
- **SEPARATELY BLOCKED:** Phase 4C recovery readiness.

PR #27 remains open, draft and unmerged. No migrations, seeds, database imports, production changes, deployments, secrets/Cloudflare changes or backup/recovery actions were performed.
