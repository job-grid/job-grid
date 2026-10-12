#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the disposable PostgreSQL CI service}"

vacancy_id='20000000-0000-4000-8000-000000000009'
actor_id='00000000-0000-4000-8000-000000000001'
key='concurrent-close-key-01'
out1="$(mktemp)"
out2="$(mktemp)"

cleanup() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null 2>&1 || true
DROP TRIGGER IF EXISTS __test_delay_concurrent_vacancy_update ON public.vacancies;
DROP FUNCTION IF EXISTS public.__test_delay_concurrent_vacancy_update();
SQL
  rm -f "$out1" "$out2"
}
trap cleanup EXIT

# Force a short overlap after the winner acquires the row lock. This trigger
# exists only in the disposable CI database and is removed on exit.
psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 <<SQL
CREATE OR REPLACE FUNCTION public.__test_delay_concurrent_vacancy_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS \$function\$
BEGIN
  IF NEW.id = '$vacancy_id'::uuid
     AND OLD.status = 'published'
     AND NEW.status = 'closed' THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END;
\$function\$;

CREATE TRIGGER __test_delay_concurrent_vacancy_update
  BEFORE UPDATE ON public.vacancies
  FOR EACH ROW EXECUTE FUNCTION public.__test_delay_concurrent_vacancy_update();
SQL

call_close() {
  local request_id="$1"
  psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 <<SQL
SET ROLE service_role;
SELECT public.close_published_vacancy(
  '$vacancy_id',
  '$actor_id',
  'filled',
  1,
  '$request_id',
  '$key'
);
SQL
}

call_close '50000000-0000-4000-8000-000000000001' >"$out1" &
pid1=$!
call_close '50000000-0000-4000-8000-000000000002' >"$out2" &
pid2=$!
wait "$pid1"
wait "$pid2"

first="$(cat "$out1")"
second="$(cat "$out2")"
combined="$first
$second"
printf '%s\n' "$combined"

[[ "$first" == *'"ok": true'* ]] || { echo "first concurrent request failed" >&2; exit 1; }
[[ "$second" == *'"ok": true'* ]] || { echo "second concurrent request failed" >&2; exit 1; }

# Exactly one invocation must perform the transition and one must replay it.
if [[ "$combined" == *'"replayed": false'*'"replayed": true'* ]] ||
   [[ "$combined" == *'"replayed": true'*'"replayed": false'* ]]; then
  :
else
  echo "concurrent requests did not produce one winner and one replay" >&2
  exit 1
fi

counts="$(psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c \
  "SELECT (SELECT count(*) FROM public.vacancy_audit_events WHERE vacancy_id = '$vacancy_id'::uuid)::text || ':' ||
          (SELECT count(*) FROM public.vacancy_closure_requests WHERE vacancy_id = '$vacancy_id'::uuid AND idempotency_key = '$key')::text")"
[[ "$counts" == "1:1" ]] || {
  echo "expected exactly one audit event and one idempotency record; got $counts" >&2
  exit 1
}

echo "PASS: concurrent idempotent retries produced one closure, one audit event, and one stored request."
