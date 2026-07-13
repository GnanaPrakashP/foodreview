-- Phase 3 canonical-schema drift surface.
-- This function is read-only, service-role only, and returns names/statuses only.

create or replace function public.production_schema_contract()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage, auth, supabase_migrations
as $$
declare
  v_critical_tables constant text[] := array[
    'profiles', 'reviews', 'review_photos', 'comments', 'likes', 'wishlist',
    'recommendation_feedback', 'circle_requests', 'circle_memberships',
    'blocked_users', 'notifications', 'push_tokens', 'post_views',
    'shared_memory_rooms', 'shared_memory_members', 'shared_memory_messages',
    'shared_memory_photos', 'shared_memory_dishes', 'shared_memory_upload_intents',
    'media_assets', 'media_derivatives', 'media_processing_jobs',
    'account_deletion_jobs', 'canonical_dishes', 'dish_aliases',
    'dish_candidates', 'review_dish_mentions'
  ];
  v_private_buckets constant text[] := array[
    'memory-media', 'media-sources', 'media-private', 'review-media-quarantine'
  ];
  v_worker_functions constant text[] := array[
    'claim_media_processing_jobs', 'heartbeat_media_processing_job',
    'media_processing_lease_is_current', 'complete_media_processing_job',
    'fail_media_processing_job', 'requeue_media_processing_job',
    'cancel_media_processing_job', 'claim_media_cleanup_assets',
    'complete_media_cleanup_asset', 'fail_media_cleanup_asset',
    'claim_account_deletion_jobs', 'account_deletion_storage_candidates',
    'account_deletion_cleanup_database', 'account_deletion_remaining_counts',
    'purge_expired_account_deletion_records'
  ];
  v_result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'production_schema_contract_forbidden';
  end if;

  select jsonb_build_object(
    'migrationVersions', coalesce((
      select jsonb_agg(m.version order by m.version)
      from supabase_migrations.schema_migrations m
    ), '[]'::jsonb),
    'migrationNames', coalesce((
      select jsonb_object_agg(m.version, m.name order by m.version)
      from supabase_migrations.schema_migrations m
    ), '{}'::jsonb),
    'missingCriticalTables', coalesce((
      select jsonb_agg(expected.name order by expected.name)
      from unnest(v_critical_tables) as expected(name)
      where to_regclass(format('public.%I', expected.name)) is null
    ), '[]'::jsonb),
    'rlsDisabledTables', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = any(v_critical_tables)
        and c.relkind = 'r'
        and not c.relrowsecurity
    ), '[]'::jsonb),
    'privateBucketDrift', coalesce((
      select jsonb_agg(expected.name order by expected.name)
      from unnest(v_private_buckets) as expected(name)
      left join storage.buckets bucket on bucket.id = expected.name
      where bucket.id is null or bucket.public is distinct from false
    ), '[]'::jsonb),
    'missingWorkerFunctions', coalesce((
      select jsonb_agg(expected.name order by expected.name)
      from unnest(v_worker_functions) as expected(name)
      where not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = expected.name
      )
    ), '[]'::jsonb),
    'clientWorkerFunctionGrants', coalesce((
      select jsonb_agg(distinct p.proname order by p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(v_worker_functions)
        and (
          has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
        )
    ), '[]'::jsonb),
    'clientTableGrantDrift', coalesce((
      select jsonb_agg(expected.table_name || ':' || lower(expected.privilege_name) order by expected.table_name, expected.privilege_name)
      from (values
        ('blocked_users', 'INSERT'),
        ('notification_settings', 'UPDATE'),
        ('post_views', 'INSERT'),
        ('push_tokens', 'INSERT'),
        ('shared_memory_members', 'SELECT'),
        ('shared_memory_messages', 'INSERT'),
        ('shared_memory_photos', 'SELECT'),
        ('shared_memory_rooms', 'SELECT'),
        ('shared_memory_stops', 'INSERT'),
        ('shared_memory_upload_intents', 'SELECT')
      ) expected(table_name, privilege_name)
      where not has_table_privilege('authenticated', format('public.%I', expected.table_name), expected.privilege_name)
    ), '[]'::jsonb),
    'serviceTableGrantDrift', coalesce((
      select jsonb_agg(expected.table_name order by expected.table_name)
      from unnest(array[
        'blocked_users', 'notification_settings', 'post_views', 'push_tokens',
        'shared_memory_members', 'shared_memory_messages', 'shared_memory_photos',
        'shared_memory_rooms', 'shared_memory_upload_intents'
      ]::text[]) expected(table_name)
      where not has_table_privilege('service_role', format('public.%I', expected.table_name), 'SELECT, INSERT, UPDATE, DELETE')
    ), '[]'::jsonb),
    'unsafeDefinerFunctions', coalesce((
      select jsonb_agg(distinct p.proname order by p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(v_worker_functions)
        and p.prosecdef
        and not exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting like 'search_path=%'
        )
    ), '[]'::jsonb),
    'invalidIndexes', coalesce((
      select jsonb_agg(index_class.relname order by index_class.relname)
      from pg_index idx
      join pg_class index_class on index_class.oid = idx.indexrelid
      join pg_class table_class on table_class.oid = idx.indrelid
      join pg_namespace n on n.oid = table_class.relnamespace
      where n.nspname = 'public' and not idx.indisvalid
    ), '[]'::jsonb),
    'unvalidatedConstraints', coalesce((
      select jsonb_agg(con.conname order by con.conname)
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public' and not con.convalidated
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.production_schema_contract() from public, anon, authenticated;
grant execute on function public.production_schema_contract() to service_role;

comment on function public.production_schema_contract() is
  'Service-only, read-only critical schema/RLS/Storage/grant drift contract for production hardening.';
