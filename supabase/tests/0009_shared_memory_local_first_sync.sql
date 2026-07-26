begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_column(
  'public', 'shared_memory_messages', 'client_id',
  'messages retain the stable client id used for exactly-once recovery'
);
select has_index(
  'public', 'shared_memory_messages', 'shared_memory_messages_author_client_id_uidx',
  'message client ids are unique for one author in one room'
);
select has_table(
  'public', 'shared_memory_chat_changes',
  'the chat change ledger exists'
);
select ok(
  (select relation.relrowsecurity
   from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relname = 'shared_memory_chat_changes'),
  'the chat change ledger has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.shared_memory_chat_changes', 'SELECT')
  and not has_table_privilege('authenticated', 'public.shared_memory_chat_changes', 'SELECT')
  and not has_table_privilege('authenticated', 'public.shared_memory_chat_changes', 'INSERT'),
  'raw chat changes are service-only'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shared_memory_chat_changes'
      and column_name in ('body', 'public_url', 'storage_path')
  ),
  'the change ledger contains no message body or private media location'
);
select has_function(
  'public', 'shared_memory_room_sync_v1',
  array['uuid', 'bigint', 'integer'],
  'the bounded room delta function exists'
);
select ok(
  (select routine.prosecdef and routine.proconfig @> array['search_path=public']::text[]
   from pg_proc routine
   where routine.oid = 'public.shared_memory_room_sync_v1(uuid,bigint,integer)'::regprocedure),
  'the room delta is a safe-search-path definer'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.shared_memory_room_sync_v1(uuid,bigint,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.shared_memory_room_sync_v1(uuid,bigint,integer)',
    'EXECUTE'
  ),
  'only authenticated and service roles can execute the room delta'
);
select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_memory_stops'
  ),
  'memory stops are published to Realtime'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000009101', 'authenticated', 'authenticated', 'memory-sync-member@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000009102', 'authenticated', 'authenticated', 'memory-sync-outsider@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.profiles (id, first_name, last_name, username, account_type, account_status)
values
  ('00000000-0000-4000-8000-000000009101', 'Memory', 'Member', 'memory_sync_member', 'public', 'active'),
  ('00000000-0000-4000-8000-000000009102', 'Memory', 'Outsider', 'memory_sync_outside', 'public', 'active');

insert into public.shared_memory_rooms (
  id, restaurant_name, created_by, status
)
values (
  '00000000-0000-4000-8000-000000009111',
  'Local-first test room',
  'memory_sync_member',
  'draft'
);

insert into public.shared_memory_members (id, room_id, user_name, role)
values (
  '00000000-0000-4000-8000-000000009112',
  '00000000-0000-4000-8000-000000009111',
  'memory_sync_member',
  'owner'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009101', true);

select is(
  public.shared_memory_room_bootstrap_v1(
    '00000000-0000-4000-8000-000000009111',
    50
  )->>'syncCursor',
  '0',
  'a cold bootstrap starts at cursor zero when the room has no changes'
);

insert into public.shared_memory_messages (
  id, room_id, author_name, body, client_id
)
values (
  '00000000-0000-4000-8000-000000009121',
  '00000000-0000-4000-8000-000000009111',
  'memory_sync_member',
  'first local-first message',
  'memory-sync-client-0001'
);

create temporary table memory_sync_test_cursor(cursor bigint) on commit drop;
insert into memory_sync_test_cursor(cursor)
select max(id)
from public.shared_memory_chat_changes
where room_id = '00000000-0000-4000-8000-000000009111';

select is(
  (select count(*)::integer
   from public.shared_memory_chat_changes
   where room_id = '00000000-0000-4000-8000-000000009111'),
  1,
  'a message insert appends one identifier-only change'
);
select ok(
  jsonb_array_length(
    public.shared_memory_room_sync_v1(
      '00000000-0000-4000-8000-000000009111',
      0,
      200
    ) #> '{changes,messages}'
  ) = 1
  and (
    public.shared_memory_room_sync_v1(
      '00000000-0000-4000-8000-000000009111',
      0,
      200
    )->>'syncCursor'
  )::bigint > 0,
  'the member delta returns only the changed message and advances its cursor'
);

insert into public.shared_memory_messages (
  id, room_id, author_name, body, client_id
)
values (
  '00000000-0000-4000-8000-000000009122',
  '00000000-0000-4000-8000-000000009111',
  'memory_sync_member',
  'duplicate should not insert',
  'memory-sync-client-0001'
)
on conflict do nothing;

select is(
  (select count(*)::integer
   from public.shared_memory_messages
   where room_id = '00000000-0000-4000-8000-000000009111'
     and author_name = 'memory_sync_member'
     and client_id = 'memory-sync-client-0001'),
  1,
  'the stable client id prevents a duplicate server message'
);

update public.shared_memory_messages
set body = 'edited local-first message', edited_at = now()
where id = '00000000-0000-4000-8000-000000009121';

delete from public.shared_memory_messages
where id = '00000000-0000-4000-8000-000000009121';

select is(
  (select count(*)::integer
   from public.shared_memory_chat_changes
   where room_id = '00000000-0000-4000-8000-000000009111'),
  1,
  'repeated changes compact to the latest row for that message'
);
select ok(
  (
    public.shared_memory_room_sync_v1(
      '00000000-0000-4000-8000-000000009111',
      (select cursor from memory_sync_test_cursor),
      200
    ) #> '{changes,deletedMessageIds}'
  ) @> '["00000000-0000-4000-8000-000000009121"]'::jsonb,
  'a later delta carries the hard-delete tombstone'
);

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009102', true);
select is(
  public.shared_memory_room_sync_v1(
    '00000000-0000-4000-8000-000000009111',
    0,
    200
  ),
  null::jsonb,
  'a non-member cannot read the room delta'
);
select ok(
  position(
    'storage_path' in pg_get_functiondef(
      'public.shared_memory_room_sync_v1(uuid,bigint,integer)'::regprocedure
    )
  ) = 0,
  'the room delta DTO never selects private storage paths'
);

select * from finish();
rollback;
