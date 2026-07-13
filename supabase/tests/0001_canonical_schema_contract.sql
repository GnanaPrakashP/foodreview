begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select ok(
  (select count(*) = 27
   from unnest(array[
     'profiles', 'reviews', 'review_photos', 'comments', 'likes', 'wishlist',
     'recommendation_feedback', 'circle_requests', 'circle_memberships', 'blocked_users',
     'notifications', 'push_tokens', 'post_views', 'shared_memory_rooms',
     'shared_memory_members', 'shared_memory_messages', 'shared_memory_photos',
     'shared_memory_dishes', 'shared_memory_upload_intents', 'media_assets',
     'media_derivatives', 'media_processing_jobs', 'account_deletion_jobs',
     'canonical_dishes', 'dish_aliases', 'dish_candidates', 'review_dish_mentions'
   ]::text[]) expected(name)
   where to_regclass(format('public.%I', expected.name)) is not null),
  'all critical application tables exist'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id' and data_type = 'uuid' and is_nullable = 'NO')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'account_status' and data_type = 'text' and is_nullable = 'NO')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'deletion_started_at' and data_type = 'timestamp with time zone'),
  'profile identity and freeze columns match the contract'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reviews' and column_name = 'visibility' and column_default like '%public%')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'review_photos' and column_name = 'media_asset_id' and data_type = 'uuid')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'review_photos' and column_name = 'storage_path' and is_nullable = 'NO'),
  'review visibility and authoritative media-link columns match the contract'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shared_memory_messages' and column_name = 'reply_to_message_id' and data_type = 'uuid')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shared_memory_photos' and column_name = 'upload_intent_id' and data_type = 'uuid')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shared_memory_photos' and column_name = 'moderation_status' and is_nullable = 'NO'),
  'Memory reply, intent and moderation columns match the contract'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media_processing_jobs' and column_name = 'lease_generation' and data_type = 'bigint' and is_nullable = 'NO')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media_processing_jobs' and column_name = 'claim_token' and data_type = 'uuid')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media_processing_jobs' and column_name = 'lock_expires_at' and data_type = 'timestamp with time zone')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'media_processing_jobs' and column_name = 'failure_code' and data_type = 'text'),
  'media job fencing and failure columns match the contract'
);

select ok(
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_jobs' and column_name = 'user_id' and data_type = 'uuid' and is_nullable = 'NO')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_jobs' and column_name = 'lease_expires_at' and data_type = 'timestamp with time zone')
  and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_jobs' and column_name = 'status' and data_type = 'text'),
  'account deletion ownership and lease columns match the contract'
);

select ok(
  (select count(*) = 27
   from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname = any(array[
       'profiles', 'reviews', 'review_photos', 'comments', 'likes', 'wishlist',
       'recommendation_feedback', 'circle_requests', 'circle_memberships', 'blocked_users',
       'notifications', 'push_tokens', 'post_views', 'shared_memory_rooms',
       'shared_memory_members', 'shared_memory_messages', 'shared_memory_photos',
       'shared_memory_dishes', 'shared_memory_upload_intents', 'media_assets',
       'media_derivatives', 'media_processing_jobs', 'account_deletion_jobs',
       'canonical_dishes', 'dish_aliases', 'dish_candidates', 'review_dish_mentions'
     ]::text[])
     and relation.relrowsecurity),
  'RLS is enabled on every critical table'
);

select ok(
  not exists (
    select 1 from pg_index idx
    join pg_class relation on relation.oid = idx.indrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and not idx.indisvalid
  ),
  'no public index is invalid'
);

select ok(
  not exists (
    select 1 from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and not constraint_row.convalidated
  ),
  'no public constraint is unvalidated'
);

select ok(
  to_regclass('public.media_processing_jobs_claim_idx') is not null
  and to_regclass('public.media_assets_cleanup_claim_idx') is not null
  and to_regclass('public.account_deletion_jobs_claim_idx') is not null
  and to_regclass('public.shared_memory_members_user_idx') is not null
  and to_regclass('public.post_views_user_viewed_at_idx') is not null,
  'security-sensitive claim, membership and visibility indexes exist'
);

select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'p')
  and exists (select 1 from pg_constraint where conrelid = 'public.review_photos'::regclass and contype = 'f')
  and exists (select 1 from pg_constraint where conrelid = 'public.media_derivatives'::regclass and contype = 'f')
  and exists (select 1 from pg_constraint where conrelid = 'public.shared_memory_members'::regclass and contype = 'u'),
  'critical primary, foreign-key and uniqueness constraints exist'
);

