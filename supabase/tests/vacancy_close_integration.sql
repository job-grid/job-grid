-- Integration tests for the proposed vacancy-close migration.
-- Runs only against the disposable PostgreSQL service created by GitHub Actions.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');

INSERT INTO public.organizations (id, legal_name, display_name, status) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Example Employer One Ltd', 'Employer One', 'verified'),
  ('10000000-0000-4000-8000-000000000002', 'Example Employer Two Ltd', 'Employer Two', 'verified');

INSERT INTO public.organization_memberships (organization_id, user_id, role, status) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'recruiter', 'active'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'owner', 'active'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'viewer', 'active');

INSERT INTO public.platform_roles (user_id, role, active) VALUES
  ('00000000-0000-4000-8000-000000000003', 'moderator', true);

INSERT INTO public.vacancies (
  id, organization_id, created_by, reference_code, slug, title, description,
  work_location, country_code, status, version, published_at, expires_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A001', 'operations-manager', 'Operations Manager',
    'Manage daily operations and coordinate the service delivery team.',
    'Nairobi', 'KE', 'published', 1, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'JOB-B001', 'finance-officer', 'Finance Officer',
    'Maintain accounting records and prepare monthly management reports.',
    'Kisumu', 'KE', 'published', 1, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A002', 'project-coordinator', 'Project Coordinator',
    'Coordinate project activities, reporting and cross-team delivery.',
    'Mombasa', 'KE', 'published', 2, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A003', 'draft-analyst', 'Draft Analyst',
    'Prepare and maintain project information for an internal analysis team.',
    'Nairobi', 'KE', 'draft', 1, NULL, NULL
  );

DO $column_grant_test$
BEGIN
  IF has_column_privilege('anon', 'public.vacancies', 'created_by', 'SELECT') THEN
    RAISE EXCEPTION 'anonymous role has access to internal created_by column';
  END IF;
  IF has_column_privilege('authenticated', 'public.vacancies', 'created_by', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated role has access to internal created_by column';
  END IF;
END;
$column_grant_test$;

-- Test-only stand-in for a future applications table. A closure must retain the
-- vacancy row and must not delete any rows related to it.
CREATE TABLE public.__vacancy_applications_probe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.vacancies(id) ON DELETE RESTRICT
);
INSERT INTO public.__vacancy_applications_probe (id, vacancy_id)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);

SET ROLE service_role;
DO $test$
DECLARE
  result jsonb;
BEGIN
  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000001',
    'close-request-0001'
  );
  IF result->>'ok' <> 'true' OR result->>'status' <> 'closed' OR result->>'version' <> '2' THEN
    RAISE EXCEPTION 'authorized close did not return expected result: %', result;
  END IF;
  IF result->>'replayed' <> 'false' THEN
    RAISE EXCEPTION 'first request was incorrectly marked as replay: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000002',
    'close-request-0001'
  );
  IF result->>'ok' <> 'true' OR result->>'replayed' <> 'true'
     OR result->>'request_id' <> '40000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'idempotent retry did not return saved result: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'cancelled_by_employer',
    1,
    '40000000-0000-4000-8000-000000000003',
    'close-request-0001'
  );
  IF result->>'error' <> 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'idempotency conflict was not rejected: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000004',
    'unauthorized-request-01'
  );
  IF result->>'error' <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'cross-organization close was not rejected: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000005',
    'cross-org-request-001'
  );
  IF result->>'error' <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'cross-organization vacancy access was not rejected: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000010',
    'close-org2-request-01'
  );
  IF result->>'ok' <> 'true' OR result->>'status' <> 'closed' THEN
    RAISE EXCEPTION 'authorized Employer Two close failed: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000006',
    'stale-version-request'
  );
  IF result->>'error' <> 'VERSION_CONFLICT' THEN
    RAISE EXCEPTION 'stale version was not rejected: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000007',
    'draft-close-request-01'
  );
  IF result->>'error' <> 'INVALID_STATE' THEN
    RAISE EXCEPTION 'draft closure was not rejected: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'not_an_approved_reason',
    2,
    '40000000-0000-4000-8000-000000000008',
    'bad-reason-request-01'
  );
  IF result->>'error' <> 'INVALID_REASON' THEN
    RAISE EXCEPTION 'unapproved reason was not rejected: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    2,
    '40000000-0000-4000-8000-000000000009',
    'another-close-request-01'
  );
  IF result->>'error' <> 'ALREADY_CLOSED' THEN
    RAISE EXCEPTION 'second close with a new idempotency key was not rejected: %', result;
  END IF;
END;
$test$;
RESET ROLE;

DO $public_read_test$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'superuser setup assertion failed for closed row';
  END IF;
  SELECT count(*) INTO row_count
    FROM public.vacancy_audit_events
   WHERE vacancy_id = '20000000-0000-4000-8000-000000000001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one audit event, found %', row_count;
  END IF;
  SELECT count(*) INTO row_count
    FROM public.vacancy_closure_requests
   WHERE vacancy_id = '20000000-0000-4000-8000-000000000001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one durable idempotency row, found %', row_count;
  END IF;
  SELECT count(*) INTO row_count
    FROM public.__vacancy_applications_probe
   WHERE vacancy_id = '20000000-0000-4000-8000-000000000001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'closure modified related application probe row';
  END IF;

  BEGIN
    UPDATE public.vacancy_audit_events
       SET reason_code = 'cancelled_by_employer'
     WHERE vacancy_id = '20000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'append-only audit guard did not reject UPDATE';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'append-only audit guard did not reject UPDATE' THEN
        RAISE;
      END IF;
  END;
END;
$public_read_test$;

SET ROLE anon;
DO $anon_test$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000001';
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'anonymous callers can still see closed vacancies';
  END IF;
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000002';
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'anonymous callers can still see another organization closed vacancy';
  END IF;
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000003';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'anonymous callers cannot see an active published vacancy';
  END IF;
END;
$anon_test$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
SET ROLE authenticated;
DO $member_test$
DECLARE
  row_count integer;
BEGIN
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000001';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'employer cannot see its own closed vacancy in management scope';
  END IF;
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000002';
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'employer can see another organization closed vacancy';
  END IF;
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000003';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'published vacancy should remain publicly visible';
  END IF;
END;
$member_test$;
RESET ROLE;

