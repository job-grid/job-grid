# ISCO-08 occupation catalogue foundation

## What this contains

The catalogue contains 436 ISCO-08 unit-group records. Source-owned codes, titles and hierarchy labels are synchronized from the ILO-hosted official CSV by the source sync script. Source verification is recorded with the exact SHA-256 and retrieval time; Job Grid category suggestions remain unapproved, and the catalogue is not a vacancy list or production import.

The International Labour Organization (ILO) identifies ISCO-08 as a four-level classification with 10 major groups, 43 sub-major groups, 130 minor groups and 436 unit groups. See the [official ILO ISCO-08 page](https://isco.ilo.org/en/isco-08/) and the [ILO publication describing its structure and definitions](https://www.ilo.org/publications/international-standard-classification-occupations-2008-isco-08-structure).

## Source and verification status

- **Classification authority:** International Labour Organization, ISCO-08.
- **Official landing page:** https://isco.ilo.org/en/isco-08/
- **Source copy used for this first extraction:** https://github.com/ails-lab/Sure-GB/blob/main/ISCO-08-EN.csv
- The official ILO-hosted source CSV was retrieved at 2026-10-14T22:12:54Z; its SHA-256 is 9afc6377d6ed6738d59aa0476777042e180397400d7dcd932e084045228b4d49. The sync compared all 436 unit-group codes and titles plus all parent labels from the official hierarchy. The older public mirror was used only for the initial extraction and its title differences were replaced from the official file.
- The separate GitHub Actions workflow `.github/workflows/isco08-source-validation.yml` runs `scripts/validate_isco08_source.py`, which downloads the ILO-hosted primary CSV directly, compares all 436 unit-group codes, all 619 level titles (including parent labels), and checks that every candidate remains unmapped/inactive. A PASS proves an exact comparison to the bytes returned by the official URL at that run time; the log records a SHA-256 digest. A download failure is reported as a failure/unverified result and must never be interpreted as a source match. Job Grid category mapping remains a separate review gate.

Every record is labelled verified_source_match for its official ILO code/title/hierarchy fields; category mapping remains pending; job_grid_category_slug is blank; and publicly_active is false. The 431 category suggestions are still unapproved, with 5 records requiring manual mapping review.

## Do not import to live Supabase

Do not run this file as a database seed or treat it as a live vacancy feed. The official source code/title check has passed, but PR #45's proposed public.occupations schema remains unmerged. Loading these records requires human review of the proposed mappings to Job Grid's existing 25 category slugs, a separate migration review, and explicit production approval.

The existing 496 starter job types and the earlier 5,000-row generated workbook are separate datasets. They must not be treated as official ISCO unit groups, nor as genuine vacancies.

## Next steps

1. Review the 431 suggested Job Grid category mappings and manually decide the 5 unmapped records.
2. Crosswalk the existing 496 starter role titles to ISCO-08 codes, retaining ambiguous matches for human review.
3. Add aliases only when supported by a source or reviewed mapping.
4. Prepare a data-only migration after PR #45 and the live recovery/security release gates have been separately resolved and approved.

## Proposed Job Grid category mappings

A first-pass, title-keyword rule set suggests an existing Job Grid category for 431 of the 436 records. 5 records remain unmapped for manual review. Counts are recorded in `public/data/occupations-isco08-review.json`.

These suggestions are not authoritative classifications. The CSV keeps `job_grid_category_slug` empty and leaves the existing `category_mapping_status` pending. Proposed values are stored separately under `proposed_job_grid_category_slug` and related fields, with the rule method and a reason recorded per row. No suggestion changes source verification status or public activation. A reviewer must approve mappings after primary-source reconciliation.


## Latest official source audit

- Retrieval time (UTC): 2026-10-14T22:12:54Z
- Official CSV: https://webapps.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/ISCO-08%20EN.csv
- SHA-256: 9afc6377d6ed6738d59aa0476777042e180397400d7dcd932e084045228b4d49
- Result: 436/436 unit-group codes and titles matched; parent labels matched; Job Grid category mappings remain unapproved; no record is active.
