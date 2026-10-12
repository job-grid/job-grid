# GeoNames country/area reconciliation and destination candidate package — 2026-10-12

**Country/area code result: PASS WITH DOCUMENTED EXCEPTIONS.** The live CI job reconciled the entire current GeoNames countryInfo list against the current public UN M49 country/area table, and now emits a row-level country/area destination candidate package. This is a country/area-layer deliverable only; it does not certify every city/town, administrative parent, alias, or operational database record.

## Measured result

Phase 0 CI run [#38190820033](https://github.com/job-grid/job-grid/actions/runs/38190820033), job **Phase 0 CI / Country-area code crosswalk audit**, completed successfully. Its [country/area code audit and destination candidate package](https://github.com/job-grid/job-grid/actions/runs/38190820033/artifacts/11721722211) includes source provenance, row-level reconciliation, and the candidate CSV/JSON.

| Measure | Result |
|---|---:|
| GeoNames countryInfo rows parsed | 252 |
| Current coded country/area rows in UN M49 | 248 |
| Exact alpha-2 + alpha-3 pairs matched, GeoNames → UN M49 | 248 |
| Exact alpha-2 + alpha-3 pairs matched, UN M49 → GeoNames | 248 |
| Source tuples absent from current UN M49 | 4 |
| Alpha-2/alpha-3 conflicts | 0 |
| Duplicate code groups | 0 |
| Undocumented source exceptions | 0 |
| Country/area records accounted for in candidate package | 252 / 252 |
| Proposed current destination-area candidates | 250 |
| Historical records retained but nonselectable | 2 |
| Operational selectability applied | 0 |
| Database or production writes | 0 |

The 250 proposed destination entries are the 248 UN M49 coded country/area records plus two current geographic destination areas that do not appear as separate current rows in UN M49. The two old source entities are retained as historic references and excluded from current destination selection. The candidate export is deliberately **not** an import or a live selector configuration.

## Four documented exceptions

The manifest is [versioned in the repository](geonames-un-m49-exception-dispositions-2026-10-12.json). The current CI job checks the actual live source IDs and code tuples against it, verifies every out-of-M49 tuple is covered exactly once, and fails closed if a tuple changes, disappears, or a new unlisted exception appears.

| GeoNames record | Current disposition | Destination behavior |
|---|---|---|
| Kosovo, ID `831053`, source tuple `XK/XKX/0` | Current destination area; GeoNames tuple retained only as source identifiers; ISO fields left null | Proposed searchable/selectable destination without a sovereignty claim |
| Taiwan, ID `1668284`, source tuple `TW/TWN/158` | Current destination area; tuple has corroborating ISO newsletter evidence; live ISO OBP/collection refresh remains outstanding | Proposed searchable/selectable destination without a sovereignty claim |
| Serbia and Montenegro, ID `8505033`, historical tuple `CS/SCG/891` | Former entity dissolved on 3 June 2006 into Serbia and Montenegro | Historical reference only; not a current selectable destination |
| Netherlands Antilles, ID `8505032`, historical tuple `AN/ANT/530` | Former entity dissolved on 10 October 2010; Aruba separated earlier in 1986 | Historical reference only; not a current selectable destination |

### Why the two current destination areas are separate from sovereignty policy

UNSD says M49 is a statistical classification and its groupings do not imply political affiliation. Its FAQ explains that Kosovo is considered part of Serbia for M49 purposes, with numerical code 412 available for strictly statistical use; it similarly places Taiwan Province of China within China for M49, while 158 may be used for strictly statistical purposes. Those are M49 classification notes, not rules that Job Grid must suppress a geographic destination from a job-location search. Source codes remain preserved and any statistical rollup must be represented separately from ISO codes. [UN M49 overview and FAQ](https://unstats.un.org/unsd/methodology/m49/?hl=en-GB).

The ISO newsletter archive provides corroborating code evidence for `TW/TWN/158`, but a live current ISO Online Browsing Platform / Country Codes Collection snapshot was **not** retrieved in this audit. The candidate package records that limitation and does not claim the public UN table is a substitute for all current ISO records. [ISO country-code information](https://www.iso.org/iso-3166-country-codes.html) · [ISO 3166 newsletter VI-3](https://www.iso.org/modules/legacy_files/n567_newsletter.pdf).

UNSD's recent-changes notes say Serbia and Montenegro was dissolved in 2006 into Serbia (M49 688) and Montenegro (M49 499). They also say the Netherlands Antilles federation was dissolved in 2010; Aruba had already separated in 1986, while Curaçao, Sint Maarten and Bonaire/Sint Eustatius/Saba have successor-context records. These records are never reactivated as current destinations. [UNSD M49 recent changes](https://unstats.un.org/unsd/methodology/m49/?hl=en-GB) · [ISO 3166-3 (formerly used country names)](https://www.iso.org/standard/72484.html).

## Candidate package contents and code policy

The CI artifact includes:
- `country-area-destination-catalog-candidate.csv` — 252 row-level candidate records for review;
- `country-area-destination-catalog-candidate.json` — structured records and integrity counts;
- row-level source reconciliation CSV/JSON;
- aggregate code audit JSON and the actual source snapshot manifest;
- the versioned exception-disposition manifest.

Each candidate retains GeoNames ID and raw countryInfo code tuple, carries a distinct source/matching status, and uses the UN M49 country/area label for exact pair matches. Alpha-2 and alpha-3 values are copied from the UN table's expressly labelled ISO fields for matched rows. For all 248 exact alpha-pair matches, GeoNames' numeric value also agrees with the UN numerical code; the exporter now emits that value as an `iso_numeric3_candidate` with explicit source-provenance status, rather than leaving the code empty. ISO says the numeric country code is assigned by the UN, while the UN M49 page identifies its numerical codes as those used by the UN Statistics Division ([ISO guidance](https://www.iso.org/iso-3166-country-codes.html), [UN M49 methodology](https://unstats.un.org/unsd/methodology/m49/overview/)). This is a source-backed candidate, not a direct download of ISO's current Country Codes Collection/OBP; the refresh gate remains open. Kosovo's ISO fields stay null, Taiwan's code tuple is separately corroborated by an official ISO newsletter, and historical rows have no current ISO tuple. The candidate package never claims that records have already become selectable in the live system.

## What is and is not complete

**Completed for this pass:** all 252 countryInfo source rows have one identity/code disposition; all 248 current UN M49 country/area rows match GeoNames by exact alpha-code pair; the four exceptions are versioned and no automatic replacements are authorized. The package contains 250 proposed current destination-area entries and two historic records.

**Still open:** current ISO source refresh for numeric-code maintenance and Taiwan periodic re-verification; approval of product display/selectability policy; all city/town/locality and administrative-area candidates; parent hierarchy verification (including 126 Japan ADM4 paths and the Kenya Kiambururu mismatch); alternate-name/language coverage; source update lifecycle and final dry-run/import reconciliation. The wider GeoNames source scan covers 13,472,324 rows, but source row counts alone do not certify place-level completeness.

No database schema, migration, seed, import, live selector change, production write, or deployment was made. PR #27 remains a draft; the database/recovery gates remain separate from this country/area candidate package.
