-- Stable client identity and ordering for rapid Table Memory sends.
-- This is additive: legacy rows retain null client metadata and continue to
-- sort by their authoritative created_at/id fallback.

alter table public.shared_memory_messages
  add column if not exists client_created_at timestamptz,
  add column if not exists client_sequence bigint,
  add column if not exists client_order_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shared_memory_messages'::regclass
      and conname = 'shared_memory_messages_client_sequence_check'
  ) then
    alter table public.shared_memory_messages
      add constraint shared_memory_messages_client_sequence_check
      check (
        client_sequence is null
        or client_sequence between 0 and 9007199254740991
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shared_memory_messages'::regclass
      and conname = 'shared_memory_messages_client_order_key_check'
  ) then
    alter table public.shared_memory_messages
      add constraint shared_memory_messages_client_order_key_check
      check (
        client_order_key is null
        or (
          char_length(client_order_key) between 16 and 200
          and client_order_key ~ '^[ -~]+$'
        )
      );
  end if;
end
$$;

create index if not exists shared_memory_messages_client_order_idx
  on public.shared_memory_messages(
    room_id,
    client_created_at,
    client_sequence,
    client_order_key
  )
  where client_id is not null;

-- Append client metadata to the already membership-filtered JSON returned by
-- the existing bounded RPCs. Keeping this helper non-executable by clients
-- prevents it from becoming a separate read surface.
create or replace function public.shared_memory_enrich_message_metadata_v1(
  p_payload jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
select jsonb_set(
  jsonb_set(
    coalesce(p_payload, '{}'::jsonb),
    '{messages}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object(
          'client_id', message.client_id,
          'client_created_at', message.client_created_at,
          'client_sequence', message.client_sequence,
          'client_order_key', message.client_order_key
        )
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(p_payload->'messages', '[]'::jsonb))
        with ordinality item(value, ordinality)
      left join public.shared_memory_messages message
        on message.id = nullif(item.value->>'id', '')::uuid
    ), '[]'::jsonb),
    true
  ),
  '{replyMessages}',
  coalesce((
    select jsonb_agg(
      item.value || jsonb_build_object(
        'client_id', message.client_id,
        'client_created_at', message.client_created_at,
        'client_sequence', message.client_sequence,
        'client_order_key', message.client_order_key
      )
      order by item.ordinality
    )
    from jsonb_array_elements(coalesce(p_payload->'replyMessages', '[]'::jsonb))
      with ordinality item(value, ordinality)
    left join public.shared_memory_messages message
      on message.id = nullif(item.value->>'id', '')::uuid
  ), '[]'::jsonb),
  true
);
$$;

revoke all on function public.shared_memory_enrich_message_metadata_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.shared_memory_enrich_message_metadata_v1(jsonb)
  to service_role;

create or replace function public.shared_memory_chat_page_v2(
  p_room_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
select public.shared_memory_enrich_message_metadata_v1(
  public.shared_memory_chat_page(
    p_room_id,
    p_before_created_at,
    p_before_message_id,
    p_limit
  )
);
$$;

revoke all on function public.shared_memory_chat_page_v2(uuid, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.shared_memory_chat_page_v2(uuid, timestamptz, uuid, integer)
  to authenticated, service_role;

create or replace function public.shared_memory_room_bootstrap_v2(
  p_room_id uuid,
  p_message_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with payload as (
  select public.shared_memory_room_bootstrap_v1(p_room_id, p_message_limit) as value
)
select case
  when value is null then null
  else jsonb_set(
    value,
    '{chat}',
    public.shared_memory_enrich_message_metadata_v1(value->'chat'),
    true
  )
end
from payload;
$$;

revoke all on function public.shared_memory_room_bootstrap_v2(uuid, integer)
  from public, anon;
grant execute on function public.shared_memory_room_bootstrap_v2(uuid, integer)
  to authenticated, service_role;

create or replace function public.shared_memory_room_sync_v2(
  p_room_id uuid,
  p_after_cursor bigint default 0,
  p_limit integer default 200
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with payload as (
  select public.shared_memory_room_sync_v1(
    p_room_id,
    p_after_cursor,
    p_limit
  ) as value
)
select case
  when value is null then null
  else jsonb_set(
    value,
    '{changes}',
    public.shared_memory_enrich_message_metadata_v1(value->'changes'),
    true
  )
end
from payload;
$$;

revoke all on function public.shared_memory_room_sync_v2(uuid, bigint, integer)
  from public, anon;
grant execute on function public.shared_memory_room_sync_v2(uuid, bigint, integer)
  to authenticated, service_role;

create or replace function public.attach_shared_memory_media_assets_v2(
  p_room_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_body text,
  p_reply_to_message_id uuid,
  p_client_id text,
  p_client_created_at timestamptz,
  p_client_sequence bigint,
  p_client_order_key text,
  p_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id uuid;
  v_result jsonb;
  v_row public.shared_memory_messages%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_client_created_at is null
    or p_client_created_at > now() + interval '5 minutes'
    or p_client_sequence is null
    or p_client_sequence < 0
    or p_client_sequence > 9007199254740991
    or p_client_order_key is null
    or char_length(p_client_order_key) not between 16 and 200
    or p_client_order_key !~ '^[ -~]+$'
    or right(p_client_order_key, char_length(p_client_id) + 1) <> ':' || p_client_id
  then
    raise exception 'shared_memory_media_client_metadata_invalid' using errcode = '22023';
  end if;

  v_result := public.attach_shared_memory_media_assets_v1(
    p_room_id,
    p_owner_id,
    p_owner_name,
    p_body,
    p_reply_to_message_id,
    p_client_id,
    p_asset_ids
  );
  v_message_id := nullif(v_result->'message'->>'id', '')::uuid;

  select message.* into v_row
  from public.shared_memory_messages message
  where message.id = v_message_id
    and message.room_id = p_room_id
    and message.author_name = p_owner_name
  for update;

  if v_row.id is null then
    raise exception 'shared_memory_media_message_missing' using errcode = 'P0002';
  end if;
  if (
    v_row.client_created_at is not null
    and (
      v_row.client_created_at is distinct from p_client_created_at
      or v_row.client_sequence is distinct from p_client_sequence
      or v_row.client_order_key is distinct from p_client_order_key
    )
  ) then
    raise exception 'shared_memory_media_idempotency_mismatch' using errcode = '23505';
  end if;

  update public.shared_memory_messages
  set
    client_created_at = p_client_created_at,
    client_sequence = p_client_sequence,
    client_order_key = p_client_order_key
  where id = v_message_id
  returning * into v_row;

  return jsonb_set(v_result, '{message}', to_jsonb(v_row), true);
end;
$$;

revoke all on function public.attach_shared_memory_media_assets_v2(
  uuid, uuid, text, text, uuid, text, timestamptz, bigint, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.attach_shared_memory_media_assets_v2(
  uuid, uuid, text, text, uuid, text, timestamptz, bigint, text, uuid[]
) to service_role;

comment on function public.attach_shared_memory_media_assets_v2(
  uuid, uuid, text, text, uuid, text, timestamptz, bigint, text, uuid[]
) is 'Atomically attaches private room media and persists stable client message identity/order metadata.';
