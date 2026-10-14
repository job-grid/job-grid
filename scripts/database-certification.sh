#!/usr/bin/env bash
set -euo pipefail

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGDATABASE="${PGDATABASE:-job_grid_certification}"

psqlx() {
  psql -X -v ON_ERROR_STOP=1 "$@"
}

echo "== Set up isolated Supabase-compatible PostgreSQL test database =="
psqlx -q -f tests/fixtures/supabase-postgres-compat.sql

echo "== Apply actual current Job Grid country migration =="
psqlx -q -f supabase/migrations/20261014093000_create_country_options.sql

echo "== Apply actual current Job Grid categories/jobs migration =="
psqlx -q -f supabase/migrations/20261014120000_create_job_catalog_and_jobs.sql

before="$(psql -XAtq -F '|' -v ON_ERROR_STOP=1 -c "
SELECT
  (SELECT count(*) FROM public.job_categories),
  (SELECT md5(string_agg(slug || '|' || name || '|' || group_name || '|' || description || '|' || sort_order::text || '|' || is_active::text, E'\\n' ORDER BY sort_order, slug)) FROM public.job_categories),
  (SELECT count(*) FROM public.country_options),
  (SELECT md5(string_agg(code || '|' || name, E'\\n' ORDER BY code)) FROM public.country_options),
  (SELECT count(*) FROM public.jobs);
")"


# Use the actual baseline tuple as the preservation reference; additionally assert the expected counts.
IFS='|' read -r category_count category_hash country_count country_hash job_count <<< "$before"
if [[ "$category_count" != "25" || "$country_count" != "249" || "$job_count" != "0" ]]; then
  echo "FAIL: baseline row counts unexpected: $before" >&2
  exit 1
fi
if [[ "$category_hash" != "480311db1f5387645f67aa8cadf91d37" || "$country_hash" != "b7b741c57938e86b7593723bce9a6f26" ]]; then
  echo "FAIL: synthetic baseline does not match the read-only production category/country content fingerprints." >&2
  echo "Category fingerprint: $category_hash" >&2
  echo "Country fingerprint:  $country_hash" >&2
  exit 1
fi
echo "PASS: isolated baseline content fingerprints match the read-only production snapshot"
echo "PASS: baseline snapshot captured (25 categories, 249 country options, 0 jobs)"

echo "== Apply the proposed PR #45 migration in isolation =="
psqlx -q -f supabase/migrations/20261014190000_add_verified_international_job_workflow.sql

after="$(psql -XAtq -F '|' -v ON_ERROR_STOP=1 -c "
SELECT
  (SELECT count(*) FROM public.job_categories),
  (SELECT md5(string_agg(slug || '|' || name || '|' || group_name || '|' || description || '|' || sort_order::text || '|' || is_active::text, E'\\n' ORDER BY sort_order, slug)) FROM public.job_categories),
  (SELECT count(*) FROM public.country_options),
  (SELECT md5(string_agg(code || '|' || name, E'\\n' ORDER BY code)) FROM public.country_options),
  (SELECT count(*) FROM public.jobs);
")"
if [[ "$before" != "$after" ]]; then
  echo "FAIL: category/country/jobs baseline changed after proposed migration." >&2
  echo "Before: $before" >&2
  echo "After:  $after" >&2
  exit 1
fi
echo "PASS: exact category/country/job baseline counts and content hashes unchanged"

echo "== Test public category and country policies used by the website =="
anon_category_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT count(*) FROM public.job_categories WHERE is_active = true;")"
anon_country_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT count(*) FROM public.country_options;")"
if [[ "$anon_category_count" != "25" || "$anon_country_count" != "249" ]]; then
  echo "FAIL: anonymous website lookup counts wrong (categories=$anon_category_count countries=$anon_country_count)" >&2
  exit 1
fi
echo "PASS: anonymous category and country lookups return 25 and 249 rows"

echo "== Test the existing website's category contract against anonymous PostgreSQL results =="
category_file="$(mktemp)"
trap 'rm -f "$category_file"' EXIT
psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT slug || E'\\t' || name || E'\\t' || sort_order::text FROM public.job_categories WHERE is_active = true ORDER BY sort_order ASC;" > "$category_file"
JOB_GRID_ACTIVE_CATEGORY_FILE="$category_file" node scripts/check-role-category-contract.mjs

echo "== Run catalog, constraints, synthetic data, and role permission checks =="
psqlx -f tests/database-certification.sql

