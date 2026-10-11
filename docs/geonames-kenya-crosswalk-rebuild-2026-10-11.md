# Kenya crosswalk rebuild — 2026-10-11

**Current status (2026-10-12): one parent path verified; Kiambururu remains unresolved.**

This rebuild does not repeat the old audit merely to reconfirm missing keys. It combines the source-pinned current GeoNames admin1-key audit with the separately recorded Kenyan administrative-source dossier and emits a deterministic JSON/CSV disposition for the two exceptions. CI regenerates the ledger whenever the official current crosswalk is fetched.

## What is missing

| Target | What is verified | What is still missing |
|---|---|---|
| GeoNames 192705 — Kiambururu Sub-Location, raw admin1 01 / key KE.01 | The current GeoNames crosswalk has no KE.01 key. Official historical material places Kiambururu in the Kiambu/Githunguri/Ngewa context. | The official records disagree on the unit class (the 2011 IEBC schedule calls it a sub-location; the 2024 Ministry of Interior Gazette lists a Location). Neither source crosswalks the exact unit to GeoNames ID 192705. We need a dated authoritative unit identifier, its immediate parent and an explicit identifier crosswalk. |
| GeoNames 7800132 — Imenti Central, raw admin1 03 / key KE.03 | The current GeoNames crosswalk has no KE.03 key. Meru County Government records Central Imenti / Imenti Central in its administrative and constituency materials. | The name variant and unit type must be resolved to one current administrative-unit identifier. We need the effective-period/source code, the GeoNames ID crosswalk and the source-backed immediate parent path. A constituency match alone cannot establish an administrative-unit entity. |

## County-level candidates recorded, not promoted

- Kiambururu: GeoNames 8693007, Kiambu County (ADM2) is retained as a county-ancestor candidate only. Do not substitute GeoNames 192709, a distinct ADM1 record.
- Imenti Central: GeoNames 8693009, Meru County (ADM2) is retained as a county-ancestor candidate only. Do not substitute GeoNames 186824, a distinct ADM1 record.

These are different records at different GeoNames administrative feature levels. The ledger keeps the county candidate in a dedicated field and leaves immediate_parent_geonames_id null. It never writes to the operational catalog.

## Permanent CI behavior

The script scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs verifies the current crosswalk audit provenance, checks both source IDs and raw codes, checks that the candidate county entity is the expected ADM2 record, and emits one row per target. The regression tests fail if the raw code drifts, an ADM1 record is confused with an ADM2 county entity, or a county ancestor is accidentally promoted to an immediate parent.

The Kenya Phase 0 CI job runs the tests and rebuilds the ledger from the freshly retrieved official GeoNames admin1 crosswalk. The CSV and JSON are uploaded with the row-level audit and provenance manifest.

## Authorities used

