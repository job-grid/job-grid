# ISCO-08 occupation catalogue foundation

## What this contains

`isco-08-unit-groups.csv` contains 436 candidate unit-group records and their hierarchy labels for initial review. The rows were extracted from a public CSV copy that represents the ISCO-08 structure. This is a source foundation, **not yet an approved or production-importable catalogue**.

The International Labour Organization (ILO) identifies ISCO-08 as a four-level classification with 10 major groups, 43 sub-major groups, 130 minor groups and 436 unit groups. See the [official ILO ISCO-08 page](https://isco.ilo.org/en/isco-08/) and the [ILO publication describing its structure and definitions](https://www.ilo.org/publications/international-standard-classification-occupations-2008-isco-08-structure).

## Source and verification status

- **Classification authority:** International Labour Organization, ISCO-08.
- **Official landing page:** https://isco.ilo.org/en/isco-08/
- **Source copy used for this first extraction:** https://github.com/ails-lab/Sure-GB/blob/main/ISCO-08-EN.csv
- The official page advertises downloadable ISCO-08 structure and occupational-title materials. On 14 October 2026, the clickable CSV/XLSX links on the current landing page resolved to legacy `www.ilo.org` URLs that returned 404. Direct `webapps.ilo.org` URLs for the corresponding CSV/XLSX responded as binary files, but this workflow could not read their bytes for a row-by-row comparison. The available CSV mirror was therefore used only to prepare a candidate dataset; reconciliation to the primary file remains outstanding.
- The repository test verifies record counts, code shapes, unique unit-group IDs, hierarchy prefixes, and that all records remain unmapped/inactive. **It does not prove that every code/title is identical to the current ILO primary-source file.**

Every record is labelled `requires_official_source_crosscheck`; category mapping is `pending`; `job_grid_category_slug` is blank; and `publicly_active` is `false`. These flags are deliberate.

## Do not import to live Supabase

Do not run this file as a database seed, mark rows verified, or make the records visible on the website yet. PR #45 defines a proposed `public.occupations` table but remains unmerged; even after that schema is approved, loading these records requires a source-level diff against an authoritative ILO download, a reviewed mapping to Job Grid's existing 25 category slugs, and a separately approved import migration.

The existing 496 starter job types and the earlier 5,000-row generated workbook are separate datasets. They must not be treated as official ISCO unit groups, nor as genuine vacancies.

## Next steps

1. Obtain a working authoritative ILO source file and reconcile every code/title pair.
2. Review the 436 unit-group-to-Job-Grid-category mappings; do not force an inaccurate single-category match.
3. Crosswalk the existing 496 starter role titles to ISCO-08 codes, retaining ambiguous matches for review.
4. Add aliases only when supported by a source or reviewed mapping.
5. Generate a data-only migration after PR #45 and the live recovery/security release gates have been separately resolved and approved.

## Proposed Job Grid category mappings

A first-pass, title-keyword rule set suggests an existing Job Grid category for 431 of the 436 records. 5 records remain unmapped for manual review. Counts are recorded in `public/data/occupations-isco08-review.json`.

These suggestions are not authoritative classifications. The CSV keeps `job_grid_category_slug` empty and leaves the existing `category_mapping_status` pending. Proposed values are stored separately under `proposed_job_grid_category_slug` and related fields, with the rule method and a reason recorded per row. No suggestion changes source verification status or public activation. A reviewer must approve mappings after primary-source reconciliation.
