-- Public manual job submissions enter a private queue; they are never public vacancies.
BEGIN;
CREATE TABLE IF NOT EXISTS public.job_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name text NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 2 AND 160),
  contact_email text NOT NULL CHECK (length(btrim(contact_email)) BETWEEN 5 AND 254),
  contact_phone text NOT NULL CHECK (length(btrim(contact_phone)) BETWEEN 7 AND 40),
  employer_name text NOT NULL CHECK (length(btrim(employer_name)) BETWEEN 2 AND 200),
  employer_website text CHECK (employer_website IS NULL OR employer_website ~ '^https://[^[:space:]]+$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 180),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 30 AND 20000),
  requirements text CHECK (requirements IS NULL OR length(requirements) <= 12000),
  category_slug text NOT NULL REFERENCES public.job_categories(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  country_code text NOT NULL REFERENCES public.country_options(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  city text CHECK (city IS NULL OR length(city) <= 120),
  region text CHECK (region IS NULL OR length(region) <= 120),
  employment_type text NOT NULL CHECK (employment_type IN ('full_time','part_time','contract','temporary','casual','seasonal','internship','apprenticeship')),
  workplace_type text NOT NULL DEFAULT 'on_site' CHECK (workplace_type IN ('on_site','hybrid','remote')),
  skill_level text NOT NULL CHECK (skill_level IN ('skilled','semi_skilled','unskilled')),
  salary_min numeric CHECK (salary_min IS NULL OR salary_min >= 0),
  salary_max numeric CHECK (salary_max IS NULL OR salary_max >= 0),
  salary_currency text CHECK (salary_currency IS NULL OR salary_currency ~ '^[A-Z]{3}$'),
  salary_period text CHECK (salary_period IS NULL OR salary_period IN ('hour','day','week','month','year')),
  source_reference text NOT NULL CHECK (source_reference ~ '^https://[^[:space:]]+$'),
  application_url text CHECK (application_url IS NULL OR application_url ~ '^https://[^[:space:]]+$'),
  application_instructions text CHECK (application_instructions IS NULL OR length(application_instructions) <= 4000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted_as_draft','rejected')),
  review_note text CHECK (review_note IS NULL OR length(review_note) <= 3000),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_submission_salary_range CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min),
  CONSTRAINT job_submission_salary_complete CHECK ((salary_min IS NULL AND salary_max IS NULL AND salary_currency IS NULL AND salary_period IS NULL) OR (salary_currency IS NOT NULL AND salary_period IS NOT NULL))
);
ALTER TABLE public.job_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.job_submissions TO service_role;
CREATE INDEX IF NOT EXISTS job_submissions_pending_created_idx ON public.job_submissions(created_at DESC) WHERE status = 'pending';
COMMENT ON TABLE public.job_submissions IS 'Private manual job submissions. Public users can submit only through the validated job-submissions Edge Function. Staff must review and create a private draft; public vacancy publication remains a separate source-verification and publisher action.';
COMMIT;
