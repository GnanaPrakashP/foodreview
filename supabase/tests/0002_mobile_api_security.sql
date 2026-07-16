begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('public', 'api_rate_limit_buckets', 'durable API rate-limit table exists');
select has_table('public', 'api_idempotency_records', 'durable idempotency table exists');
select has_table('public', 'media_moderation_actions', 'media moderation audit table exists');
select has_table('public', 'moderation_report_actions', 'report moderation audit table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.api_rate_limit_buckets'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.api_idempotency_records'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.media_moderation_actions'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.moderation_report_actions'::regclass),
  'all Phase 4 private state tables have RLS enabled'
);

select function_privs_are(
  'public', 'consume_api_rate_limits', array['jsonb'], 'service_role', array['EXECUTE'],
  'service role can execute the guarded limiter wrapper'
);
select function_privs_are(
  'public', 'cleanup_api_security_state', array['integer'], 'service_role', array['EXECUTE'],
  'only service role receives security cleanup execution'
);
select function_privs_are(
  'public', 'apply_media_moderation_action', array['uuid', 'text', 'text', 'text'], 'service_role', array['EXECUTE'],
  'only service role receives media moderation execution'
);
select function_privs_are(
  'public', 'apply_report_moderation_action', array['uuid', 'text', 'text', 'text', 'text'], 'service_role', array['EXECUTE'],
  'only service role receives report moderation execution'
);

select ok(
  not has_table_privilege('anon', 'public.api_rate_limit_buckets', 'select')
  and not has_table_privilege('authenticated', 'public.api_rate_limit_buckets', 'select')
  and not has_table_privilege('anon', 'public.api_idempotency_records', 'select')
  and not has_table_privilege('authenticated', 'public.api_idempotency_records', 'select'),
  'normal clients have no Phase 4 limiter or idempotency table access'
);

select col_not_null('public', 'media_assets', 'moderation_status', 'media moderation state is mandatory');
select col_default_is('public', 'media_assets', 'moderation_status', 'pending', 'new media defaults to quarantine');
select col_type_is('public', 'push_tokens', 'user_id', 'uuid', 'push tokens bind to Auth user UUID');
select col_type_is('public', 'push_tokens', 'install_id', 'uuid', 'push tokens bind to installation UUID');

select * from finish();
rollback;
