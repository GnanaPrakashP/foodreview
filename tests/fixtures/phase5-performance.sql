\set ON_ERROR_STOP on
begin;
set local client_min_messages = warning;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000005101', 'authenticated', 'authenticated', 'phase5-viewer@example.test', crypt('Phase5-local-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000005102', 'authenticated', 'authenticated', 'phase5-author@example.test', crypt('Phase5-local-only', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name, username, account_type, account_status)
values
  ('00000000-0000-4000-8000-000000005101', 'Phase', 'Viewer', 'phase5_viewer', 'public', 'active'),
  ('00000000-0000-4000-8000-000000005102', 'Phase', 'Author', 'phase5_author', 'public', 'active')
on conflict (id) do update set account_status = 'active';

insert into public.circle_memberships (user_name, member_name)
values ('phase5_author', 'phase5_viewer')
on conflict do nothing;

insert into public.reviews (
  id, reviewer_name, restaurant_id, restaurant_name, area, restaurant_address,
  restaurant_lat, restaurant_lng, items, body, visibility, status, created_at
)
select (
    substr(md5('phase5-review-' || g), 1, 8) || '-' || substr(md5('phase5-review-' || g), 9, 4) || '-4' ||
    substr(md5('phase5-review-' || g), 14, 3) || '-8' || substr(md5('phase5-review-' || g), 18, 3) || '-' ||
    substr(md5('phase5-review-' || g), 21, 12)
  )::uuid,
  'phase5_author', 'phase5-place-' || (g % 100), 'Phase 5 Place ' || (g % 100), 'Performance Area',
  'Performance Address ' || (g % 100), 12.9 + ((g % 20)::double precision / 1000),
  77.5 + ((g % 20)::double precision / 1000),
  jsonb_build_array(jsonb_build_object('name', 'Dish ' || (g % 50), 'rating', 4)),
  'deterministic synthetic performance review', case when g % 10 = 0 then 'public' else 'circle' end, 'active',
  case when g % 10 = 0 then timestamptz '2026-07-01 00:00:00+00'
    else timestamptz '2026-07-01 00:00:00+00' - make_interval(secs => g) end
from generate_series(1, 10000) g
on conflict (id) do nothing;

create temporary table phase5_posts as
select id, created_at from public.reviews where reviewer_name = 'phase5_author' order by created_at desc, id desc limit 250;

create temporary table phase5_home_media as
select
  post.id as review_id,
  post.visibility,
  (
    substr(md5('phase5-home-asset-' || row_number() over (order by post.created_at desc, post.id desc)), 1, 8) || '-' ||
    substr(md5('phase5-home-asset-' || row_number() over (order by post.created_at desc, post.id desc)), 9, 4) || '-4' ||
    substr(md5('phase5-home-asset-' || row_number() over (order by post.created_at desc, post.id desc)), 14, 3) || '-8' ||
    substr(md5('phase5-home-asset-' || row_number() over (order by post.created_at desc, post.id desc)), 18, 3) || '-' ||
    substr(md5('phase5-home-asset-' || row_number() over (order by post.created_at desc, post.id desc)), 21, 12)
  )::uuid as asset_id
from public.reviews post
where post.reviewer_name = 'phase5_author'
order by post.created_at desc, post.id desc
limit 10;

insert into public.media_assets (
  id, owner_id, owner_name, surface, media_type, original_mime_type, original_extension,
  original_file_size_bytes, original_width, original_height, crop_rect, source_bucket_id,
  source_storage_path, status, access_class, privacy_state, visibility, expires_at, processed_at
)
select
  media.asset_id, '00000000-0000-4000-8000-000000005102', 'phase5_author', 'post', 'image',
  'image/jpeg', 'jpg', 250000, 1080, 1350,
  '{"x":0,"y":0,"width":1,"height":1,"targetAspect":0.8}'::jsonb,
  'media-sources',
  'sources/post/00000000-0000-4000-8000-000000005102/' || media.asset_id || '/original.jpg',
  'ready', case media.visibility when 'public' then 'public_post' when 'circle' then 'circle_post' else 'private_post' end,
  'stable', 'private', now() + interval '1 day', now()
from phase5_home_media media
on conflict (id) do nothing;

insert into public.review_photos (review_id, storage_path, public_url, media_type, width, height, size_bytes, position, media_asset_id)
select review_id, 'private-posts/00000000-0000-4000-8000-000000005102/' || asset_id || '/canonical.jpg',
  null, 'image', 1080, 1350, 250000, 0, asset_id
from phase5_home_media
on conflict (media_asset_id) where media_asset_id is not null do nothing;

