-- Add structured preferred work destinations without changing existing candidate records.
BEGIN;
ALTER TABLE public.candidate_applications
  ADD COLUMN IF NOT EXISTS preferred_destinations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.candidate_applications
  ADD CONSTRAINT candidate_applications_preferred_destinations_array
  CHECK (jsonb_typeof(preferred_destinations) = 'array');
COMMENT ON COLUMN public.candidate_applications.preferred_destinations IS
  'Private candidate-selected work destinations: array of {country_code, city}; each city belongs to its selected country. Validated by submit-application.';
COMMIT;
