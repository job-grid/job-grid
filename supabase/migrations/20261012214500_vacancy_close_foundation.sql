BEGIN;

-- Proposed additive Phase 2A Close Job lifecycle extension.
-- Requires the owner-approved Phase 2A core schema to exist first. This migration
-- does not create organizations, memberships, roles or vacancies. Review-only:
-- do not apply until schema approval, isolated integration, recovery readiness,
-- project authorization and separate execution approval are verified.

-- Prerequisite: Phase 2A core migration must already define organizations,
-- organization_memberships, platform_roles, geography and vacancies. This lifecycle
-- migration deliberately does not create a competing tenant/vacancy data model.
-- CI creates the documented contract fixture before applying this additive migration.

CREATE TABLE public.vacancy_closure_reason_codes (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Initial reason catalog is deliberately small and controlled. Policy owners
-- should review labels and coverage before enabling this for real employers.
INSERT INTO public.vacancy_closure_reason_codes (code, label)
VALUES
  ('filled', 'Position filled'),
  ('cancelled_by_employer', 'Vacancy cancelled by employer'),
  ('incorrect_listing', 'Listing created in error')
ON CONFLICT (code) DO NOTHING;

-- Add only the fields owned by this lifecycle extension to the canonical
-- Phase 2A vacancy entity. Core identity, content, geography, moderation and
-- application fields remain the responsibility of the Phase 2A core schema.
ALTER TABLE public.vacancies
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_reason_code text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.vacancies'::regclass
       AND conname = 'vacancies_closure_reason_code_fkey'
  ) THEN
    ALTER TABLE public.vacancies
      ADD CONSTRAINT vacancies_closure_reason_code_fkey
      FOREIGN KEY (closure_reason_code)
      REFERENCES public.vacancy_closure_reason_codes(code)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.vacancies'::regclass
       AND conname = 'vacancies_closure_fields_consistent'
  ) THEN
    IF EXISTS (
      SELECT 1
        FROM public.vacancies
       WHERE (status = 'closed' AND (closed_at IS NULL OR closure_reason_code IS NULL))
          OR (status <> 'closed' AND (closed_at IS NOT NULL OR closure_reason_code IS NOT NULL))
    ) THEN
      RAISE EXCEPTION
        'Existing vacancy closure states need reconciliation before adding closure constraints';
    END IF;

    ALTER TABLE public.vacancies
      ADD CONSTRAINT vacancies_closure_fields_consistent
      CHECK (
        (status = 'closed' AND closed_at IS NOT NULL AND closure_reason_code IS NOT NULL)
        OR
        (status <> 'closed' AND closed_at IS NULL AND closure_reason_code IS NULL)
      );
  END IF;
END;
$constraints$;

CREATE TABLE public.vacancy_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.vacancies(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type = 'vacancy.closed'),
  from_status text NOT NULL CHECK (from_status = 'published'),
  to_status text NOT NULL CHECK (to_status = 'closed'),
  from_version integer NOT NULL CHECK (from_version >= 1),
  to_version integer NOT NULL CHECK (to_version = from_version + 1),
  reason_code text NOT NULL REFERENCES public.vacancy_closure_reason_codes(code) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.vacancy_closure_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.vacancies(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  reason_code text NOT NULL REFERENCES public.vacancy_closure_reason_codes(code) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  result_version integer NOT NULL CHECK (result_version >= 2),
  closed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, actor_user_id, idempotency_key)
);

CREATE INDEX vacancies_public_search_idx
  ON public.vacancies (geography_id, status, published_at DESC, expires_at);
CREATE INDEX vacancies_org_status_idx
  ON public.vacancies (organization_id, status, updated_at DESC);
CREATE INDEX vacancy_audit_events_vacancy_time_idx
  ON public.vacancy_audit_events (vacancy_id, occurred_at DESC);

-- Canonical Phase 2A tables are expected to have RLS enabled by the core
-- schema migration as well. Reasserting it is fail-closed and does not disable
-- or replace existing policies.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_closure_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_closure_requests ENABLE ROW LEVEL SECURITY;

