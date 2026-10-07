-- Phase 0 security regression test.
-- Execute only against an authorized test database or during a controlled production maintenance verification.

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not be able to EXECUTE public.rls_auto_enable()';
  END IF;
  IF has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not be able to EXECUTE public.rls_auto_enable()';
  END IF;
  IF has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must not be able to EXECUTE public.rls_auto_enable()';
  END IF;
  IF NOT has_function_privilege('postgres', 'public.rls_auto_enable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres must retain EXECUTE on public.rls_auto_enable()';
  END IF;
END
$$;

DO $$
DECLARE
  rls_enabled boolean;
BEGIN
  CREATE TABLE public.__phase0_rls_regression_probe (id bigint);

  SELECT c.relrowsecurity
    INTO rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = '__phase0_rls_regression_probe';

  IF COALESCE(rls_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ensure_rls did not enable RLS on the qualifying probe table';
  END IF;

  DROP TABLE public.__phase0_rls_regression_probe;
END
$$;
