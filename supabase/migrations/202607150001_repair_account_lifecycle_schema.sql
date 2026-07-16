-- Repair migration drift where the account-deletion migration is recorded as
-- applied but the profile lifecycle columns are absent from the live schema.
-- These columns are required by the mobile account-status endpoint and the
-- hardened authentication boundary.

alter table public.profiles
  add column if not exists account_status text,
  add column if not exists deletion_started_at timestamptz;

update public.profiles
set account_status = 'active'
where account_status is null;

alter table public.profiles
  alter column account_status set default 'active',
  alter column account_status set not null;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'deleting'));

create index if not exists profiles_account_status_idx
  on public.profiles(account_status, deletion_started_at);
