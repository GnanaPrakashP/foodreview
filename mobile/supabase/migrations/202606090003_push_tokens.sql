-- Store Expo push tokens so backend jobs can notify users about Table Memory activity.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  expo_push_token text not null unique,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform_check check (platform in ('ios', 'android', 'web'))
);

create index if not exists push_tokens_user_name_idx
  on public.push_tokens(user_name);

alter table public.push_tokens enable row level security;

drop policy if exists "Users can read own push tokens" on public.push_tokens;
create policy "Users can read own push tokens"
  on public.push_tokens for select to authenticated
  using (user_name = public.current_profile_name());

drop policy if exists "Users can create own push tokens" on public.push_tokens;
create policy "Users can create own push tokens"
  on public.push_tokens for insert to authenticated
  with check (user_name = public.current_profile_name());

drop policy if exists "Users can update own push tokens" on public.push_tokens;
create policy "Users can update own push tokens"
  on public.push_tokens for update to authenticated
  using (user_name = public.current_profile_name())
  with check (user_name = public.current_profile_name());

drop policy if exists "Users can delete own push tokens" on public.push_tokens;
create policy "Users can delete own push tokens"
  on public.push_tokens for delete to authenticated
  using (user_name = public.current_profile_name());
