-- Add an occupation and verified-international-vacancy workflow around the existing Job Grid tables.
-- IMPORTANT: public.job_categories, public.country_options, and public.jobs already exist.
-- This migration deliberately does not recreate categories or create a parallel vacancy table.
-- No source connectors are seeded or enabled. No existing job or category rows are deleted.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.job_categories') IS NULL THEN
    RAISE EXCEPTION 'Required existing table public.job_categories was not found; refusing to create a replacement.';
  END IF;
  IF to_regclass('public.country_options') IS NULL THEN
    RAISE EXCEPTION 'Required existing table public.country_options was not found.';
  END IF;
  IF to_regclass('public.jobs') IS NULL THEN
    RAISE EXCEPTION 'Required existing table public.jobs was not found; refusing to create a parallel vacancy table.';
  END IF;
END;
$preflight$;

CREATE TABLE public.occupations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_slug text NOT NULL REFERENCES public.job_categories (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  canonical_title text NOT NULL
    CONSTRAINT occupations_title_nonempty CHECK (length(btrim(canonical_title)) BETWEEN 2 AND 180),
  normalized_title text GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(canonical_title), '[[:space:]]+', ' ', 'g'))
  ) STORED,
  isco08_code text
    CONSTRAINT occupations_isco08_format CHECK (isco08_code IS NULL OR isco08_code ~ '^[0-9]{1,4}$'),
  verification_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT occupations_verification_status_valid CHECK (
      verification_status IN ('pending', 'verified', 'rejected', 'needs_review')
    ),
  verification_source_url text
    CONSTRAINT occupations_source_url_https CHECK (
      verification_source_url IS NULL OR verification_source_url ~ '^https://[^[:space:]]+$'
    ),
  verification_notes text,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT occupations_verified_has_evidence CHECK (
    verification_status <> 'verified'
    OR (verification_source_url IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT occupations_normalized_title_unique UNIQUE (normalized_title)
);

COMMENT ON TABLE public.occupations IS
  'Canonical occupation directory. Every row belongs to the existing job_categories table. Pending titles are candidates, not official classifications; verification requires evidence.';

CREATE TABLE public.occupation_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupation_id uuid NOT NULL REFERENCES public.occupations (id) ON DELETE RESTRICT,
  alternative_title text NOT NULL
    CONSTRAINT occupation_aliases_title_nonempty CHECK (length(btrim(alternative_title)) BETWEEN 2 AND 180),
  normalized_title text GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(alternative_title), '[[:space:]]+', ' ', 'g'))
  ) STORED,
  locale text NOT NULL DEFAULT 'en'
    CONSTRAINT occupation_aliases_locale_nonempty CHECK (length(btrim(locale)) BETWEEN 2 AND 16),
  source_url text
    CONSTRAINT occupation_aliases_source_url_https CHECK (source_url IS NULL OR source_url ~ '^https://[^[:space:]]+$'),
  verification_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT occupation_aliases_verification_status_valid CHECK (
      verification_status IN ('pending', 'verified', 'rejected')
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT occupation_aliases_per_occupation_unique UNIQUE (occupation_id, normalized_title)
);

