begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select col_type_is('public', 'reviews', 'updated_at', 'timestamp with time zone', 'reviews expose a visible-content revision');
select col_not_null('public', 'reviews', 'updated_at', 'review visible-content revision is required');
select has_trigger('public', 'reviews', 'touch_review_visible_content_updated_at_trigger', 'review updates advance the visible-content revision');
select has_trigger('public', 'review_photos', 'touch_review_from_media_link_change_trigger', 'review media-link changes advance the parent revision');
select function_returns('public', 'touch_review_visible_content_updated_at', array[]::text[], 'trigger', 'review revision trigger function returns trigger');
select function_returns('public', 'touch_review_from_media_link_change', array[]::text[], 'trigger', 'media-link revision trigger function returns trigger');
select ok(
  (select 'search_path=""' = any(proconfig)
   from pg_catalog.pg_proc
   where oid = 'public.touch_review_visible_content_updated_at()'::regprocedure),
  'review revision trigger has an empty search path'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000007201',
  'authenticated', 'authenticated', 'refresh-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.profiles (id, first_name, last_name, username, account_type, account_status)
values ('00000000-0000-4000-8000-000000007201', 'Refresh', 'Owner', 'refresh_owner', 'public', 'active');

insert into public.reviews (
  id, reviewer_name, restaurant_name, items, visibility, status, requires_ready_media
)
values (
  '00000000-0000-4000-8000-000000007211', 'refresh_owner', 'Revision Kitchen',
  '[{"name":"Dosa","rating":4}]'::jsonb, 'public', 'draft', false
);

create temporary table review_revision_snapshot as
select updated_at from public.reviews where id = '00000000-0000-4000-8000-000000007211';

select pg_sleep(0.001);
update public.reviews set body = 'changed copy' where id = '00000000-0000-4000-8000-000000007211';
select ok(
  (select review.updated_at > snapshot.updated_at
   from public.reviews review cross join review_revision_snapshot snapshot
   where review.id = '00000000-0000-4000-8000-000000007211'),
  'updating review metadata advances the visible-content revision'
);

truncate review_revision_snapshot;
insert into review_revision_snapshot
select updated_at from public.reviews where id = '00000000-0000-4000-8000-000000007211';
select pg_sleep(0.001);
insert into public.review_photos (review_id, storage_path, public_url, media_type, position)
values (
  '00000000-0000-4000-8000-000000007211', 'legacy/refresh-owner/cover.jpg',
  'https://images.example.test/cover.jpg', 'image', 0
);
select ok(
  (select review.updated_at > snapshot.updated_at
   from public.reviews review cross join review_revision_snapshot snapshot
   where review.id = '00000000-0000-4000-8000-000000007211'),
  'adding ordered media advances the parent review revision'
);

truncate review_revision_snapshot;
insert into review_revision_snapshot
select updated_at from public.reviews where id = '00000000-0000-4000-8000-000000007211';
select pg_sleep(0.001);
delete from public.review_photos where review_id = '00000000-0000-4000-8000-000000007211';
select ok(
  (select review.updated_at > snapshot.updated_at
   from public.reviews review cross join review_revision_snapshot snapshot
   where review.id = '00000000-0000-4000-8000-000000007211'),
  'removing ordered media advances the parent review revision'
);

select * from finish();
rollback;
