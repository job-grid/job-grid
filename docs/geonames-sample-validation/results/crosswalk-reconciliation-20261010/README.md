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

The stricter reproducible audit found **125 admin1** and **6,977 admin2** resolved-key lookups where the candidate ID equals the record being checked. These **7,102 self-reference cases must not become parent links**. The remaining **23,195 admin1** and **13,468 admin2** candidates are distinct same-country administrative-feature IDs present in the sample, but they are candidates only—not approved semantic parents. The 2,333 admin1 misses and 240 admin2 unresolved reference/context cases remain. See the [updated hierarchy candidate-presence report](../../../geonames-hierarchy-candidate-presence-audit-2026-10-10.md).


## Owner-approved exception dispositions — 2026-10-11

The owner approved conservative, non-destructive feature/selectability defaults on 2026-10-11. A reproducible disposition audit applies those defaults to the unchanged row-level exception exports. It adds decision labels; it does **not** rewrite any raw code or declare a missing source crosswalk key resolved.

- [Owner-approved disposition CSV](owner-approved-dispositions.csv) — every one of the 2,573 level-specific exception references, plus the original ID, name, country, feature code, raw codes, original review classification, and approved product treatment.
- [Machine-readable disposition summary](owner-approved-disposition-summary.json) — reference and unique-record counts, per-country breakdown, and limitations.
- Generator: `scripts/geonames-approved-exception-dispositions.mjs`. Rebuild these derived artifacts from the original exception JSON files with `node scripts/geonames-approved-exception-dispositions.mjs --write`. The original inputs remain unchanged.

### What this review separates

| Approved treatment | Reference rows | Unique GeoNames IDs | Meaning |
|---|---:|---:|---|
| Country-level `PCLI`; no administrative parent required | 5 | 5 | Preserve the country records and raw `00` values; a country entity itself does not need an administrative parent. |
| Current administrative feature, parent path still unresolved | 128 | 128 | `ADM3`: 2; `ADM4`: 126. These require country-specific ancestor-path evidence before becoming current administrative selector options. |
| Historical administrative features | 1,187 | 1,030 | Preserve history and identity; not current administrative selector options or current parents by default. |
| Undifferentiated administrative level `ADMD` | 1,109 | 1,109 | Preserve raw fields; do not infer the administrative level; not current selector options by default. |
| Populated places with unresolved administrative association | 139 | 139 | Preserve the place record; its administrative association remains independently unresolved. |
| Historical populated places with unresolved association | 2 | 2 | Preserve historical place identity; do not turn it into a current administrative boundary. |
| Other non-administrative entities (`ZN`) | 3 | 3 | Preserve entity; do not treat it as an administrative boundary. |

Reference rows across admin1/admin2 still total **2,573**, with **157** IDs occurring in both sets and **2,416 unique IDs** in the union. The row-level exception counts are not silently reduced. Instead, the approved dispositions distinguish country entities that do not need an administrative parent from the cases that truly need hierarchy/association handling.

**Practical result:** the current administrative-selector hierarchy work is now focused on the **128 unresolved current ADM3/ADM4 records**, concentrated in Japan (126) and Kenya (2). The 1,030 unique historical admin records and 1,109 unique undifferentiated admin records are preserved but excluded from current admin selectors by default. Place associations and the other unresolved references remain visible in the CSV for future case-level work.

### Boundaries

The dispositions do not establish any individual parent relationship, validate official ISO status, or prove source-origin/worldwide completeness. No source IDs or raw codes were normalized; no record was discarded; no parent ID/link, migration, seed, import, database, deployment, or production change was made. Current ISO comparison and full country-specific path review remain open gates.
