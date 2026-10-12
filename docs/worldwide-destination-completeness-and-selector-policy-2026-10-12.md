# Worldwide country and destination catalogue — completeness and selector policy

**Status:** Acceptance policy proposal; source coverage audit is being added to PR #27.  
**Scope:** Country/area identity, destination candidate feature coverage, administrative hierarchy and selectable UI values.  
**Write boundary:** No database migration, seed, import, production change or deployment is authorized by this document.

## 1. Define “complete” before counting

Job Grid needs two different deliverables:

1. **Country/area catalogue completeness:** every source-backed country/area candidate is accounted for, its code identity is reconciled, its entity type and selectable state are reviewed, and every exceptional row has a recorded disposition. A country menu is not complete just because a source file parsed without malformed rows.
2. **Destination catalogue completeness:** every feature in the *approved destination scope* from a pinned source snapshot is accounted for, classified as a selectable destination candidate, excluded with an explicit reason, or held for review. Coverage needs measured counts by source country code and feature type, hierarchy-depth coverage, duplicate-ID checks, name/alias coverage and country-level exception reports.

“Worldwide complete” must not mean every feature in a 13-million-row gazetteer is a valid user-facing destination. GeoNames includes administrative divisions, populated places, historical/abandoned places and non-location feature types. We need complete coverage of a clearly approved selector scope, not blind exposure of every source row.

## 2. Country/area code evidence

The read-only UN M49 alpha-code audit currently measures:
- 252 GeoNames `countryInfo` rows;
- 248 country/area rows in the UN M49 table with alpha codes;
- 248 exact alpha-2 + alpha-3 matches in each direction;
- 4 GeoNames alpha-code pairs not present in that UN table;
- zero alpha-code conflicts and zero duplicate code groups.

