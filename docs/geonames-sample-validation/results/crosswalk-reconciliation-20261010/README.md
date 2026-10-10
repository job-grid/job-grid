# Row-level GeoNames crosswalk reconciliation — 2026-10-10

These files are the row-level output of the owner-computer crosswalk reconciliation. They are proposed exception classifications for review, not approved geographic mappings.

## Export files

- `unmatched_admin1_references.csv` — 2,333 unmatched admin1 references.
- `unmatched_admin1_references.json` — same 2,333 records as a JSON array.
- `unmatched_admin2_references.csv` — 240 unmatched admin2 references.
- `unmatched_admin2_references.json` — same 240 records as a JSON array.
- `summary.json` — counts, code breakdowns, exact Singapore ID comparison, and source-output checksums.

Each record keeps GeoNames ID, name, country code, feature code, raw admin codes, missing-reference category, proposed review classification, lookup key, and raw missing value.

## Measured set reconciliation

| Measure | Count |
|---|---:|
| Sample records | 25,685 |
| Unique admin1 crosswalk keys inspected | 3,865 |
| Unique admin2 crosswalk keys inspected | 47,642 |
| Unmatched admin1 references | 2,333 |
| Unmatched admin2 references | 240 |
| GeoNames IDs appearing in both exception sets | 157 |
| Unique GeoNames IDs in the union | 2,416 |
| Earlier Singapore exceptions | 24 |
| Wider Singapore admin1 misses | 142 |
| Exact overlap between Singapore ID sets | 24 |
| Additional Singapore IDs in wider set | 118 |

The 2,333 and 240 figures count references at separate hierarchy levels; they must not be added and described as unique affected records. The two sets share 157 IDs, and the union has 2,416 unique IDs.

All 24 earlier Singapore exception IDs occur in the broader 142-row Singapore set. There are no prior-only IDs; 118 IDs are additional. The broader set contains 118 raw `00` values and 24 nonzero raw code values in `01`–`05`.

## Required handling

- Preserve source GeoNames IDs and raw admin codes exactly.
- Classify raw `00` as an unresolved placeholder/nonstandard-code candidate until an owner-approved interpretation rule exists.
- Treat unmatched nonzero values as missing-reference or possible version-dependent cases. Do not state that they are legacy without evidence.
- Missing crosswalk keys are exceptions for review, not automatic record rejection.
- Do not create synthetic administrative records or invent parent links.
- Do not merge same-name geographic entities by name alone.
- Obtain owner approval for unresolved representations and hierarchy policy before catalog acceptance.

These outputs address the row-level export requirement only. Full worldwide scan reproduction and current approved ISO-authority comparison remain UNVERIFIED; catalog acceptance and Phase 4C recovery readiness remain BLOCKED.
