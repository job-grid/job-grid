\set ON_ERROR_STOP on

CREATE TEMP TABLE certification_temp_initializer (id integer);
DROP TABLE certification_temp_initializer;

CREATE OR REPLACE FUNCTION pg_temp.assert_sqlstate(
  p_statement text,
  p_expected_state text,
  p_label text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_actual_state text;
  v_actual_message text;
BEGIN
  BEGIN
    EXECUTE p_statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_actual_state = RETURNED_SQLSTATE,
      v_actual_message = MESSAGE_TEXT;
    IF v_actual_state = p_expected_state THEN
      RAISE NOTICE 'PASS: % (SQLSTATE %)', p_label, v_actual_state;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL: %, expected SQLSTATE %, got %: %',
      p_label, p_expected_state, v_actual_state, v_actual_message;
  END;

  RAISE EXCEPTION 'FAIL: % unexpectedly succeeded (expected SQLSTATE %)',
    p_label, p_expected_state;
END;
$function$;

DO $certification$
DECLARE
  v_fk_count integer;
  v_check_count integer;
  v_missing_rls text;
  v_missing_triggers text;
  v_missing_functions text;
  v_bad_secdef text;
BEGIN
  IF (SELECT count(*) FROM public.job_categories) <> 25 THEN
    RAISE EXCEPTION 'FAIL: existing baseline does not contain exactly 25 categories';
  END IF;
  IF (SELECT count(*) FROM public.country_options) <> 249 THEN
    RAISE EXCEPTION 'FAIL: existing baseline does not contain exactly 249 country options';
  END IF;
  IF (SELECT count(*) FROM public.jobs) <> 0 THEN
    RAISE EXCEPTION 'FAIL: baseline synthetic database should start with zero jobs';
  END IF;
  IF to_regclass('public.job_vacancies') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: a parallel vacancy table exists';
  END IF;
  IF (SELECT count(*) FROM public.job_categories WHERE is_active) <> 25 THEN
    RAISE EXCEPTION 'FAIL: not all existing categories are active';
  END IF;
  IF (SELECT count(*) FROM public.country_options WHERE code = 'KE' AND name = 'Kenya') <> 1
     OR (SELECT count(*) FROM public.country_options WHERE code = 'JP' AND name = 'Japan') <> 1 THEN
    RAISE EXCEPTION 'FAIL: Kenya or Japan country option is missing';
  END IF;

  SELECT count(*) INTO v_fk_count
  FROM pg_constraint
  WHERE contype = 'f'
    AND connamespace = 'public'::regnamespace;
  IF v_fk_count < 30 THEN
    RAISE EXCEPTION 'FAIL: expected at least 30 declared foreign-key constraints, found %', v_fk_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND NOT convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL: one or more foreign-key constraints are not validated';
  END IF;

  SELECT count(*) INTO v_check_count
  FROM pg_constraint
  WHERE contype = 'c' AND connamespace = 'public'::regnamespace;
  IF v_check_count < 40 THEN
    RAISE EXCEPTION 'FAIL: expected at least 40 declared CHECK constraints, found %', v_check_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace AND NOT convalidated
  ) THEN
    RAISE EXCEPTION 'FAIL: one or more CHECK constraints are not validated';
  END IF;

  SELECT string_agg(t.table_name, ', ' ORDER BY t.table_name)
  INTO v_missing_rls
  FROM unnest(ARRAY[
    'occupations','occupation_aliases','employers','job_sources','source_connections',
    'job_dedupe_keys','job_duplicate_candidates','vacancy_sources','vacancy_evidence',
    'eligibility_assessments','staff_roles','verification_reviews','publication_records',
    'ingestion_jobs','ingestion_errors','audit_logs','jobs'
  ]) AS t(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class c
    WHERE c.oid = format('public.%I', t.table_name)::regclass
      AND c.relrowsecurity
  );
  IF v_missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on: %', v_missing_rls;
  END IF;

  SELECT string_agg(t.trigger_name, ', ' ORDER BY t.trigger_name)
  INTO v_missing_triggers
  FROM unnest(ARRAY[
    'jobs_bump_record_version',
    'vacancy_sources_invalidate_review',
    'vacancy_evidence_invalidate_review',
    'eligibility_assessments_invalidate_review',
    'employers_invalidate_related_jobs',
    'occupations_invalidate_related_jobs',
    'job_sources_invalidate_related_jobs',
    'source_connection_enabled_guard',
    'employers_reset_verification_before_identity_change',
    'occupations_reset_verification_before_identity_change'
  ]) AS t(trigger_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_trigger tr
    JOIN pg_class c ON c.oid = tr.tgrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND tr.tgname = t.trigger_name
      AND NOT tr.tgisinternal
      AND tr.tgenabled IN ('O','A')
  );
  IF v_missing_triggers IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: expected triggers missing or disabled: %', v_missing_triggers;
  END IF;

  SELECT string_agg(t.function_name, ', ' ORDER BY t.function_name)
  INTO v_missing_functions
  FROM unnest(ARRAY[
    'job_evidence_ready','job_approval_current','job_publication_gate_passed',
    'review_job','publish_verified_job','unpublish_job','set_job_source_enabled',
    'guard_source_connection_enabled'
  ]) AS t(function_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname = t.function_name
      AND p.prosecdef
  );
  IF v_missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: expected SECURITY DEFINER functions missing: %', v_missing_functions;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
  INTO v_bad_secdef
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prosecdef
    AND p.proname IN (
      'job_evidence_ready','job_approval_current','job_publication_gate_passed',
      'review_job','publish_verified_job','unpublish_job','set_job_source_enabled',
      'guard_source_connection_enabled'
    )
    AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=""%';
  IF v_bad_secdef IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: SECURITY DEFINER functions without pinned empty search_path: %', v_bad_secdef;
  END IF;

  IF NOT has_table_privilege('anon','public.jobs','SELECT')
     OR has_table_privilege('anon','public.jobs','INSERT')
     OR has_table_privilege('authenticated','public.jobs','UPDATE')
     OR has_table_privilege('authenticated','public.jobs','DELETE') THEN
    RAISE EXCEPTION 'FAIL: public jobs table grants are not read-only';
  END IF;
  IF has_table_privilege('anon','public.employers','SELECT')
     OR has_table_privilege('authenticated','public.job_sources','INSERT')
     OR has_table_privilege('authenticated','public.vacancy_evidence','SELECT')
     OR has_table_privilege('authenticated','public.staff_roles','INSERT') THEN
    RAISE EXCEPTION 'FAIL: an internal workflow table is exposed to browser roles';
  END IF;
  IF NOT has_function_privilege('authenticated','public.review_job(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.publish_verified_job(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.review_job(uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.publish_verified_job(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: reviewer/publisher RPC execute grants do not follow role boundaries';
  END IF;
  IF (SELECT count(*) FROM public.job_sources) <> 0
     OR (SELECT count(*) FROM public.source_connections) <> 0 THEN
    RAISE EXCEPTION 'FAIL: source connectors must start empty and disabled';
  END IF;
  RAISE NOTICE 'PASS: baseline categories/countries, no parallel vacancy table, validated FKs, RLS, triggers, SECURITY DEFINER search paths and browser grants';
END;
$certification$;

-- Verify check constraints and foreign keys reject representative invalid writes.
SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code)
    VALUES ('Invalid category test','invalid-category-test','Synthetic Employer','Fixture description','missing-category','skilled','full_time','CA')$$,
  '23503', 'jobs.category_slug foreign key');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code)
    VALUES ('Invalid country test','invalid-country-test','Synthetic Employer','Fixture description','health-care-caregiving','skilled','full_time','ZZ')$$,
  '23503', 'jobs.country_code foreign key');