echo "== Verify public occupation directory excludes active but unverified titles =="
anon_occupation_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT count(*) FROM public.occupations;")"
if [[ "$anon_occupation_count" != "1" ]]; then
  echo "FAIL: public occupation directory should expose only the one verified synthetic title; got $anon_occupation_count" >&2
  exit 1
fi
echo "PASS: active-but-pending occupation title is not visible anonymously"

expect_failure() {
  local label="$1"
  local expected="$2"
  local statement="$3"
  local output
  if output="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "$statement" 2>&1)"; then
    echo "FAIL: $label unexpectedly succeeded" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    echo "FAIL: $label failed for an unexpected reason" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "PASS: $label"
}

set_role_sql() {
  local user_id="$1"
  local command="$2"
  printf "SET ROLE authenticated; SET request.jwt.claim.sub = '%s'; %s" "$user_id" "$command"
}

assert_public_job_count() {
  local expected_count="$1"
  local label="$2"
  local actual_count
  actual_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT count(*) FROM public.jobs;")"
  if [[ "$actual_count" != "$expected_count" ]]; then
    echo "FAIL: $label expected $expected_count public jobs, got $actual_count" >&2
    exit 1
  fi
}

assert_job_retracted_for_review() {
  local label="$1"
  local state
  state="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT j.status || '|' || j.verification_status || '|' || ((j.published_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.publication_records pr WHERE pr.job_id=j.id AND pr.unpublished_at IS NULL))::text) FROM public.jobs j WHERE j.id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
  if [[ "$state" != "draft|needs_review|true" ]]; then
    echo "FAIL: $label did not invalidate the published record correctly (state=$state)" >&2
    exit 1
  fi
  assert_public_job_count "0" "$label"
  echo "PASS: $label retracts the published job and requires review"
}

reapprove_and_publish_valid_job() {
  local reviewer_sql publisher_sql
  reviewer_sql="$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approved','Synthetic trigger revalidation for database certification.');")"
  publisher_sql="$(set_role_sql '22222222-2222-4222-8222-222222222222' "SELECT public.publish_verified_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd');")"
  psql -X -qAt -v ON_ERROR_STOP=1 -c "$reviewer_sql" >/dev/null
  psql -X -qAt -v ON_ERROR_STOP=1 -c "$publisher_sql" >/dev/null
  assert_public_job_count "1" "reapproved synthetic vacancy"
  echo "PASS: authorized reviewer and publisher can reapprove after evidence refresh"
}

echo "== Test reviewer/publisher/administrator function permissions =="

expect_failure "anonymous user cannot call reviewer RPC" "permission denied" \
  "SET ROLE anon; SELECT public.review_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approved','unauthorized');"

expect_failure "authenticated non-reviewer cannot approve a vacancy" "Reviewer permission is required" \
  "$(set_role_sql '44444444-4444-4444-8444-444444444444' "SELECT public.review_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approved','unauthorized');")"

expect_failure "reviewer cannot publish" "Publisher permission is required" \
  "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.publish_verified_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd');")"

expect_failure "reviewer cannot approve unknown international eligibility" "lacks current employer, occupation, source, application, or international-eligibility evidence" \
  "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','approved','insufficient eligibility evidence');")"

expect_failure "reviewer cannot approve missing evidence" "lacks current employer, occupation, source, application, or international-eligibility evidence" \
  "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('ffffffff-ffff-4fff-8fff-ffffffffffff','approved','missing evidence');")"

echo "== Approve a valid synthetic vacancy as reviewer =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approved','Synthetic positive-path evidence reviewed for certification.');")" >/dev/null
echo "PASS: authorized reviewer can approve a complete current evidence set"

echo "== Expired listing must not publish =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('99999999-9999-4999-8999-999999999999','approved','Synthetic expired listing evidence reviewed.');")" >/dev/null
expect_failure "publisher cannot publish an expired vacancy" "future expiry" \
  "$(set_role_sql '22222222-2222-4222-8222-222222222222' "SELECT public.publish_verified_job('99999999-9999-4999-8999-999999999999');")"

echo "== Publish valid listing as publisher, then test public RLS =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "$(set_role_sql '22222222-2222-4222-8222-222222222222' "SELECT public.publish_verified_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd');")" >/dev/null
anon_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT count(*) FROM public.jobs;")"
auth_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE authenticated; SET request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444'; SELECT count(*) FROM public.jobs;")"
if [[ "$anon_count" != "1" || "$auth_count" != "1" ]]; then
  echo "FAIL: RLS should return exactly one valid published vacancy to public roles; anon=$anon_count authenticated=$auth_count" >&2
  exit 1
