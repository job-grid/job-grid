# Kenya current-unit path evidence — 2026-10-12

**Progress:** both records now have documented official native administrative paths. Their GeoNames identifier crosswalks are still pending, so this evidence does not authorise a GeoNames parent link.

## Kiambururu — official current path identified

The Kenya Gazette of 14 February 2024 lists **Kiambururu under Locations** within **Githunguri Sub-County, Kiambu County**. The 2011 IEBC schedule calls Kiambururu a sub-location, and the 2019 KNBS census index contains the exact KIAMBURURU row with a population value of 4,000. These are dated source observations; we do not treat them as a same-date contradiction or infer a legal reclassification date from them.

Native current path: `Kenya → Kiambu County → Githunguri Sub-County → Kiambururu (Location)`.

GeoNames still calls ID `192705` **Kiambururu Sub-Location (ADM3)** and displays no parent. GeoNames ID `197219` is **Githunguri Location (ADMD)**; because the Gazette names Githunguri *Sub-County* as the parent, ID 197219 must not be substituted as the immediate parent. The authority does not provide a machine-readable unit ID/code crosswalk to GeoNames `192705` or a GeoNames node for Githunguri Sub-County.

Potential county nodes `192709` (ADM1 Kiambu County) and `8693007` (ADM2 Kiambu County) remain distinct candidates. Neither is approved as the immediate parent.

## Imenti Central — official current path identified

The County Government of Meru's **FY 2026/2027 County Annual Development Plan**, published in November 2025, states that its administrative structure has 16 sub-counties and lists Imenti Central in Table 1 with 4 divisions, 22 locations and 57 sub-locations. Its next section separately lists Imenti Central as a parliamentary constituency. The evidence supports the *administrative sub-county* path, while the same-name electoral unit remains a separate concept.

Native current path: `Kenya → Meru County → Imenti Central (Sub-County)`.

GeoNames ID `7800132` is still shown as **Imenti Central (ADM3)** with no parent link. The plan does not publish a code/identifier crosswalk from the current sub-county to `7800132`. GeoNames Meru nodes `186824` (ADM1 Meru) and `8693009` (ADM2 Meru County) are different entities; the path rebuild must select neither until the specific record-level crosswalk and canonical catalog convention are verified.

## What this closes, and what remains

- **Closed for source discovery:** the official *native* path (unit level and named administrative parent) is documented for both records.
- **Still open:** the stable unit identifier/code, direct source-backed entity crosswalk to each GeoNames target, and the target-to-parent GeoNames/catalog mapping.
- Raw codes `01` and `03` stay unchanged. Both operational parent IDs remain null. Both records remain excluded from the active administrative selector until the GeoNames crosswalk is verified.

## Sources

- [Kenya Gazette, 14 February 2024 — Administrative Units](https://www.interior.go.ke/sites/default/files/2024-05/gazette-vol.-17-14-2-24-special-admin-units.pdf)
- [Kenya Law — IEBC Act schedule](https://www.kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/IndependentElectoralandBoundariesCommissionNo9of2011.pdf)
- [KNBS 2019 Kenya Population and Housing Census, Volume II](https://www.knbs.or.ke/wp-content/uploads/2023/09/2019-kenya-population-and-housing-census-volume-2-distribution-of-population-by-administrative-units.pdf)
- [Meru County Annual Development Plan FY 2026/2027 (November 2025), p. 18](https://meru.go.ke/assets/file/05b8937c-county-annual-development-plan-cadp-.pdf)
- [GeoNames Kiambururu ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html) and [Githunguri Location ID 197219](https://www.geonames.org/197219/githunguri-location.html)
- [GeoNames Imenti Central ID 7800132](https://www.geonames.org/7800132/imenti-central.html)