SELECT pg_temp.assert_sqlstate(
  $stmt$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,occupation_id,skill_level,employment_type,country_code)
    VALUES ('Invalid occupation test','invalid-occupation-test','Synthetic Employer','Fixture description','health-care-caregiving','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','skilled','full_time','CA')$stmt$,
  '23503', 'jobs.occupation_id foreign key');
-- The following invalid-reference checks use explicit nullable workflow foreign keys.
SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.occupations (category_slug,canonical_title) VALUES ('missing-category','Synthetic Occupation')$$,
  '23503', 'occupations.category_slug foreign key');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.occupations (category_slug,canonical_title,verification_status,is_active)
    VALUES ('health-care-caregiving','Synthetic Unverified Occupation','verified',true)$$,
  '23514', 'verified occupation requires verification evidence and reviewer');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.employers (legal_name,verification_status)
    VALUES ('Synthetic Employer Missing Evidence','verified')$$,
  '23514', 'verified employer requires verification evidence and reviewer');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.job_sources (name,domain,source_type,access_method,permission_status)
    VALUES ('Unapproved Synthetic Source','unapproved.synthetic.example','employer_careers','permitted_structured_page','approved')$$,
  '23514', 'approved source requires permission evidence and reviewer');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.source_connections (source_id,adapter_key,configuration,enabled)
    VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fake-adapter','{"api_key":"must-not-be-stored"}',false)$$,
  '23514', 'connector configuration rejects embedded credentials');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code)
    VALUES ('Invalid skill level test','invalid-skill-level-test','Synthetic Employer','Fixture description','health-care-caregiving','unclassified','full_time','CA')$$,
  '23514', 'jobs skill level check');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code)
    VALUES ('Invalid employment type test','invalid-employment-type-test','Synthetic Employer','Fixture description','health-care-caregiving','skilled','permanent_forever','CA')$$,
  '23514', 'jobs employment type check');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code,salary_min,salary_max,salary_currency,salary_period)
    VALUES ('Invalid salary range test','invalid-salary-range-test','Synthetic Employer','Fixture description','health-care-caregiving','skilled','full_time','CA',5000,1000,'CAD','month')$$,
  '23514', 'jobs salary range check');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code,application_url)
    VALUES ('Invalid HTTP application link','invalid-http-application-link','Synthetic Employer','Fixture description','health-care-caregiving','skilled','full_time','CA','http://insecure.synthetic.example/job')$$,
  '23514', 'application URL HTTPS constraint');

SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code,status)
    VALUES ('Premature published job','premature-published-job','Synthetic Employer','Fixture description','health-care-caregiving','skilled','full_time','CA','published')$$,
  '23514', 'published state requires publication dates');

-- Create only synthetic identities. No external source is contacted and no real vacancy is inserted.
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

INSERT INTO public.staff_roles (user_id,role,granted_by) VALUES
  ('11111111-1111-4111-8111-111111111111','reviewer','33333333-3333-4333-8333-333333333333'),
  ('22222222-2222-4222-8222-222222222222','publisher','33333333-3333-4333-8333-333333333333'),
  ('33333333-3333-4333-8333-333333333333','system_admin','33333333-3333-4333-8333-333333333333'),
  ('33333333-3333-4333-8333-333333333333','source_admin','33333333-3333-4333-8333-333333333333');

INSERT INTO public.employers (
  id,legal_name,website,country_code,verification_status,verification_evidence_url,
  verified_at,verified_by
) VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Synthetic Care Employer — Certification Fixture',
  'https://employer.synthetic.example/',
  'CA','verified','https://employer.synthetic.example/test-verification-evidence',
  now(),'33333333-3333-4333-8333-333333333333'
);

INSERT INTO public.occupations (
  id,category_slug,canonical_title,verification_status,verification_source_url,
  verification_notes,verified_at,verified_by,is_active
) VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'health-care-caregiving','Synthetic Care Assistant — Certification Fixture',
  'verified','https://occupations.synthetic.example/test-occupation-evidence',
  'Synthetic fixture only; not an authoritative occupational classification.',
  now(),'33333333-3333-4333-8333-333333333333',true
);

-- An active-but-pending title tests that an unverified occupation is not visible to anonymous users.
INSERT INTO public.occupations (
  category_slug,canonical_title,verification_status,is_active
) VALUES ('health-care-caregiving','Synthetic Pending Role — Certification Fixture','pending',true);

INSERT INTO public.occupation_aliases (occupation_id,alternative_title,verification_status)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Synthetic Caregiving Assistant Alias','pending');

