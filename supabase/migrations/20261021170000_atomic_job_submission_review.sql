-- Review a private job submission and create its draft in one database transaction.
-- This prevents two staff members from creating duplicate drafts from the same pending item.
BEGIN;

CREATE OR REPLACE FUNCTION public.staff_job_submission_review(
  p_actor_id uuid,
  p_submission_id uuid,
  p_action text,
  p_review_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_submission public.job_submissions%rowtype;
  v_roles text[];
  v_job jsonb;
  v_job_id uuid;
  v_note text;
BEGIN
  IF p_actor_id IS NULL OR p_submission_id IS NULL THEN
    RAISE EXCEPTION 'Staff actor and submission ID are required' USING ERRCODE = '22023';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('reject', 'accept_as_draft') THEN
    RAISE EXCEPTION 'Unsupported submission review action' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(left(btrim(coalesce(p_review_note, '')), 3000), '');

  SELECT array_agg(sr.role) INTO v_roles
  FROM public.staff_roles sr
  WHERE sr.user_id = p_actor_id;

  IF NOT coalesce(v_roles && ARRAY['reviewer','publisher','system_admin']::text[], false) THEN
    RAISE EXCEPTION 'This account cannot review job submissions' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'accept_as_draft'
     AND NOT coalesce(v_roles && ARRAY['publisher','system_admin']::text[], false) THEN
    RAISE EXCEPTION 'Only a publisher or system administrator can accept a submission as a draft' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission
  FROM public.job_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND OR v_submission.status <> 'pending' THEN
    RAISE EXCEPTION 'Submission is missing or has already been reviewed' USING ERRCODE = '23514';
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.job_submissions
    SET status = 'rejected', review_note = v_note,
        reviewed_by = p_actor_id, reviewed_at = now()
    WHERE id = p_submission_id;
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, details)
    VALUES (p_actor_id, 'job_submission_rejected', 'job_submission', p_submission_id::text,
            jsonb_build_object('review_note', v_note));
    RETURN jsonb_build_object('ok', true, 'status', 'rejected', 'job_id', NULL);
  END IF;

  v_job := public.staff_vacancy_save_draft(
    p_actor_id,
    NULL,
    jsonb_build_object(
      'title', v_submission.title,
      'slug', coalesce(nullif(trim(both '-' from regexp_replace(lower(translate(v_submission.title, 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCc')), '[^a-z0-9]+', '-', 'g')), ''), 'job') || '-' || substr(v_submission.id::text, 1, 8),
      'employer_name', v_submission.employer_name,
      'description', v_submission.description,
      'requirements', v_submission.requirements,
      'category_slug', v_submission.category_slug,
      'skill_level', v_submission.skill_level,
      'employment_type', v_submission.employment_type,
      'workplace_type', v_submission.workplace_type,
      'country_code', v_submission.country_code,
      'region', v_submission.region,
      'city', v_submission.city,
      'salary_min', v_submission.salary_min,
      'salary_max', v_submission.salary_max,
      'salary_currency', v_submission.salary_currency,
      'salary_period', v_submission.salary_period,
      'sponsorship_status', 'not_stated',
      'application_url', v_submission.application_url,
      'application_instructions', v_submission.application_instructions,
      'is_featured', false,
      'status', 'draft',
      'published_at', NULL,
      'expires_at', NULL
    ),
    v_submission.source_reference
  );
  v_job_id := (v_job->>'id')::uuid;

  UPDATE public.job_submissions
  SET status = 'accepted_as_draft', review_note = v_note,
      reviewed_by = p_actor_id, reviewed_at = now(), created_job_id = v_job_id
  WHERE id = p_submission_id;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, details)
  VALUES (p_actor_id, 'job_submission_accepted_as_draft', 'job_submission', p_submission_id::text,
          jsonb_build_object('job_id', v_job_id, 'review_note', v_note));

  RETURN jsonb_build_object('ok', true, 'status', 'accepted_as_draft', 'job_id', v_job_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_job_submission_review(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_job_submission_review(uuid, uuid, text, text) TO service_role;

COMMIT;
