# Job Grid — Country Catalog Database Foundation

**Status:** Design proposal for owner review only.  
**Authority:** Master Plan V2, especially §3 (Countries, Cities, Towns & Jurisdictions), §§29–30 (Data/API Architecture), §35 and §36.  
**Baseline:** main at 8b5a89ccdb85d5e3eba6ab6dcbe96df84d2ec08d.  
**Scope:** Documentation only. No application code, migration, schema, seed, source-data import, database operation, deployment, production configuration or recovery-system change is authorized or performed.

## 1. Recommendation

Use a stable internal country/area catalog and a separate reusable geographic-place catalog. ISO 3166 codes are standardized identifiers only where assigned by the ISO authority; GeoNames IDs remain source identifiers; internal UUIDs are application primary keys. Entity classification and Job Grid selectability must be separate fields. A code or name must not be treated as a statement of sovereignty, legal status or employment eligibility.

The owner's 64-entry spreadsheet, if located and verified, is a business-priority list, not the master definition of supported countries. Earlier Job Grid work has a 40-country draft geography set; that staging material is not authoritative or exhaustive.

**No production migration or import has been run.** The sample below is a source-based preflight, not a successful database import. A full machine-parsed sample run requires downloading and checksum-pinning the actual files first.

## 2. Source evaluation