INSERT INTO public.job_sources (
  id,name,domain,source_type,access_method,permission_status,permission_evidence_url,
  permission_reviewed_at,permission_reviewed_by,enabled,recheck_interval_hours,max_requests_per_hour
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Synthetic Approved Source — Certification Fixture',
  'careers.synthetic.example','employer_careers','permitted_structured_page',
  'approved','https://careers.synthetic.example/test-permission-evidence',
  now(),'33333333-3333-4333-8333-333333333333',true,72,30
);

INSERT INTO public.source_connections (source_id,adapter_key,configuration,enabled)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','synthetic-test-adapter','{"fixture":true}',true);

CREATE OR REPLACE FUNCTION pg_temp.seed_synthetic_vacancy(
  p_job_id uuid,
  p_slug text,
  p_title text,
  p_international_eligibility text,
  p_expiry timestamptz,
  p_include_eligibility_evidence boolean,
  p_include_application_evidence boolean
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_url text := 'https://careers.synthetic.example/jobs/' || p_slug;
  v_dedupe_id uuid;
  v_eligibility_evidence_id uuid;
BEGIN
  INSERT INTO public.jobs (
    id,title,slug,employer_name,description,category_slug,occupation_id,employer_id,
    skill_level,employment_type,workplace_type,country_code,city,application_url,
    status,expires_at,first_seen_at,last_checked_at,international_eligibility,visa_sponsorship
  ) VALUES (
    p_job_id,p_title,p_slug,'Synthetic Care Employer — Certification Fixture',
    'Synthetic test-only vacancy text. Not a real job advertisement.',
    'health-care-caregiving','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','semi_skilled','full_time','on_site','CA',
    'Toronto',v_url,'draft',p_expiry,now(),now(),p_international_eligibility,'unknown'
  );

  INSERT INTO public.job_dedupe_keys (job_id,key_type,normalized_value)
  VALUES (p_job_id,'canonical_url',v_url)
  RETURNING id INTO v_dedupe_id;

  INSERT INTO public.vacancy_sources (
    job_id,source_id,canonical_dedupe_key_id,external_id,source_url,canonical_url,
    first_seen_at,last_checked_at
  ) VALUES (
    p_job_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',v_dedupe_id,
    'synthetic-' || p_slug,v_url,v_url,now(),now()
  );

  INSERT INTO public.vacancy_evidence (job_id,source_id,evidence_type,evidence_url,short_excerpt)
  VALUES (
    p_job_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','posting_status',v_url,
    'Synthetic fixture: source indicates this test posting is open.'
  );

  IF p_include_application_evidence THEN
    INSERT INTO public.vacancy_evidence (job_id,source_id,evidence_type,evidence_url,short_excerpt)
    VALUES (
      p_job_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','application_url',v_url,
      'Synthetic fixture: application link matches the advertisement.'
    );
  END IF;

  IF p_include_eligibility_evidence THEN
    INSERT INTO public.vacancy_evidence (job_id,source_id,evidence_type,evidence_url,short_excerpt)
    VALUES (
      p_job_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','international_eligibility',v_url,
      CASE WHEN p_international_eligibility = 'unknown'
        THEN 'Synthetic fixture: no clear international applicant statement.'
        ELSE 'Synthetic fixture: applicants outside the destination country may apply.'
      END
    )
    RETURNING id INTO v_eligibility_evidence_id;

    INSERT INTO public.eligibility_assessments (
      job_id,applicant_scope,sponsorship_status,assessment_status,
      eligibility_evidence_id,assessment_reason,assessed_by
    ) VALUES (
      p_job_id,p_international_eligibility,'unknown','approved',
      v_eligibility_evidence_id,'Synthetic eligibility fixture for certification only.',
      '11111111-1111-4111-8111-111111111111'
    );
  END IF;

  RETURN p_job_id;
END;
$function$;

SELECT pg_temp.seed_synthetic_vacancy(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'valid-international-fixture',
  'Synthetic Valid International Vacancy',
  'explicitly_open',
  now() + interval '14 days',
  true,true
);

SELECT pg_temp.seed_synthetic_vacancy(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'unknown-eligibility-fixture',
  'Synthetic Unknown Eligibility Vacancy',
  'unknown',
  now() + interval '14 days',
  true,true
);

SELECT pg_temp.seed_synthetic_vacancy(
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'missing-evidence-fixture',
  'Synthetic Missing Evidence Vacancy',
  'explicitly_open',
  now() + interval '14 days',
  false,false
);

SELECT pg_temp.seed_synthetic_vacancy(
  '99999999-9999-4999-8999-999999999999',
  'expired-vacancy-fixture',
  'Synthetic Expired Vacancy',
  'explicitly_open',
  now() - interval '1 day',
  true,true
);

-- Runtime foreign-key matrix: exercise the remaining table-reference boundaries using synthetic IDs only.
SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.occupation_aliases (occupation_id,alternative_title)
      VALUES ('51515151-5151-4151-8151-515151515151','Missing Occupation Alias Fixture')$fk$,
  '23503', 'occupation_aliases.occupation_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.occupations (category_slug,canonical_title,verification_status,verified_by)
      VALUES ('health-care-caregiving','Missing Occupation Reviewer Fixture','pending','51525252-5252-4252-8252-525252525252')$fk$,
  '23503', 'occupations.verified_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.employers (legal_name,country_code)
      VALUES ('Employer with missing country fixture','ZZ')$fk$,
  '23503', 'employers.country_code foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.employers (legal_name,country_code,verified_by)
      VALUES ('Employer with missing reviewer fixture','CA','51535353-5353-4353-8353-535353535353')$fk$,
  '23503', 'employers.verified_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.job_sources (name,domain,source_type,access_method,permission_status,permission_reviewed_by)
      VALUES ('Source with missing reviewer fixture','missing-reviewer-source.synthetic.example','employer_careers','permitted_structured_page','pending_review','51545454-5454-4454-8454-545454545454')$fk$,
  '23503', 'job_sources.permission_reviewed_by foreign key');

