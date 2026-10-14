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

Every record is labelled verified_source_match for official ILO code/title/hierarchy fields. Conservative title-rule suggestions: 286; manual review required: 150. Formal category fields remain unset and all records remain inactive.

## Do not import to live Supabase

Do not run this file as a database seed or treat it as a live vacancy feed. The official source code/title check has passed, but PR #45's proposed public.occupations schema remains unmerged. Loading these records requires human review of the proposed mappings to Job Grid's existing 25 category slugs, a separate migration review, and explicit production approval.

The existing 496 starter job types and the earlier 5,000-row generated workbook are separate datasets. They must not be treated as official ISCO unit groups, nor as genuine vacancies.

## Next steps

1. Review the 286 title-rule category suggestions and resolve the 150 records retained for human review.
2. Review the 496 starter-title crosswalk candidate list; every candidate remains pending human review.
3. Add occupation aliases only when supported by an official source or a reviewed decision.
4. Prepare a data-only migration only after PR #45 and the live recovery/security gates are resolved and explicitly approved.
## Latest official source audit

- Retrieval time (UTC): 2026-10-14T22:31:08Z
- Official CSV: https://webapps.ilo.org/ilostat-files/ISCO/newdocs-08-2021/ISCO-08/ISCO-08%20EN.csv
- SHA-256: 9afc6377d6ed6738d59aa0476777042e180397400d7dcd932e084045228b4d49
- Result: 436/436 unit-group codes and titles matched; parent labels matched; Job Grid category mappings remain unapproved; no record is active.


## Conservative category mapping audit (latest)

- Rule set: title_phrase_rules_v2 (whole-word/phrase matches on occupation title only).
- Suggested category matches: 286.
- Manual review required: 150 (9 ambiguous, 0 weak, 141 with no rule match).
- The earlier substring-oriented suggestions were replaced because matching bus inside business or roof inside proofreading can create false matches.
- Suggestions remain unapproved. The formal job_grid_category_slug is blank and category_mapping_status remains pending for every record.
