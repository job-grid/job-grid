-- Integration tests for the proposed vacancy-close migration.
-- Runs only against the disposable PostgreSQL service created by GitHub Actions.
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004');

INSERT INTO public.organizations (
  id, legal_name, display_name, type, status, verification_status
) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Example Employer One Ltd', 'Employer One', 'employer', 'verified', 'verified'),
  ('10000000-0000-4000-8000-000000000002', 'Example Employer Two Ltd', 'Employer Two', 'employer', 'verified', 'verified');

INSERT INTO public.geography (id, country_code, level, canonical_name) VALUES
  ('90000000-0000-4000-8000-000000000001', 'KE', 'city', 'Nairobi'),
  ('90000000-0000-4000-8000-000000000002', 'KE', 'city', 'Kisumu'),
  ('90000000-0000-4000-8000-000000000003', 'KE', 'city', 'Mombasa');

INSERT INTO public.organization_memberships (organization_id, user_id, role, status) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'recruiter', 'active'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'owner', 'active'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'viewer', 'active');

INSERT INTO public.platform_roles (user_id, role, active) VALUES
  ('00000000-0000-4000-8000-000000000003', 'moderator', true);

INSERT INTO public.vacancies (
  id, organization_id, created_by, reference_code, slug, title, description,
  geography_id, worksite_text, status, version, published_at, expires_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A001', 'operations-manager', 'Operations Manager',
    'Manage daily operations and coordinate the service delivery team.',
    '90000000-0000-4000-8000-000000000001', 'Nairobi', 'published', 1, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'JOB-B001', 'finance-officer', 'Finance Officer',
    'Maintain accounting records and prepare monthly management reports.',
    '90000000-0000-4000-8000-000000000002', 'Kisumu', 'published', 1, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A002', 'project-coordinator', 'Project Coordinator',
    'Coordinate project activities, reporting and cross-team delivery.',
    '90000000-0000-4000-8000-000000000003', 'Mombasa', 'published', 2, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A003', 'draft-analyst', 'Draft Analyst',
    'Prepare and maintain project information for an internal analysis team.',
    '90000000-0000-4000-8000-000000000001', 'Nairobi', 'draft', 1, NULL, NULL
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A004', 'expired-engineer', 'Expired Engineer',
    'Maintain engineering records and support operational reliability.',
    '90000000-0000-4000-8000-000000000001', 'Nairobi', 'published', 1, now() - interval '30 days', now() - interval '1 hour'
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A005', 'future-analyst', 'Future Analyst',
    'Prepare forward-looking operational reports for a project team.',
    '90000000-0000-4000-8000-000000000001', 'Nairobi', 'published', 1, now() + interval '1 day', now() + interval '31 days'
  ),
  (
    '20000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A006', 'moderator-close', 'Moderator Close Test',
    'Coordinate quality reviews and provide oversight for teams.',
    '90000000-0000-4000-8000-000000000001', 'Nairobi', 'published', 1, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    'JOB-B002', 'viewer-close', 'Viewer Permission Test',
    'Support business operations and maintain regular status reporting.',
    '90000000-0000-4000-8000-000000000002', 'Kisumu', 'published', 1, now() - interval '1 day', now() + interval '30 days'
  ),
  (
    '20000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'JOB-A007', 'concurrent-close', 'Concurrent Close Test',
    'Coordinate a test vacancy used for concurrent idempotency regression checks.',
    '90000000-0000-4000-8000-000000000001', 'Nairobi', 'published', 1, now() - interval '1 day', now() + interval '30 days'
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

-- Disposable contract fixture using the Phase 2A canonical job_applications name.
-- The live project has no recruitment schema yet; this fixture does not claim to be a production table.
CREATE TABLE public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.vacancies(id) ON DELETE RESTRICT,
  candidate_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'submitted',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  candidate_snapshot_ref text,
  idempotency_key_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.job_applications (
  id, vacancy_id, candidate_user_id, status, candidate_snapshot_ref, idempotency_key_ref
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'submitted',
  'candidate-snapshot-fixture-001',
  'application-idempotency-fixture-001'
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

  -- A read-only viewer member must not be allowed to close a vacancy.
  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000008',
    '00000000-0000-4000-8000-000000000004',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000011',
    'viewer-close-request-01'
  );
  IF result->>'error' <> 'FORBIDDEN' THEN
    RAISE EXCEPTION 'viewer membership was incorrectly allowed to close: %', result;
  END IF;

  -- Moderator role can close a published vacancy outside their employer tenancy.
  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000003',
    'incorrect_listing',
    1,
    '40000000-0000-4000-8000-000000000012',
    'moderator-close-request-01'
  );
  IF result->>'ok' <> 'true' OR result->>'status' <> 'closed' THEN
    RAISE EXCEPTION 'authorized moderator close failed: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000013',
    'expired-close-request-01'
  );
  IF result->>'error' <> 'INVALID_STATE' THEN
    RAISE EXCEPTION 'expired published vacancy was closable: %', result;
  END IF;

  result := public.close_published_vacancy(
    '20000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000001',
    'filled',
    1,
    '40000000-0000-4000-8000-000000000014',
    'future-close-request-01'
  );
  IF result->>'error' <> 'INVALID_STATE' THEN
    RAISE EXCEPTION 'future published vacancy was closable: %', result;
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