| Source | Use | Strengths | Limitations / controls |
|---|---|---|---|
| [GeoNames countryInfo.txt](https://download.geonames.org/export/dump/countryInfo.txt) | Country/area candidates, GeoNames ID, names, capital, code candidates, currency and calling-code hints | Small tab-delimited UTF-8 seed source | Code fields require ISO validation; some rows use GeoNames-only codes; currency/phone/capital are not authoritative business rules |
| [GeoNames allCountries.zip](https://download.geonames.org/export/dump/allCountries.zip) | Worldwide feature staging: IDs, names, coordinates, feature class/code, country code, admin1–admin4, population and modification date | Worldwide dataset; stable source IDs support reconciliation | Large and includes non-place feature types. Stream/filter; do not import every row into user-facing lists |
| [GeoNames admin1CodesASCII.txt](https://download.geonames.org/export/dump/admin1CodesASCII.txt) | First-level administrative code/name crosswalk | Code, name, ASCII name and GeoNames ID | Code conventions vary and can change; reconcile with source IDs and country context |
| [GeoNames admin2Codes.txt](https://download.geonames.org/export/dump/admin2Codes.txt) | Second-level administrative crosswalk | UTF-8 names and IDs | Not every country uses an equivalent admin2 level; do not assume universal hierarchy |
| [GeoNames readme.txt](https://download.geonames.org/export/dump/readme.txt) | File format, feature codes, alternate names, hierarchy and delta import | Documents UTF-8 tab-delimited data, IDs, feature classes, alternateNamesV2, modifications and deletes | Explicitly no guarantee of accuracy, timeliness or completeness |
| [ISO 3166](https://www.iso.org/iso-3166-country-codes.html) | Authority for ISO alpha-2, alpha-3, numeric codes and code status | Standardized codes; distinguishes countries/areas and subdivision codes | Validate against a current approved ISO source; code assignment does not mean every entry is a sovereign state |

GeoNames states the data is UTF-8, tab-delimited and licensed under **CC BY 4.0**, without a warranty of accuracy, timeliness or completeness. Retain attribution, source URL, licence, snapshot date and checksums. ISO says ISO 3166 codes may be used free of charge, but that should not be interpreted as every ISO update product or data feed being free. Prefer **alternateNamesV2.zip**; the older alternateNames.zip is documented as obsolete.

## 3. Naming and code policy

Keep these concepts separate:
- Internal UUID identity.
- ISO alpha-2, alpha-3 and numeric-3 fields, nullable when not officially assigned.
- Source identifiers (GeoNames ID and source codes).
- Entity classification: ISO country/area, territory/dependency, special/disputed area, GeoNames-only area, historical/retired, or pending review. These are catalog classifications, not legal conclusions.
- Job Grid status: pending_review, active or inactive, plus is_selectable. Selectability requires active status and explicit approval.
- Canonical name and localized/alternate names with language, type, source and optional effective dates.
- Business priority in a separate table/configuration; it must not limit the canonical catalog.

Rules:
1. Validate ISO codes against the approved current ISO source. Store alpha codes uppercase.
2. Store numeric-3 as CHAR(3) text to preserve leading zeroes (e.g. 020, 004, 076).
3. Enforce uniqueness of each non-null ISO code with partial unique indexes.
4. GeoNames says the United Kingdom's official ISO alpha-2 is GB and UK is reserved. GB is the candidate; UK must not be silently treated as ISO.
5. GeoNames uses XK/XKX/numeric 0 for Kosovo as a temporary source code. Preserve XK/XKX as GeoNames source identifiers only; do not put them into ISO fields unless an approved ISO source assigns them. Leave ISO fields null and status pending review unless owner policy approves a selectable catalog identity.
6. Hong Kong and Taiwan should be distinct geographic identities if approved, with code fields populated only after current ISO verification and entity classification/selectability set by explicit policy. Codes do not settle political status.
7. Never reassign an old code to a different internal identity. Keep historical identifiers and aliases with dates; deactivate rather than hard-delete referenced records.
8. Names, FIPS codes, currency codes, phone codes and internet TLDs are not primary keys.
9. Aliases are not globally unique: London and other names can occur in multiple countries. Return contextual candidates rather than silently selecting one.

## 4. Proposed schema

This is a logical proposal, **not executable migration SQL**.

### countries

| Field | Proposed type / constraint | Purpose |
|---|---|---|
| id | UUID primary key | Stable internal identity independent of names/source IDs |
| iso_alpha2 | CHAR(2), nullable, unique when non-null | Official ISO alpha-2 only |
| iso_alpha3 | CHAR(3), nullable, unique when non-null | Official ISO alpha-3 only |
| iso_numeric | CHAR(3), nullable, unique when non-null | Preserve leading zeroes |
| geonames_id | BIGINT, nullable, unique when non-null | Source identifier, not primary key |
| common_name | TEXT NOT NULL | Trimmed canonical display name |
| official_name | TEXT nullable | Only from approved source, with provenance |
| capital_name | TEXT nullable | Display metadata, not a location foreign key unless separately resolved |
| entity_kind | Controlled value/FK | Explicit catalog classification |
| status | Controlled value/FK | pending_review, active, inactive |
| is_selectable | BOOLEAN | Must be false unless approved and active |
| phone_calling_code | TEXT nullable | Display hint only; shared codes allowed |
| source_name/source_version | TEXT nullable | Latest source reference for convenience |
| imported_at | TIMESTAMPTZ nullable | Import time for source snapshot |
| created_at/updated_at | TIMESTAMPTZ | Internal timestamps |

Checks: ISO field format; non-empty common name; valid status/entity_kind; selectable implies active and approved. Do not require capital, official name, currency or calling code for every record.

### Related tables

- **catalog_sources:** source key, name, canonical URL, licence/attribution, source owner, update cadence and status.
- **source_snapshots:** source/release, retrieval time, file, byte size, SHA-256, ETag/Last-Modified, parser version, counts and review status.
- **country_source_identifiers:** country_id, source_id, snapshot_id, external_identifier, identifier_type, raw value, first/last seen, active. Unique by source + identifier type + external identifier under a documented history policy.
- **country_name_variants:** country_id, display/normalized name, language, type (canonical, official, preferred, short, alias, historic, transliteration), source, valid_from/to, review status. Shared normalized text is permitted.
- **currencies:** ISO 4217 code CHAR(3) primary key, canonical name and status.
- **country_currency_assignments:** country_id, currency code, role (primary/legal tender/common/historical), effective dates, source and verification status. Allow zero or multiple assignments.
- **country_calling_codes** (optional): country_id, calling prefix, territory context, effective dates and source. Shared codes and multiple ranges are allowed.

Do not duplicate currency names/rules across countries. A view can expose an approved current default, but it must not become a second source of truth.

### geographic_places

Use one reusable place table instead of rigid cities/towns tables:
- id UUID; country_id UUID NOT NULL; parent_id UUID nullable.
- geonames_id BIGINT nullable unique.
- place_type controlled internal type (administrative area, populated place, locality, postal area, etc.).
- feature_class/feature_code preserving GeoNames classification.
- raw admin1–admin4 codes for reconciliation; do not assume they are universal ISO subdivision codes.
- canonical_name, nullable WGS84 latitude/longitude, status, is_selectable, source_snapshot_id, source_modified_date, created_at, updated_at.

Enforce a composite uniqueness key on (id, country_id), and a composite self-FK from (parent_id, country_id) to (id, country_id), so a parent cannot belong to another country. Block self-parenting; use recursive validation/trigger or import validation to detect longer cycles. Parent is optional. Do not invent a parent city for a town. Store place aliases in a separate geographic_place_names table with language, type, source and effective dates.

**Relationship diagram (logical):**

World/catalog root → countries/areas → optional administrative divisions → populated places/localities → optional postal areas.

Countries connect to source identifiers, name variants and effective-dated currency assignments. Each place has an owning country; if it has a parent, that parent must belong to the same country. The UI can remain Country → City → Town/Locality while the data model supports Country → County → Locality, Country → City, Country → Town or other evidenced structures.

## 5. Sample-country source preflight

**PRE-FLIGHT ONLY.** No source archive was downloaded into the repository, no parser was run, and no database rows were inserted. Browser-readable GeoNames countryInfo excerpts and GeoNames place/admin search pages were inspected. The available countryInfo view was cached/dated rather than a captured current snapshot. Values below are mapping candidates, not a signed-off ISO snapshot or completed import.

| Country/area | GeoNames countryInfo candidate | Proposed handling / result |
|---|---|---|
| Kenya | KE / KEN / 404; GeoNames ID 192950; Nairobi capital; KES and calling code 254 | Candidate row. Validate ISO codes against current approved ISO source; currency becomes a separate FK; machine-parsed place sample pending |
| United Kingdom | GB / GBR / 826; GeoNames ID 2635167; London capital | Use GB candidate, not UK; ISO verification pending |
| Japan | JP / JPN / 392; GeoNames ID 1861060; Tokyo capital | Candidate row; distinguish administrative Tokyo from populated-place Tokyo by source ID and feature type |
| Brazil | BR / BRA / 076; GeoNames ID 3469034; Brasília capital | Store numeric code as text 076; no conversion to integer 76 |
| United States | US / USA / 840; GeoNames ID 6252001; Washington capital | Candidate row; represent state/county/place levels from source, not hard-coded universal levels |
| Hong Kong | HK / HKG / 344; GeoNames ID 1819730 | Separate area identity; explicit entity-kind/selectability review |
| Taiwan | TW / TWN / 158; GeoNames ID 1668284 | Separate area identity; verify ISO fields and apply explicit classification policy |
| Kosovo | GeoNames source values XK / XKX / 0; GeoNames ID 831053 | Keep codes source-only; ISO fields null unless officially verified; pending owner policy |

GeoNames countryInfo explicitly notes GB versus reserved UK and its temporary XK code. All ISO fields in this table remain candidates pending current ISO verification.

### Geographic relationship spot checks

- **Kenya:** GeoNames search results place Kisumu in Kisumu County and Mombasa in Mombasa County; admin1 crosswalk includes Nairobi County (GeoNames ID 184742) and Kisumu County (191242). Before import, verify the exact populated-place IDs and paths from a checksum-pinned allCountries/admin snapshot.
- **United Kingdom:** GeoNames shows London under England/Greater London and also returns unrelated places named London in other countries. Country context and source IDs are required.
- **Japan:** GeoNames shows Tokyo as a capital/populated-place record and Tokyo as an administrative division with distinct feature classifications. Keep separate records when source IDs differ.
- **Feature types:** GeoNames defines feature class A for administrative features and P for populated places; finer feature codes must be mapped with reviewed rules. Do not label every P record a city or every A record a selectable state.

**Counts:** 8 candidate country/area rows inspected; 0 geographic source records machine-imported; accepted/rejected/unmatched/ambiguous database counts **not measured** because no pinned source files were parsed. A real dry-run report must measure input, accepted, rejected/quarantined, duplicates, ambiguous matches, missing parents, code coverage, aliases and per-country/feature totals.

## 6. Import and update pipeline

1. Download files into staging only. Capture retrieval time, exact URL, byte size, SHA-256, ETag/Last-Modified, licence and parser version. Never fetch directly into production.
2. Verify ZIP integrity, UTF-8, tab/column counts, required fields, IDs, duplicate source IDs and coordinate ranges. Preserve source rows unchanged.
3. Stage raw data with source snapshot references; normalize separately.
4. Map ISO values only after current ISO validation; unknown/non-ISO codes remain source identifiers. New entries default to pending review and non-selectable.
5. Match admin records by country + administrative code + source ID, never by name alone.
6. Filter allCountries using approved feature codes; preserve GeoNames ID, feature class/code, country/admin codes, coordinates and source modification date.
7. Import alternateNamesV2 with language/name type/flags/effective dates; do not flatten aliases.
8. Produce a dry-run reconciliation report and exception CSV/JSON before writes: accepted, rejected, unmatched, ambiguous, duplicate, changed, deprecated and missing-parent.
9. Require human review of non-ISO entries, changed identifiers, uncertain parentage, material status/name changes and source conflicts.
10. Upsert by stable source + external ID, not name. An identical snapshot must not create new identities or unintended changes. Resume partial runs using snapshot/record keys.
11. Apply only to an explicitly approved non-production database after schema approval; validate constraints, relationships, RLS and APIs. Production requires separate approval.
12. Save manifest, parser version, report, decisions and commit reference.

GeoNames documents daily modifications and deletions. Use them to detect changes, not to auto-delete referenced records. Deprecate and map replacements when verified; preserve foreign keys and historical profile/vacancy snapshots. Do not silently overwrite a material parent/country change. Queue deltas for review.

## 7. API and UI proposal

Not implemented endpoints; proposed contracts only.

- **GET /api/catalog/countries?query={text}&code={alpha2|alpha3|numeric}&limit={n}&cursor={token}**: active/selectable approved rows by default; search canonical name/aliases/codes; return stable id, commonName, nullable ISO codes and entityKind; bounded pagination.
- **GET /api/catalog/countries/{countryId}**: return one country/area by internal ID; never substitute another record for an unknown/inactive ID.
- **GET /api/catalog/countries/{countryId}/administrative-areas?parentId={placeId}&query={text}**: verify the country and any parent belong together and parent type is valid.
- **GET /api/catalog/countries/{countryId}/places?parentId={placeId}&type={type}&query={text}**: return approved places only; enforce same-country parent context.
- **GET /api/catalog/places/{placeId}**: return one place and its approved parent path.

Proposed errors: 400 malformed code/filter/parent; 404 unknown ID; 409 stale/conflicting catalog version where relevant; 429 rate limit. Public APIs must not expose inactive admin notes or source-review details.

UI: search country name, alias or code; retain IDs, not names, in form state; selecting a new country clears prior location selections; show region/province/county only when meaningful; do not force a universal hierarchy; retain historical labels for inactive referenced records but block new selection. The 64-entry priority list may influence featured defaults, not API eligibility or the master catalog.

## 8. Acceptance tests

**Codes and identity**
- Uniqueness for non-null ISO alpha-2/alpha-3/numeric-3; preserve leading zeroes.
- Null ISO fields are allowed with internal ID and provenance.
- GeoNames IDs preserved and unique; duplicate IDs in a snapshot fail.
- Kosovo XK/XKX stays source-only; GB is alpha-2 candidate and UK is not treated as ISO alpha-2.
- Unknown/malformed/conflicting/reserved codes are quarantined, not guessed.
- Hong Kong and Taiwan remain separate identities with explicit classification/selectability review.
- Missing currency/capital/calling code is allowed; non-null currency references must resolve.

**Names and hierarchy**
- Canonical names/aliases searchable with documented case/diacritic normalization; original spelling retained.
- Same names in multiple countries return contextual candidates; alias text not globally unique.
- Historic aliases do not outrank current canonical names.
- Kenya queries return only places whose country_id is Kenya; cross-country parent IDs fail.
- Parent is same-country; self-parent/cycles fail; no synthetic city parent is created.
- Feature-code tests distinguish administrative divisions, populated places, historic features, parks, roads and other non-location records.

**Import and updates**
- Identical rerun creates no duplicates or unintended changes; interrupted run resumes safely.
- Malformed encoding/columns, missing IDs, duplicate IDs and ZIP/checksum errors stop or quarantine with reasons.
- Modifications update the correct source-linked record; deletions create deprecation review and never cascade-delete referenced locations.
- Changed codes, country assignment or ambiguous parents are flagged for review.
- Input counts reconcile to accepted + rejected/quarantined under documented rules; nothing disappears silently.
- Reports include per-country/feature totals, ISO and GeoNames ID coverage, aliases, valid parent links, duplicate collisions and unresolved references.

**API/security**
- Candidates/employers cannot edit or activate shared catalog entries.
- Catalog administration requires a dedicated permission, server-side authorization, validation and audit.
- Audit records actor, action, record/version, diff reference, reason, snapshot, timestamp and outcome; no secrets or unnecessary PII.
- Public endpoints return only active/selectable approved rows; bounded pagination/rate limits and safe errors are tested.
- RLS/privileges and API checks are independently tested; CI never targets production by default.

## 9. Migration, security and recovery gates

A later implementation PR must include exact DDL, constraints/indexes/FKs, RLS/grants, authorization matrix, source manifest and dry-run report, migration impact analysis, forward-only migration and rollback/forward-fix plan, non-production test evidence, and explicit catalog-admin/audit policies. Migration governance in the repository requires authorization design and RLS policies, not just enabling RLS.

The non-production database must be explicitly approved and allow-listed; CI/import rehearsal must fail closed if the target is production or unknown. Production schema creation and import require separate approvals.

**Phase 4C remains BLOCKED** until the independent recovery target and procedure are separately approved and backup/read-back/restore evidence independently verified. Synthetic tests or a successful catalog import are not recovery evidence.

## 10. Owner decisions

1. Approve classification vocabulary and selectability policy for ISO-listed countries/areas, territories, disputed/special areas, GeoNames-only and historical entries.
2. Decide initial launch handling for Hong Kong, Macao, Taiwan and Kosovo; this proposal makes no geopolitical determination.
3. Approve source precedence for canonical/official names when ISO, GeoNames and national authorities differ.
4. Approve current ISO validation source/snapshot and update/licensing process.
5. Locate/identify the owner's 64-entry spreadsheet; it remains a priority list, not the master definition.
6. Approve launch priority and whether first release exposes all reviewed entries or only selected entries.
7. Approve GeoNames attribution wording/location and data notice.
8. Approve currency source and effective-date rules.
9. Approve feature-code mapping for city/town/locality and historic/unpopulated features.
10. Choose the first import scope: country + admin1/admin2 + selected populated places, or all relevant place features after dry-run.
11. Separately authorize non-production database provisioning and a later schema/import PR.
12. Assign catalog admin, source refresh, correction and audit responsibilities.
13. Keep production import, production configuration and Phase 4C separately gated.

## 11. Recommended next step

After schema and policy approval, produce a source-pinned sample package for Kenya, the United Kingdom, Japan, Brazil and the United States, plus Hong Kong, Taiwan and Kosovo code edge cases. Include country rows, admin1/admin2, selected populated places, alternate names, source IDs, checksums, a mapping report and exception CSVs.

Validate Nairobi County, Kisumu County, Kisumu and Mombasa by country/admin codes and GeoNames IDs; test aliases and same-name collisions; repeat for countries across several regions. The sample report must contain actual machine counts and rejected/unmatched/ambiguous records. Only after it passes should a worldwide dry run be proposed. Never import the full world dataset directly into production.

## 12. Evidence links

- [Master Plan V2 repository baseline](https://github.com/job-grid/job-grid/tree/main)
- [GeoNames countryInfo](https://download.geonames.org/export/dump/countryInfo.txt)
- [GeoNames allCountries](https://download.geonames.org/export/dump/allCountries.zip)
- [GeoNames admin1 crosswalk](https://download.geonames.org/export/dump/admin1CodesASCII.txt)
- [GeoNames admin2 crosswalk](https://download.geonames.org/export/dump/admin2Codes.txt)
- [GeoNames readme](https://download.geonames.org/export/dump/readme.txt)
- [GeoNames data and licence context](https://www.geonames.org/export/)
- [ISO 3166 country codes](https://www.iso.org/iso-3166-country-codes.html)
- [GeoNames Kenya populated-place search](https://www.geonames.org/advanced-search.html?country=KE&fclass=P&q=)
- [GeoNames Japan place search](https://www.geonames.org/advanced-search.html?country=JP)
- [GeoNames UK place search](https://www.geonames.org/search.html?country=GB)

**Requested disposition:** owner review of schema, entity policy, source preflight, import controls and decisions. This proposal does not authorize schema creation, migrations, imports, deployment or production changes.


## 5A. PR #27 source-pinned validation attempt — BLOCKED

Attempt date: 2026-10-10 UTC. Isolated workspace: /tmp/geonames-stage. No repository raw archives, database, production or deployment target was used.

Python standard-library HTTPS retrieval with a 20-second timeout failed for all nine official URLs before receiving an HTTP response. Exact error for each: URLError: [Errno -3] Temporary failure in name resolution. Sources: KE.zip, GB.zip, JP.zip, BR.zip, SG.zip, countryInfo.txt, admin1CodesASCII.txt, admin2Codes.txt and readme.txt, all under https://download.geonames.org/export/dump/.

A second fetch attempt via the connected retrieval service returned target_unreachable for each of the five country ZIP archives. It did return extracted text for countryInfo.txt, both admin crosswalks and readme.txt, but those extracted page contents are not archive bytes and cannot support source ZIP byte-size/checksum or country-record counts.

Therefore no archive passed ZIP integrity; no current approved ISO 3166 authority snapshot was obtained; and no place rows were parsed. SHA-256, bytes for inaccessible archives, record counts, accepted/rejected/quarantined place rows, duplicate IDs, ambiguous country mappings, parent exceptions, alternate-name coverage and per-country feature counts remain NOT MEASURED, not zero. The previous browser-only place checks are leads, not source-ID-verified reconciliation for Nairobi, Kisumu or Mombasa.

Tooling added to this branch:
- scripts/geonames-sample-validate.mjs — isolated source-manifest/checksum preflight; emits source-manifest.json, validation-summary.json, exceptions.jsonl and retrieval-errors.json. It performs no database operations, does not commit raw source files, requires explicit workspace, supports optional download, preserves numeric country code candidates as strings (including 076), and intentionally exits blocked until the source gates are satisfied.
- tests/geonames-sample-validate.test.js — tests the required URL list, checksum gate, fail-closed behavior, string preservation of 076 and null (not fabricated zero) counts.

Important limitation: this is not the completed sample parser/reconciliation requested by the owner. It is source retrieval/checksum preflight only. The 19-field country archive parser, ZIP integrity gate, approved ISO cross-check, reviewed feature mapping, duplicate-ID reconciliation, alternate-name parsing, same-country parent validation and Kenya place ID/admin-code checks remain incomplete. The helper intentionally reports BLOCKED; its existence must not be represented as completion.

Reproduction on a network-enabled isolated runner: node scripts/geonames-sample-validate.mjs --workspace /isolated/geonames-staging --download. Pin reviewed expected SHA-256 values in the workspace manifest before treating any source as verified. Do not commit source archives. No database migration, seed, import, deployment or production/recovery action was performed. Phase 4C remains BLOCKED.


## 5B. Uploaded GeoNames sample validation — 2026-10-10 update

The owner supplied `JobGrid-GeoNames-Sample-20261010-163234.zip`. This artifact was read and validated locally; it supersedes the earlier statement that no machine-generated sample output was available, but does not erase the earlier source retrieval limitation.

- ZIP: 1,346,867 bytes; SHA-256 `feba409196d05d77e4a02e194c3223c2a1849231c8e80594934d9e99370ab4bf`; ZIP member integrity check passed.
- The supplied summary reports 13,472,324 worldwide rows scanned, zero malformed 19-field rows, and 481,942 rows across the five country codes before sample selection.
- Measured output: 25,685 selected place rows and 25,685 distinct GeoNames IDs; zero duplicate IDs and zero invalid coordinates within the selected output; 5 country metadata rows; 125 admin1 crosswalk rows; 6,977 admin2 crosswalk rows.
- All 24 exceptions are `admin1_crosswalk_not_found`, and all are Singapore (SG). Rechecking the selected populated places against the included admin1 crosswalk reproduced the same 24 SG-only misses; no admin2 misses were found. These are unresolved source-model/crosswalk exceptions, not automatically invalid records. Preserve source IDs/codes and do not invent administrative parents.
- Source-ID/admin1 checks: Nairobi 184745 / KE.05 → Nairobi County crosswalk ID 184742; Kisumu 191245 / KE.26 → Kisumu County crosswalk ID 191242; Mombasa candidate 186301 / KE.37 → Mombasa County crosswalk ID 186298. A same-name Mombasa record (186300 / KE.27) also exists and must remain distinct pending semantic review. The sample has 11 Brasília name matches; use ID, feature code and admin context rather than name-only matching.
- Brazil numeric code remains text `076`; GB is used for United Kingdom; Singapore's populated-place record 1880252 has blank admin codes and must not be assigned a synthetic parent.

Detailed report: [GeoNames sample validation report](geonames-sample-validation-report-2026-10-10.md) and [machine-readable JSON results](geonames-sample-validation-report-2026-10-10.json).

Limitations remain material: the uploaded ZIP does not contain the original allCountries.zip, original countryInfo source, or full admin crosswalks. Thus the source hashes/byte sizes in its manifest were not independently recomputed from the original source bytes. The supplied script uses local filesystem `st_mtime` for a field named `last_modified_utc`; it should be renamed to `local_file_mtime_utc` or replaced with verified HTTP Last-Modified metadata. Crosswalk presence does not prove a parent-child relationship, and parent links were not resolved. A current approved ISO authority snapshot was not independently validated.

The sample output supports owner review of these measured results, but is not a production catalog acceptance. No database operations, imports, migrations, production changes, Cloudflare changes or PR merge were performed. Phase 4C remains BLOCKED.
