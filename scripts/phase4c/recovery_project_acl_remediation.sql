/*
Job Grid Phase 4C — one-time recovery-project function ACL remediation
Status: manual operator procedure; NOT a Supabase migration.

EXACT TARGET:
  Recovery project ref: vbxyigsljxjfcvytdoiq
  SQL Editor: https://supabase.com/dashboard/project/vbxyigsljxjfcvytdoiq/sql/new

SAFETY:
- Before running any section, open the URL above and confirm the project ref
  shown in the Supabase dashboard is exactly vbxyigsljxjfcvytdoiq.
- Do not run this against production (tnrdovdhlwitjzecduxa).
- Run the PRECHECK first and inspect its result. Then run only the REPAIR
  transaction. Finally run the POSTCHECK and retain its output with the
  Phase 4C audit evidence.
- Do not execute as a migration or add this file to supabase/migrations/.
- This repairs function EXECUTE ACLs only. It does not create a backup, prove
  restore readiness, change function code, or authorize a catalog import.
*/

/* PRECHECK — read-only. Expected: function exists, prosecdef=true, and an
   enabled event trigger references it. Inspect the PUBLIC/anon/authenticated
   execute results before proceeding. */
WITH fn AS (
  SELECT to_regprocedure('public.rls_auto_enable()')::oid AS function_oid
)
SELECT
  current_database() AS database_name,
  p.oid::regprocedure AS function_identity,
  p.prosecdef AS security_definer,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.proacl AS function_acl,
  EXISTS (
    SELECT 1
    FROM pg_event_trigger et
    WHERE et.evthandle = p.oid
      AND et.evtenabled <> 'D'
  ) AS has_enabled_event_trigger,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_can_execute
FROM fn
LEFT JOIN pg_proc p ON p.oid = fn.function_oid;

/* REPAIR — run only after confirming the target project ref in the dashboard.
   The transaction fails closed if the function/handler shape has drifted. */
BEGIN;

DO $repair$
DECLARE
  function_oid oid;
  is_security_definer boolean;
  enabled_handler_count integer;
BEGIN
  function_oid := to_regprocedure('public.rls_auto_enable()')::oid;
  IF function_oid IS NULL THEN
    RAISE EXCEPTION 'STOP: public.rls_auto_enable() is absent; inspect manually.';
  END IF;

  SELECT p.prosecdef
    INTO is_security_definer
    FROM pg_proc p
   WHERE p.oid = function_oid;

  IF is_security_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'STOP: function is not SECURITY DEFINER as expected; inspect drift.';
  END IF;

  SELECT count(*)
    INTO enabled_handler_count
    FROM pg_event_trigger et
   WHERE et.evthandle = function_oid
     AND et.evtenabled <> 'D';

  IF enabled_handler_count < 1 THEN
    RAISE EXCEPTION 'STOP: no enabled event trigger references this function; inspect manually.';
  END IF;
END
$repair$;

-- Remove inherited default execution and any direct grants to API-facing roles.
-- The event trigger remains registered; this statement does not modify its code.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

COMMIT;

/* POSTCHECK — expected values: anon_can_execute=false,
   authenticated_can_execute=false, public_can_execute=false,
   security_definer=true, has_enabled_event_trigger=true. */
WITH fn AS (
  SELECT to_regprocedure('public.rls_auto_enable()')::oid AS function_oid
)
SELECT
  p.oid::regprocedure AS function_identity,
  p.prosecdef AS security_definer,
  p.proacl AS function_acl,
  EXISTS (
    SELECT 1
    FROM pg_event_trigger et
    WHERE et.evthandle = p.oid
      AND et.evtenabled <> 'D'
  ) AS has_enabled_event_trigger,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) AS public_can_execute
FROM fn
LEFT JOIN pg_proc p ON p.oid = fn.function_oid;
