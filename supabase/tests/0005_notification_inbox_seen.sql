begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'notification_inbox_state', 'notification inbox state table exists');
select col_type_is('public', 'notification_inbox_state', 'user_id', 'uuid', 'inbox owner is UUID-backed');
select col_type_is('public', 'notification_inbox_state', 'last_seen_at', 'timestamp with time zone', 'seen marker is server time');
select ok(
  (select relation.relrowsecurity
   from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relname = 'notification_inbox_state'),
  'notification inbox state has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.notification_inbox_state', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_inbox_state', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_inbox_state', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notification_inbox_state', 'UPDATE'),
  'raw notification inbox state is not client-readable or writable'
);
select has_function('public', 'notification_inbox_has_unseen', array[]::text[], 'owner-derived unseen lookup exists');
select has_function('public', 'notification_inbox_mark_seen', array[]::text[], 'owner-derived seen mutation exists');
select ok(
  (select routine.prosecdef and routine.proconfig @> array['search_path=""']::text[]
   from pg_proc routine
   where routine.oid = 'public.notification_inbox_has_unseen()'::regprocedure),
  'unseen lookup is a safe-search-path definer'
);
select ok(
  (select routine.prosecdef and routine.proconfig @> array['search_path=""']::text[]
   from pg_proc routine
   where routine.oid = 'public.notification_inbox_mark_seen()'::regprocedure),
  'seen mutation is a safe-search-path definer'
);
select ok(
  has_function_privilege('authenticated', 'public.notification_inbox_has_unseen()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.notification_inbox_mark_seen()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.notification_inbox_has_unseen()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.notification_inbox_mark_seen()', 'EXECUTE'),
  'only authenticated clients can execute notification inbox RPCs'
);
select has_index(
  'public', 'notifications', 'notifications_unseen_recipient_user_created_idx',
  'UUID recipient unseen lookup has a created-at partial index'
);
select has_index(
  'public', 'notifications', 'notifications_unseen_recipient_name_created_idx',
  'legacy-name recipient unseen lookup has a created-at partial index'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000007101', 'authenticated', 'authenticated', 'inbox-viewer@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000007102', 'authenticated', 'authenticated', 'inbox-other@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.profiles (id, first_name, last_name, username, account_type, account_status)
values
  ('00000000-0000-4000-8000-000000007101', 'Inbox', 'Viewer', 'inbox_viewer', 'public', 'active'),
  ('00000000-0000-4000-8000-000000007102', 'Inbox', 'Other', 'inbox_other', 'public', 'active');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007101', true);

select is(public.notification_inbox_has_unseen(), false, 'an empty inbox has no unseen notification');

insert into public.notifications (recipient_user_id, recipient_name, type, is_read, read, created_at)
values ('00000000-0000-4000-8000-000000007101', 'inbox_viewer', 'POST_LIKED', false, false, clock_timestamp());

select is(public.notification_inbox_has_unseen(), true, 'a new unread notification sets unseen state');
select ok(public.notification_inbox_mark_seen() is not null, 'opening the inbox records a server timestamp');
select is(public.notification_inbox_has_unseen(), false, 'opening the inbox clears unseen state');
select ok(
  (select not is_read and not read from public.notifications where recipient_name = 'inbox_viewer' order by created_at desc limit 1),
  'opening the inbox does not mark notification rows read'
);

insert into public.notifications (recipient_user_id, recipient_name, type, is_read, read, created_at)
values ('00000000-0000-4000-8000-000000007101', 'inbox_viewer', 'POST_COMMENTED', false, false, now() - interval '1 day');

select is(public.notification_inbox_has_unseen(), false, 'older unread rows stay seen after opening the inbox');

insert into public.notifications (recipient_user_id, recipient_name, type, is_read, read, created_at)
values ('00000000-0000-4000-8000-000000007101', 'inbox_viewer', 'CIRCLE_REQUEST_RECEIVED', false, false, clock_timestamp() + interval '1 second');

select is(public.notification_inbox_has_unseen(), true, 'a notification newer than the seen marker restores the badge');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000007102', true);
select is(public.notification_inbox_has_unseen(), false, 'unseen state is isolated to the authenticated owner');

select * from finish();
rollback;
