-- Read-only verification for 202607160001_auth_profile_boundary_hardening.sql.

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles'
order by grantee, privilege_type;

select grantee, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
order by grantee, column_name, privilege_type;

select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by policyname;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'complete_current_profile', 'update_current_profile_details',
    'update_current_account_type', 'update_current_username',
    'is_profile_complete', 'circlebites_access_token_hook'
  )
order by routine_name, grantee;

select
  count(*) as total_profiles,
  count(*) filter (where public.is_profile_complete(id)) as complete_profiles,
  count(*) filter (
    where account_status = 'active'
      and deletion_started_at is null
      and not public.is_profile_complete(id)
  ) as incomplete_active_profiles,
  count(*) filter (where account_status = 'deleting') as deleting_profiles,
  count(*) filter (where account_status = 'active' and deletion_started_at is not null) as active_with_deletion_marker,
  count(*) filter (where not public.profile_name_is_valid(first_name, last_name)) as invalid_names,
  count(*) filter (where not public.profile_username_is_valid(username)) as invalid_usernames
from public.profiles;

select
  has_table_privilege('anon', 'public.profiles', 'INSERT') as anon_can_insert,
  has_table_privilege('anon', 'public.profiles', 'UPDATE') as anon_can_update,
  has_table_privilege('authenticated', 'public.profiles', 'INSERT') as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE') as authenticated_can_update,
  has_table_privilege('authenticated', 'public.profiles', 'DELETE') as authenticated_can_delete,
  has_table_privilege('authenticated', 'public.profiles', 'SELECT') as authenticated_can_select;

select namespace.nspname, function_row.proname, function_row.prosecdef, function_row.proconfig
from pg_proc function_row
join pg_namespace namespace on namespace.oid = function_row.pronamespace
where namespace.nspname = 'public'
  and function_row.proname in (
    'complete_current_profile', 'update_current_profile_details',
    'update_current_account_type', 'update_current_username',
    'is_profile_complete', 'circlebites_access_token_hook'
  )
order by function_row.proname;
