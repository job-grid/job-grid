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

The source-pinned candidate audit completed successfully in [Phase 0 CI run 38179021834](https://github.com/job-grid/job-grid/actions/runs/38179021834). It downloaded the official [GeoNames Kenya archive](https://download.geonames.org/export/dump/KE.zip), passed ZIP CRC validation and scanned all **31,490** records in `KE.txt`.

| Evidence check | Result |
|---|---:|
| Normalized name/alias candidate records | 15 |
| Exact Githunguri Sub-County administrative-label candidates | **0** |
| Githunguri administrative-feature name candidates | 3 |
| Kiambururu administrative-feature name candidates | 1 (the target itself) |
| Target GeoNames ID `192705` found exactly once | Yes |
| Approved parent IDs / operational links created | **0 / 0** |

The three Githunguri administrative candidates in that exact source snapshot are:

| GeoNames ID | Official dump label | Feature | Raw admin1 | Disposition |
|---|---|---|---|---|
| `197217` | Githunguri Sub-Location | `ADMD` | `22` (Kiambu) | Lower-level administrative name candidate; not a sub-county |
| `197218` | Githunguri Sub-Location | `ADMD` | `38` (Murang'a) | Same label in a different county; not the Kiambu sub-county |
| `197219` | Githunguri Location | `ADMD` | `22` (Kiambu) | Location-level feature; not the sub-county |

So the current source dump has no exact normalized administrative feature labelled **Githunguri Sub-County** among the reviewed name/alias candidates. This is a bounded result from the current source snapshot and search labels; it is not a proof that no alternate-language name, historical node, or identifier exists in any dataset. The three similarly named administrative records have mismatched administrative levels or location context and cannot safely be substituted as the parent.

The CI source fingerprints are:
- `KE.zip` SHA-256: `310a0086d873b5990d2707049d0a79b077e582a0ec5eb7226a2a3943082b033d`
- `KE.txt` SHA-256: `921a723d32bffcb57e0a781d7140ce47e9fb14c1ac80eecbfe5801ef80ed0f32`
- Retrieval time recorded by CI: `2026-10-11T22:05:45Z`; HTTP 200; ZIP CRC validation passed.

The audit records archive and country-text SHA-256 digests, retrieval metadata, feature codes, raw administrative codes, coordinates, modification dates, and which source field matched each label. It is deliberately **discovery-only**: even an exact-label candidate would require a separate manual identity crosswalk before approval. The [CI artifact](https://github.com/job-grid/job-grid/actions/runs/38179021834/artifacts/11716208897) contains row-level JSON/CSV and the retrieval manifest; the compressed GeoNames source archive itself is not uploaded.

## Decision boundary

- **Confirmed:** the current official native parent unit is Githunguri Sub-County in Kiambu County.
- **Not confirmed:** a GeoNames node or stable catalog identity that represents this precise sub-county, and an authoritative unit-identifier crosswalk linking the 2024 Gazette's Kiambururu Location to GeoNames ID 192705.
- **Not approved:** substituting GeoNames ID 197219, skipping the sub-county to use a county node, or using a name/coordinate match as a complete identity crosswalk.
- Raw admin1 code \`01\` and legacy key \`KE.01\` remain unchanged. Kiambururu stays excluded from the effective initial administrative selector. Operational parent links, database changes, migrations, seeds, imports, and production changes remain at zero.

## Sources

- [Kenya Gazette, 14 February 2024 — Administrative Units](https://www.interior.go.ke/sites/default/files/2024-05/gazette-vol.-17-14-2-24-special-admin-units.pdf)
- [Kiambu County Government — Administrative Units](https://kiambu.go.ke/administrative-units/) — distinguishes National Government administrative sub-counties from county-government/electoral units.
- [Kiambu County Annual Development Plan FY 2026/2027](https://kiambu.go.ke/wp-content/uploads/2025/09/Kiambu-County-ADP-2026.2027-FINAL-to-assembly.pdf)
- [KNBS 2025 Statistical Abstract — Administrative Units](https://www.knbs.or.ke/wp-content/uploads/2025/11/2025-Statistical-Abstract.pdf)
- [GeoNames Kenya archive](https://download.geonames.org/export/dump/KE.zip)
- [GeoNames: Githunguri Location, ID 197219](https://www.geonames.org/197219/githunguri-location.html)
- [GeoNames: Kiambururu Sub-Location, ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html)
- [Kenya Law — IEBC Act No. 9 of 2011](https://www.kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/IndependentElectoralandBoundariesCommissionNo9of2011.pdf)
