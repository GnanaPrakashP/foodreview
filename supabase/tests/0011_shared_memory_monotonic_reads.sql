begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function(
  'public',
  'mark_shared_memory_read_v1',
  array['uuid', 'timestamp with time zone'],
  'the visibility-driven monotonic Memory read RPC exists'
);

select ok(
  (
    select routine.prosecdef
      and routine.proconfig @> array['search_path=public']::text[]
    from pg_proc routine
    where routine.oid =
      'public.mark_shared_memory_read_v1(uuid,timestamp with time zone)'::regprocedure
  ),
  'the Memory read RPC is a safe-search-path security definer'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.mark_shared_memory_read_v1(uuid,timestamp with time zone)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.mark_shared_memory_read_v1(uuid,timestamp with time zone)',
    'execute'
  ),
  'authenticated actors can acknowledge reads while anonymous actors cannot'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000009291',
  'authenticated',
  'authenticated',
  'memory-monotonic-member@example.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

insert into public.profiles (
  id, first_name, last_name, username, account_type, account_status
)
values (
  '00000000-0000-4000-8000-000000009291',
  'Memory',
  'Reader',
  'mem_read_9291',
  'public',
  'active'
);

insert into public.shared_memory_rooms (
  id, restaurant_name, created_by, status
)
values (
  '00000000-0000-4000-8000-000000009292',
  'Monotonic read test room',
  'mem_read_9291',
  'draft'
);

insert into public.shared_memory_members (id, room_id, user_name, role)
values (
  '00000000-0000-4000-8000-000000009293',
  '00000000-0000-4000-8000-000000009292',
  'mem_read_9291',
  'owner'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000009291',
  true
);

select is(
  public.mark_shared_memory_read_v1(
    '00000000-0000-4000-8000-000000009292',
    '2026-07-20 12:00:00+00'::timestamptz
  ),
  '2026-07-20 12:00:00+00'::timestamptz,
  'a room member can persist the visible read position'
);

select is(
  public.mark_shared_memory_read_v1(
    '00000000-0000-4000-8000-000000009292',
    '2026-07-19 12:00:00+00'::timestamptz
  ),
  '2026-07-20 12:00:00+00'::timestamptz,
  'an older device acknowledgement cannot move the read position backward'
);

select is(
  (
    select last_read_at
    from public.shared_memory_reads
    where room_id = '00000000-0000-4000-8000-000000009292'
      and user_name = 'mem_read_9291'
  ),
  '2026-07-20 12:00:00+00'::timestamptz,
  'the durable row retains the greatest acknowledged position'
);

create temporary table monotonic_future_result (
  acknowledged_at timestamptz not null,
  observed_at timestamptz not null
) on commit drop;

insert into monotonic_future_result (acknowledged_at, observed_at)
values (
  public.mark_shared_memory_read_v1(
    '00000000-0000-4000-8000-000000009292',
    now() + interval '1 day'
  ),
  clock_timestamp()
);

select ok(
  (
    select acknowledged_at <= observed_at
    from monotonic_future_result
  ),
  'a client cannot advance the durable read position into the future'
);

select is(
  (
    select last_read_at
    from public.shared_memory_reads
    where room_id = '00000000-0000-4000-8000-000000009292'
      and user_name = 'mem_read_9291'
  ),
  (select acknowledged_at from monotonic_future_result),
  'the server-returned clamped position matches durable state'
);

select * from finish();
rollback;
