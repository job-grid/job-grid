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
