# Job Grid starter-title to ISCO-08 crosswalk review

## Purpose

This is an exploratory crosswalk for the 496 existing starter role titles in `public/data/job-types.json`. It gives reviewers a short list of possible four-digit ISCO-08 unit groups to assess, instead of silently treating starter titles as official occupational classifications.

## Data and method

- Source titles and the Job Grid category labels come from the current 496-title starter catalogue.
- ISCO-08 candidate codes and hierarchy labels come from the catalogue whose source-code/title check is recorded in PR #46's source manifest.
- Candidate retrieval uses normalized token overlap weighted by inverse document frequency over unit-group and parent labels. The existing Job Grid category is used only as a ranking hint for likely major groups.
- The score is a ranking heuristic, not a probability, confidence guarantee or official occupational match.
- Each starter title has the three highest-ranked unit-group candidates, an assessment band, matched words, review status, and a false-by-default approval flag.

## Required reviewer handling

- `exact_title_candidate` means only that the displayed starter title and an ISCO-08 unit-group title normalize to the same text; it still requires review.
- `strong_text_candidate`, `possible_text_candidate`, and `manual_review_required` express retrieval strength, not validation.
- Never import these candidate links as official aliases, never set an occupation as verified solely because of this file, and never use it to create vacancies.
- A reviewer should compare each match against the ILO index of occupational titles and group definitions, then record accepted aliases with exact supporting-source references.
- All 496 rows have `review_status=pending_human_review`, `mapping_approved=false`, and `source_verified=false`.

## Preview

The review-only page is served at `/occupation-title-crosswalk-preview.html` on the isolated PR branch preview. It is labelled `noindex, nofollow` and is not linked from the shared site navigation or main production site.
