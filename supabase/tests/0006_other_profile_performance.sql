begin;
select plan(5);

select has_function(
  'public',
  'mobile_other_profile_shell_v1',
  array['uuid', 'text'],
  'viewer-aware other-profile shell exists'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid = 'public.mobile_other_profile_shell_v1(uuid,text)'::regprocedure),
  'other-profile shell is security definer'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_catalog.pg_proc where oid = 'public.mobile_other_profile_shell_v1(uuid,text)'::regprocedure),
  'other-profile shell has an empty search path'
);
select ok(
  has_function_privilege('service_role', 'public.mobile_other_profile_shell_v1(uuid,text)', 'EXECUTE'),
  'service role can execute the shell'
);
select ok(
  not has_function_privilege('authenticated', 'public.mobile_other_profile_shell_v1(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mobile_other_profile_shell_v1(uuid,text)', 'EXECUTE'),
  'mobile clients cannot bypass the viewer-aware route'
);

select * from finish();
rollback;
