# International job workflow — audit and safe extension plan

## Production audit — 14 October 2026

A read-only audit was performed on the existing Supabase production project, Job-Grid, before preparing the schema extension.

- \`public.job_categories\`: 25 active categories. This existing table is the taxonomy source of truth and must not be recreated.
- \`public.country_options\`: 249 rows; the existing country catalogue is reused.
- \`public.jobs\`: 0 rows at audit time. This remains the single job-advertisement table.
- The application schema did not contain \`occupations\`, \`occupation_aliases\`, \`job_sources\`, \`source_connections\`, \`employers\`, \`vacancy_sources\`, \`vacancy_evidence\`, \`eligibility_assessments\`, \`verification_reviews\`, \`publication_records\`, \`ingestion_jobs\`, or \`ingestion_errors\`.
- Security Advisor returned no findings. Performance Advisor reported one informational missing index for the existing jobs-to-category foreign key; this extension adds an index for that lookup.

## Occupation workbook status

The workbook review shows 5,000 generated occupation/title variants, not 5,000 independently verified occupations or live advertisements. It has 41 exact normalized duplicate-title groups, no ISCO-08 codes, no official source/evidence URLs, and all rows were marked pending / do not publish. The deduplicated review list has 4,959 unique title strings, but these still require verification and do not automatically equal 4,959 canonical occupations.

Do not import these rows into \`public.jobs\`. Occupation titles belong in a separate occupation directory and must remain inactive or pending until checked against suitable occupational evidence. This schema migration seeds no occupation records and imports no workbook data.

The current website has a static starter list of 496 distinct base role titles. Its category names are removed from static data; categories shown to visitors are fetched from the existing \`public.job_categories\` table. These titles remain a starter catalogue until the occupation import is separately validated and approved.

## Schema extension

This migration is additive and designed around the existing data model.

- Reuses existing \`public.job_categories\`, \`public.country_options\`, and \`public.jobs\`.
- Adds \`public.occupations\` and \`public.occupation_aliases\`; every occupation links to an existing category slug.
- Extends existing \`public.jobs\` with occupation/employer links, source freshness, international applicant scope, sponsorship evidence status, verification status, and a revision number.
- Adds source permission/connection records, employers, deduplication identities/candidates, vacancy-source provenance, evidence references, international eligibility assessments, reviewer decisions, publication history, ingestion runs/errors, staff roles, and audit records.
- Does not create a second category table or a parallel \`job_vacancies\` table.
- Does not seed any source, enable any connector, import the 5,000 workbook rows, or create any advertised vacancy.

## Publication safety

The proposed publication gate requires, for the current job revision:

- a verified employer with supporting evidence;
- a verified and active occupation connected to the same existing category as the job;
- an HTTPS application destination and a non-expired publication window;
- a source with explicitly approved access and permission evidence;
- a current source check and vacancy-specific evidence of international-applicant eligibility;
- sponsorship evidence whenever sponsorship is claimed to be confirmed, conditional, or not offered;
- an authorized human review approving the same record version; and
- a publisher with the appropriate role.

International application eligibility, employer sponsorship, and an individual applicant's immigration eligibility are different questions. The platform must not infer one from another or promote an unknown status as confirmed. Source connectors default to disabled; source permission defaults to pending review.

## Important implementation status

This pull request is a schema and frontend taxonomy-source correction only. It does **not** apply the migration to production, import occupation candidates, activate an external source, fetch or publish live vacancies, create an admin interface, or deploy new production functionality.

Before merge, the migration must pass the repository checks and receive review. Before production execution, it needs an execution plan and approval because it changes the database schema. Before any source is enabled, verify its permitted acquisition method, limits, attribution, reuse rights and retention policy. The next operational milestone should be a small 10–25-vacancy pilot from one approved source, not an attempt to harvest thousands of listings immediately.