-- This helper derives identity from the verified Supabase session, never from
-- client-supplied user IDs. It exposes only the caller's own membership result.
CREATE OR REPLACE FUNCTION public.is_active_org_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = auth.uid()
      AND membership.status = 'active'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_active_org_member(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_org_member(uuid) TO authenticated;

CREATE POLICY organizations_member_read
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_active_org_member(id));

CREATE POLICY organization_memberships_self_read
  ON public.organization_memberships FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY vacancy_closure_reasons_active_read
  ON public.vacancy_closure_reason_codes FOR SELECT TO anon, authenticated
  USING (active = true);

-- Anonymous callers see only currently published vacancies. Active organization
-- members can view their own organization's vacancies in employer management.
CREATE POLICY vacancies_public_read
  ON public.vacancies FOR SELECT TO anon
  USING (
    status = 'published'
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  );

CREATE POLICY vacancies_public_or_member_read
  ON public.vacancies FOR SELECT TO authenticated
  USING (
    (
      status = 'published'
      AND published_at IS NOT NULL
      AND published_at <= now()
      AND (expires_at IS NULL OR expires_at > now())
    )
    OR
    (
      auth.uid() IS NOT NULL
      AND public.is_active_org_member(organization_id)
    )
  );

CREATE OR REPLACE FUNCTION public.reject_vacancy_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'vacancy_audit_events is append-only';
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_vacancy_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER vacancy_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.vacancy_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_vacancy_audit_mutation();

