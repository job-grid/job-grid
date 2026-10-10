# Row-level GeoNames crosswalk reconciliation — 2026-10-10

These files are the row-level output of the owner-computer crosswalk reconciliation. They are proposed exception classifications for review, not approved geographic mappings.

## Export files

- `unmatched_admin1_references.csv` — 2,333 unmatched admin1 references.
- `unmatched_admin1_references.json` — same 2,333 records as a JSON array.
- `unmatched_admin2_references.csv` — 240 unmatched admin2 references.
- `unmatched_admin2_references.json` — same 240 records as a JSON array.
- `summary.json` — counts, code breakdowns, exact Singapore ID comparison, and export metadata. The earlier pretty-JSON output hashes were removed because JSON files were compacted; source archive hashes remain in the Stage C reports.

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

## Broader verification update — 2026-10-10

The row-level crosswalk exports and classifications above remain unchanged: they describe unresolved reference keys and do not approve or fabricate parent links. A separate PowerShell/.NET implementation has since scanned the full local `allCountries.zip` and matched all 25,685 existing sample records to the worldwide archive across all 19 original fields. Details are in [the independent worldwide scan report](../../../geonames-worldwide-independent-verification-2026-10-10.md) and [machine-readable evidence](../../../geonames-worldwide-independent-verification-2026-10-10.json).

This advances the full-local-archive row-count/sample-match gate, but does not change the crosswalk outcomes: **2,333** admin1 misses, **240** admin2 misses, **157** records in both categories, **2,416** unique affected records, and **142** unresolved Singapore admin1 misses (24 prior exceptions overlap exactly; 118 additional rows with raw code `00`). Do not reject unmatched rows automatically or synthesize administrative parents.

Current overall gates remain: ISO comparison **UNVERIFIED** (source choice approved, snapshot not yet compared); official GeoNames source-origin/remote retrieval metadata **UNVERIFIED**; worldwide completeness **UNVERIFIED**; parent/feature policies require review; catalog acceptance **BLOCKED**; Phase 4C recovery readiness separately **BLOCKED**.

## Lookup-context classification refinement — 2026-10-10

A follow-up read-only hierarchy audit distinguished **239** admin2 rows where a complete composite key was available but missing from the crosswalk, from **one** row where the raw admin1 code is blank and therefore a full admin2 lookup key cannot be formed. The one record is now classified in both the JSON and CSV export as `ADMIN2_LOOKUP_UNCHECKABLE_MISSING_ADMIN1_CONTEXT` / `UNRESOLVED_MISSING_ADMIN1_CONTEXT`; its raw source values are retained and its `crosswalk_lookup_key` is null rather than recording a synthetic key. The total unresolved admin2 export remains **240** rows.

The audit also confirmed that all **23,320** found admin1 crosswalk keys map to an ID present in the sample as a same-country administrative feature, and all **20,445** found admin2 keys map to an ID present as a same-country administrative feature. This is candidate-presence evidence only; it does not approve parent links, resolve the 2,333 admin1 misses or establish worldwide hierarchy completeness. See [the hierarchy candidate presence report](../../../geonames-hierarchy-candidate-presence-audit-2026-10-10.md).