fi
echo "PASS: anon and ordinary authenticated visitors see only the single approved, in-date vacancy"

expect_failure "public visitors cannot insert jobs directly" "permission denied" \
  "SET ROLE anon; INSERT INTO public.jobs(title,slug,employer_name,description,category_slug,skill_level,employment_type,country_code) VALUES ('Unauthorized public insertion','unauthorized-public-insertion','Synthetic Employer','Not allowed','health-care-caregiving','skilled','full_time','CA');"

echo "== Exercise the job revision trigger on a published row =="
version_before="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT record_version FROM public.jobs WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.jobs SET description = description || ' edited during certification' WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';" >/dev/null
revision_state="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT status || '|' || verification_status || '|' || (record_version > $version_before)::text FROM public.jobs WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
if [[ "$revision_state" != "draft|needs_review|true" ]]; then
  echo "FAIL: job revision trigger did not invalidate changed content (state=$revision_state)" >&2
  exit 1
fi
assert_public_job_count "0" "content edit invalidation"
echo "PASS: job revision trigger increments version and invalidates the current publication"
reapprove_and_publish_valid_job

echo "== Exercise employer identity verification reset and linked-job invalidation =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.employers SET website='https://employer-revised.synthetic.example/' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';" >/dev/null
assert_job_retracted_for_review "employer identity change"
employer_state="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT verification_status || '|' || (verification_evidence_url IS NULL)::text || '|' || (verified_at IS NULL)::text || '|' || (verified_by IS NULL)::text FROM public.employers WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';")"
if [[ "$employer_state" != "pending|true|true|true" ]]; then
  echo "FAIL: employer identity change did not reset verification evidence (state=$employer_state)" >&2
  exit 1
fi
expect_failure "reviewer cannot reapprove a vacancy after employer identity change until reverified" "lacks current employer, occupation, source, application, or international-eligibility evidence" \
  "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approved','attempt before employer reverification');")"
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.employers SET verification_status='verified', verification_evidence_url='https://employer-revised.synthetic.example/test-verification-evidence', verified_at=now(), verified_by='33333333-3333-4333-8333-333333333333' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';" >/dev/null
reapprove_and_publish_valid_job

echo "== Exercise occupation identity verification reset and linked-job invalidation =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.occupations SET canonical_title = canonical_title || ' Revised' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';" >/dev/null
assert_job_retracted_for_review "occupation identity change"
occupation_state="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT verification_status || '|' || is_active::text || '|' || (verification_source_url IS NULL)::text || '|' || (verified_at IS NULL)::text || '|' || (verified_by IS NULL)::text FROM public.occupations WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';")"
if [[ "$occupation_state" != "pending|false|true|true|true" ]]; then
  echo "FAIL: occupation identity change did not reset verification evidence and active flag (state=$occupation_state)" >&2
  exit 1
fi
expect_failure "reviewer cannot reapprove a vacancy after occupation identity change until reverified" "lacks current employer, occupation, source, application, or international-eligibility evidence" \
  "$(set_role_sql '11111111-1111-4111-8111-111111111111' "SELECT public.review_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approved','attempt before occupation reverification');")"
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.occupations SET verification_status='verified', verification_source_url='https://occupations.synthetic.example/test-occupation-evidence-revised', verified_at=now(), verified_by='33333333-3333-4333-8333-333333333333', is_active=true WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';" >/dev/null
reapprove_and_publish_valid_job

echo "== Exercise source-link invalidation trigger =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.vacancy_sources SET content_hash=repeat('a',64) WHERE job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';" >/dev/null
assert_job_retracted_for_review "source content hash change"
reapprove_and_publish_valid_job

echo "== Exercise evidence invalidation trigger =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.vacancy_evidence SET short_excerpt=short_excerpt || ' rechecked' WHERE job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' AND evidence_type='international_eligibility';" >/dev/null
assert_job_retracted_for_review "international-eligibility evidence change"
reapprove_and_publish_valid_job

echo "== Exercise eligibility-assessment invalidation trigger =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.eligibility_assessments SET assessment_status='superseded' WHERE id=(SELECT id FROM public.eligibility_assessments WHERE job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd' ORDER BY assessed_at DESC,id DESC LIMIT 1);" >/dev/null
assert_job_retracted_for_review "eligibility assessment status change"
psql -X -qAt -v ON_ERROR_STOP=1 -c "
INSERT INTO public.eligibility_assessments (
  job_id,applicant_scope,sponsorship_status,assessment_status,eligibility_evidence_id,
  assessment_reason,assessed_by,assessed_at
)
SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd','explicitly_open','unknown','approved',
       ev.id,'Synthetic re-assessment after evidence recertification',
       '11111111-1111-4111-8111-111111111111',clock_timestamp()