CREATE TABLE public.employers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL
    CONSTRAINT employers_legal_name_nonempty CHECK (length(btrim(legal_name)) BETWEEN 2 AND 220),
  website text
    CONSTRAINT employers_website_https CHECK (website IS NULL OR website ~ '^https://[^[:space:]]+$'),
  country_code text REFERENCES public.country_options (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  verification_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT employers_verification_status_valid CHECK (
      verification_status IN ('pending', 'verified', 'rejected', 'suspended')
    ),
  verification_evidence_url text
    CONSTRAINT employers_evidence_url_https CHECK (
      verification_evidence_url IS NULL OR verification_evidence_url ~ '^https://[^[:space:]]+$'
    ),
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employers_verified_has_evidence CHECK (
    verification_status <> 'verified'
    OR (verification_evidence_url IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE TABLE public.job_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
    CONSTRAINT job_sources_name_nonempty CHECK (length(btrim(name)) BETWEEN 2 AND 180),
  domain text NOT NULL
    CONSTRAINT job_sources_domain_valid CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9.-]+$'),
  source_type text NOT NULL
    CONSTRAINT job_sources_type_valid CHECK (
      source_type IN (
        'government_portal', 'employer_careers', 'licensed_api',
        'authorized_feed', 'partner_portal', 'employer_submission', 'manual_submission'
      )
    ),
  access_method text NOT NULL
    CONSTRAINT job_sources_access_method_valid CHECK (
      access_method IN (
        'official_api', 'licensed_feed', 'employer_feed',
        'partner_api', 'permitted_structured_page', 'manual_submission'
      )
    ),
  permission_status text NOT NULL DEFAULT 'pending_review'
    CONSTRAINT job_sources_permission_status_valid CHECK (
      permission_status IN ('pending_review', 'approved', 'restricted', 'revoked')
    ),
  permission_evidence_url text
    CONSTRAINT job_sources_permission_url_https CHECK (
      permission_evidence_url IS NULL OR permission_evidence_url ~ '^https://[^[:space:]]+$'
    ),
  permission_reviewed_at timestamptz,
  permission_reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT false,
  recheck_interval_hours integer NOT NULL DEFAULT 72
    CONSTRAINT job_sources_recheck_interval_valid CHECK (recheck_interval_hours BETWEEN 1 AND 720),
  max_requests_per_hour integer NOT NULL DEFAULT 30
    CONSTRAINT job_sources_rate_limit_valid CHECK (max_requests_per_hour BETWEEN 1 AND 10000),
  attribution_text text,
  retention_days integer NOT NULL DEFAULT 30
    CONSTRAINT job_sources_retention_valid CHECK (retention_days BETWEEN 1 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_sources_approval_requires_evidence CHECK (
    permission_status <> 'approved'
    OR (permission_evidence_url IS NOT NULL AND permission_reviewed_at IS NOT NULL)
  ),
  CONSTRAINT job_sources_enabled_requires_permission CHECK (
    NOT enabled OR (permission_status = 'approved' AND permission_evidence_url IS NOT NULL)
  )
);

CREATE UNIQUE INDEX job_sources_domain_unique ON public.job_sources (lower(domain));

CREATE TABLE public.source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL UNIQUE REFERENCES public.job_sources (id) ON DELETE RESTRICT,
  adapter_key text NOT NULL
    CONSTRAINT source_connections_adapter_key_nonempty CHECK (length(btrim(adapter_key)) BETWEEN 2 AND 120),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT source_connections_config_object CHECK (jsonb_typeof(configuration) = 'object'),
  schedule_minutes integer NOT NULL DEFAULT 360
    CONSTRAINT source_connections_schedule_valid CHECK (schedule_minutes BETWEEN 15 AND 10080),
  enabled boolean NOT NULL DEFAULT false,
  last_cursor text,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_connections_no_secret_values CHECK (
    NOT (
      configuration ?| ARRAY[
        'api_key', 'access_token', 'client_secret', 'password',
        'service_role_key', 'authorization', 'token'
      ]
    )
  )
);

COMMENT ON COLUMN public.source_connections.configuration IS
  'Non-secret connector settings only. Credentials must be stored in an approved secret manager, never in this JSON column.';

ALTER TABLE public.jobs
  ADD COLUMN occupation_id uuid REFERENCES public.occupations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD COLUMN employer_id uuid REFERENCES public.employers (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD COLUMN source_posted_at timestamptz,
  ADD COLUMN first_seen_at timestamptz,
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN international_eligibility text NOT NULL DEFAULT 'unknown'
    CONSTRAINT jobs_international_eligibility_valid CHECK (
      international_eligibility IN (
        'pending', 'explicitly_open', 'employer_sponsored',
        'conditional', 'unknown', 'domestic_only', 'contradictory'
      )
    ),
  ADD COLUMN visa_sponsorship text NOT NULL DEFAULT 'unknown'
    CONSTRAINT jobs_visa_sponsorship_valid CHECK (
      visa_sponsorship IN ('confirmed', 'not_offered', 'conditional', 'unknown')
    ),
  ADD COLUMN verification_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT jobs_verification_status_valid CHECK (
      verification_status IN ('pending', 'verified', 'rejected', 'needs_review')
    ),
  ADD COLUMN record_version bigint NOT NULL DEFAULT 1
    CONSTRAINT jobs_record_version_positive CHECK (record_version > 0);

COMMENT ON COLUMN public.jobs.sponsorship_status IS
  'Legacy display field retained for compatibility. Use visa_sponsorship plus vacancy-specific evidence for international publication decisions.';
COMMENT ON COLUMN public.jobs.international_eligibility IS
  'Whether the advertisement explicitly accepts international applicants; separate from the applicant eligibility decision and visa sponsorship.';
COMMENT ON COLUMN public.jobs.visa_sponsorship IS
  'Vacancy-specific evidence-backed status: confirmed, not_offered, conditional, or unknown. Unknown must never be displayed as confirmed.';
COMMENT ON COLUMN public.jobs.record_version IS
  'Incremented when publish-relevant job details or linked source/evidence/eligibility records change. Reviews are valid only for the current version.';

CREATE TABLE public.job_dedupe_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  key_type text NOT NULL
    CONSTRAINT job_dedupe_keys_type_valid CHECK (key_type IN ('canonical_url')),
  normalized_value text NOT NULL
    CONSTRAINT job_dedupe_keys_value_nonempty CHECK (length(btrim(normalized_value)) BETWEEN 8 AND 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_dedupe_keys_global_identity UNIQUE (key_type, normalized_value),
  CONSTRAINT job_dedupe_keys_id_job_unique UNIQUE (id, job_id),
  CONSTRAINT job_dedupe_keys_canonical_url_https CHECK (
    key_type <> 'canonical_url' OR normalized_value ~ '^https://[^[:space:]]+$'
  )
);

COMMENT ON TABLE public.job_dedupe_keys IS
  'Global dedupe identities that connect repeat sightings of one canonical vacancy to the same existing jobs row. Cross-source fuzzy matches stay review candidates rather than being auto-merged.';

CREATE TABLE public.job_duplicate_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_a_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  job_b_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  match_type text NOT NULL
    CONSTRAINT job_duplicate_candidates_type_valid CHECK (
      match_type IN ('employer_title_location', 'similar_content', 'reviewer_flag')
    ),
  match_score numeric(4,3)
    CONSTRAINT job_duplicate_candidates_score_valid CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT job_duplicate_candidates_status_valid CHECK (
      status IN ('pending', 'confirmed_duplicate', 'not_duplicate', 'resolved')
    ),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT job_duplicate_candidates_evidence_object CHECK (jsonb_typeof(evidence) = 'object'),
  reviewed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_duplicate_candidates_ordered_pair CHECK (job_a_id < job_b_id),
  CONSTRAINT job_duplicate_candidates_pair_unique UNIQUE (job_a_id, job_b_id)
);

CREATE INDEX job_duplicate_candidates_pending_idx
  ON public.job_duplicate_candidates (status, created_at DESC);

CREATE TABLE public.vacancy_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES public.job_sources (id) ON DELETE RESTRICT,
  canonical_dedupe_key_id uuid NOT NULL,
  external_id text,
  source_url text NOT NULL
    CONSTRAINT vacancy_sources_source_url_https CHECK (source_url ~ '^https://[^[:space:]]+$'),
  canonical_url text NOT NULL
    CONSTRAINT vacancy_sources_canonical_url_https CHECK (canonical_url ~ '^https://[^[:space:]]+$'),
  source_posted_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  content_hash text
    CONSTRAINT vacancy_sources_content_hash_format CHECK (
      content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacancy_sources_job_source_pair_unique UNIQUE (id, job_id),
  CONSTRAINT vacancy_sources_dedupe_key_same_job FOREIGN KEY (canonical_dedupe_key_id, job_id)
    REFERENCES public.job_dedupe_keys (id, job_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX vacancy_sources_external_id_unique
  ON public.vacancy_sources (source_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX vacancy_sources_source_canonical_url_unique
  ON public.vacancy_sources (source_id, canonical_url);

CREATE INDEX vacancy_sources_job_id_idx ON public.vacancy_sources (job_id);
CREATE INDEX vacancy_sources_source_last_checked_idx ON public.vacancy_sources (source_id, last_checked_at DESC);

CREATE TABLE public.vacancy_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES public.job_sources (id) ON DELETE RESTRICT,
  evidence_type text NOT NULL
    CONSTRAINT vacancy_evidence_type_valid CHECK (
      evidence_type IN (
        'posting_status', 'employer_identity', 'international_eligibility',
        'visa_sponsorship', 'application_url', 'salary',
        'occupation_mapping', 'source_authorization', 'other'
      )
    ),
  evidence_url text NOT NULL
    CONSTRAINT vacancy_evidence_url_https CHECK (evidence_url ~ '^https://[^[:space:]]+$'),
  short_excerpt text
    CONSTRAINT vacancy_evidence_excerpt_limit CHECK (short_excerpt IS NULL OR length(short_excerpt) <= 1200),
  content_hash text
    CONSTRAINT vacancy_evidence_content_hash_format CHECK (
      content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'
    ),
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vacancy_evidence_id_job_unique UNIQUE (id, job_id)
);

CREATE INDEX vacancy_evidence_job_type_idx
  ON public.vacancy_evidence (job_id, evidence_type, captured_at DESC);

CREATE TABLE public.eligibility_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  applicant_scope text NOT NULL DEFAULT 'unknown'
    CONSTRAINT eligibility_applicant_scope_valid CHECK (
      applicant_scope IN (
        'explicitly_open', 'employer_sponsored', 'conditional',
        'unknown', 'domestic_only', 'contradictory'
      )
    ),
  sponsorship_status text NOT NULL DEFAULT 'unknown'
    CONSTRAINT eligibility_sponsorship_status_valid CHECK (
      sponsorship_status IN ('confirmed', 'not_offered', 'conditional', 'unknown')
    ),
  assessment_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT eligibility_assessment_status_valid CHECK (
      assessment_status IN ('pending', 'approved', 'rejected', 'superseded')
    ),
  eligibility_evidence_id uuid,
  sponsorship_evidence_id uuid,
  assessment_reason text,
  assessed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eligibility_evidence_same_job FOREIGN KEY (eligibility_evidence_id, job_id)
    REFERENCES public.vacancy_evidence (id, job_id) ON DELETE RESTRICT,
  CONSTRAINT sponsorship_evidence_same_job FOREIGN KEY (sponsorship_evidence_id, job_id)
    REFERENCES public.vacancy_evidence (id, job_id) ON DELETE RESTRICT,
  CONSTRAINT approved_eligibility_requires_evidence CHECK (
    assessment_status <> 'approved'
    OR eligibility_evidence_id IS NOT NULL
  ),
  CONSTRAINT confirmed_sponsorship_requires_evidence CHECK (
    sponsorship_status <> 'confirmed'
    OR sponsorship_evidence_id IS NOT NULL
  )
);

CREATE INDEX eligibility_assessments_latest_idx
  ON public.eligibility_assessments (job_id, assessed_at DESC, id DESC);

CREATE TABLE public.staff_roles (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL
    CONSTRAINT staff_roles_role_valid CHECK (
      role IN ('system_admin', 'source_admin', 'collector', 'reviewer', 'publisher', 'auditor')
    ),
  granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE public.verification_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  decision text NOT NULL
    CONSTRAINT verification_reviews_decision_valid CHECK (
      decision IN ('approved', 'rejected', 'needs_changes')
    ),
  reason text NOT NULL
    CONSTRAINT verification_reviews_reason_nonempty CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  reviewed_record_version bigint NOT NULL CHECK (reviewed_record_version > 0),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_reviews_latest_idx
  ON public.verification_reviews (job_id, reviewed_at DESC, id DESC);

CREATE TABLE public.publication_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE RESTRICT,
  publication_version integer NOT NULL CHECK (publication_version > 0),
  job_record_version bigint NOT NULL CHECK (job_record_version > 0),
  published_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  unpublished_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  unpublished_at timestamptz,
  unpublished_reason text,
  CONSTRAINT publication_records_job_version_unique UNIQUE (job_id, publication_version),
  CONSTRAINT publication_records_unpublish_pair CHECK (
    (unpublished_at IS NULL AND unpublished_reason IS NULL)
    OR (unpublished_at IS NOT NULL AND length(btrim(unpublished_reason)) >= 3)
  )
);

CREATE INDEX publication_records_job_history_idx
  ON public.publication_records (job_id, publication_version DESC);

CREATE TABLE public.ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.job_sources (id) ON DELETE RESTRICT,
  request_key text NOT NULL UNIQUE
    CONSTRAINT ingestion_jobs_request_key_nonempty CHECK (length(btrim(request_key)) BETWEEN 8 AND 200),
  status text NOT NULL DEFAULT 'queued'
    CONSTRAINT ingestion_jobs_status_valid CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT ingestion_jobs_counts_object CHECK (jsonb_typeof(counts) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_jobs_time_pair CHECK (completed_at IS NULL OR started_at IS NOT NULL)
);

CREATE INDEX ingestion_jobs_source_started_idx
  ON public.ingestion_jobs (source_id, started_at DESC);

CREATE TABLE public.ingestion_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_job_id uuid NOT NULL REFERENCES public.ingestion_jobs (id) ON DELETE RESTRICT,
  error_code text NOT NULL
    CONSTRAINT ingestion_errors_code_nonempty CHECK (length(btrim(error_code)) BETWEEN 2 AND 100),
  safe_message text NOT NULL
    CONSTRAINT ingestion_errors_message_nonempty CHECK (length(btrim(safe_message)) BETWEEN 2 AND 1200),
  retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ingestion_errors_job_idx ON public.ingestion_errors (ingestion_job_id, created_at DESC);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(btrim(action)) BETWEEN 2 AND 120),
  entity_type text NOT NULL CHECK (length(btrim(entity_type)) BETWEEN 2 AND 120),
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT audit_logs_details_object CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity_idx ON public.audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON public.audit_logs (actor_id, created_at DESC);

CREATE INDEX jobs_occupation_id_idx ON public.jobs (occupation_id);
CREATE INDEX jobs_employer_id_idx ON public.jobs (employer_id);
CREATE INDEX jobs_category_slug_idx ON public.jobs (category_slug);
CREATE INDEX occupations_category_status_idx ON public.occupations (category_slug, verification_status, is_active);
CREATE INDEX occupation_aliases_occupation_idx ON public.occupation_aliases (occupation_id);

-- Any meaningful content change creates a new version. A published job immediately returns to draft
-- so its previous approval cannot silently authorize changed details.
CREATE OR REPLACE FUNCTION public.bump_job_record_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  content_changed boolean;
BEGIN
  content_changed :=
    ROW(
      NEW.title, NEW.slug, NEW.employer_name, NEW.description, NEW.requirements,
      NEW.category_slug, NEW.occupation_id, NEW.employer_id, NEW.skill_level,
      NEW.employment_type, NEW.workplace_type, NEW.country_code, NEW.region, NEW.city,
      NEW.salary_min, NEW.salary_max, NEW.salary_currency, NEW.salary_period,
      NEW.sponsorship_status, NEW.application_url, NEW.application_instructions,
      NEW.international_eligibility, NEW.visa_sponsorship, NEW.source_posted_at
    )
    IS DISTINCT FROM
    ROW(
      OLD.title, OLD.slug, OLD.employer_name, OLD.description, OLD.requirements,
      OLD.category_slug, OLD.occupation_id, OLD.employer_id, OLD.skill_level,
      OLD.employment_type, OLD.workplace_type, OLD.country_code, OLD.region, OLD.city,
      OLD.salary_min, OLD.salary_max, OLD.salary_currency, OLD.salary_period,
      OLD.sponsorship_status, OLD.application_url, OLD.application_instructions,
      OLD.international_eligibility, OLD.visa_sponsorship, OLD.source_posted_at
    );

  IF content_changed THEN
    NEW.record_version := OLD.record_version + 1;
    NEW.verification_status := 'needs_review';
    IF OLD.status = 'published' THEN
      NEW.status := 'draft';
      NEW.published_at := NULL;
      UPDATE public.publication_records
      SET unpublished_at = COALESCE(unpublished_at, now()),
          unpublished_reason = COALESCE(unpublished_reason, 'Job details changed after approval'),
          unpublished_by = NULL
      WHERE job_id = OLD.id AND unpublished_at IS NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER jobs_bump_record_version
BEFORE UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.bump_job_record_version();

-- Linked-source or evidence changes invalidate the job review. A mere last-checked timestamp refresh
-- does not invalidate approval unless the source URL, external ID, canonical URL, or content hash changed.
CREATE OR REPLACE FUNCTION public.invalidate_job_after_linked_record_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  affected_job_id uuid;
  meaningful_change boolean := true;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_job_id := OLD.job_id;
  ELSE
    affected_job_id := NEW.job_id;
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'vacancy_sources' THEN
    meaningful_change :=
      ROW(NEW.job_id, NEW.source_id, NEW.external_id, NEW.source_url, NEW.canonical_url, NEW.content_hash)
      IS DISTINCT FROM
      ROW(OLD.job_id, OLD.source_id, OLD.external_id, OLD.source_url, OLD.canonical_url, OLD.content_hash);
  END IF;

  IF NOT meaningful_change THEN
    RETURN NEW;
  END IF;

  UPDATE public.jobs
  SET record_version = record_version + 1,
      verification_status = 'needs_review',
      status = CASE WHEN status = 'published' THEN 'draft' ELSE status END,
      published_at = CASE WHEN status = 'published' THEN NULL ELSE published_at END
  WHERE id = affected_job_id;

  UPDATE public.publication_records
  SET unpublished_at = COALESCE(unpublished_at, now()),
      unpublished_reason = COALESCE(unpublished_reason, 'Linked evidence or source details changed'),
      unpublished_by = NULL
  WHERE job_id = affected_job_id AND unpublished_at IS NULL;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER vacancy_sources_invalidate_review
AFTER INSERT OR UPDATE OR DELETE ON public.vacancy_sources
FOR EACH ROW EXECUTE FUNCTION public.invalidate_job_after_linked_record_change();

CREATE TRIGGER vacancy_evidence_invalidate_review
AFTER INSERT OR UPDATE OR DELETE ON public.vacancy_evidence
FOR EACH ROW EXECUTE FUNCTION public.invalidate_job_after_linked_record_change();

CREATE TRIGGER eligibility_assessments_invalidate_review
AFTER INSERT OR UPDATE OR DELETE ON public.eligibility_assessments
FOR EACH ROW EXECUTE FUNCTION public.invalidate_job_after_linked_record_change();

CREATE OR REPLACE FUNCTION public.invalidate_jobs_for_parent_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'employers' THEN
    IF ROW(NEW.legal_name, NEW.website, NEW.country_code, NEW.verification_status, NEW.verification_evidence_url)
       IS DISTINCT FROM
       ROW(OLD.legal_name, OLD.website, OLD.country_code, OLD.verification_status, OLD.verification_evidence_url) THEN
      UPDATE public.jobs
      SET record_version = record_version + 1,
          verification_status = 'needs_review',
          status = CASE WHEN status = 'published' THEN 'draft' ELSE status END,
          published_at = CASE WHEN status = 'published' THEN NULL ELSE published_at END
      WHERE employer_id = NEW.id;

      UPDATE public.publication_records pr
      SET unpublished_at = COALESCE(pr.unpublished_at, now()),
          unpublished_reason = COALESCE(pr.unpublished_reason, 'Employer record changed'),
          unpublished_by = NULL
      WHERE pr.unpublished_at IS NULL
        AND pr.job_id IN (SELECT j.id FROM public.jobs j WHERE j.employer_id = NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'occupations' THEN
    IF ROW(NEW.category_slug, NEW.canonical_title, NEW.isco08_code, NEW.verification_status, NEW.verification_source_url, NEW.is_active)
       IS DISTINCT FROM
       ROW(OLD.category_slug, OLD.canonical_title, OLD.isco08_code, OLD.verification_status, OLD.verification_source_url, OLD.is_active) THEN
      UPDATE public.jobs
      SET record_version = record_version + 1,
          verification_status = 'needs_review',
          status = CASE WHEN status = 'published' THEN 'draft' ELSE status END,
          published_at = CASE WHEN status = 'published' THEN NULL ELSE published_at END
      WHERE occupation_id = NEW.id;

      UPDATE public.publication_records pr
      SET unpublished_at = COALESCE(pr.unpublished_at, now()),
          unpublished_reason = COALESCE(pr.unpublished_reason, 'Occupation record changed'),
          unpublished_by = NULL
      WHERE pr.unpublished_at IS NULL
        AND pr.job_id IN (SELECT j.id FROM public.jobs j WHERE j.occupation_id = NEW.id);
    END IF;
  ELSIF TG_TABLE_NAME = 'job_sources' THEN
    IF ROW(NEW.permission_status, NEW.permission_evidence_url, NEW.recheck_interval_hours)
       IS DISTINCT FROM
       ROW(OLD.permission_status, OLD.permission_evidence_url, OLD.recheck_interval_hours) THEN
      UPDATE public.jobs j
      SET record_version = j.record_version + 1,
          verification_status = 'needs_review',
          status = CASE WHEN j.status = 'published' THEN 'draft' ELSE j.status END,
          published_at = CASE WHEN j.status = 'published' THEN NULL ELSE j.published_at END
      WHERE EXISTS (
        SELECT 1 FROM public.vacancy_sources vs
        WHERE vs.job_id = j.id AND vs.source_id = NEW.id
      );

      UPDATE public.publication_records pr
      SET unpublished_at = COALESCE(pr.unpublished_at, now()),
          unpublished_reason = COALESCE(pr.unpublished_reason, 'Source permission or freshness policy changed'),
          unpublished_by = NULL
      WHERE pr.unpublished_at IS NULL
        AND pr.job_id IN (
          SELECT vs.job_id FROM public.vacancy_sources vs WHERE vs.source_id = NEW.id
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.job_evidence_ready(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.employers e ON e.id = j.employer_id
    JOIN public.occupations o ON o.id = j.occupation_id
    WHERE j.id = p_job_id
      AND j.application_url IS NOT NULL
      AND j.first_seen_at IS NOT NULL
      AND j.last_checked_at IS NOT NULL
      AND j.category_slug = o.category_slug
      AND e.verification_status = 'verified'
      AND e.verification_evidence_url IS NOT NULL
      AND o.verification_status = 'verified'
      AND o.is_active = true
      AND j.international_eligibility IN ('explicitly_open', 'employer_sponsored')
      AND EXISTS (
        SELECT 1
        FROM public.eligibility_assessments ea
        JOIN public.vacancy_evidence eligibility_ev
          ON eligibility_ev.id = ea.eligibility_evidence_id AND eligibility_ev.job_id = ea.job_id
        LEFT JOIN public.vacancy_evidence sponsorship_ev
          ON sponsorship_ev.id = ea.sponsorship_evidence_id AND sponsorship_ev.job_id = ea.job_id
        JOIN public.vacancy_sources vs
          ON vs.job_id = j.id AND vs.source_id = eligibility_ev.source_id
        JOIN public.job_sources src ON src.id = vs.source_id
        JOIN public.job_dedupe_keys dk
          ON dk.id = vs.canonical_dedupe_key_id
         AND dk.job_id = vs.job_id
         AND dk.key_type = 'canonical_url'
         AND dk.normalized_value = vs.canonical_url
        WHERE ea.job_id = j.id
          AND ea.id = (
            SELECT latest_ea.id
            FROM public.eligibility_assessments latest_ea
            WHERE latest_ea.job_id = j.id
            ORDER BY latest_ea.assessed_at DESC, latest_ea.id DESC
            LIMIT 1
          )
          AND ea.assessment_status = 'approved'
          AND ea.applicant_scope = j.international_eligibility
          AND ea.sponsorship_status = j.visa_sponsorship
          AND (ea.applicant_scope <> 'employer_sponsored' OR ea.sponsorship_status = 'confirmed')
          AND eligibility_ev.evidence_type = 'international_eligibility'
          AND eligibility_ev.captured_at >= now() - pg_catalog.make_interval(hours => src.recheck_interval_hours)
          AND src.permission_status = 'approved'
          AND src.permission_evidence_url IS NOT NULL
          AND src.permission_reviewed_at IS NOT NULL
          AND vs.last_checked_at IS NOT NULL
          AND vs.last_checked_at >= now() - pg_catalog.make_interval(hours => src.recheck_interval_hours)
          AND j.last_checked_at >= now() - pg_catalog.make_interval(hours => src.recheck_interval_hours)
          AND (
            ea.sponsorship_status = 'unknown'
            OR (
              sponsorship_ev.id IS NOT NULL
              AND sponsorship_ev.source_id = src.id
              AND sponsorship_ev.evidence_type = 'visa_sponsorship'
              AND sponsorship_ev.captured_at >= now() - pg_catalog.make_interval(hours => src.recheck_interval_hours)
            )
          )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.job_approval_current(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.verification_reviews vr ON vr.job_id = j.id
    WHERE j.id = p_job_id
      AND j.verification_status = 'verified'
      AND j.expires_at IS NOT NULL
      AND j.expires_at > now()
      AND public.job_evidence_ready(j.id)
      AND vr.id = (
        SELECT latest_vr.id
        FROM public.verification_reviews latest_vr
        WHERE latest_vr.job_id = j.id
        ORDER BY latest_vr.reviewed_at DESC, latest_vr.id DESC
        LIMIT 1
      )
      AND vr.decision = 'approved'
      AND vr.reviewed_record_version = j.record_version
  );
$function$;

CREATE OR REPLACE FUNCTION public.job_publication_gate_passed(p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.status = 'published'
      AND j.published_at IS NOT NULL
      AND j.published_at <= now()
      AND j.expires_at IS NOT NULL
      AND j.expires_at > now()
      AND public.job_approval_current(j.id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.review_job(
  p_job_id uuid,
  p_decision text,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reviewer_id uuid;
  v_record_version bigint;
BEGIN
  v_reviewer_id := auth.uid();

  IF v_reviewer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = v_reviewer_id
      AND sr.role IN ('reviewer', 'system_admin')
  ) THEN
    RAISE EXCEPTION 'Reviewer permission is required' USING ERRCODE = '42501';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected', 'needs_changes') THEN
    RAISE EXCEPTION 'Unsupported review decision' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'A review reason between 3 and 2000 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT j.record_version INTO v_record_version
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job was not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_decision = 'approved' AND NOT public.job_evidence_ready(p_job_id) THEN
    RAISE EXCEPTION 'Job lacks current employer, occupation, source, application, or international-eligibility evidence';
  END IF;

  UPDATE public.jobs
  SET verification_status = CASE p_decision
    WHEN 'approved' THEN 'verified'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'needs_review'
  END,
  status = CASE
    WHEN p_decision <> 'approved' AND status = 'published' THEN 'draft'
    ELSE status
  END,
  published_at = CASE
    WHEN p_decision <> 'approved' AND status = 'published' THEN NULL
    ELSE published_at
  END
  WHERE id = p_job_id;

  IF p_decision <> 'approved' THEN
    UPDATE public.publication_records
    SET unpublished_at = COALESCE(unpublished_at, now()),
        unpublished_reason = COALESCE(unpublished_reason, btrim(p_reason)),
        unpublished_by = NULL
    WHERE job_id = p_job_id AND unpublished_at IS NULL;
  END IF;

  INSERT INTO public.verification_reviews (
    job_id, reviewer_id, decision, reason, reviewed_record_version
  ) VALUES (
    p_job_id, v_reviewer_id, p_decision, btrim(p_reason), v_record_version
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_reviewer_id, 'job_review_recorded', 'job', p_job_id::text,
    pg_catalog.jsonb_build_object('decision', p_decision, 'record_version', v_record_version)
  );

  RETURN v_record_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_verified_job(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_publisher_id uuid;
  v_record_version bigint;
  v_expires_at timestamptz;
  v_next_publication_version integer;
BEGIN
  v_publisher_id := auth.uid();

  IF v_publisher_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = v_publisher_id
      AND sr.role IN ('publisher', 'system_admin')
  ) THEN
    RAISE EXCEPTION 'Publisher permission is required' USING ERRCODE = '42501';
  END IF;

  SELECT j.record_version, j.expires_at INTO v_record_version, v_expires_at
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_expires_at IS NULL OR v_expires_at <= now() OR NOT public.job_approval_current(p_job_id) THEN
    RAISE EXCEPTION 'Only current, verified, eligible, evidence-backed jobs with a future expiry may be published';
  END IF;

  SELECT COALESCE(MAX(pr.publication_version), 0) + 1
  INTO v_next_publication_version
  FROM public.publication_records pr
  WHERE pr.job_id = p_job_id;

  UPDATE public.jobs
  SET status = 'published', published_at = now()
  WHERE id = p_job_id;

  INSERT INTO public.publication_records (
    job_id, publication_version, job_record_version, published_by, published_at
  ) VALUES (
    p_job_id, v_next_publication_version, v_record_version, v_publisher_id, now()
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_publisher_id, 'job_published', 'job', p_job_id::text,
    pg_catalog.jsonb_build_object('publication_version', v_next_publication_version, 'record_version', v_record_version)
  );

  RETURN v_next_publication_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unpublish_job(
  p_job_id uuid,
  p_terminal_status text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = v_actor_id
      AND sr.role IN ('publisher', 'system_admin')
  ) THEN
    RAISE EXCEPTION 'Publisher permission is required' USING ERRCODE = '42501';
  END IF;

  IF p_terminal_status NOT IN ('closed', 'suspended') THEN
    RAISE EXCEPTION 'Unpublish status must be closed or suspended' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 OR length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'An unpublish reason between 3 and 2000 characters is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.jobs
  SET status = p_terminal_status
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job was not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.publication_records
  SET unpublished_at = COALESCE(unpublished_at, now()),
      unpublished_by = COALESCE(unpublished_by, v_actor_id),
      unpublished_reason = COALESCE(unpublished_reason, btrim(p_reason))
  WHERE job_id = p_job_id AND unpublished_at IS NULL;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_actor_id, 'job_unpublished', 'job', p_job_id::text,
    pg_catalog.jsonb_build_object('status', p_terminal_status, 'reason', btrim(p_reason))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_job_source_enabled(p_source_id uuid, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_permission_status text;
  v_permission_evidence_url text;
BEGIN
  v_actor_id := auth.uid();

  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_roles sr
    WHERE sr.user_id = v_actor_id
      AND sr.role IN ('source_admin', 'system_admin')
  ) THEN
    RAISE EXCEPTION 'Source administrator permission is required' USING ERRCODE = '42501';
  END IF;

  SELECT js.permission_status, js.permission_evidence_url
  INTO v_permission_status, v_permission_evidence_url
  FROM public.job_sources js
  WHERE js.id = p_source_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source was not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_enabled AND (v_permission_status <> 'approved' OR v_permission_evidence_url IS NULL) THEN
    RAISE EXCEPTION 'A source cannot be enabled without approved access and permission evidence';
  END IF;

  IF p_enabled AND NOT EXISTS (
    SELECT 1 FROM public.source_connections sc WHERE sc.source_id = p_source_id
  ) THEN
    RAISE EXCEPTION 'A source connection must be configured before collection can be enabled';
  END IF;

  UPDATE public.job_sources SET enabled = p_enabled, updated_at = now()
  WHERE id = p_source_id;

  UPDATE public.source_connections SET enabled = p_enabled, updated_at = now()
  WHERE source_id = p_source_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, details)
  VALUES (
    v_actor_id,
    CASE WHEN p_enabled THEN 'job_source_enabled' ELSE 'job_source_disabled' END,
    'job_source', p_source_id::text,
    pg_catalog.jsonb_build_object('permission_status', v_permission_status)
  );
END;
$function$;

-- The existing public category lookup is left untouched. Only occupation titles marked active
-- may be browsed; their verification status remains available for explicit UI labeling.
ALTER TABLE public.occupations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occupation_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_dedupe_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eligibility_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.occupations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.occupation_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_dedupe_keys FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_duplicate_candidates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.source_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vacancy_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vacancy_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.eligibility_assessments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.staff_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.verification_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publication_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ingestion_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ingestion_errors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.occupations TO anon, authenticated;

CREATE POLICY occupations_public_read
  ON public.occupations
  FOR SELECT TO anon, authenticated
  USING (is_active = true AND verification_status IN ('pending', 'verified'));

-- Do not permit public writes to job data. Publication is through the checked publisher function only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jobs TO anon, authenticated;

REVOKE ALL ON FUNCTION public.bump_job_record_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_job_after_linked_record_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_jobs_for_parent_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_evidence_ready(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_approval_current(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.job_publication_gate_passed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_job(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_verified_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unpublish_job(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_job_source_enabled(uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.job_publication_gate_passed(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_job(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_verified_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_job(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_job_source_enabled(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS jobs_public_read_published ON public.jobs;
CREATE POLICY jobs_public_read_published
  ON public.jobs
  FOR SELECT TO anon, authenticated
  USING (public.job_publication_gate_passed(id));

COMMIT;