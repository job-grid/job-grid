# Kenya external county-ancestor evidence review — 2026-10-11

**Result: two county-level ancestor candidates now have official administrative evidence. Neither is an approved immediate-parent path.**

This review adds outside-authority evidence to the exact-key audit. The official GeoNames composite keys `KE.01` and `KE.03` remain absent, and the GeoNames hierarchy panel still shows no parent links for the two target records. The evidence below identifies a plausible current county-level ancestor only. It does not change raw codes, declare immediate parentage, or authorize data writes.

## Evidence matrix

| Target GeoNames ID | Raw admin1 | Official source evidence | Current GeoNames county-level ancestor candidate | Disposition |
|---|---|---|---|---|
| 192705 — Kiambururu Sub-Location (ADM3) | `01` | 2011 IEBC Act schedule / 2012 revision places “Kiambururu” among sub-locations of Kiambu County in the Ngewa ward schedule. The 2024 Ministry of Interior Gazette lists “Kiambururu” as a *Location* under Githunguri Sub-County. | **8693007 — Kiambu County (ADM2)** | Candidate ancestor only; review required because the 2011 and 2024 sources differ on administrative level and neither crosswalks the unit to GeoNames ID 192705. |
| 7800132 — Imenti Central (ADM3) | `03` | Meru County Government lists “Central Imenti” as an administrative sub-county and constituency, and its sub-county administrator page uses “Imenti Central.” An official 2022 Kenya Gazette table places Central Imenti under Meru County. | **8693009 — Meru County (ADM2)** | Candidate ancestor only; exact identity/name-variant crosswalk and immediate path to GeoNames ID 7800132 remain unverified. |

## Sources and what each proves

### Kiambururu

- [Kenya Law — Independent Electoral and Boundaries Commission Act, No. 9 of 2011 (revised 2012)](https://www.kenyalaw.org/kl/fileadmin/pdfdownloads/Acts/IndependentElectoralandBoundariesCommissionNo9of2011.pdf), displayed PDF pages 180–181, schedule lines for County Assembly Ward 0580 Ngewa: the table lists the Kiambu County / Githunguri constituency framework and names Kiambururu among the sub-locations of Kiambu County. This is official evidence for county-level ancestry, not a record-ID crosswalk.
- [Kenya Ministry of Interior — Gazette Vol. 17, 14 February 2024, Special Issue: Administrative Units](https://www.interior.go.ke/sites/default/files/2024-05/gazette-vol.-17-14-2-24-special-admin-units.pdf): the indexed Gazette excerpt lists Githunguri Sub-County under Kiambu County and names Kiambururu as a **Location**, while the GeoNames ID 192705 page calls it “Kiambururu Sub-Location.” That level disagreement must be reviewed rather than silently normalized.
- [GeoNames ID 192705](https://www.geonames.org/192705/kiambururu-sub-location.html): the record is `ADM3`, coordinates `-1.05000, 36.83333`, raw historical admin1 key `KE.01` absent from today's admin1 crosswalk; the page's hierarchy panel lists only Kenya and the target.
- [GeoNames Kiambu ADM1 record ID 192709](https://www.geonames.org/192709/kiambu-county.html) links to a distinct child record named Kiambu County, ID **8693007**, feature `ADM2`. Do not substitute this county-level ID with the related Kiambu ADM1 ID 192709.

### Imenti Central

- [County Government of Meru — Sub Counties](https://meru.go.ke/sub-counties/): lists **Central Imenti** as an administrative sub-county and parliamentary constituency.
- [County Government of Meru — Sub County Administrators](https://meru.go.ke/1164/sub-county-administrators/): the official list includes an administrator for “Imenti Central,” corroborating the reordered name used by GeoNames.
- [Kenya Gazette, 24 August 2022](https://new.kenyalaw.org/akn/ke/officialGazette/gazette/2022-08-24/170/eng%402022-08-24/source): election-result tables explicitly place Central Imenti under Meru County.
- [GeoNames ID 7800132](https://www.geonames.org/7800132/imenti-central.html): the `ADM3` record is named Imenti Central and coordinates are `-0.00206, 37.59484`; raw key `KE.03` is absent from today's admin1 crosswalk, and the current GeoNames hierarchy panel lists no parent link.
- [GeoNames Meru ADM1 record ID 186824](https://www.geonames.org/186824/meru-county.html) links to a distinct child record named Meru County, ID **8693009**, feature `ADM2`. The possible county ancestor candidate is 8693009, not the related Meru ADM1 ID 186824.

## Important distinction

The current GeoNames hierarchy has two differently leveled records for each county name, e.g. Kiambu ADM1 (192709) vs Kiambu County ADM2 (8693007), and Meru ADM1 (186824) vs Meru County ADM2 (8693009). They are different GeoNames entities. The official external sources establish plausible county-level ancestry for review, but not a complete immediate-parent hierarchy, a direct ID link from the place record to the current county unit, or a correction to the raw legacy admin1 code.

The exact crosswalk keys remain absent in the live `admin1CodesASCII.txt` audit. Raw admin1 values `01` and `03` are preserved. The full 128-target source-pinned parent audit still reports:
- 126 Japan ADM4 rows blocked under `BLOCKED_RAW_ADMIN1_00_GENERAL_FEATURE_ANCESTOR_UNRESOLVED`;
- 2 Kenya ADM3 rows blocked for missing current exact crosswalk keys; and
- zero complete code-derived parent paths, zero explicit `ADM` hierarchy edges for the targets, and zero operational parent links.

## Required next review decision

Review whether each evidence-backed county-level ancestor should be added as a catalog lineage candidate, and what source/version rule is needed for the missing historic admin1 keys and intermediate administrative levels. Until that is approved, keep these candidates in this evidence dossier only. No live record, migration, seed, import, database or production state was changed.

The machine-readable version is [`geonames-kenya-external-ancestor-evidence-2026-10-11.json`](geonames-kenya-external-ancestor-evidence-2026-10-11.json).
