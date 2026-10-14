-- Job Grid MVP: public category catalog and manually managed jobs.
-- Scope: an administrator curates jobs in the existing Supabase dashboard.
-- Browser/API clients can read only published, unexpired jobs and active categories.
-- Employer accounts, applications, moderation workflows, and candidate data are not included.

BEGIN;

CREATE TABLE IF NOT EXISTS public.job_categories (
  slug text PRIMARY KEY
    CONSTRAINT job_categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL UNIQUE
    CONSTRAINT job_categories_name_nonempty CHECK (length(btrim(name)) > 0),
  group_name text NOT NULL
    CONSTRAINT job_categories_group_valid CHECK (group_name IN ('operations', 'trades', 'services', 'professional', 'other')),
  description text NOT NULL
    CONSTRAINT job_categories_description_nonempty CHECK (length(btrim(description)) > 0),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE public.job_categories IS
  'Public Job Grid job-category lookup. Categories are admin-managed reference data; public clients have read-only access.';

ALTER TABLE public.job_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_categories TO anon, authenticated;

DROP POLICY IF EXISTS job_categories_public_read ON public.job_categories;
CREATE POLICY job_categories_public_read
  ON public.job_categories
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

INSERT INTO public.job_categories (slug, name, group_name, description, sort_order) VALUES
  ('agriculture-farming', 'Agriculture & Farming', 'operations', 'Farm work, crop production, livestock, and agricultural support.', 10),
  ('construction-building', 'Construction & Building', 'trades', 'Construction sites, building work, and site support.', 20),
  ('skilled-trades-repair', 'Skilled Trades & Repair', 'trades', 'Electrical, plumbing, welding, carpentry, mechanics, and other trade work.', 30),
  ('driving-transport', 'Driving & Transport', 'operations', 'Drivers, delivery, public transport, and transport support.', 40),
  ('warehouse-logistics', 'Warehouse & Logistics', 'operations', 'Warehouse, packing, stock handling, dispatch, and logistics.', 50),
  ('cleaning-housekeeping', 'Cleaning & Housekeeping', 'services', 'Cleaning, housekeeping, janitorial, and facilities cleaning.', 60),
  ('security-safety', 'Security & Safety', 'services', 'Security guards, safety support, and related roles.', 70),
  ('hospitality-tourism', 'Hospitality & Tourism', 'services', 'Hotels, tourism, guest services, and accommodation.', 80),
  ('food-service-catering', 'Food Service & Catering', 'services', 'Kitchen, catering, food preparation, and restaurant roles.', 90),
  ('retail-sales', 'Retail & Sales', 'services', 'Shop assistants, sales representatives, cashiers, and retail operations.', 100),
  ('customer-service', 'Customer Service', 'services', 'Customer support, call centres, help desks, and front-desk work.', 110),
  ('general-labour', 'General Labour', 'operations', 'General labour, loading, site support, and other entry-level operational roles.', 120),
  ('manufacturing-factory', 'Manufacturing & Factory', 'operations', 'Production lines, factory support, assembly, and quality operations.', 130),
  ('domestic-household-work', 'Domestic & Household Work', 'services', 'Household support, caregiving at home, and domestic work.', 140),
  ('health-care-caregiving', 'Healthcare & Caregiving', 'professional', 'Healthcare, nursing, care assistants, and support roles.', 150),
  ('education-training', 'Education & Training', 'professional', 'Teaching, tutoring, training, and education support.', 160),
  ('office-administration', 'Office & Administration', 'services', 'Reception, clerical, data entry, office support, and administration.', 170),
  ('it-technology', 'IT & Technology', 'professional', 'Software, IT support, networks, data, and technology roles.', 180),
  ('finance-accounting', 'Finance & Accounting', 'professional', 'Accounting, bookkeeping, banking, finance, and payroll.', 190),
  ('engineering', 'Engineering', 'professional', 'Engineering, technical design, and specialist engineering support.', 200),
  ('beauty-personal-care', 'Beauty & Personal Care', 'services', 'Hair, beauty, barbering, spa, and personal care.', 210),
  ('maintenance-facilities', 'Maintenance & Facilities', 'trades', 'Building maintenance, repairs, groundskeeping, and facilities operations.', 220),
  ('marketing-communications', 'Marketing & Communications', 'professional', 'Marketing, communications, content, media, and public relations.', 230),
  ('professional-services', 'Professional Services', 'professional', 'Legal, consulting, research, and other specialist professional work.', 240),
  ('other', 'Other', 'other', 'Roles that do not fit another category.', 250)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL
    CONSTRAINT jobs_title_valid CHECK (length(btrim(title)) BETWEEN 3 AND 180),
  slug text NOT NULL UNIQUE
    CONSTRAINT jobs_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  employer_name text NOT NULL
    CONSTRAINT jobs_employer_name_valid CHECK (length(btrim(employer_name)) BETWEEN 1 AND 200),
  description text NOT NULL
    CONSTRAINT jobs_description_valid CHECK (length(btrim(description)) BETWEEN 1 AND 20000),
  requirements text,
  category_slug text NOT NULL
    REFERENCES public.job_categories (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  skill_level text NOT NULL
    CONSTRAINT jobs_skill_level_valid CHECK (skill_level IN ('skilled', 'semi_skilled', 'unskilled')),
  employment_type text NOT NULL
    CONSTRAINT jobs_employment_type_valid CHECK (employment_type IN (
      'full_time', 'part_time', 'contract', 'temporary', 'casual',
      'seasonal', 'internship', 'apprenticeship'
    )),
  workplace_type text NOT NULL DEFAULT 'on_site'
    CONSTRAINT jobs_workplace_type_valid CHECK (workplace_type IN ('on_site', 'hybrid', 'remote')),
  country_code text NOT NULL
    REFERENCES public.country_options (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  region text,
  city text,
  salary_min numeric(12,2),
  salary_max numeric(12,2),
  salary_currency text,
  salary_period text,
  sponsorship_status text NOT NULL DEFAULT 'not_stated'
    CONSTRAINT jobs_sponsorship_status_valid CHECK (sponsorship_status IN (
      'available', 'not_available', 'not_stated', 'requires_verification'
    )),
  application_url text
    CONSTRAINT jobs_application_url_https CHECK (
      application_url IS NULL OR application_url ~ '^https://[^[:space:]]+$'
    ),
  application_instructions text,
  is_featured boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT jobs_status_valid CHECK (status IN ('draft', 'published', 'closed', 'suspended')),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_salary_nonnegative CHECK (
    (salary_min IS NULL OR salary_min >= 0) AND
    (salary_max IS NULL OR salary_max >= 0)
  ),
  CONSTRAINT jobs_salary_range_valid CHECK (
    salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min
  ),
  CONSTRAINT jobs_salary_currency_period_consistent CHECK (
    (salary_min IS NULL AND salary_max IS NULL AND salary_currency IS NULL AND salary_period IS NULL)
    OR (
      (salary_min IS NOT NULL OR salary_max IS NOT NULL)
      AND salary_currency IS NOT NULL
      AND salary_currency ~ '^[A-Z]{3}$'
      AND salary_period IS NOT NULL
      AND salary_period IN ('hour', 'day', 'week', 'month', 'year')
    )
  ),
  CONSTRAINT jobs_publication_window_valid CHECK (
    status <> 'published'
    OR (
      published_at IS NOT NULL
      AND expires_at IS NOT NULL
      AND expires_at > published_at
    )
  )
);

COMMENT ON TABLE public.jobs IS
  'Admin-curated public job advertisements only. Do not store candidate personal data, private review notes, credentials, or confidential documents here. Browser clients have SELECT-only access to rows that are published and within their publication window.';

COMMENT ON COLUMN public.jobs.skill_level IS
  'Values: skilled, semi_skilled, unskilled. For visitor-facing labels, prefer respectful wording such as “Entry-level / no specialist skill required” for unskilled roles; classify from actual job requirements, not assumptions about people.';

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.jobs TO anon, authenticated;

DROP POLICY IF EXISTS jobs_public_read_published ON public.jobs;
CREATE POLICY jobs_public_read_published
  ON public.jobs
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'published'
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND expires_at IS NOT NULL
    AND expires_at > now()
  );

CREATE INDEX IF NOT EXISTS jobs_public_search_idx
  ON public.jobs (country_code, category_slug, skill_level, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS jobs_public_city_idx
  ON public.jobs (lower(city))
  WHERE status = 'published' AND city IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_public_expiry_idx
  ON public.jobs (expires_at)
  WHERE status = 'published';

COMMIT;
