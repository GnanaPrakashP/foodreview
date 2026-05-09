-- Add profile account visibility type for public/private Circle behavior.
-- Safe to run multiple times on existing Supabase projects.

alter table public.profiles
  add column if not exists account_type text;

update public.profiles
set account_type = 'public'
where account_type is null
   or account_type not in ('public', 'private');

alter table public.profiles
  alter column account_type set default 'public';

alter table public.profiles
  alter column account_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_account_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_account_type_check
      check (account_type in ('public', 'private'));
  end if;
end $$;

comment on column public.profiles.account_type is
  'Circle account mode. public accounts can be joined directly; private accounts require request/accept.';