FROM public.vacancy_evidence ev
WHERE ev.job_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  AND ev.evidence_type='international_eligibility'
ORDER BY ev.captured_at DESC,ev.id
LIMIT 1;
" >/dev/null
reapprove_and_publish_valid_job

echo "== Test unpublish function role checks =="
expect_failure "unauthorized user cannot unpublish" "Publisher permission is required" \
  "$(set_role_sql '44444444-4444-4444-8444-444444444444' "SELECT public.unpublish_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','suspended','unauthorized unpublish');")"

echo "== Revoking source permission must disable its connection and unpublish linked jobs =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "
UPDATE public.job_sources
SET permission_status='revoked', enabled=false
WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
" >/dev/null

revoked_source="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT (permission_status='revoked' AND enabled=false)::text FROM public.job_sources WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';")"
connection_enabled="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT enabled::text FROM public.source_connections WHERE source_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';")"
visible_after_revoke="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SET ROLE anon; SELECT count(*) FROM public.jobs;")"
if [[ "$revoked_source" != "true" || "$connection_enabled" != "false" || "$visible_after_revoke" != "0" ]]; then
  echo "FAIL: source revocation did not switch off collection and hide published jobs (source=$revoked_source connection=$connection_enabled public_jobs=$visible_after_revoke)" >&2
  exit 1
fi
echo "PASS: revoked source is disabled, connection is shut off, linked publication disappears"

echo "== Test authorized publisher unpublish path and its audit record =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "$(set_role_sql '22222222-2222-4222-8222-222222222222' "SELECT public.unpublish_job('dddddddd-dddd-4ddd-8ddd-dddddddddddd','suspended','Source permission revoked during certification');")" >/dev/null
unpublish_audit="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.audit_logs WHERE actor_id='22222222-2222-4222-8222-222222222222' AND action='job_unpublished' AND entity_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
terminal_status="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT status FROM public.jobs WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
if [[ "$unpublish_audit" -lt "1" || "$terminal_status" != "suspended" ]]; then
  echo "FAIL: authorized unpublish did not change the listing and record the action" >&2
  exit 1
fi
echo "PASS: authorized publisher can suspend a listing and the action is audited"

expect_failure "administrator cannot re-enable a revoked source" "cannot be enabled without approved access" \
  "$(set_role_sql '33333333-3333-4333-8333-333333333333' "SELECT public.set_job_source_enabled('cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);")"

echo "== Test an admin permission-gated source toggle and audit record =="
psql -X -qAt -v ON_ERROR_STOP=1 -c "$(set_role_sql '33333333-3333-4333-8333-333333333333' "SELECT public.set_job_source_enabled('cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);")" >/dev/null
audit_count="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.audit_logs WHERE actor_id='33333333-3333-4333-8333-333333333333' AND action='job_source_disabled';")"
if [[ "$audit_count" -lt "1" ]]; then
  echo "FAIL: administrator source toggle did not leave an audit record" >&2
  exit 1
fi
echo "PASS: authorized system administrator source toggle is audited"

echo "== Final synthetic-data integrity checks =="
psql -XAtq -v ON_ERROR_STOP=1 -c "
DO \$final\$
BEGIN
  IF (SELECT count(*) FROM public.job_categories) <> 25 THEN RAISE EXCEPTION 'category count changed'; END IF;
  IF (SELECT count(*) FROM public.country_options) <> 249 THEN RAISE EXCEPTION 'country count changed'; END IF;
  IF (SELECT count(*) FROM public.jobs) <> 4 THEN RAISE EXCEPTION 'unexpected synthetic job count'; END IF;
  IF (SELECT count(*) FROM public.vacancy_sources) <> 4 THEN RAISE EXCEPTION 'source provenance fixture count wrong'; END IF;
  IF (SELECT count(*) FROM public.publication_records WHERE unpublished_at IS NOT NULL) < 1 THEN RAISE EXCEPTION 'publication invalidation history missing'; END IF;
  IF to_regclass('public.job_vacancies') IS NOT NULL THEN RAISE EXCEPTION 'parallel vacancy table unexpectedly exists'; END IF;
END;
\$final\$;
"
echo "PASS: final catalog preservation, four isolated synthetic jobs, provenance, audit and publication history"
echo "DATABASE CERTIFICATION RESULT: PASS for isolated PostgreSQL 17 migration and synthetic permission/publication tests"
