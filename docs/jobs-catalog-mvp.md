# Job Grid MVP — categories and manually managed job posts

## What this adds

This migration creates two tables in the existing Job Grid Supabase project:

- `job_categories`: 25 broad categories, including general labour, agriculture, construction and trades, transport, cleaning, hospitality, healthcare, education, office work, IT, finance, engineering, and other.
- `jobs`: individual job advertisements connected to one category and a country from `country_options`.

Each job has a skill level (`skilled`, `semi_skilled`, or `unskilled`), employment type, workplace type, location, optional salary, optional HTTPS application link, publication dates, and a status.

## How the first version is managed

For the first version, an administrator manually creates and updates job advertisements using the existing Supabase Dashboard / Table Editor. This avoids opening job posting to unauthenticated visitors before employer accounts, identity, organization membership, verification, and moderation are built.

The website can read active categories and only jobs whose status is `published`, whose `published_at` is not in the future, and whose `expires_at` is still in the future. Draft, closed, suspended, scheduled, and expired jobs are not public. Anonymous and signed-in browser users receive read-only SELECT permission; there is no browser INSERT, UPDATE, or DELETE grant.

## Important limits

- The migration does not create employer accounts, candidate accounts, applications, or a moderation workflow.
- The `employer_name` field is display text. It does not mean the employer has been independently verified. Only publish roles that the administrator has checked.
- Do not store candidate names, CVs, identity documents, private internal notes, passwords, or credentials in the public `jobs` table.
- Keep job claims, salaries, sponsorship, deadlines, and application links accurate. Use `not_stated` when visa sponsorship is unknown.
- The code value `unskilled` is retained for compatibility with the requested classification. In visitor-facing copy, prefer respectful language such as **“Entry-level / no specialist skill required”** and classify roles from their actual requirements rather than assumptions about workers.
- Public search UI integration is a separate step. A successful table migration alone does not mean the website has started querying the table.
- Apply the migration only to the existing **Job-Grid** project after confirming a fresh backup/recovery position. Do not apply it to **Job-Grid-Recovery** or any unrelated project.

## First job-entry checklist

When the table is available, enter a job as `draft` first. Check the employer, job title, category, skill level, work location, salary details, application path, publication date, and expiry. Set status to `published` only after those checks are complete; set both publication dates, and make sure expiry is later than publication. Public access remains read-only.