INSERT INTO public.job_sources (name,domain,source_type,access_method,permission_status,enabled)
VALUES ('Pending source guard fixture','pending-source-guard.synthetic.example','employer_careers','permitted_structured_page','pending_review',false);

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.source_connections (source_id,adapter_key,configuration,enabled)
      SELECT id,'must-remain-disabled','{}',true
      FROM public.job_sources
      WHERE domain='pending-source-guard.synthetic.example'$fk$,
  '23514', 'source connection cannot be enabled before approved access evidence');


SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.source_connections (source_id,adapter_key,configuration,enabled)
      VALUES ('51555555-5555-4555-8555-555555555555','missing-source-adapter','{}',false)$fk$,
  '23503', 'source_connections.source_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.jobs (title,slug,employer_name,description,category_slug,occupation_id,employer_id,skill_level,employment_type,country_code)
      VALUES ('Missing employer foreign key fixture','missing-employer-fk-fixture','Synthetic Employer','Fixture description','health-care-caregiving','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','51565656-5656-4656-8656-565656565656','skilled','full_time','CA')$fk$,
  '23503', 'jobs.employer_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.job_dedupe_keys (job_id,key_type,normalized_value)
      VALUES ('51575757-5757-4757-8757-575757575757','canonical_url','https://careers.synthetic.example/invalid-parent-job')$fk$,
  '23503', 'job_dedupe_keys.job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.job_duplicate_candidates (job_a_id,job_b_id,match_type)
      VALUES ('00000000-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddddd','reviewer_flag')$fk$,
  '23503', 'job_duplicate_candidates.job_a_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.job_duplicate_candidates (job_a_id,job_b_id,match_type)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','f1585858-5858-4858-8858-585858585858','reviewer_flag')$fk$,
  '23503', 'job_duplicate_candidates.job_b_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.job_duplicate_candidates (job_a_id,job_b_id,match_type,reviewed_by,reviewed_at)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','reviewer_flag','51595959-5959-4959-8959-595959595959',now())$fk$,
  '23503', 'job_duplicate_candidates.reviewed_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.vacancy_sources (job_id,source_id,canonical_dedupe_key_id,external_id,source_url,canonical_url)
      VALUES ('515a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        (SELECT id FROM public.job_dedupe_keys WHERE job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        'missing-job-source-link','https://careers.synthetic.example/fk-missing-job',
        'https://careers.synthetic.example/fk-missing-job')$fk$,
  '23503', 'vacancy_sources.job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.vacancy_sources (job_id,source_id,canonical_dedupe_key_id,external_id,source_url,canonical_url)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','515b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b',
        (SELECT id FROM public.job_dedupe_keys WHERE job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        'missing-source-id-link','https://careers.synthetic.example/fk-missing-source',
        'https://careers.synthetic.example/fk-missing-source')$fk$,
  '23503', 'vacancy_sources.source_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.vacancy_sources (job_id,source_id,canonical_dedupe_key_id,external_id,source_url,canonical_url)
      VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        (SELECT id FROM public.job_dedupe_keys WHERE job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
        'mismatched-dedupe-job','https://careers.synthetic.example/fk-mismatched-dedupe',
        'https://careers.synthetic.example/fk-mismatched-dedupe')$fk$,
  '23503', 'vacancy_sources canonical dedupe key must belong to same job');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.vacancy_evidence (job_id,source_id,evidence_type,evidence_url)
      VALUES ('515c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c','cccccccc-cccc-4ccc-8ccc-cccccccccccc','other','https://evidence.synthetic.example/missing-job')$fk$,
  '23503', 'vacancy_evidence.job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.vacancy_evidence (job_id,source_id,evidence_type,evidence_url)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','515d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d','other','https://evidence.synthetic.example/missing-source')$fk$,
  '23503', 'vacancy_evidence.source_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.vacancy_evidence (job_id,source_id,evidence_type,evidence_url,captured_by)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','other','https://evidence.synthetic.example/missing-captor','515e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e')$fk$,
  '23503', 'vacancy_evidence.captured_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.eligibility_assessments (job_id,applicant_scope,sponsorship_status,assessment_status)
      VALUES ('515f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f','unknown','unknown','pending')$fk$,
  '23503', 'eligibility_assessments.job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.eligibility_assessments (job_id,applicant_scope,sponsorship_status,assessment_status,eligibility_evidence_id)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','unknown','unknown','pending',
        (SELECT id FROM public.vacancy_evidence WHERE job_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND evidence_type='international_eligibility' LIMIT 1))$fk$,
  '23503', 'eligibility evidence must belong to the same job');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.eligibility_assessments (job_id,applicant_scope,sponsorship_status,assessment_status,sponsorship_evidence_id)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','unknown','unknown','pending',
        (SELECT id FROM public.vacancy_evidence WHERE job_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND evidence_type='posting_status' LIMIT 1))$fk$,
  '23503', 'sponsorship evidence must belong to the same job');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.eligibility_assessments (job_id,applicant_scope,sponsorship_status,assessment_status,assessed_by)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','unknown','unknown','pending','51606060-6060-4060-8060-606060606060')$fk$,
  '23503', 'eligibility_assessments.assessed_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.staff_roles (user_id,role)
      VALUES ('51616161-6161-4161-8161-616161616161','auditor')$fk$,
  '23503', 'staff_roles.user_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.staff_roles (user_id,role,granted_by)
      VALUES ('11111111-1111-4111-8111-111111111111','auditor','51626262-6262-4262-8262-626262626262')$fk$,
  '23503', 'staff_roles.granted_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.verification_reviews (job_id,reviewer_id,decision,reason,reviewed_record_version)
      VALUES ('51636363-6363-4363-8363-636363636363','11111111-1111-4111-8111-111111111111','rejected','Invalid job reference fixture',1)$fk$,
  '23503', 'verification_reviews.job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.verification_reviews (job_id,reviewer_id,decision,reason,reviewed_record_version)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','51646464-6464-4464-8464-646464646464','rejected','Invalid reviewer reference fixture',1)$fk$,
  '23503', 'verification_reviews.reviewer_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.publication_records (job_id,publication_version,job_record_version,published_by)
      VALUES ('51656565-6565-4565-8565-656565656565',1,1,'22222222-2222-4222-8222-222222222222')$fk$,
  '23503', 'publication_records.job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.publication_records (job_id,publication_version,job_record_version,published_by)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',99,1,'51666666-6666-4666-8666-666666666666')$fk$,
  '23503', 'publication_records.published_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.publication_records (
      job_id,publication_version,job_record_version,published_by,published_at,unpublished_by,unpublished_at,unpublished_reason
    )
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',98,1,
      '22222222-2222-4222-8222-222222222222',now()-interval '1 day',
      '51676767-6767-4767-8767-676767676767',now(),'Invalid unpublisher fixture')$fk$,
  '23503', 'publication_records.unpublished_by foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.ingestion_jobs (source_id,request_key)
      VALUES ('51686868-6868-4868-8868-686868686868','fk-invalid-source-ingestion-run-001')$fk$,
  '23503', 'ingestion_jobs.source_id foreign key');