select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.media_assets'::regclass and tgname = 'ensure_media_processing_job_after_upload_trigger' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'cancel_media_jobs_for_frozen_account_trigger' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgrelid = 'public.shared_memory_messages'::regclass and tgname = 'shared_memory_messages_security_guard' and not tgisinternal),
  'critical media and Memory security triggers exist'
);

select ok(
  to_regprocedure('public.claim_media_processing_jobs(text,integer,integer,integer)') is not null
  and to_regprocedure('public.heartbeat_media_processing_job(uuid,text,bigint,uuid,integer)') is not null
  and to_regprocedure('public.claim_account_deletion_jobs(integer,text,integer,uuid)') is not null
  and to_regprocedure('public.finalize_shared_memory_upload_intent(uuid,uuid,integer,bigint,text,text,timestamp with time zone,timestamp with time zone)') is not null
  and to_regprocedure('public.production_schema_contract()') is not null,
  'critical function signatures exist'
);

select ok(
  not exists (
    select 1 from pg_proc function_row
    join pg_namespace namespace on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and function_row.proname = any(array[
        'claim_media_processing_jobs', 'heartbeat_media_processing_job',
        'complete_media_processing_job', 'fail_media_processing_job',
        'requeue_media_processing_job', 'cancel_media_processing_job',
        'claim_media_cleanup_assets', 'complete_media_cleanup_asset',
        'fail_media_cleanup_asset', 'claim_account_deletion_jobs',
        'account_deletion_storage_candidates', 'account_deletion_cleanup_database'
      ]::text[])
      and (
        has_function_privilege('anon', function_row.oid, 'execute')
        or has_function_privilege('authenticated', function_row.oid, 'execute')
      )
  ),
  'worker and deletion functions have no client execution grant'
);

select ok(
  has_table_privilege('authenticated', 'public.blocked_users', 'insert')
  and has_table_privilege('authenticated', 'public.push_tokens', 'insert')
  and has_table_privilege('authenticated', 'public.post_views', 'insert')
  and has_table_privilege('authenticated', 'public.shared_memory_messages', 'insert')
  and has_table_privilege('authenticated', 'public.shared_memory_photos', 'select')
  and not has_table_privilege('authenticated', 'public.shared_memory_photos', 'insert')
  and not has_table_privilege('authenticated', 'public.shared_memory_upload_intents', 'insert'),
  'canonical client grants reach RLS without exposing server-owned media writes'
);

select ok(
  not exists (
    select 1 from pg_proc function_row
    join pg_namespace namespace on namespace.oid = function_row.pronamespace
    where namespace.nspname = 'public'
      and function_row.prosecdef
      and function_row.proname = any(array[
        'claim_media_processing_jobs', 'heartbeat_media_processing_job',
        'complete_media_processing_job', 'fail_media_processing_job',
        'claim_media_cleanup_assets', 'claim_account_deletion_jobs',
        'account_deletion_cleanup_database', 'finalize_shared_memory_upload_intent',
        'production_schema_contract'
      ]::text[])
      and not exists (
        select 1 from unnest(coalesce(function_row.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  'critical SECURITY DEFINER functions set an explicit search_path'
);

select ok(
  (select count(*) = 4 from storage.buckets where id = any(array[
    'memory-media', 'media-sources', 'media-private', 'review-media-quarantine'
  ]::text[]) and public = false),
  'all critical private Storage buckets remain private'
);

select ok(
  (select public from storage.buckets where id = 'review-photos') = true
  and (select public from storage.buckets where id = 'media-public') = true,
  'intentionally public finalized-avatar/review and public-derivative buckets remain explicit'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Memory members can view memory media')
  and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Memory members can upload own memory media')
  and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Authenticated users can upload scoped media sources')
  and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Service role can manage generic media objects'),
  'critical Storage object policies exist'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews' and policyname = 'Reviews readable by visibility')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Deleting profiles are suppressed')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shared_memory_rooms' and policyname = 'Shared memory rooms readable by participants')
  and not has_table_privilege('authenticated', 'public.account_deletion_jobs', 'select')
  and not has_table_privilege('anon', 'public.account_deletion_jobs', 'select'),
  'critical visibility, deletion and Memory policies exist'
);

select ok(
  public.review_media_path_is_owned_by(
    'private-posts/11111111-1111-4111-8111-111111111111/asset/canonical.jpg',
    '11111111-1111-4111-8111-111111111111'::uuid
  )
  and not public.review_media_path_is_owned_by(
    'private-posts/22222222-2222-4222-8222-222222222222/asset/canonical.jpg',
    '11111111-1111-4111-8111-111111111111'::uuid
  ),
  'review media ownership recognizes Phase 1A private paths without cross-owner matches'
);

select * from finish();
rollback;