-- The trusted service-role Edge Function is the only caller granted EXECUTE.
-- It supplies an actor taken from a verified Auth session; this function then
-- rechecks the actor's current membership or moderator role in the transaction.
CREATE OR REPLACE FUNCTION public.close_published_vacancy(
  p_vacancy_id uuid,
  p_actor_user_id uuid,
  p_reason_code text,
  p_expected_version integer,
  p_request_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_vacancy public.vacancies%ROWTYPE;
  v_prior public.vacancy_closure_requests%ROWTYPE;
  v_authorized boolean := false;
  v_new_version integer;
  v_closed_at timestamptz;
BEGIN
  IF p_actor_user_id IS NULL OR p_vacancy_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  END IF;

  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  END IF;

  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_IDEMPOTENCY_KEY');
  END IF;

  SELECT *
    INTO v_vacancy
    FROM public.vacancies
   WHERE id = p_vacancy_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  SELECT
    EXISTS (
      SELECT 1
        FROM public.organization_memberships AS membership
       WHERE membership.organization_id = v_vacancy.organization_id
         AND membership.user_id = p_actor_user_id
         AND membership.status = 'active'
         AND membership.role IN ('owner', 'admin', 'recruiter')
    )
    OR EXISTS (
      SELECT 1
        FROM public.platform_roles AS platform_role
       WHERE platform_role.user_id = p_actor_user_id
         AND platform_role.active = true
         AND platform_role.role IN ('moderator', 'admin')
    )
    INTO v_authorized;

  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  -- Same-key retries return the previously committed outcome without another
  -- audit event. Reusing a key for another reason is rejected.
  SELECT *
    INTO v_prior
    FROM public.vacancy_closure_requests
   WHERE vacancy_id = p_vacancy_id
     AND actor_user_id = p_actor_user_id
     AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_prior.reason_code <> p_reason_code THEN
      RETURN jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'replayed', true,
      'vacancy_id', p_vacancy_id,
      'status', 'closed',
      'version', v_prior.result_version,
      'closed_at', v_prior.closed_at,
      'reason_code', v_prior.reason_code,
      'request_id', v_prior.request_id
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.vacancy_closure_reason_codes AS reason
     WHERE reason.code = p_reason_code
       AND reason.active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REASON');
  END IF;

  IF v_vacancy.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_CLOSED');
  END IF;

  IF v_vacancy.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE');
  END IF;

  IF v_vacancy.published_at IS NULL
     OR v_vacancy.published_at > now()
     OR (v_vacancy.expires_at IS NOT NULL AND v_vacancy.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_STATE');
  END IF;

  IF v_vacancy.version <> p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT');
  END IF;

  UPDATE public.vacancies
     SET status = 'closed',
         closed_at = clock_timestamp(),
         closure_reason_code = p_reason_code,
         version = version + 1,
         updated_at = clock_timestamp()
   WHERE id = p_vacancy_id
     AND status = 'published'
     AND version = p_expected_version
  RETURNING version, closed_at INTO v_new_version, v_closed_at;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT');
  END IF;

  INSERT INTO public.vacancy_audit_events (
    vacancy_id, organization_id, actor_user_id, event_type,
    from_status, to_status, from_version, to_version, reason_code, request_id
  ) VALUES (
    p_vacancy_id, v_vacancy.organization_id, p_actor_user_id, 'vacancy.closed',
    'published', 'closed', v_vacancy.version, v_new_version, p_reason_code, p_request_id
  );

  INSERT INTO public.vacancy_closure_requests (
    vacancy_id, actor_user_id, idempotency_key, reason_code,
    request_id, result_version, closed_at
  ) VALUES (
    p_vacancy_id, p_actor_user_id, p_idempotency_key, p_reason_code,
    p_request_id, v_new_version, v_closed_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', false,
    'vacancy_id', p_vacancy_id,
    'status', 'closed',
    'version', v_new_version,
    'closed_at', v_closed_at,
    'reason_code', p_reason_code,
    'request_id', p_request_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.close_published_vacancy(uuid, uuid, text, integer, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_published_vacancy(uuid, uuid, text, integer, uuid, text)
  TO service_role;

-- Restrict privileges only on lifecycle-owned tables. The core schema remains
-- responsible for base organization/membership grants and its other API contracts.
REVOKE ALL ON public.vacancy_closure_reason_codes,
  public.vacancy_audit_events, public.vacancy_closure_requests
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.vacancy_closure_reason_codes TO anon, authenticated;

-- Remove table-wide or stale column-level reads inherited from a core draft.
-- Re-grant only the explicitly reviewed public/management projection below.
REVOKE SELECT ON public.vacancies FROM anon, authenticated;
REVOKE SELECT (
  created_by, moderation_state, verification_state, version, closed_at,
  closure_reason_code
) ON public.vacancies FROM anon, authenticated;

GRANT SELECT (
  id, organization_id, reference_code, slug, title, description,
  geography_id, worksite_text, employment_type, contract_duration,
  hours_per_week, salary_min, salary_max, salary_currency, pay_period,
  benefits, accommodation_provided, qualification_requirements,
  licence_requirements, language_requirements, vacancies_count,
  sponsorship_status, application_deadline, status, published_at,
  expires_at, created_at, updated_at
) ON public.vacancies TO anon;

GRANT SELECT (
  id, organization_id, reference_code, slug, title, description,
  geography_id, worksite_text, employment_type, contract_duration,
  hours_per_week, salary_min, salary_max, salary_currency, pay_period,
  benefits, accommodation_provided, qualification_requirements,
  licence_requirements, language_requirements, vacancies_count,
  sponsorship_status, application_deadline, status, moderation_state,
  verification_state, version, published_at, expires_at, closed_at,
  closure_reason_code, created_at, updated_at
) ON public.vacancies TO authenticated;

-- Minimal privilege required by the trusted lifecycle RPC.
GRANT SELECT ON public.organization_memberships, public.platform_roles TO service_role;
GRANT SELECT, UPDATE ON public.vacancies TO service_role;
GRANT SELECT ON public.vacancy_closure_reason_codes TO service_role;
GRANT SELECT, INSERT ON public.vacancy_audit_events TO service_role;
GRANT SELECT, INSERT ON public.vacancy_closure_requests TO service_role;

REVOKE UPDATE, DELETE ON public.vacancy_audit_events FROM service_role;
REVOKE UPDATE, DELETE ON public.vacancy_closure_requests FROM service_role;

COMMIT;
