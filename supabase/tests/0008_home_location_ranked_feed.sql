begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select col_type_is(
  'public', 'post_views', 'first_viewed_at', 'timestamp with time zone',
  'post views retain an immutable first-seen timestamp'
);
select has_trigger(
  'public', 'post_views', 'preserve_post_first_viewed_at',
  'repeat views cannot rewrite the first-seen timestamp'
);
select has_function(
  'public',
  'circle_feed_page_v3',
  array[
    'uuid', 'double precision', 'double precision', 'timestamp with time zone',
    'boolean', 'bigint', 'timestamp with time zone', 'uuid', 'integer', 'uuid[]'
  ],
  'location-ranked Home feed RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.circle_feed_page_v3(uuid,double precision,double precision,timestamp with time zone,boolean,bigint,timestamp with time zone,uuid,integer,uuid[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.circle_feed_page_v3(uuid,double precision,double precision,timestamp with time zone,boolean,bigint,timestamp with time zone,uuid,integer,uuid[])',
    'EXECUTE'
  ),
  'only the service-backed API can execute the Home feed RPC'
);
select ok(
  (select 'search_path=""' = any(proconfig)
   from pg_catalog.pg_proc
   where oid = 'public.circle_feed_page_v3(uuid,double precision,double precision,timestamp with time zone,boolean,bigint,timestamp with time zone,uuid,integer,uuid[])'::regprocedure),
  'Home feed RPC has an empty search path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000008201',
  'authenticated', 'authenticated', 'home-rank@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.profiles (id, first_name, last_name, username, account_type, account_status)
values ('00000000-0000-4000-8000-000000008201', 'Home', 'Rank', 'home_rank_owner', 'public', 'active');

insert into public.reviews (
  id, reviewer_name, restaurant_name, restaurant_lat, restaurant_lng,
  items, visibility, status, created_at
)
values
  ('00000000-0000-4000-8000-000000008211', 'home_rank_owner', 'Unseen Near', 12.001, 77.000, '[{"name":"Dish","rating":4}]', 'public', 'active', now() - interval '5 hours'),
  ('00000000-0000-4000-8000-000000008212', 'home_rank_owner', 'Unseen Mid', 12.010, 77.000, '[{"name":"Dish","rating":4}]', 'public', 'active', now() - interval '4 hours'),
  ('00000000-0000-4000-8000-000000008213', 'home_rank_owner', 'Unseen Missing', null, null, '[{"name":"Dish","rating":4}]', 'public', 'active', now() - interval '3 hours'),
  ('00000000-0000-4000-8000-000000008214', 'home_rank_owner', 'Seen Near', 12.0005, 77.000, '[{"name":"Dish","rating":4}]', 'public', 'active', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-000000008215', 'home_rank_owner', 'Seen Far', 12.020, 77.000, '[{"name":"Dish","rating":4}]', 'public', 'active', now() - interval '1 hour');

insert into public.media_assets (
  id, owner_id, owner_name, surface, media_type, original_mime_type,
  original_extension, original_file_size_bytes, original_width, original_height,
  source_storage_path, status, visibility, expires_at, uploaded_at, processed_at,
  consumed_at, access_class, privacy_state, moderation_status
)
select
  asset_id,
  '00000000-0000-4000-8000-000000008201'::uuid,
  'home_rank_owner', 'post', 'image', 'image/jpeg', 'jpg', 1000, 800, 1000,
  'sources/post/00000000-0000-4000-8000-000000008201/' || asset_id || '/original.jpg',
  'ready', 'public', now() + interval '1 day', now(), now(), now(),
  'public_post', 'stable', 'approved'
from unnest(array[
  '00000000-0000-4000-8000-000000008301'::uuid,
  '00000000-0000-4000-8000-000000008302'::uuid,
  '00000000-0000-4000-8000-000000008303'::uuid,
  '00000000-0000-4000-8000-000000008304'::uuid,
  '00000000-0000-4000-8000-000000008305'::uuid
]) as assets(asset_id);

insert into public.media_derivatives (
  asset_id, kind, bucket_id, storage_path, public_url, mime_type,
  width, height, file_size_bytes, processing_version
)
select
  asset_id, 'feed', 'media-private',
  'derivatives/post/' || asset_id || '/feed.r1.jpg', null, 'image/jpeg',
  640, 800, 500, 'home-rank-test'
from unnest(array[
  '00000000-0000-4000-8000-000000008301'::uuid,
  '00000000-0000-4000-8000-000000008302'::uuid,
  '00000000-0000-4000-8000-000000008303'::uuid,
  '00000000-0000-4000-8000-000000008304'::uuid,
  '00000000-0000-4000-8000-000000008305'::uuid
]) as assets(asset_id);

insert into public.review_photos (
  review_id, storage_path, public_url, media_type, width, height, size_bytes,
  position, owner_id, mime_type, file_size_bytes, media_asset_id
)
select
  review_id,
  'private-posts/00000000-0000-4000-8000-000000008201/' || asset_id || '/feed.r1.jpg',
  null, 'image', 640, 800, 500, 0,
  '00000000-0000-4000-8000-000000008201'::uuid, 'image/jpeg', 500, asset_id
from (values
  ('00000000-0000-4000-8000-000000008211'::uuid, '00000000-0000-4000-8000-000000008301'::uuid),
  ('00000000-0000-4000-8000-000000008212'::uuid, '00000000-0000-4000-8000-000000008302'::uuid),
  ('00000000-0000-4000-8000-000000008213'::uuid, '00000000-0000-4000-8000-000000008303'::uuid),
  ('00000000-0000-4000-8000-000000008214'::uuid, '00000000-0000-4000-8000-000000008304'::uuid),
  ('00000000-0000-4000-8000-000000008215'::uuid, '00000000-0000-4000-8000-000000008305'::uuid)
) as links(review_id, asset_id);

create temporary table home_rank_session as
select statement_timestamp() as seen_cutoff;

insert into public.post_views (user_id, post_id, viewed_at, first_viewed_at)
values
  ('00000000-0000-4000-8000-000000008201', '00000000-0000-4000-8000-000000008214', now() - interval '1 day', now() - interval '1 day'),
  ('00000000-0000-4000-8000-000000008201', '00000000-0000-4000-8000-000000008215', now() - interval '1 day', now() - interval '1 day');

create temporary table home_rank_all as
select private.circle_feed_page_v3(
  '00000000-0000-4000-8000-000000008201', 12.0, 77.0,
  (select seen_cutoff from home_rank_session), null, null, null, null, 10, '{}'
) as payload;

select is(
  (select array_agg(review ->> 'id' order by ordinal)
   from home_rank_all,
   jsonb_array_elements(payload -> 'reviews') with ordinality as rows(review, ordinal)),
  array[
    '00000000-0000-4000-8000-000000008211',
    '00000000-0000-4000-8000-000000008212',
    '00000000-0000-4000-8000-000000008213',
    '00000000-0000-4000-8000-000000008214',
    '00000000-0000-4000-8000-000000008215'
  ]::text[],
  'all unseen posts precede seen posts and each bucket is nearest first'
);

select is(
  (select array_agg(review ->> 'id' order by ordinal)
   from jsonb_array_elements(private.circle_feed_page_v3(
     '00000000-0000-4000-8000-000000008201', null, null,
     (select seen_cutoff from home_rank_session), null, null, null, null, 10, '{}'
   ) -> 'reviews') with ordinality as rows(review, ordinal)),
  array[
    '00000000-0000-4000-8000-000000008213',
    '00000000-0000-4000-8000-000000008212',
    '00000000-0000-4000-8000-000000008211',
    '00000000-0000-4000-8000-000000008215',
    '00000000-0000-4000-8000-000000008214'
  ]::text[],
  'without location the fallback remains unseen first and newest first'
);

create temporary table home_rank_first_page as
select private.circle_feed_page_v3(
  '00000000-0000-4000-8000-000000008201', 12.0, 77.0,
  (select seen_cutoff from home_rank_session), null, null, null, null, 2, '{}'
) as payload;

select is(
  (select jsonb_array_length(payload -> 'reviews') from home_rank_first_page),
  2,
  'the first ranked page respects its row limit'
);
select ok(
  (select (payload ->> 'hasMore')::boolean from home_rank_first_page),
  'the ranked page retains an eleventh-row style has-more sentinel'
);

insert into public.post_views (user_id, post_id, viewed_at, first_viewed_at)
select
  '00000000-0000-4000-8000-000000008201',
  '00000000-0000-4000-8000-000000008213',
  seen_cutoff + interval '1 second',
  seen_cutoff + interval '1 second'
from home_rank_session;

create temporary table home_rank_second_page as
with cursor as (
  select payload -> 'nextCursor' as value from home_rank_first_page
)
select private.circle_feed_page_v3(
  '00000000-0000-4000-8000-000000008201', 12.0, 77.0,
  (cursor.value ->> 'seenCutoff')::timestamptz,
  (cursor.value ->> 'seen')::boolean,
  case when jsonb_typeof(cursor.value -> 'distanceMeters') = 'null'
    then null else (cursor.value ->> 'distanceMeters')::bigint end,
  (cursor.value ->> 'createdAt')::timestamptz,
  (cursor.value ->> 'id')::uuid,
  2,
  '{}'
) as payload
from cursor;

select is(
  (select array_agg(review ->> 'id' order by ordinal)
   from home_rank_second_page,
   jsonb_array_elements(payload -> 'reviews') with ordinality as rows(review, ordinal)),
  array[
    '00000000-0000-4000-8000-000000008213',
    '00000000-0000-4000-8000-000000008214'
  ]::text[],
  'the fixed seen cutoff prevents mid-scroll views from moving or duplicating rows'
);

create temporary table first_seen_snapshot as
select first_viewed_at
from public.post_views
where user_id = '00000000-0000-4000-8000-000000008201'
  and post_id = '00000000-0000-4000-8000-000000008214';

update public.post_views
set viewed_at = now(), first_viewed_at = now()
where user_id = '00000000-0000-4000-8000-000000008201'
  and post_id = '00000000-0000-4000-8000-000000008214';

select is(
  (select view_row.first_viewed_at
   from public.post_views view_row
   where view_row.user_id = '00000000-0000-4000-8000-000000008201'
     and view_row.post_id = '00000000-0000-4000-8000-000000008214'),
  (select first_viewed_at from first_seen_snapshot),
  'recording a repeat view preserves the original first-seen classification'
);

select * from finish();
rollback;
