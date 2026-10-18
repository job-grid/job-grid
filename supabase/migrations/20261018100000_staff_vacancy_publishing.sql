-- Staff-only source verification evidence must never live on the publicly-readable jobs table.
create table if not exists public.staff_job_source_verifications (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  source_reference text not null,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  checked_at timestamptz,
  checked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_job_source_https check (source_reference ~ '^https://[^[:space:]]+$'),
  constraint staff_job_source_verified_evidence check (
    verification_status <> 'verified' or (checked_at is not null and checked_by is not null)
  )
);
alter table public.staff_job_source_verifications enable row level security;
revoke all on table public.staff_job_source_verifications from public, anon, authenticated;
grant all on table public.staff_job_source_verifications to service_role;

-- Staff source evidence is stored only in the private table created above.

create or replace function public.enforce_verified_job_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare evidence public.staff_job_source_verifications%rowtype;
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    select * into evidence from public.staff_job_source_verifications where job_id = new.id;
    if not found
       or evidence.verification_status <> 'verified'
       or evidence.source_reference is null
       or length(btrim(evidence.source_reference)) not between 8 and 2000
       or evidence.checked_at is null
       or evidence.checked_by is null
       or evidence.source_reference !~ '^https://[^[:space:]]+$' then
      raise exception 'Vacancy cannot be published without recorded HTTPS source verification'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists jobs_require_source_verification_before_publish on public.jobs;
create trigger jobs_require_source_verification_before_publish
before insert or update of status on public.jobs
for each row execute function public.enforce_verified_job_publication();
comment on table public.staff_job_source_verifications is 'Private staff-only source verification evidence for vacancies; never expose through public vacancy APIs.';
comment on function public.enforce_verified_job_publication() is 'Blocks publication without a verified private HTTPS source record.';

create or replace function public.prevent_published_source_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare current_status text;
begin
  select status into current_status from public.jobs where id = coalesce(new.job_id, old.job_id);
  if current_status = 'published' then
    raise exception 'Source verification evidence for a published vacancy is immutable; close the vacancy before changing it'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists staff_source_evidence_immutable_when_published on public.staff_job_source_verifications;
create trigger staff_source_evidence_immutable_when_published
before update or delete on public.staff_job_source_verifications
for each row execute function public.prevent_published_source_evidence_mutation();


