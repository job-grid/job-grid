-- Minimal Supabase-compatible roles/auth schema for isolated PostgreSQL 17 tests.
-- No production credentials or production data are used.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Supabase normally grants its service role backend access to public objects.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;


-- Minimal private Storage bucket catalog for migrations that configure buckets.
-- Object storage itself is not emulated by isolated PostgreSQL tests.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
