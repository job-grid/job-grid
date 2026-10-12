-- Disposable Phase 2A core-schema contract fixture for Close Job integration tests.
-- This represents the minimum canonical columns needed by the lifecycle slice;
-- it is CI-only and is not a production migration or a claim of live schema.
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('employer', 'agency')),
  registration_country char(2),
  registration_number text,
  status text NOT NULL DEFAULT 'pending',
  verification_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'recruiter', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (organization_id, user_id)
);

CREATE TABLE public.platform_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('moderator', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE public.geography (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code char(2) NOT NULL,
  level text NOT NULL,
  canonical_name text NOT NULL
);

CREATE TABLE public.vacancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  branch_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reference_code text NOT NULL UNIQUE,
  slug text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  sector_id uuid,
  occupation_id uuid,
  skill_level_id uuid,
  geography_id uuid REFERENCES public.geography(id) ON DELETE RESTRICT,
  worksite_text text NOT NULL,
  employment_type text NOT NULL DEFAULT 'full_time',
  contract_duration text,
  hours_per_week numeric,
  salary_min numeric,
  salary_max numeric,
  salary_currency char(3),
  pay_period text,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  accommodation_provided boolean NOT NULL DEFAULT false,
  qualification_requirements text,
  licence_requirements text,
  language_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  vacancies_count integer NOT NULL DEFAULT 1 CHECK (vacancies_count >= 1),
  sponsorship_status text,
  application_deadline timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'submitted', 'under_review', 'changes_requested', 'approved',
      'published', 'suspended', 'closed', 'expired', 'rejected', 'archived'
    )),
  moderation_state text NOT NULL DEFAULT 'pending',
  verification_state text NOT NULL DEFAULT 'pending',
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max),
  CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at)
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
