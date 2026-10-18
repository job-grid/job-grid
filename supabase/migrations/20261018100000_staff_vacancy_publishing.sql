-- Staff vacancy publishing must retain traceable source-review evidence.
-- Existing live jobs remain editable. Publication and changes to source evidence
-- on published rows require complete, recorded HTTPS verification.
alter table public.jobs
  add column if not exists source_reference text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists source_checked_at timestamptz,
  add column if not exists source_checked_by uuid references auth.users(id) on delete set null;

alter table public.jobs
  add constraint jobs_verification_status_valid
  check (verification_status in ('unverified', 'verified', 'rejected')) not valid;

alter table public.jobs
  drop constraint if exists jobs_published_source_verified;

create or replace function public.enforce_verified_job_publication()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published'
     and (
       tg_op = 'INSERT'
       or old.status is distinct from 'published'
       or (
         old.status = 'published'
         and (
           new.verification_status is distinct from old.verification_status
           or new.source_reference is distinct from old.source_reference
           or new.source_checked_at is distinct from old.source_checked_at
           or new.source_checked_by is distinct from old.source_checked_by
         )
       )
     )
     and not (
       new.verification_status = 'verified'
       and new.source_reference is not null
       and length(btrim(new.source_reference)) between 8 and 2000
       and new.source_checked_at is not null
       and new.source_checked_by is not null
       and new.source_reference ~ '^https://[^[:space:]]+$'
     ) then
    raise exception 'Vacancy cannot be published without recorded HTTPS source verification'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_require_source_verification_before_publish on public.jobs;
create trigger jobs_require_source_verification_before_publish
before insert or update of status, verification_status, source_reference, source_checked_at, source_checked_by
on public.jobs
for each row execute function public.enforce_verified_job_publication();

comment on column public.jobs.source_reference is 'Official employer or vacancy source reviewed by Job Grid staff; must be HTTPS before publication.';
comment on column public.jobs.verification_status is 'Human review status for the vacancy; new publication requires verified.';
comment on column public.jobs.source_checked_at is 'Timestamp when an authorized staff member recorded source verification.';
comment on column public.jobs.source_checked_by is 'Staff account that recorded source verification.';
comment on function public.enforce_verified_job_publication() is 'Blocks publication without source verification and prevents removal of verification evidence from published rows while preserving ordinary edits to legacy published rows.';