insert into public.media_derivatives (
  asset_id, kind, bucket_id, storage_path, public_url, mime_type, width, height, duration_ms, file_size_bytes, blurhash
)
select asset_id, derivative.kind, 'media-private',
  'private-posts/00000000-0000-4000-8000-000000005102/' || asset_id || '/' || derivative.kind || '.jpg',
  null, 'image/jpeg', derivative.width, derivative.height, null, derivative.bytes, 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
from phase5_home_media
cross join (values ('feed', 720, 900, 90000), ('canonical', 1080, 1350, 185000)) derivative(kind, width, height, bytes)
on conflict (asset_id, kind) do nothing;

insert into public.likes (post_id, user_name)
select id, 'phase5_viewer' from phase5_posts limit 100
on conflict do nothing;

insert into public.comments (id, post_id, user_name, content, created_at)
select (
    substr(md5('phase5-comment-' || g), 1, 8) || '-' || substr(md5('phase5-comment-' || g), 9, 4) || '-4' ||
    substr(md5('phase5-comment-' || g), 14, 3) || '-8' || substr(md5('phase5-comment-' || g), 18, 3) || '-' ||
    substr(md5('phase5-comment-' || g), 21, 12)
  )::uuid,
  (select id from phase5_posts order by created_at desc, id desc limit 1), 'phase5_viewer',
  'deterministic comment ' || g, timestamptz '2026-07-02 00:00:00+00' + make_interval(secs => g)
from generate_series(1, 2000) g
on conflict (id) do nothing;

insert into public.notifications (
  id, recipient_user_id, actor_user_id, recipient_name, actor_name, type, title, message,
  is_read, read, created_at, updated_at
)
select (
    substr(md5('phase5-notification-' || g), 1, 8) || '-' || substr(md5('phase5-notification-' || g), 9, 4) || '-4' ||
    substr(md5('phase5-notification-' || g), 14, 3) || '-8' || substr(md5('phase5-notification-' || g), 18, 3) || '-' ||
    substr(md5('phase5-notification-' || g), 21, 12)
  )::uuid,
  case when g % 10 = 0 then '00000000-0000-4000-8000-000000005101'::uuid else '00000000-0000-4000-8000-000000005102'::uuid end,
  case when g % 10 = 0 then '00000000-0000-4000-8000-000000005102'::uuid else '00000000-0000-4000-8000-000000005101'::uuid end,
  case when g % 10 = 0 then 'phase5_viewer' else 'phase5_author' end,
  case when g % 10 = 0 then 'phase5_author' else 'phase5_viewer' end,
  'like', 'Performance fixture', 'bounded synthetic summary',
  (g % 3 = 0), (g % 3 = 0), timestamptz '2026-07-03 00:00:00+00' - make_interval(secs => g),
  timestamptz '2026-07-03 00:00:00+00' - make_interval(secs => g)
from generate_series(1, 5000) g
on conflict (id) do nothing;

insert into public.shared_memory_rooms (id, restaurant_name, area, created_by, created_at, updated_at)
values ('00000000-0000-4000-8000-000000005201', 'Phase 5 Memory', 'Performance Area', 'phase5_viewer',
  timestamptz '2026-07-01 00:00:00+00', timestamptz '2026-07-04 00:00:00+00')
on conflict (id) do update set updated_at = excluded.updated_at;
insert into public.shared_memory_members (room_id, user_name)
values
  ('00000000-0000-4000-8000-000000005201', 'phase5_viewer'),
  ('00000000-0000-4000-8000-000000005201', 'phase5_author')
on conflict do nothing;
insert into public.shared_memory_messages (id, room_id, author_name, body, created_at)
select (
    substr(md5('phase5-message-' || g), 1, 8) || '-' || substr(md5('phase5-message-' || g), 9, 4) || '-4' ||
    substr(md5('phase5-message-' || g), 14, 3) || '-8' || substr(md5('phase5-message-' || g), 18, 3) || '-' ||
    substr(md5('phase5-message-' || g), 21, 12)
  )::uuid,
  '00000000-0000-4000-8000-000000005201', case when g % 2 = 0 then 'phase5_viewer' else 'phase5_author' end,
  'deterministic bounded message ' || g, timestamptz '2026-07-04 00:00:00+00' + make_interval(secs => g)
from generate_series(1, 5000) g
on conflict (id) do nothing;

analyze public.reviews;
analyze public.comments;
analyze public.notifications;
analyze public.shared_memory_messages;