-- State changes and their audit entries must commit or roll back together.
-- Only the trusted Edge Function's service role may invoke this RPC.
create or replace function public.staff_vacancy_transition(
  p_action text,
  p_actor_id uuid,
  p_job_id uuid,
  p_source_reference text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_evidence public.staff_job_source_verifications%rowtype;
  v_result jsonb;
begin
  if p_actor_id is null or p_job_id is null then
    raise exception 'Actor and vacancy IDs are required' using errcode = '22023';
  end if;

  if p_action = 'verify_source' then
    if p_source_reference is null or p_source_reference !~ '^https://[^[:space:]]+$' then
      raise exception 'An HTTPS source reference is required' using errcode = '22023';
    end if;
    select * into v_job from public.jobs where id = p_job_id for update;
    if not found or v_job.status <> 'draft' then
      raise exception 'Only draft vacancies can be verified' using errcode = '23514';
    end if;
    insert into public.staff_job_source_verifications
      (job_id, source_reference, verification_status, checked_at, checked_by, updated_at)
    values (p_job_id, p_source_reference, 'verified', now(), p_actor_id, now())
    on conflict (job_id) do update set
      source_reference = excluded.source_reference,
      verification_status = 'verified',
      checked_at = excluded.checked_at,
      checked_by = excluded.checked_by,
      updated_at = excluded.updated_at;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'vacancy_source_verified', 'job', p_job_id, jsonb_build_object('source_reference', p_source_reference));
    return jsonb_build_object('id', v_job.id, 'slug', v_job.slug, 'status', v_job.status);
  elsif p_action = 'publish' then
    if p_expires_at is null or p_expires_at <= now() then
      raise exception 'Expiry must be in the future' using errcode = '22023';
    end if;
    select * into v_job from public.jobs where id = p_job_id for update;
    if not found or v_job.status <> 'draft' then
      raise exception 'Only draft vacancies can be published' using errcode = '23514';
    end if;
    select * into v_evidence from public.staff_job_source_verifications where job_id = p_job_id for update;
    if not found or v_evidence.verification_status <> 'verified'
       or v_evidence.checked_at is null or v_evidence.checked_by is null
       or v_evidence.source_reference !~ '^https://[^[:space:]]+$' then
      raise exception 'Only a draft with recorded official-source verification can be published' using errcode = '23514';
    end if;
    if v_evidence.checked_by = p_actor_id then
      raise exception 'A different authorized staff member must publish after the source review' using errcode = '23514';
    end if;
    update public.jobs set status = 'published', published_at = now(), expires_at = p_expires_at
    where id = p_job_id returning * into v_job;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'vacancy_published', 'job', p_job_id, jsonb_build_object('expires_at', v_job.expires_at));
    return jsonb_build_object('id', v_job.id, 'slug', v_job.slug, 'status', v_job.status, 'published_at', v_job.published_at, 'expires_at', v_job.expires_at);
  elsif p_action = 'close' then
    select * into v_job from public.jobs where id = p_job_id for update;
    if not found or v_job.status <> 'published' then
      raise exception 'Only currently published vacancies can be closed' using errcode = '23514';
    end if;
    update public.jobs set status = 'closed' where id = p_job_id returning * into v_job;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'vacancy_closed', 'job', p_job_id, '{}'::jsonb);
    return jsonb_build_object('id', v_job.id, 'slug', v_job.slug, 'status', v_job.status);
  else
    raise exception 'Unsupported staff vacancy transition' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.staff_vacancy_transition(text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.staff_vacancy_transition(text, uuid, uuid, text, timestamptz) to service_role;


-- Draft, private evidence and audit are one atomic operation as well.
create or replace function public.staff_vacancy_save_draft(
  p_actor_id uuid,
  p_job_id uuid,
  p_payload jsonb,
  p_source_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_saved public.jobs%rowtype;
begin
  if p_actor_id is null or p_payload is null
     or p_source_reference is null
     or p_source_reference !~ '^https://[^[:space:]]+$' then
    raise exception 'Actor, draft payload and HTTPS source reference are required' using errcode = '22023';
  end if;

  v_job := jsonb_populate_record(null::public.jobs, p_payload);
  if v_job.title is null or length(btrim(v_job.title)) < 3
     or v_job.slug is null or v_job.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or v_job.employer_name is null or v_job.description is null
     or v_job.category_slug is null or v_job.country_code is null then
    raise exception 'Required draft fields are missing or invalid' using errcode = '22023';
  end if;

  if p_job_id is not null then
    select * into v_saved from public.jobs where id = p_job_id for update;
    if not found or v_saved.status <> 'draft' then
      raise exception 'Only existing drafts can be edited' using errcode = '23514';
    end if;
    update public.jobs set
      title=v_job.title, slug=v_job.slug, employer_name=v_job.employer_name,
      description=v_job.description, requirements=v_job.requirements,
      category_slug=v_job.category_slug, skill_level=v_job.skill_level,
      employment_type=v_job.employment_type, workplace_type=v_job.workplace_type,
      country_code=v_job.country_code, region=v_job.region, city=v_job.city,
      salary_min=v_job.salary_min, salary_max=v_job.salary_max,
      salary_currency=v_job.salary_currency, salary_period=v_job.salary_period,
      sponsorship_status=v_job.sponsorship_status, application_url=v_job.application_url,
      application_instructions=v_job.application_instructions, is_featured=v_job.is_featured
    where id=p_job_id returning * into v_saved;
  else
    insert into public.jobs (
      title,slug,employer_name,description,requirements,category_slug,skill_level,
      employment_type,workplace_type,country_code,region,city,salary_min,salary_max,
      salary_currency,salary_period,sponsorship_status,application_url,
      application_instructions,is_featured,status,published_at,expires_at
    ) values (
      v_job.title,v_job.slug,v_job.employer_name,v_job.description,v_job.requirements,
      v_job.category_slug,v_job.skill_level,v_job.employment_type,v_job.workplace_type,
      v_job.country_code,v_job.region,v_job.city,v_job.salary_min,v_job.salary_max,
      v_job.salary_currency,v_job.salary_period,v_job.sponsorship_status,v_job.application_url,
      v_job.application_instructions,coalesce(v_job.is_featured,false),'draft',null,null
    ) returning * into v_saved;
  end if;

  insert into public.staff_job_source_verifications
    (job_id,source_reference,verification_status,checked_at,checked_by,updated_at)
  values (v_saved.id,p_source_reference,'unverified',null,null,now())
  on conflict (job_id) do update set
    source_reference=excluded.source_reference,
    verification_status='unverified', checked_at=null, checked_by=null, updated_at=now();

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values (p_actor_id,'vacancy_draft_saved','job',v_saved.id,jsonb_build_object('slug',v_saved.slug));

  return jsonb_build_object('id',v_saved.id,'slug',v_saved.slug,'status',v_saved.status);
end;
$$;
revoke all on function public.staff_vacancy_save_draft(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.staff_vacancy_save_draft(uuid, uuid, jsonb, text) to service_role;


-- Keep draft data, private source evidence and audit in one transaction.
