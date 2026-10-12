-- Structural RLS contract test for the proposed location preference table.
-- Run only after the reviewed migration is applied to the verified Job Grid project.
-- This confirms policy shape; a separate two-user authenticated integration test is required
-- before release to prove cross-user isolation end to end.

DO $$
DECLARE
  rls_enabled boolean;
  required_policy record;
BEGIN
  SELECT c.relrowsecurity
    INTO rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'user_location_preferences';

  IF COALESCE(rls_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'RLS must be enabled on public.user_location_preferences';
  END IF;

  FOR required_policy IN
    SELECT * FROM (VALUES
      ('user_location_preferences_select_own', 'SELECT'),
      ('user_location_preferences_insert_own', 'INSERT'),
      ('user_location_preferences_update_own', 'UPDATE'),
      ('user_location_preferences_delete_own', 'DELETE')
    ) AS expected(policyname, cmd)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = 'user_location_preferences'
        AND p.policyname = required_policy.policyname
        AND p.cmd = required_policy.cmd
        AND p.roles::text[] @> ARRAY['authenticated']::text[]
        AND NOT (p.roles::text[] && ARRAY['anon', 'public']::text[])
        AND CASE p.cmd
          WHEN 'SELECT' THEN
            p.qual IS NOT NULL
            AND position('auth.uid()' IN p.qual) > 0
            AND position('user_id' IN p.qual) > 0
            AND p.with_check IS NULL
          WHEN 'INSERT' THEN
            p.qual IS NULL
            AND p.with_check IS NOT NULL
            AND position('auth.uid()' IN p.with_check) > 0
            AND position('user_id' IN p.with_check) > 0
          WHEN 'UPDATE' THEN
            p.qual IS NOT NULL
            AND position('auth.uid()' IN p.qual) > 0
            AND position('user_id' IN p.qual) > 0
            AND p.with_check IS NOT NULL
            AND position('auth.uid()' IN p.with_check) > 0
            AND position('user_id' IN p.with_check) > 0
          WHEN 'DELETE' THEN
            p.qual IS NOT NULL
            AND position('auth.uid()' IN p.qual) > 0
            AND position('user_id' IN p.qual) > 0
            AND p.with_check IS NULL
          ELSE false
        END
    ) THEN
      RAISE EXCEPTION 'Missing or unsafe owner-scoped policy: %', required_policy.policyname;
    END IF;
  END LOOP;
END
$$;