INSERT INTO public.ingestion_jobs (source_id,request_key)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','fk-valid-ingestion-parent-001');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.ingestion_errors (ingestion_job_id,error_code,safe_message)
      VALUES ('51696969-6969-4969-8969-696969696969','synthetic_fk','Missing ingestion run fixture')$fk$,
  '23503', 'ingestion_errors.ingestion_job_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $fk$INSERT INTO public.audit_logs (actor_id,action,entity_type,entity_id)
      VALUES ('51707070-7070-4070-8070-707070707070','foreign_key_test','test_entity','synthetic')$fk$,
  '23503', 'audit_logs.actor_id foreign key');

SELECT pg_temp.assert_sqlstate(
  $stmt$INSERT INTO public.eligibility_assessments (
      job_id,applicant_scope,sponsorship_status,assessment_status,assessment_reason
    ) VALUES (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','employer_sponsored','confirmed','pending',
      'Must fail: confirmation has no sponsorship evidence.'
    )$stmt$,
  '23514', 'confirmed sponsorship requires vacancy-specific evidence');

-- Exact dedupe identity and per-source external identifiers must be unique.
SELECT pg_temp.assert_sqlstate(
  $$INSERT INTO public.job_dedupe_keys (job_id,key_type,normalized_value)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','canonical_url','https://careers.synthetic.example/jobs/valid-international-fixture')$$,
  '23505', 'global canonical-URL dedupe identity prevents exact duplicate vacancy identity');

