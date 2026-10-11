# Geographic authority hierarchy and source crosswalk design — 2026-10-12

**Status:** Proposed design for owner review. Documentation only.  
**Applies to:** Country catalog, administrative geography and place matching in Job Grid.  
**Current boundary:** No migration, schema change, seed, data import, database operation, production write, deployment, or PR merge is authorized or performed.

## Decision

**An unresolved GeoNames parent must not block a source-backed national administrative hierarchy.** Model internal geographic identities and reviewed parent relationships independently from the external identifiers used to discover or enrich them. A GeoNames record may remain unmatched while a separately sourced official administrative unit and its parent path are represented with clear provenance.

This is not permission to invent a missing GeoNames ID, to skip an evidenced intermediate administrative level, or to silently merge records based on similar names or coordinates.

## Proposed data model

This refines the earlier country-catalog proposal. Exact DDL and constraints belong in a later implementation PR after database authorization and recovery gates clear.

### 1. `geographic_places` — internal identities

Use an internal UUID as the primary key. Store canonical name, country/jurisdiction, internal place type, coordinates when supported, lifecycle status, selectability and audit timestamps.

Do not make a GeoNames identifier the place's primary identity or only source identifier. One internal place may be corroborated by more than one authority, while a source row may remain unmatched. Keep the existing same-country invariant: an approved parent must be in the same country/jurisdiction as the child, self-parenting and cycles are forbidden.

### 2. `geographic_source_snapshots` and `geographic_source_records` — source evidence

Capture each source release or dated retrieval with its canonical URL, source owner/licence, retrieval time, release/effective date when known, SHA-256, byte size, parser version, source-row count and review status.

Retain each source record's external identifier and raw evidence independently: original name/label, feature or unit type, raw administrative codes, source-declared parent code/identifier where available, coordinates where available, effective dates and a reference to the snapshot. Do not silently rewrite raw fields when normalization changes.

Uniqueness is scoped to the source's documented identifier namespace and snapshot policy. Do not impose global name uniqueness. If a source does not publish a persistent identifier for a unit, record that limitation; do not present a serial number or an inferred composite label as a persistent national identifier.

### 3. `geographic_place_source_matches` — external identity crosswalk

Link a source record to an internal place with a controlled status such as `candidate`, `verified`, `rejected` or `unresolved`. Store the evidence reference, matching rule, reviewer/decision time and effective interval or source period as appropriate.

- Only an explicitly verified crosswalk may assert that a particular external record represents an internal place.
- Candidate, rejected and unresolved matches remain queryable for audit but cannot silently become approved identities.
- Preserve the original GeoNames ID and raw codes, including historic or absent keys such as `KE.01`; never overwrite them to force a current match.
- The same display name in different counties, countries or administrative levels is not enough to merge records.

### 4. `geographic_place_relationships` — sourced hierarchy edges

Represent relationships between internal UUIDs separately from the source match itself. A relationship records child, parent, relationship type (for example `administrative_parent` or `contained_in`), source evidence, verification state, effective dates, reviewer/decision and audit timestamps.

An authority may establish a parent path for its own administrative units even when those units have no GeoNames crosswalk. Source-backed but unreviewed edges remain candidates, not operational hierarchy. A single preferred operational parent path should be exposed only where a reviewed rule identifies one unambiguous active approved edge for the relevant date and relationship type. Keep historical relationships rather than overwriting them.

The final implementation may retain a composite `parent_id` as a constrained, derived shortcut for reads, but it must not be the only place where source-specific relationship evidence is recorded.

## How the catalog should behave

1. Import and validate source records into a controlled staging/reconciliation layer.
2. Independently build source-specific administrative hierarchy candidates from an approved national authority or other approved source, retaining dates and provenance.
3. Create internal unit identities only under documented identity rules. A unit can be represented in the internal catalog without inventing an external GeoNames identifier.
4. Accept a GeoNames-to-internal-place crosswalk only after identity and administrative level have been reconciled.
5. Allow the UI/API to query approved internal units and approved parent edges. Do not make successful GeoNames matching a global prerequisite for every country or every separately verified source.
6. Keep unmatched GeoNames source records visible in reconciliation reports. Do not expose duplicate-looking unmatched/official entries as a single selectable option before reviewed identity resolution.
7. Gate public selectability independently from existence and source matching. An internal place can exist for evidence and lineage without being selectable; selection requires an explicit approved policy.
8. Reject cross-country parents, self-parenting, cycles, ambiguous operational parent paths and unreviewed crosswalk use. Report each rejection with a reason.

