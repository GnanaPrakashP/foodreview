-- Settings account management: notification preferences, blocked accounts, and a
-- transactional account-deletion RPC. Run after the existing mobile migrations.
--
-- IMPORTANT: delete_current_account() removes the row from auth.users, so this
-- migration must be applied with the postgres/admin role (e.g. the Supabase SQL
-- editor) so the SECURITY DEFINER function owner can write to the auth schema.

-- ---------------------------------------------------------------------------
-- Notification preferences (one row per profile, keyed by username).
-- ---------------------------------------------------------------------------
create table if not exists public.notification_settings (
  user_name        text        primary key,
  push_enabled     boolean     not null default true,
  memory_activity  boolean     not null default true,
  circle_activity  boolean     not null default true,
  post_engagement  boolean     not null default true,
  updated_at       timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

drop policy if exists "Users can read own notification settings" on public.notification_settings;
create policy "Users can read own notification settings"
  on public.notification_settings for select to authenticated
  using (user_name = public.current_profile_name());

drop policy if exists "Users can upsert own notification settings" on public.notification_settings;
create policy "Users can upsert own notification settings"
  on public.notification_settings for insert to authenticated
  with check (user_name = public.current_profile_name());

drop policy if exists "Users can update own notification settings" on public.notification_settings;
create policy "Users can update own notification settings"
  on public.notification_settings for update to authenticated
  using (user_name = public.current_profile_name())
  with check (user_name = public.current_profile_name());

-- ---------------------------------------------------------------------------
-- Blocked accounts (blocker_name has blocked blocked_name).
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_users (
  id            uuid        primary key default gen_random_uuid(),
  blocker_name  text        not null,
  blocked_name  text        not null,
  created_at    timestamptz not null default now(),
  unique (blocker_name, blocked_name),
  check (blocker_name <> blocked_name)
);

create index if not exists blocked_users_blocker_idx
  on public.blocked_users(blocker_name, created_at desc);
create index if not exists blocked_users_blocked_idx
  on public.blocked_users(blocked_name);

alter table public.blocked_users enable row level security;

drop policy if exists "Users can read own block list" on public.blocked_users;
create policy "Users can read own block list"
  on public.blocked_users for select to authenticated
  using (blocker_name = public.current_profile_name());

drop policy if exists "Users can block others" on public.blocked_users;
create policy "Users can block others"
  on public.blocked_users for insert to authenticated
  with check (blocker_name = public.current_profile_name() and blocked_name <> public.current_profile_name());

drop policy if exists "Users can unblock others" on public.blocked_users;
create policy "Users can unblock others"
  on public.blocked_users for delete to authenticated
  using (blocker_name = public.current_profile_name());

-- ---------------------------------------------------------------------------
-- Preference check used by notification senders. SECURITY DEFINER so a sender
-- acting as the actor can read the *recipient's* preference without exposing the
-- row (RLS only lets users read their own settings). Returns a boolean and
-- defaults to true when no row exists or the category is unknown.
-- ---------------------------------------------------------------------------
create or replace function public.notification_category_enabled(p_user_name text, p_category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case p_category
        when 'push'            then s.push_enabled
        when 'memory_push'     then s.push_enabled and s.memory_activity
        when 'memory_activity' then s.memory_activity
        when 'circle_activity' then s.circle_activity
        when 'post_engagement' then s.post_engagement
        else true
      end
      from public.notification_settings s
      where s.user_name = p_user_name
    ),
    true
  );
$$;

grant execute on function public.notification_category_enabled(text, text) to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Transactional account deletion. Removes every row keyed on the caller's
-- username, then the profile, then the auth user. Username-keyed deletes are
-- guarded against missing tables/columns so the function stays resilient as the
-- schema evolves; user_id-keyed tables cascade from the auth.users delete.
-- ---------------------------------------------------------------------------
create or replace function public.delete_current_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_pair record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select username into v_username from public.profiles where id = v_uid;

  if v_username is not null then
    for v_pair in
      select * from (values
        ('reviews', 'reviewer_name'),
        ('comments', 'user_name'),
        ('likes', 'user_name'),
        ('wishlist', 'user_name'),
        ('circle_memberships', 'user_name'),
        ('circle_memberships', 'member_name'),
        ('circle_requests', 'sender_name'),
        ('circle_requests', 'receiver_name'),
        ('push_tokens', 'user_name'),
        ('notifications', 'recipient_name'),
        ('notifications', 'actor_name'),
        ('shared_memory_rooms', 'created_by'),
        ('shared_memory_members', 'user_name'),
        ('shared_memory_messages', 'author_name'),
        ('shared_memory_photos', 'uploader_name'),
        ('shared_memory_invites', 'sender_name'),
        ('shared_memory_invites', 'receiver_name'),
        ('blocked_users', 'blocker_name'),
        ('blocked_users', 'blocked_name'),
        ('notification_settings', 'user_name')
      ) as t(table_name, column_name)
    loop
      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = v_pair.table_name
          and column_name = v_pair.column_name
      ) then
        execute format('delete from public.%I where %I = $1', v_pair.table_name, v_pair.column_name)
          using v_username;
      end if;
    end loop;
  end if;

  -- Profile delete cascades user_id-keyed tables; auth delete removes the login.
  delete from public.profiles where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function public.delete_current_account() to authenticated;