SELECT pg_temp.assert_sqlstate(
  $stmt$INSERT INTO public.vacancy_sources (
      job_id,source_id,canonical_dedupe_key_id,external_id,source_url,canonical_url,first_seen_at,last_checked_at
    )
    SELECT
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      valid_source.source_id,
      unknown_dedupe.id,
      valid_source.external_id,
      unknown_source.source_url,
      unknown_source.canonical_url,
      now(),now()
    FROM public.vacancy_sources valid_source
    CROSS JOIN public.vacancy_sources unknown_source
    CROSS JOIN LATERAL (
      SELECT id FROM public.job_dedupe_keys
      WHERE job_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    ) unknown_dedupe
    WHERE valid_source.job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      AND unknown_source.job_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'$stmt$,
  '23505', 'source-specific external ID remains unique across distinct vacancy records');

-- Unverified aliases and all private workflow tables stay inaccessible to browser users.
DO $privileges$
BEGIN
  IF has_table_privilege('anon','public.occupation_aliases','SELECT')
     OR has_table_privilege('authenticated','public.vacancy_evidence','SELECT')
     OR has_table_privilege('authenticated','public.verification_reviews','INSERT')
     OR has_table_privilege('authenticated','public.staff_roles','INSERT') THEN
    RAISE EXCEPTION 'FAIL: browser roles can read or change private workflow tables';
  END IF;
  IF NOT has_table_privilege('service_role','public.vacancy_evidence','INSERT')
     OR NOT has_table_privilege('service_role','public.jobs','UPDATE') THEN
    RAISE EXCEPTION 'FAIL: privileged service role lacks required backend privileges in the Supabase-compatible fixture';
  END IF;
  RAISE NOTICE 'PASS: public and backend table privileges';
END;
$privileges$;
