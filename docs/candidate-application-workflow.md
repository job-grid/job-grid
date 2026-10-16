# Job Grid candidate application workflow

## Candidate journey
- Candidates submit their details, job preferences, skills, experience, consent, and CV on `/apply.html`.
- The form calls the `submit-application` Supabase Edge Function. It validates fields, checks the optional job is still published, stores the CV in the private `candidate-cvs` bucket, and writes a private `candidate_applications` record.
- Job cards use “Apply through Job Grid” and retain the job ID in the application URL. No public external employer-application link is shown.
- Recruitment staff review applications internally and match candidates with suitable employers through verified sources and authorized partners.

## Privacy and security
- Candidate applications and internal notes have row-level security enabled and no grants to `anon` or `authenticated`; browser clients cannot read or write these tables directly.
- The CV bucket is private and limited to PDF, DOC, and DOCX files up to 5 MiB.
- Only the Edge Function uses `SUPABASE_SERVICE_ROLE_KEY`. Never put that key in browser JavaScript, repository variables exposed to the client, or the public website.
- Set the Edge Function secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SITE_ORIGIN=https://jobs-grid.co.ke` in Supabase's function secrets. Deploy the function using the authorized Supabase project and deploy its migration to the existing production project only after normal review/authorization.
- The schema deliberately does not provide a public listing of applications or CVs. A separate staff-only dashboard must authenticate staff and verify `staff_roles` before allowing case review, CV access, status changes, or internal notes.

## Honest deployment status
Merging static files into GitHub triggers Cloudflare Pages, but it does not automatically deploy Supabase migrations or Edge Functions unless a separate authorized workflow is configured. The application form must not be advertised as live until the migration and Edge Function have been deployed and tested against the intended production Supabase project.

## Operational policy
Only publish roles with verified evidence and source permission. Do not promise employment, visa sponsorship, or placement. Record source provenance internally and use candidate information only for the stated recruitment purpose. Provide a process for candidates to request access, correction, or deletion of their personal information.
