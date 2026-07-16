begin;
select plan(46);

select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated users can read profiles through RLS');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'authenticated users cannot insert profile rows directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'authenticated users cannot update profile rows directly');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'authenticated users cannot delete profile rows directly');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anonymous users cannot read profiles');
select ok(not has_table_privilege('anon', 'public.profiles', 'INSERT'), 'anonymous users cannot insert profiles');
select ok(
  (select count(*) = 0 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  'profiles has no direct client-write RLS policy'
);
select ok(
  (select count(*) = 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'),
  'profiles has one centralized authenticated read policy'
);

select has_function('public', 'profile_username_is_valid', array['text'], 'canonical username validator exists');
select has_function('public', 'profile_name_is_valid', array['text', 'text'], 'canonical Name validator exists');
select has_function('public', 'is_profile_complete', array['uuid'], 'authoritative completeness function exists');
select has_function('public', 'complete_current_profile', array['text', 'text'], 'restricted onboarding RPC exists');
select has_function('public', 'update_current_profile_details', array['text', 'text'], 'restricted profile detail RPC exists');
select has_function('public', 'update_current_account_type', array['text'], 'restricted account type RPC exists');
select has_function('public', 'update_current_username', array['text'], 'restricted username RPC exists');
select has_function('public', 'circlebites_access_token_hook', array['jsonb'], 'password-blocking access token hook exists');

select ok(has_function_privilege('authenticated', 'public.complete_current_profile(text,text)', 'EXECUTE'), 'authenticated users can complete their own profile');
select ok(has_function_privilege('authenticated', 'public.update_current_profile_details(text,text)', 'EXECUTE'), 'authenticated users can edit Name and bio through RPC');
select ok(has_function_privilege('authenticated', 'public.update_current_account_type(text)', 'EXECUTE'), 'authenticated users can edit account type through RPC');
select ok(has_function_privilege('authenticated', 'public.update_current_username(text)', 'EXECUTE'), 'authenticated users can edit username through RPC');
select ok(not has_function_privilege('anon', 'public.complete_current_profile(text,text)', 'EXECUTE'), 'anonymous users cannot complete a profile');
select ok(has_function_privilege('authenticated', 'public.is_profile_complete(uuid)', 'EXECUTE'), 'authenticated boundary can resolve profile completeness');
select ok(not has_function_privilege('authenticated', 'public.circlebites_access_token_hook(jsonb)', 'EXECUTE'), 'clients cannot invoke the Auth hook');
select ok(not has_function_privilege('anon', 'public.circlebites_access_token_hook(jsonb)', 'EXECUTE'), 'anonymous clients cannot invoke the Auth hook');
select ok(has_function_privilege('supabase_auth_admin', 'public.circlebites_access_token_hook(jsonb)', 'EXECUTE'), 'Supabase Auth can invoke the access token hook');

select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.complete_current_profile(text,text)'::regprocedure), 'onboarding RPC is security definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.update_current_profile_details(text,text)'::regprocedure), 'profile detail RPC is security definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.update_current_account_type(text)'::regprocedure), 'account type RPC is security definer');
select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.update_current_username(text)'::regprocedure), 'username RPC is security definer');

select ok((select 'search_path=""' = any(proconfig) from pg_catalog.pg_proc where oid = 'public.complete_current_profile(text,text)'::regprocedure), 'onboarding RPC has an empty search path');
select ok((select 'search_path=""' = any(proconfig) from pg_catalog.pg_proc where oid = 'public.update_current_profile_details(text,text)'::regprocedure), 'profile detail RPC has an empty search path');
select ok((select 'search_path=""' = any(proconfig) from pg_catalog.pg_proc where oid = 'public.update_current_username(text)'::regprocedure), 'username RPC has an empty search path');
select ok((select 'search_path=""' = any(proconfig) from pg_catalog.pg_proc where oid = 'public.is_profile_complete(uuid)'::regprocedure), 'completeness function has an empty search path');

select ok(public.profile_username_is_valid('circle_bites7'), 'normalized username is valid');
select ok(not public.profile_username_is_valid('CircleBites'), 'uppercase username is invalid');
select ok(public.profile_name_is_valid('Circle', 'Bites'), 'non-empty Name is valid');
select ok(not public.profile_name_is_valid('   ', ''), 'blank Name is invalid');
select is(
  public.circlebites_access_token_hook('{"authentication_method":"password","claims":{}}'::jsonb)->'error'->>'http_code',
  '403',
  'password token issuance is rejected'
);
select is(
  public.circlebites_access_token_hook('{"authentication_method":"otp","claims":{"sub":"test"}}'::jsonb)->'claims'->>'sub',
  'test',
  'OTP token claims continue unchanged'
);

select ok(not has_column_privilege('authenticated', 'public.profiles', 'trust_score', 'UPDATE'), 'trust score is server-owned');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'account_status', 'UPDATE'), 'account lifecycle is server-owned');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'avatar_media_asset_id', 'UPDATE'), 'avatar media linkage is server-owned');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE'), 'profile timestamps are server-owned');
select ok(has_table_privilege('service_role', 'public.profiles', 'UPDATE'), 'service role retains explicit profile maintenance access');
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and function_row.proretset
      and not has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
  ),
  'public schema contains no ungranted set-returning function exposed to the PostgreSQL ACL crash path'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace namespace on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'private'
      and function_row.proname = 'claim_media_processing_jobs'
      and function_row.proretset
  )
  and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'service-only worker implementation is isolated in a non-client schema'
);

select * from finish();
rollback;
