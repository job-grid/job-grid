-- Staff vacancy publishing must retain a traceable source and review evidence.
alter table public.jobs
  add column if not exists source_reference text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists source_checked_at timestamptz,
  add column if not exists source_checked_by uuid references auth.users(id) on delete set null;

alter table public.jobs
  add constraint jobs_verification_status_valid
  check (verification_status in ('unverified', 'verified', 'rejected')) not valid;

alter table public.jobs
  add constraint jobs_published_source_verified
  check (
    status <> 'published'
    or (
      verification_status = 'verified'
      and source_reference is not null
      and length(btrim(source_reference)) between 8 and 2000
      and source_checked_at is not null
      and source_checked_by is not null
      and source_reference ~ '^https://[^[:space:]]+$'
    )
  ) not valid;

comment on column public.jobs.source_reference is 'Official employer or vacancy source reviewed by Job Grid staff; must be HTTPS before publication.';
comment on column public.jobs.verification_status is 'Human review status for the vacancy source; public publishing requires verified.';
comment on column public.jobs.source_checked_at is 'Timestamp when an authorized staff member recorded source verification.';
comment on column public.jobs.source_checked_by is 'Staff account that recorded source verification.';