See [the measured code cross-check report](geonames-un-m49-crosswalk-audit-2026-10-12.md) and [country/area candidate package in CI](https://github.com/job-grid/job-grid/actions/runs/38190820033/artifacts/11721722211). All four rows absent from the live M49 table now have versioned, machine-checked dispositions in [the exception manifest](geonames-un-m49-exception-dispositions-2026-10-12.json): Kosovo and Taiwan are proposed as current geographic destination areas, while Serbia and Montenegro and Netherlands Antilles are historical-only references. Their raw source tuples are retained, with no code replacements or live selector changes. The test fails closed if a new source tuple lacks a disposition, or if a documented exception disappears or becomes matched in the live comparison.

The UN M49 page displays ISO-assigned alpha codes but its numerical code is maintained for UN statistical use. This audit does not constitute a direct current ISO Country Codes Collection/OBP snapshot and does not establish ISO numeric-3 conformance for ordinary rows. Where an ISO code is unverified or not assigned, keep nullable ISO fields and a separate internal UUID/source identifier. A geographic destination being searchable is not a sovereignty or visa-eligibility determination.

## 3. Candidate destinations from GeoNames

The source audit is pinned to GeoNames `allCountries.zip`, whose 19-field lines are streamed and checked. It produces:
- a country/source identity aggregate report;
- an aggregate destination feature coverage JSON;
- a per-source-country-code CSV showing counts of all source records, feature class, candidate populated places and administrative levels;
- a short-lived source manifest and the existing crosswalk exception audit rows;
- a country/area candidate master CSV/JSON that accounts for all 252 `countryInfo` entries by exact UN M49 alpha-code pair or explicit exception disposition.

The proposed current populated-place candidate feature-code set is explicitly limited to:
`PPL`, `PPLA`, `PPLA2`, `PPLA3`, `PPLA4`, `PPLA5`, `PPLC`, `PPLCD`, `PPLF`, `PPLG`, `PPLL`, `PPLR`, `PPLS`.

This set is grounded in the [official GeoNames feature-code list](https://www.geonames.org/export/codes.html), which defines the codes by populated-place types, seats and capitals. The audit counts them as **source candidates only**, not approved/selectable destinations. Candidate counts do not imply that labels are current, that the entity is correctly assigned to a country, or that a parent path is known.

Historical capital `PPLCH`, historical populated place `PPLH`, abandoned place `PPLQ` and destroyed place `PPLW` are held out from default current-place candidate counts. Other `PPL*` codes (such as sections of a populated place) are counted separately for explicit policy review. They must not silently disappear or become user-facing choices.

For administrative coverage, the audit separately counts GeoNames class-A `ADM1` through `ADM5` features. `ADMD` and other unspecified/historical administration remain their own review scope; they are not silently converted to an arbitrary level. Not every country has equivalent levels. A missing level is an explicit country-level coverage fact, not proof that the source is wrong.

## 4. Rules for making an internal place selectable

A later implementation may set an internal place as selectable only after all of these are satisfied:
1. A stable internal UUID exists; GeoNames ID remains a source identifier, not the internal primary key.
2. A reviewed source identity match ties the source record to that internal place. Names or coordinates alone are insufficient for merging records.
3. Its current feature type is included in the approved selector policy; historical, abandoned, destroyed, road, park, postal, building and other non-place feature rows are not accidentally shown as cities/towns.
4. Its country/jurisdiction assignment is verified against an approved source mapping. An unknown/non-standard source code is never assigned to an ISO country by assumption.
5. No duplicate-ID, conflicting identity, or ambiguous source crosswalk exists for the relevant source snapshot/effective period.
6. Names and relevant aliases are searchable while the original source spelling, language and provenance are retained.
7. The UI can select the place by internal ID. A parent path may remain unresolved when the product only needs a country-scoped destination search; however, the place may not be represented as belonging to a specific region/county or used in hierarchical filtering unless that specific edge is verified.
8. Parent edges, when approved, are same-country, cycle-free, period-aware and supported by cited source evidence. Unknown parents remain null/unresolved, never guessed.

The country code and place-hierarchy crosswalks remain separate. A valid country match does not prove an immediate administrative parent, and an unverified parent must not block independent, verified records elsewhere in the catalogue.

## 5. Coverage report acceptance

Before “destination scope complete” can be claimed, the country/source coverage run must report:
- total source rows scanned and malformed/invalid-ID rows;
- counts by source country-code bucket, feature class/code and admin level;
- current place candidate rows and unique candidate IDs;
- duplicate candidate IDs and duplicate current admin-feature IDs;
- source country-code buckets with zero current place candidates;
- UN/ISO country-code crosswalk mismatches or countryInfo codes not mapped to approved internal country identities;
- unresolved parent paths and unknown/ambiguous country assignment counts;
- language/alternate-name coverage and source freshness;
- accepted, excluded and review-held totals that reconcile exactly to the in-scope input.

Every source record in scope must land in exactly one reviewed disposition. Duplicate IDs or malformed candidates must block source-scope acceptance rather than silently dropping rows. The test fixtures verify place/admin feature counting, held-out historical places, per-country CSV output, and fail-closed duplicate destination identities.

**A passing source count audit still does not prove worldwide real-world completeness.** It proves only that a pinned source snapshot is accounted for under the published rules. National authorities may identify localities absent from GeoNames; such additions need a source-backed crosswalk or a clearly labelled supplemental authority record.

## 6. Kiambururu example

Kiambururu’s national administrative path can be represented separately from GeoNames matching. The current exact GeoNames immediate parent remains unresolved. The source row must retain its raw code and identity; the internal official-unit path may be kept for reconciliation but must not be conflated with GeoNames ID `192705`. The similarly named GeoNames Githunguri Location is not a verified Sub-County record.

See [the current evidence report](geonames-kenya-githunguri-parent-candidate-search-2026-10-12.md) and [the independent hierarchy/crosswalk design](geographic-authority-hierarchy-and-source-crosswalk-design-2026-10-12.md).

## 7. Required implementation order

1. **Completed for the current country/area source:** the live source-code comparison and exception disposition now pass CI; the row-level 252-record candidate package is emitted from the current source snapshot.
2. Review the candidate country/area package labels, proposed 250 current destination options and two historical-only references. The artifact explicitly has zero operationally enabled rows.
3. Review the all-country destination feature coverage artifact and per-country zero/gap counts; approve the city/town/locality and administrative-level feature scope.
4. Produce a row-level destination reconciliation from the pinned global place snapshot, including country-code assignment, duplicate/ambiguous IDs, alias/language coverage, and unresolved parent paths.
5. Finish source-specific parent-path reviews without fabricating edges. The country-area code cross-check does not clear the 128-record administrative parent-path review.
6. Review the logical schema, source-match states, relationship history, RLS and admin permissions in a separate implementation PR.
7. Independently verify backup/restore readiness before authorizing any database schema/import work.
8. Only then implement and validate the schema/import through the reviewed migration path; keep production execution under its own authorization.

PR #27 remains a draft. The country/area candidate package is review/import-planning evidence, not a live database seed or selector. Destination feature-scope completeness and production acceptance remain open.
