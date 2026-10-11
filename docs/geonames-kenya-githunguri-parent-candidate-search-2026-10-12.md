# Githunguri Sub-County identity search — 2026-10-12

**Disposition: native administrative unit confirmed; GeoNames parent identity still blocked.** No operational parent link has been created.

## What the official Kenyan sources establish

The Ministry of Interior's Kenya Gazette of 14 February 2024 lists Kiambururu as a **Location** under **Githunguri Sub-County, Kiambu County**. This establishes the current native administrative path:

\`Kenya → Kiambu County → Githunguri Sub-County → Kiambururu (Location)\`

The Kenya National Bureau of Statistics (KNBS) **2025 Statistical Abstract**, in its *Administrative Units* table, also lists **Githunguri** under **Kiambu**. The table row is \`CODE=22, COUNTY=Kiambu, SNO=14, SUB_COUNTY=Githunguri\`. This is independent evidence that Githunguri is a current listed sub-county. The report labels SNO as a serial number; it is **not** treated here as a persistent canonical unit identifier or as a GeoNames crosswalk.

## Why GeoNames ID 197219 cannot be used as the parent

GeoNames ID [197219](https://www.geonames.org/197219/githunguri-location.html) is named **Githunguri Location** and has feature code **ADMD**. The Gazette names **Githunguri Sub-County**, a different administrative level, as the parent of Kiambururu Location. Matching the word “Githunguri” is not enough to collapse those two unit types.

The target [GeoNames ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html) is called **Kiambururu Sub-Location (ADM3)** and displays no parent. The 2011 IEBC schedule uses the historical label *Sub-Location*, while the 2024 Gazette lists *Location*. These dated observations do not establish a formal reclassification date, nor do they alone provide a machine-readable ID crosswalk.

## Reproducible GeoNames candidate scan

Phase 0 CI now scans the freshly retrieved official [GeoNames Kenya archive](https://download.geonames.org/export/dump/KE.zip) and records exact normalized name/alias matches for:

- Githunguri, Githunguri Location, and spelling variants of Githunguri Sub-County.
- Kiambururu and the relevant Location/Sub-Location labels.

The audit records the archive and country-text SHA-256 digests, HTTP retrieval metadata, feature codes, raw administrative codes, coordinates, modification dates, and the exact source field that matched each label. It is deliberately **discovery-only**: even a same-name sub-county candidate stays unapproved until the evidence supports the identity crosswalk. The CI artifact contains row-level JSON and CSV; the compressed GeoNames source archive is not uploaded.

## Decision boundary

- **Confirmed:** the current official native parent unit is Githunguri Sub-County in Kiambu County.
- **Not confirmed:** a GeoNames node or stable catalog identity that represents this precise sub-county, and an authoritative unit-identifier crosswalk linking the 2024 Gazette's Kiambururu Location to GeoNames ID 192705.
- **Not approved:** substituting GeoNames ID 197219, skipping the sub-county to use a county node, or using a name/coordinate match as a complete identity crosswalk.
- Raw admin1 code \`01\` and legacy key \`KE.01\` remain unchanged. Kiambururu stays excluded from the effective initial administrative selector. Operational parent links, database changes, migrations, seeds, imports, and production changes remain at zero.

## Sources

- [Kenya Gazette, 14 February 2024 — Administrative Units](https://www.interior.go.ke/sites/default/files/2024-05/gazette-vol.-17-14-2-24-special-admin-units.pdf)
- [KNBS 2025 Statistical Abstract — Administrative Units](https://www.knbs.or.ke/wp-content/uploads/2025/11/2025-Statistical-Abstract.pdf)
- [GeoNames Kenya archive](https://download.geonames.org/export/dump/KE.zip)
- [GeoNames: Githunguri Location, ID 197219](https://www.geonames.org/197219/githunguri-location.html)
- [GeoNames: Kiambururu Sub-Location, ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html)
- [Kenya Law — IEBC Act No. 9 of 2011](https://www.kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/IndependentElectoralandBoundariesCommissionNo9of2011.pdf)