- [GeoNames current admin1 crosswalk](https://download.geonames.org/export/dump/admin1CodesASCII.txt) — proves whether the legacy composite keys exist in the current crosswalk; key absence does not identify replacements.
- [Kenya Law — IEBC Act schedule](https://www.kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/IndependentElectoralandBoundariesCommissionNo9of2011.pdf) — county/ward/sub-location context for Kiambururu, but no GeoNames ID crosswalk.
- [Ministry of Interior — 14 February 2024 Administrative Units Gazette](https://www.interior.go.ke/sites/default/files/2024-05/gazette-vol.-17-14-2-24-special-admin-units.pdf) — current Location/Sub-County context for Kiambururu; the Location versus Sub-Location discrepancy is intentionally unresolved.
- [County Government of Meru — Sub Counties](https://meru.go.ke/sub-counties/) and [Sub-County Administrators](https://meru.go.ke/1164/sub-county-administrators/) — confirm the Central Imenti / Imenti Central names, but do not provide a GeoNames identifier crosswalk.
- [Kenya National Bureau of Statistics — 2019 Population and Housing Census reports](https://www.knbs.or.ke/2019-kenya-population-and-housing-census-reports/) — an authoritative discovery route for tables by county, sub-county, division, location and sub-location; the required exact-record lineage still needs to be captured and validated under permitted terms.

## Disposition

Both rows remain excluded from the active administrative selector until an authoritative identifier crosswalk and complete parent path are verified. Raw codes 01/03 remain unchanged. The code change closes the repeatable rebuild/reporting workflow, not the underlying identity gaps; zero operational parent links are approved. No migration, seed, import, live database or production changes are part of this work.


## Evidence improvement — 2026-10-12

The official native unit paths are now documented separately from GeoNames identifiers. See [Kenya current-unit path evidence](geonames-kenya-current-unit-path-evidence-2026-10-12.md) and the [machine-readable dossier](geonames-kenya-current-unit-evidence-2026-10-12.json). The Kenya CI ledger now reports two documented native paths, zero verified GeoNames entity crosswalks, and zero parent links. This narrows the remaining work to stable identifiers, direct source-backed crosswalks and catalog-parent mapping; those gates are not claimed as complete.


## Source-backed parent resolution — 2026-10-12

**Current result: one parent path is verified by a record-specific crosswalk override; Kiambururu remains unresolved.** This supersedes the earlier statement that both Kenya paths were unresolved.

### Imenti Central — resolved current admin1 parent

GeoNames target ID 7800132 is Imenti Central (ADM3), with raw admin1 code 03. The current crosswalk has no KE.03 key. The current parent record at [GeoNames ID 186824](https://www.geonames.org/186824/meru.html) documents the exact historical change: name:Meru Central District to Meru, admin1 03 to 35, and featureCode ADM2 to ADM1. The live official current crosswalk maps KE.35 to the same ID 186824. The County Government of Meru's [FY 2026/2027 County Annual Development Plan](https://meru.go.ke/assets/file/05b8937c-county-annual-development-plan-cadp-.pdf) independently lists Imenti Central as an administrative sub-county and separately identifies the same-named parliamentary constituency.

The versioned override maps only target 7800132 to current parent ID 186824 (KE.35, ADM1). It keeps target raw code 03 unchanged. It does not establish a generic KE.03 alias or rewrite any source records. The duplicate ADM2 node ID 8693009 is not used as the canonical first-order parent.

### Kiambururu — immediate parent remains unresolved

The [2024 Kenya Gazette](https://www.interior.go.ke/sites/default/files/2024-05/gazette-vol.-17-14-2-24-special-admin-units.pdf) documents the native path Kenya → Kiambu County → Githunguri Sub-County → Kiambururu (Location). GeoNames ID 197219 is Githunguri Location (ADMD), not Githunguri Sub-County, so it is not used as the immediate parent. Target raw admin1 01 and legacy key KE.01 remain unchanged until a catalog/GeoNames identity for Githunguri Sub-County is verified.

### Effective exclusion overlay

The original [128-row exclusion snapshot](geonames-sample-validation/results/crosswalk-reconciliation-20261010/initial-operational-admin-catalog-exclusions.csv) remains unchanged as historical evidence. CI generates a separate effective overlay of 127 unresolved records: 126 Japan records plus Kiambururu. Imenti Central is re-admitted to the proposed catalog through its source-backed parent override. This is repository-level catalog evidence only; no live database, migration, seed, import, production or deployment parent link has been written.

See the [machine-readable override](geonames-kenya-admin1-parent-override-2026-10-12.json), [one-row mapping export](geonames-sample-validation/results/crosswalk-reconciliation-20261010/kenya-admin1-parent-overrides-2026-10-12.csv), [effective exclusion overlay](geonames-sample-validation/results/crosswalk-reconciliation-20261010/effective-initial-operational-admin-catalog-exclusions-2026-10-12.csv), [rebuild generator](../scripts/geonames-kenya-crosswalk-rebuild-ledger.mjs), and [regression tests](../tests/geonames-kenya-crosswalk-rebuild-ledger.test.mjs).
