-- Atomically persist Table Memory notification intent with committed room
-- activity. Push delivery remains asynchronous in push_delivery_jobs.

alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications drop constraint if exists notifications_dedupe_key_check;
alter table public.notifications add constraint notifications_dedupe_key_check
  check (dedupe_key is null or dedupe_key ~ '^[a-f0-9]{64}$');
create unique index if not exists notifications_dedupe_key_unique_idx
  on public.notifications(dedupe_key) where dedupe_key is not null;

create or replace function public.enqueue_table_memory_activity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_id uuid;
  v_actor_name text;
  v_actor_user_id uuid;
  v_created_at timestamptz;
  v_kind text;
  v_message text;
  v_notification_id uuid;
  v_notification_key text;
  v_room_id uuid;
  v_recipient record;
begin
  if tg_table_name = 'shared_memory_messages' then
    if tg_op <> 'INSERT' then return new; end if;
    v_activity_id := new.id;
    v_actor_name := new.author_name;
    v_created_at := new.created_at;
    v_kind := 'message';
    v_message := 'You have a new Table Memory message.';
    v_room_id := new.room_id;
  elsif tg_table_name = 'shared_memory_dishes' then
    if tg_op <> 'INSERT' then return new; end if;
    v_activity_id := new.id;
    v_actor_name := new.added_by;
    v_created_at := new.created_at;
    v_kind := 'dish';
    v_message := 'A dish was added to your Table Memory.';
    v_room_id := new.room_id;
  elsif tg_table_name = 'shared_memory_photos' then
    if tg_op = 'UPDATE' and (
      coalesce(old.moderation_status, 'pending') = 'approved'
      or coalesce(new.moderation_status, 'pending') <> 'approved'
    ) then return new; end if;
    if tg_op = 'INSERT' and coalesce(new.moderation_status, 'approved') <> 'approved' then return new; end if;
    v_activity_id := new.id;
    v_actor_name := new.uploader_name;
    v_created_at := new.created_at;
    v_kind := 'media';
    v_message := 'Media was added to your Table Memory.';
    v_room_id := new.room_id;
  else
    return new;
  end if;

  select profile.id into v_actor_user_id
  from public.profiles profile
  where profile.username = v_actor_name
  limit 1;

  for v_recipient in
    select profile.id as user_id, member.user_name
    from public.shared_memory_members member
    join public.profiles profile on profile.username = member.user_name
    where member.room_id = v_room_id
      and member.user_name <> v_actor_name
      and not public.shared_memory_room_has_blocked_relationship(v_room_id, member.user_name)
  loop
    v_notification_key := encode(extensions.digest(
      convert_to('table-memory:' || v_kind || ':' || v_activity_id::text || ':' || v_recipient.user_id::text, 'UTF8'),
      'sha256'
    ), 'hex');

    insert into public.notifications (
      actor_name,
      actor_user_id,
      created_at,
      dedupe_key,
      entity_id,
      entity_type,
      is_read,
      message,
      metadata,
      read,
      recipient_name,
      recipient_user_id,
      title,
      type,
      updated_at
    ) values (
      v_actor_name,
      v_actor_user_id,
      v_created_at,
      v_notification_key,
      v_room_id::text,
      'TABLE_MEMORY',
      false,
      v_message,
      jsonb_build_object('activityId', v_activity_id::text, 'kind', v_kind),
      false,
      v_recipient.user_name,
      v_recipient.user_id,
      'Table Memory',
      'TABLE_MEMORY_ACTIVITY',
      v_created_at
    )
    on conflict (dedupe_key) where dedupe_key is not null do update
      set dedupe_key = excluded.dedupe_key
    returning id into v_notification_id;

    -- Product contract: chat creates one OS push. Media and dish activity use
    -- durable in-app per-tab unread state without generating noisy pushes.
    if v_kind = 'message' and coalesce((
      select setting.push_enabled and setting.memory_activity
      from public.notification_settings setting
      where setting.user_name = v_recipient.user_name
    ), true) then
      insert into public.push_delivery_jobs (
        correlation_id,
        dedupe_key,
        notification_id,
        notification_type,
        push_token_id,
        status,
        user_id
      )
      select
        v_activity_id::text,
        encode(extensions.digest(
          convert_to(v_notification_id::text || chr(0) || token.id::text, 'UTF8'),
          'sha256'
        ), 'hex'),
        v_notification_id,
        'TABLE_MEMORY_ACTIVITY',
        token.id,
        'queued',
        v_recipient.user_id
      from public.push_tokens token
      where token.user_id = v_recipient.user_id
        and token.disabled_at is null
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.enqueue_table_memory_activity_v1() from public, anon, authenticated;

drop trigger if exists enqueue_table_memory_message_activity on public.shared_memory_messages;
create trigger enqueue_table_memory_message_activity
after insert on public.shared_memory_messages
for each row execute function public.enqueue_table_memory_activity_v1();

drop trigger if exists enqueue_table_memory_dish_activity on public.shared_memory_dishes;
create trigger enqueue_table_memory_dish_activity
after insert on public.shared_memory_dishes
for each row execute function public.enqueue_table_memory_activity_v1();

drop trigger if exists enqueue_table_memory_media_activity on public.shared_memory_photos;
create trigger enqueue_table_memory_media_activity
after insert or update of moderation_status on public.shared_memory_photos
for each row execute function public.enqueue_table_memory_activity_v1();

comment on function public.enqueue_table_memory_activity_v1() is
  'Atomic Table Memory in-app notification and chat push-job outbox with stable per-recipient deduplication.';
