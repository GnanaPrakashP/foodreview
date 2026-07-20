-- Keep notification inbox visibility separate from per-row read state.
-- Clients can only access this owner-derived state through the two bounded RPCs.

create table if not exists public.notification_inbox_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.notification_inbox_state enable row level security;

revoke all on table public.notification_inbox_state from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_inbox_state to service_role;

create or replace function public.notification_inbox_has_unseen()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text;
  v_last_seen_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select profile.username
  into v_username
  from public.profiles profile
  where profile.id = v_user_id
    and coalesce(profile.account_status, 'active') = 'active'
    and profile.deletion_started_at is null;

  if v_username is null then
    raise exception 'active_profile_required' using errcode = '42501';
  end if;

  select state.last_seen_at
  into v_last_seen_at
  from public.notification_inbox_state state
  where state.user_id = v_user_id;

  return exists (
    select 1
    from public.notifications notification
    where notification.deleted_at is null
      and notification.is_read = false
      and notification.read = false
      and notification.created_at > coalesce(v_last_seen_at, '-infinity'::timestamptz)
      and (
        notification.recipient_user_id = v_user_id
        or notification.recipient_name = v_username
      )
  );
end;
$$;

create or replace function public.notification_inbox_mark_seen()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_seen_at timestamptz := clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_user_id
      and coalesce(profile.account_status, 'active') = 'active'
      and profile.deletion_started_at is null
  ) then
    raise exception 'active_profile_required' using errcode = '42501';
  end if;

  insert into public.notification_inbox_state as state (user_id, last_seen_at, updated_at)
  values (v_user_id, v_seen_at, v_seen_at)
  on conflict (user_id) do update
  set last_seen_at = greatest(state.last_seen_at, excluded.last_seen_at),
      updated_at = greatest(state.updated_at, excluded.updated_at)
  returning last_seen_at into v_seen_at;

  return v_seen_at;
end;
$$;

revoke all on function public.notification_inbox_has_unseen() from public, anon;
revoke all on function public.notification_inbox_mark_seen() from public, anon;
grant execute on function public.notification_inbox_has_unseen() to authenticated, service_role;
grant execute on function public.notification_inbox_mark_seen() to authenticated, service_role;

comment on table public.notification_inbox_state is
  'Owner-scoped timestamp for notification badge visibility; per-row read state remains on notifications.';
comment on function public.notification_inbox_has_unseen() is
  'Returns whether the authenticated active profile has a newer unread notification than its inbox-seen timestamp.';
comment on function public.notification_inbox_mark_seen() is
  'Monotonically records that the authenticated active profile opened its notification inbox.';
