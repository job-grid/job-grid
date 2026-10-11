# Kenya crosswalk rebuild — 2026-10-11

**Status: rebuild ledger implemented; both immediate parent paths remain unresolved.**

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