## Kiambururu — applied example

The read-only evidence dossier, [Githunguri Sub-County identity search](geonames-kenya-githunguri-parent-candidate-search-2026-10-12.md), records the current native administrative path reported by the official sources as:

`Kenya → Kiambu County → Githunguri Sub-County → Kiambururu (Location)`

The Ministry of Interior Gazette dated 14 February 2024 identifies Kiambururu as a Location under Githunguri Sub-County, Kiambu County; the KNBS 2025 Statistical Abstract independently lists Githunguri under Kiambu. The KNBS `SNO` is a serial number, not a persistent canonical sub-county identifier. The older 2011 IEBC schedule uses “Sub-Location,” while GeoNames ID `192705` still uses the name “Kiambururu Sub-Location” and has no current exact `KE.01` crosswalk. The reviewed GeoNames dump has no exact-label Githunguri Sub-County feature.

Therefore:

- Preserve GeoNames ID `192705`, its raw admin1 code `01`, name, coordinates and feature classification as source evidence.
- Record the official administrative units and their sourced parent path separately, with authority, publication/effective date and snapshot provenance.
- Do **not** map GeoNames ID `192705` to the official Kiambururu Location automatically. That identity crosswalk stays unresolved until review addresses the level/name mismatch.
- Do **not** use GeoNames ID `197219` (“Githunguri Location”) as the Sub-County parent, skip the sub-county and point directly at the county, or fabricate a GeoNames key.
- The internal official-unit path may be retained for reconciliation. Keep it non-selectable until the owner-approved identity, duplicate-prevention and selectability rules are satisfied. Once approved, it may be used based on the official hierarchy without requiring a GeoNames parent ID.
- Keep this source-specific decision local. It must not create a blanket exception that permits unknown parent paths in other countries.

No database records or parent links were written as part of this design.

## Acceptance tests required before schema implementation

- A place can exist with no GeoNames ID, while its internal UUID remains stable.
- A raw GeoNames row with a missing/unknown parent is preserved and quarantined/unresolved rather than dropped or assigned a guessed parent.
- A verified national-authority path can exist without a GeoNames crosswalk for one or more nodes.
- A candidate/rejected/unresolved source match cannot become a verified match or selectable place by default.
- Matching uses source namespace/identifier, administrative level, jurisdiction, source period and recorded evidence; name-only or coordinate-only matching is insufficient.
- Multiple source records can be linked to one internal place only after explicit review; one source record cannot silently identify several canonical places for the same effective period.
- Parent edges cannot cross country/jurisdiction, point to themselves, create a cycle, or produce multiple conflicting approved administrative parents for the same effective period.
- Historical names and relationships retain their source and effective dates.
- Kiambururu fixtures assert that the official parent chain can be represented while GeoNames ID `192705` remains unresolved, and that ID `197219` is not accepted as the Sub-County.
- Re-running an identical source snapshot is idempotent; all unmatched, ambiguous and rejected cases appear in a row-level report.
- RLS, grants, administrative permissions, audit logging and source-data retention are tested before any production design is approved.

## Implementation sequence and gates

1. **Now:** review and approve this logical design and status vocabulary; repository documentation/tests only.
2. Add schema DDL and authorization/RLS design in a separate implementation PR; include migration validation and tests against an explicitly approved non-production target.
3. Produce source-pinned, row-level dry-run evidence for the Kenyan official hierarchy and GeoNames reconciliation; obtain review of duplicate handling and selectability.
4. Obtain independent backup/restore readiness evidence before authorizing any live schema/import changes.
5. Authorize and execute production migrations/imports only through the repository's required review and release controls.

The current country-catalog PR remains draft and has unresolved acceptance gates. This document does not clear those gates, authorize a migration, or imply that Kenya or worldwide catalog acceptance is complete.

## Evidence

- [Kenya Githunguri Sub-County identity search, 2026-10-12](geonames-kenya-githunguri-parent-candidate-search-2026-10-12.md)
- [Kenya external county-ancestor evidence review, 2026-10-11](geonames-kenya-external-ancestor-evidence-2026-10-11.md)
- [Country catalog database foundation](country-catalog-database-foundation.md)
- [Database migration governance](database-migrations.md)