-- Force the audit insert to fail for one eligible published vacancy and prove
-- the vacancy update and idempotency row roll back with the audit event.
CREATE OR REPLACE FUNCTION public.__test_fail_vacancy_audit_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.vacancy_id = '20000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'forced audit insert failure for atomicity test';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER __test_fail_vacancy_audit_insert
  BEFORE INSERT ON public.vacancy_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.__test_fail_vacancy_audit_insert();

SET ROLE service_role;
DO $atomicity_test$
DECLARE
  row_status text;
  row_version integer;
  result_count integer;
BEGIN
  BEGIN
    PERFORM public.close_published_vacancy(
      '20000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000001',
      'filled',
      2,
      '40000000-0000-4000-8000-000000000020',
      'atomicity-request-0001'
    );
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'expected audit insert failure did not occur';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;

  SELECT status, version INTO row_status, row_version
    FROM public.vacancies
   WHERE id = '20000000-0000-4000-8000-000000000003';
  IF row_status <> 'published' OR row_version <> 2 THEN
    RAISE EXCEPTION 'vacancy transition was not rolled back after audit failure';
  END IF;

  SELECT count(*) INTO result_count
    FROM public.vacancy_audit_events
   WHERE vacancy_id = '20000000-0000-4000-8000-000000000003';
  IF result_count <> 0 THEN
    RAISE EXCEPTION 'audit event persisted despite failed transactional closure';
  END IF;

  SELECT count(*) INTO result_count
    FROM public.vacancy_closure_requests
   WHERE vacancy_id = '20000000-0000-4000-8000-000000000003'
     AND idempotency_key = 'atomicity-request-0001';
  IF result_count <> 0 THEN
    RAISE EXCEPTION 'idempotency record persisted despite failed transactional closure';
  END IF;
END;
$atomicity_test$;
RESET ROLE;

DROP TRIGGER __test_fail_vacancy_audit_insert ON public.vacancy_audit_events;
DROP FUNCTION public.__test_fail_vacancy_audit_insert();

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
    FROM public.job_applications
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
  IF has_function_privilege('anon', 'public.is_active_org_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous role can execute the membership helper';
  END IF;
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
  SELECT count(*) INTO row_count
    FROM public.vacancies
   WHERE id IN (
     '20000000-0000-4000-8000-000000000005',
     '20000000-0000-4000-8000-000000000006',
     '20000000-0000-4000-8000-000000000007'
   );
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'anonymous callers can see an expired, future or moderator-closed vacancy';
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
  IF NOT has_function_privilege('authenticated', 'public.is_active_org_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated role cannot execute the membership helper';
  END IF;
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

