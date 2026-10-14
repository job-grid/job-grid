#!/usr/bin/env bash
set -euo pipefail

export PGHOST="\${PGHOST:-127.0.0.1}"
export PGPORT="\${PGPORT:-5432}"
export PGUSER="\${PGUSER:-postgres}"
export PGPASSWORD="\${PGPASSWORD:-postgres}"
export PGDATABASE="\${PGDATABASE:-job_grid_certification}"

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

expected="$(psql -XAtq -F '|' -v ON_ERROR_STOP=1 -c "SELECT 25, md5(string_agg(slug || '|' || name || '|' || group_name || '|' || description || '|' || sort_order::text || '|' || is_active::text, E'\\n' ORDER BY sort_order, slug)), 249, md5(string_agg(code || '|' || name, E'\\n' ORDER BY code)), 0 FROM public.job_categories CROSS JOIN public.country_options")"
# Use the actual baseline tuple as the preservation reference; additionally assert the expected counts.
IFS='|' read -r category_count category_hash country_count country_hash job_count <<< "$before"
if [[ "$category_count" != "25" || "$country_count" != "249" || "$job_count" != "0" ]]; then
  echo "FAIL: baseline row counts unexpected: $before" >&2
  exit 1
fi
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

echo "== Run catalog, constraints, synthetic data, and role permission checks =="
psqlx -f tests/database-certification.sql

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

echo "== Test data revision trigger invalidates previously approved publication =="
version_before="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT record_version FROM public.jobs WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
psql -X -qAt -v ON_ERROR_STOP=1 -c "UPDATE public.jobs SET description = description || ' changed during certification' WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';" >/dev/null
state_after_change="$(psql -XAtq -v ON_ERROR_STOP=1 -c "SELECT status || '|' || verification_status || '|' || (record_version > $version_before)::text FROM public.jobs WHERE id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';")"
if [[ "$state_after_change" != "draft|needs_review|true" ]]; then
  echo "FAIL: content change did not require a fresh review (state=$state_after_change)" >&2
  exit 1
fi
echo "PASS: publish-relevant content edits invalidate current approval and return the vacancy to draft"

echo "== Final synthetic-data integrity checks =="
psql -XAtq -v ON_ERROR_STOP=1 -c "
DO \$final\$
BEGIN
  IF (SELECT count(*) FROM public.job_categories) <> 25 THEN RAISE EXCEPTION 'category count changed'; END IF;
  IF (SELECT count(*) FROM public.country_options) <> 249 THEN RAISE EXCEPTION 'country count changed'; END IF;
  IF (SELECT count(*) FROM public.jobs) <> 4 THEN RAISE EXCEPTION 'unexpected synthetic job count'; END IF;
  IF (SELECT count(*) FROM public.vacancy_sources) <> 4 THEN RAISE EXCEPTION 'source provenance fixture count wrong'; END IF;
  IF (SELECT count(*) FROM public.publication_records WHERE unpublished_at IS NOT NULL) < 1 THEN RAISE EXCEPTION 'publication invalidation history missing'; END IF;
  IF (SELECT count(*) FROM public.job_vacancies) <> 0 THEN RAISE EXCEPTION 'parallel vacancy table unexpectedly exists'; END IF;
END;
\$final\$;
"
echo "PASS: final catalog preservation, four isolated synthetic jobs, provenance, audit and publication history"
echo "DATABASE CERTIFICATION RESULT: PASS for isolated PostgreSQL 17 migration and synthetic permission/publication tests"
