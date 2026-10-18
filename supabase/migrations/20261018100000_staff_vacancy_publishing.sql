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

-- Remove the earlier version's sensitive fields from the public jobs table.
alter table public.jobs
  drop constraint if exists jobs_source_verification_status_valid,
  drop column if exists source_reference,
  drop column if exists source_verification_status,
  drop column if exists source_checked_at,
  drop column if exists source_checked_by;

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
