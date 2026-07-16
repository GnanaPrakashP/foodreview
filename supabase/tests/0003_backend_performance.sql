begin;
select plan(22);

select has_function('public', 'mobile_post_engagement_v1', array['uuid[]', 'uuid'], 'bounded engagement RPC exists');
select has_function('public', 'mobile_public_feed_page_v1', array['text', 'uuid', 'timestamp with time zone', 'uuid', 'integer', 'text', 'text', 'text', 'uuid', 'text', 'uuid', 'text'], 'bounded public/profile/detail feed RPC exists');
select has_function('public', 'circle_feed_page_v2', array['uuid', 'timestamp with time zone', 'uuid', 'integer', 'uuid[]'], 'bounded Circle feed RPC exists');
select has_function('public', 'shared_memory_room_summaries_v2', array['integer', 'timestamp with time zone', 'uuid'], 'bounded Memory summary RPC exists');
select has_function('public', 'shared_memory_room_bootstrap_v1', array['uuid', 'integer'], 'bounded Memory bootstrap RPC exists');
select has_function('public', 'shared_memory_media_page_v1', array['uuid', 'timestamp with time zone', 'uuid', 'integer'], 'bounded Memory media RPC exists');
select has_function('public', 'explore_discovery_canonical_v3', array['double precision', 'double precision', 'integer'], 'canonical Explore v3 RPC exists');
select has_function('public', 'reconcile_phase5_projections', array['boolean', 'integer'], 'projection reconciliation RPC exists');

select ok(has_table_privilege('service_role', 'public.reviews', 'SELECT'), 'service role can assemble feeds');
select ok(
  has_function_privilege('anon', 'public.circle_feed_page_v2(uuid,timestamp with time zone,uuid,integer,uuid[])', 'EXECUTE')
  and (select position('service_role_required' in routine.prosrc) > 0 from pg_catalog.pg_proc routine where routine.oid = 'public.circle_feed_page_v2(uuid,timestamp with time zone,uuid,integer,uuid[])'::regprocedure),
  'anonymous Circle RPC calls reach only the stable service-role guard'
);
select ok(
  has_function_privilege('authenticated', 'public.circle_feed_page_v2(uuid,timestamp with time zone,uuid,integer,uuid[])', 'EXECUTE')
  and (select routine.prosecdef from pg_catalog.pg_proc routine where routine.oid = 'public.circle_feed_page_v2(uuid,timestamp with time zone,uuid,integer,uuid[])'::regprocedure),
  'authenticated clients cannot bypass the guarded Circle API actor contract'
);
select ok(has_function_privilege('service_role', 'public.circle_feed_page_v2(uuid,timestamp with time zone,uuid,integer,uuid[])', 'EXECUTE'), 'service role executes Circle RPC');
select ok(
  has_function_privilege('authenticated', 'public.mobile_post_engagement_v1(uuid[],uuid)', 'EXECUTE')
  and not (select routine.proretset from pg_catalog.pg_proc routine where routine.oid = 'public.mobile_post_engagement_v1(uuid[],uuid)'::regprocedure)
  and (select routine.prosecdef from pg_catalog.pg_proc routine where routine.oid = 'public.mobile_post_engagement_v1(uuid[],uuid)'::regprocedure)
  and (select position('service_role_required' in routine.prosrc) > 0 from pg_catalog.pg_proc routine where routine.oid = 'public.mobile_post_engagement_v1(uuid[],uuid)'::regprocedure),
  'authenticated engagement calls terminate at the scalar service-role guard before private viewer-state assembly'
);
select ok(has_function_privilege('service_role', 'public.mobile_post_engagement_v1(uuid[],uuid)', 'EXECUTE'), 'service role executes engagement RPC');
select ok(has_function_privilege('authenticated', 'public.explore_discovery_canonical_v3(double precision,double precision,integer)', 'EXECUTE'), 'authenticated clients can execute canonical Explore');
select ok((select routine.prosecdef from pg_catalog.pg_proc routine join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace where namespace.nspname = 'public' and routine.proname = 'explore_discovery_canonical_v3'), 'Explore reads private projection tables through its bounded definer contract');
select ok(not has_table_privilege('authenticated', 'public.place_stats', 'SELECT'), 'authenticated clients cannot scan the raw place projection');

select has_index('public', 'reviews', 'reviews_active_cursor_idx', 'Circle active cursor index exists');
select has_index('public', 'reviews', 'reviews_public_cursor_idx', 'public feed cursor index exists');
select has_index('public', 'comments', 'comments_post_cursor_idx', 'comment cursor index exists');
select has_index('public', 'notifications', 'notifications_recipient_user_cursor_idx', 'notification recipient cursor index exists');
select has_index('public', 'shared_memory_messages', 'shared_memory_messages_room_created_id_desc_idx', 'Memory chat cursor index exists');

select * from finish();
rollback;
