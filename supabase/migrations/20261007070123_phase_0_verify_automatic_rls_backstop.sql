-- destructive-review: phase0-controlled-test
-- Phase 0 controlled verification only; this is not an application/domain migration.
CREATE TABLE public.__phase0_rls_probe (id bigint);

DO $$
DECLARE
  rls_enabled boolean;
BEGIN
  SELECT c.relrowsecurity
    INTO rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = '__phase0_rls_probe';

  IF COALESCE(rls_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Phase 0 RLS backstop test failed: RLS was not enabled on public.__phase0_rls_probe';
  END IF;
END
$$;

DROP TABLE public.__phase0_rls_probe;