\echo PHASE5_PLAN_CIRCLE_BEGIN
explain (analyze, buffers, format json)
select r.id, r.created_at from public.reviews r
join public.profiles author on author.username = r.reviewer_name
where r.deleted_at is null and r.hidden_at is null and r.reported_at is null and r.status = 'active'
  and coalesce(author.account_status, 'active') = 'active'
  and (
    r.visibility = 'public'
    or r.reviewer_name = 'phase5_viewer'
    or (r.visibility = 'circle' and exists (
      select 1 from public.circle_memberships membership
      where membership.member_name = 'phase5_viewer' and membership.user_name = r.reviewer_name
    ))
  )
  and not exists (
    select 1 from public.blocked_users block
    where (block.blocker_name = 'phase5_viewer' and block.blocked_name = r.reviewer_name)
       or (block.blocked_name = 'phase5_viewer' and block.blocker_name = r.reviewer_name)
  )
order by r.created_at desc, r.id desc limit 11;
\echo PHASE5_PLAN_CIRCLE_END
select 'PHASE5_CIRCLE_ROWS=' || jsonb_array_length(public.circle_feed_page_v2(
  '00000000-0000-4000-8000-000000005101', null, null, 10, '{}'::uuid[]
)->'reviews');
select 'PHASE5_CIRCLE_PAYLOAD_BYTES=' || pg_column_size(public.circle_feed_page_v2(
  '00000000-0000-4000-8000-000000005101', null, null, 10, '{}'::uuid[]
));
select 'PHASE5_HOME_MEDIA_ROWS=' || count(distinct asset_id) from private.authorized_home_media_derivatives_v1(
  '00000000-0000-4000-8000-000000005101',
  (select array_agg(asset_id) from phase5_home_media),
  array['feed', 'canonical', 'poster']::text[]
);
select 'PHASE5_HOME_MEDIA_PAYLOAD_BYTES=' || pg_column_size(jsonb_agg(to_jsonb(media)))
from private.authorized_home_media_derivatives_v1(
  '00000000-0000-4000-8000-000000005101',
  (select array_agg(asset_id) from phase5_home_media),
  array['feed', 'canonical', 'poster']::text[]
) media;

\echo PHASE5_PLAN_PUBLIC_BEGIN
explain (analyze, buffers, format json)
select id, created_at from public.reviews
where visibility = 'public' and deleted_at is null and hidden_at is null and reported_at is null and status = 'active'
order by created_at desc, id desc limit 24;
\echo PHASE5_PLAN_PUBLIC_END

\echo PHASE5_PLAN_COMMENTS_BEGIN
explain (analyze, buffers, format json)
select id, created_at from public.comments
where post_id = (select id from phase5_posts order by created_at desc, id desc limit 1)
order by created_at desc, id desc limit 30;
\echo PHASE5_PLAN_COMMENTS_END

\echo PHASE5_PLAN_NOTIFICATIONS_BEGIN
explain (analyze, buffers, format json)
select id, created_at from public.notifications
where recipient_user_id = '00000000-0000-4000-8000-000000005101' and deleted_at is null
order by created_at desc, id desc limit 30;
\echo PHASE5_PLAN_NOTIFICATIONS_END

\echo PHASE5_PLAN_CHAT_BEGIN
explain (analyze, buffers, format json)
select id, created_at from public.shared_memory_messages
where room_id = '00000000-0000-4000-8000-000000005201'
order by created_at desc, id desc limit 30;
\echo PHASE5_PLAN_CHAT_END

create temporary table phase5_page_one as
select id, created_at from public.reviews
where reviewer_name = 'phase5_author' and visibility = 'public' and deleted_at is null and hidden_at is null
order by created_at desc, id desc limit 24;
insert into public.reviews (id, reviewer_name, restaurant_name, items, body, visibility, status, created_at)
values ('00000000-0000-4000-8000-000000005301', 'phase5_author', 'Concurrent Place', '[]', 'concurrent insertion', 'public', 'active', '2026-07-12 00:00:00+00');
create temporary table phase5_page_two as
select id, created_at from public.reviews
where reviewer_name = 'phase5_author' and visibility = 'public' and deleted_at is null and hidden_at is null
  and (created_at, id) < (select created_at, id from phase5_page_one order by created_at asc, id asc limit 1)
order by created_at desc, id desc limit 24;
select 'PHASE5_CURSOR_OVERLAP=' || count(*) from phase5_page_one join phase5_page_two using (id);
select 'PHASE5_CURSOR_PAGE_TWO=' || count(*) from phase5_page_two;
select 'PHASE5_PAYLOAD_BYTES=' || pg_column_size(public.mobile_public_feed_page_v1('public', null, null, null, 24, null, null, null, null, null, null, null));

rollback;
