# GeoNames hierarchy candidate-presence audit — 2026-10-10

**Current result: BLOCKED — crosswalk lookup self-references found.** The stricter, reproducible audit detects **125 admin1** and **6,977 admin2** lookups where the crosswalk candidate ID equals the record being checked. These are not valid parent links. Other found candidate IDs were present as distinct same-country administrative features in the sample, but that availability alone does not approve a parent relationship.

## Scope

A read-only audit was run using the committed, reproducible [hierarchy audit script](../scripts/geonames-hierarchy-candidate-presence-audit.py) against the existing 25,685-row GeoNames sample and full `admin1CodesASCII.txt` and `admin2Codes.txt` crosswalk files. The first presence-only check did not exclude self-reference candidates. A stricter follow-up of the same source set explicitly compared each candidate ID with the child ID and found 7,102 self-reference cases in total. The JSON report and this section now reflect the stricter result.

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
| Admin1 references with a resolved key | 23,320 |
| Admin1 candidates that are a distinct same-country administrative feature | 23,195 |
| Admin1 self-reference candidates (candidate ID equals current record ID) | 125 |
| Admin2 references with a key found | 20,445 |
| Admin2 references with a resolved composite key | 20,445 |
| Admin2 candidates that are a distinct same-country administrative feature | 13,468 |
| Admin2 self-reference candidates (candidate ID equals current record ID) | 6,977 |
| Other candidate presence mismatches (missing ID, wrong country or non-admin feature, excluding self-reference) | 0 |
| **Self-reference cases that must not become parent links** | **7,102** |

Resolved keys often point to administrative-feature rows in the sample, but **the key finding is that 7,102 lookups point back to the child record itself** (125 admin1 and 6,977 admin2). Those self-references must never become `parent_id` links. The remaining distinct candidate IDs are availability evidence only; they do not prove semantically correct parentage and do not approve any links.

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

- **PARTIAL / BLOCKED:** 7,102 resolved crosswalk lookups are self-references (125 admin1; 6,977 admin2), so they cannot be used as parent links. A separate 23,195 admin1 and 13,468 admin2 distinct same-country administrative candidate IDs are present in the sample, but those links also remain unapproved.
- **PARTIAL / UNRESOLVED:** 2,333 admin1 references and 240 admin2 reference/context cases remain open.
- **UNVERIFIED:** Official source-origin/remote retrieval metadata, current ISO authority comparison, global geographic completeness, and full parent-hierarchy correctness.
- **BLOCKED:** Catalog acceptance and feature-code/selectability policy decisions.
- **SEPARATELY BLOCKED:** Phase 4C recovery readiness.

PR #27 remains open, draft and unmerged. No migrations, seeds, database imports, production changes, deployments, secrets/Cloudflare changes or backup/recovery actions were performed.

## Strict self-reference review — 2026-10-10

The first audit checked only that crosswalk candidate IDs existed as administrative features in the same country; it did not explicitly reject the case where the candidate ID was the current row's own GeoNames ID. The committed reusable script now flags this condition.

| Country | Admin1 self-references | Admin2 self-references |
|---|---:|---:|
| KE | 47 | 32 |
| GB | 4 | 185 |
| JP | 47 | 1,190 |
| BR | 27 | 5,570 |
| SG | 0 | 0 |
| **Total** | **125** | **6,977** |

These are crosswalk-key lookup results, not relationships to adopt. Do not create self-parent links. The stricter report supersedes the earlier statement that there were no candidate-presence mismatches: the earlier check found no absent/wrong-country/non-admin candidates, but missed self-reference as its own failure category. All parent relationships remain unapproved and catalog acceptance remains **BLOCKED**.

## Latest repository-version rerun — 2026-10-11 (Africa/Nairobi)

The exact script fetched from PR #27 branch commit `0cb86bb039861147e858365a9b4aee6874df1930` was copied byte-for-byte to the owner-connected Windows computer and re-run against the owner-local sample and full crosswalk files. It completed at **2026-10-10T21:53:29.446261Z (2026-10-11 00:53:29 EAT)**.

- Script path: `scripts/geonames-hierarchy-candidate-presence-audit.py`
- Executed copy SHA-256: `6912908743ee71dfb29e067ca363f59ecc2601a9f9970c89a765c3fbf7a54800`
- Git blob SHA-1: `3950cb6e6a9ca2398f5bd93907f1c95425648a9d`
- Sample TSV SHA-256: `1932181885967f3079dfefd5d16b4df4c00b6e62e4213bede7aa49bfc44ab9ad`
- Admin1 crosswalk SHA-256: `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a`
- Admin2 crosswalk SHA-256: `e1b500f4f0e13b3119ff15df84ce3c28982e899bb4183ee033f802a280c377d3`

The current repository script reproduced the results: **25,685** sample rows and unique IDs; **3,865** admin1 keys; **47,642** admin2 keys; zero malformed sample rows, duplicate IDs, malformed crosswalk rows or duplicate keys; **2,333** unmatched admin1 references; **240** unresolved admin2 key/context cases; and **7,102** self-reference candidates (125 admin1, 6,977 admin2). Exit code 1 is the intended fail-closed status because self-reference blockers were found; the report was written successfully.

This rerun closes the earlier provenance gap. It does not resolve the hierarchy: self-referencing links must not be created, and distinct candidate IDs are not yet approved parentage. Catalog acceptance remains **BLOCKED**. No parent links, source-file changes, database operations, migrations, seeds, production changes or deployments occurred.
