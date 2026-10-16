-- Private first-party candidate applications. Public job records remain separate from candidate PII.
-- Only the trusted Edge Function service role may read/write these tables.
BEGIN;

CREATE TABLE public.candidate_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 160),
  email text NOT NULL CHECK (length(btrim(email)) BETWEEN 5 AND 254),
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 7 AND 40),
  country_code text NOT NULL REFERENCES public.country_options(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  city text,
  experience_summary text NOT NULL CHECK (length(btrim(experience_summary)) BETWEEN 20 AND 6000),
  skills text NOT NULL CHECK (length(btrim(skills)) BETWEEN 2 AND 3000),
  cv_storage_path text NOT NULL CHECK (length(btrim(cv_storage_path)) BETWEEN 1 AND 500),
  consent_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'shortlisted', 'matched', 'referred', 'interview', 'placed', 'rejected', 'withdrawn')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.candidate_applications IS
  'Private candidate applications submitted through Job Grid. Contains personal data; access only through trusted server-side workflows.';
CREATE INDEX candidate_applications_status_submitted_idx ON public.candidate_applications(status, submitted_at DESC);
CREATE INDEX candidate_applications_job_idx ON public.candidate_applications(job_id, submitted_at DESC);
CREATE INDEX candidate_applications_email_idx ON public.candidate_applications(lower(email));

CREATE TABLE public.candidate_application_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.candidate_applications(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.candidate_application_notes IS
  'Confidential internal recruitment notes. Never expose to candidate or public clients.';

ALTER TABLE public.candidate_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_application_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.candidate_applications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.candidate_application_notes FROM PUBLIC, anon, authenticated;
-- No public Storage bucket: CVs are kept in a private bucket and accessed only by authorized server-side staff workflows.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('candidate-cvs', 'candidate-cvs', false, 5242880, ARRAY[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;