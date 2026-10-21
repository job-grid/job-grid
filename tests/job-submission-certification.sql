-- Isolated PR #99 manual job-submission integration checks.
-- Run only against the disposable GitHub Actions PostgreSQL service.
INSERT INTO auth.users (id) VALUES
 ('11111111-1111-4111-8111-111111111111'),
 ('22222222-2222-4222-8222-222222222222')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.staff_roles (user_id, role, granted_by) VALUES
 ('11111111-1111-4111-8111-111111111111', 'reviewer', '22222222-2222-4222-8222-222222222222'),
 ('22222222-2222-4222-8222-222222222222', 'publisher', '22222222-2222-4222-8222-222222222222')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.job_submissions (
 id, contact_name, contact_email, contact_phone, employer_name, title, description,
 category_slug, country_code, employment_type, workplace_type, skill_level, source_reference
) VALUES
 ('a1111111-1111-4111-8111-111111111111', 'Synthetic Contact', 'contact-a@synthetic.example', '+10000000001',
  'Synthetic Employer', 'Synthetic Accepted Vacancy', 'This is a synthetic test description long enough for the isolated integration test.',
  'health-care-caregiving', 'CA', 'full_time', 'on_site', 'skilled', 'https://employer.synthetic.example/jobs/accepted'),
 ('a2222222-2222-4222-8222-222222222222', 'Synthetic Contact', 'contact-b@synthetic.example', '+10000000002',
  'Synthetic Employer', 'Synthetic Rejected Vacancy', 'This is a synthetic test description long enough for the isolated integration test.',
  'health-care-caregiving', 'CA', 'full_time', 'on_site', 'skilled', 'https://employer.synthetic.example/jobs/rejected');

DO $test$
DECLARE
  result jsonb;
  accepted_id uuid;
BEGIN
  IF has_table_privilege('anon', 'public.job_submissions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.job_submissions', 'SELECT') THEN
    RAISE EXCEPTION 'Public roles unexpectedly have direct SELECT on private submissions';
  END IF;

  IF (SELECT status FROM public.job_submissions WHERE id='a1111111-1111-4111-8111-111111111111') <> 'pending' THEN
    RAISE EXCEPTION 'New manual submission is not pending';
  END IF;

  result := public.staff_job_submission_review(
    '22222222-2222-4222-8222-222222222222',
    'a1111111-1111-4111-8111-111111111111',
    'accept_as_draft',
    'Synthetic integration test'
  );
  accepted_id := (result->>'job_id')::uuid;
  IF accepted_id IS NULL THEN RAISE EXCEPTION 'Accept action did not return a job ID'; END IF;
  IF (SELECT status FROM public.job_submissions WHERE id='a1111111-1111-4111-8111-111111111111') <> 'accepted_as_draft'
     OR (SELECT created_job_id FROM public.job_submissions WHERE id='a1111111-1111-4111-8111-111111111111') <> accepted_id THEN
    RAISE EXCEPTION 'Submission was not linked to the created draft';
  END IF;
  IF (SELECT status FROM public.jobs WHERE id=accepted_id) <> 'draft'
     OR (SELECT published_at FROM public.jobs WHERE id=accepted_id) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.publication_records WHERE job_id=accepted_id AND unpublished_at IS NULL) THEN
    RAISE EXCEPTION 'Accepted manual submission was not kept unpublished';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE actor_id='22222222-2222-4222-8222-222222222222'
      AND action='job_submission_accepted_as_draft' AND entity_id='a1111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'Acceptance audit record is missing';
  END IF;

  result := public.staff_job_submission_review(
    '11111111-1111-4111-8111-111111111111',
    'a2222222-2222-4222-8222-222222222222',
    'reject',
    'Synthetic rejection test'
  );
  IF (SELECT status FROM public.job_submissions WHERE id='a2222222-2222-4222-8222-222222222222') <> 'rejected' THEN
    RAISE EXCEPTION 'Reviewer rejection did not update submission state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE actor_id='11111111-1111-4111-8111-111111111111'
      AND action='job_submission_rejected' AND entity_id='a2222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'Rejection audit record is missing';
  END IF;

  BEGIN
    PERFORM public.staff_job_submission_review(
      '22222222-2222-4222-8222-222222222222',
      'a1111111-1111-4111-8111-111111111111',
      'accept_as_draft',
      'Must not process twice'
    );
    RAISE EXCEPTION 'Second review unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%already been reviewed%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS: private queue, pending state, role separation, atomic draft acceptance, unpublished state, rejection, audit, and duplicate-review guard';
END;
$test$;

SELECT 'PASS: isolated manual job-submission integration checks' AS result;
