create table if not exists public.stories (
  id            uuid        primary key default gen_random_uuid(),
  author_name   text        not null,
  media_url     text        not null,
  storage_path  text,
  caption       text,
  visibility    text        not null default 'circle',
  status        text        not null default 'active',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  deleted_at    timestamptz,
  hidden_at     timestamptz,
  reported_at   timestamptz
);

alter table public.stories add column if not exists storage_path text;
alter table public.stories add column if not exists caption text;
alter table public.stories add column if not exists visibility text not null default 'circle';
alter table public.stories add column if not exists status text not null default 'active';
alter table public.stories add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');
alter table public.stories add column if not exists deleted_at timestamptz;
alter table public.stories add column if not exists hidden_at timestamptz;
alter table public.stories add column if not exists reported_at timestamptz;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_visibility_check'
  ) then
    alter table public.stories
      add constraint stories_visibility_check
      check (visibility in ('public', 'circle'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stories'::regclass
      and conname = 'stories_status_check'
  ) then
    alter table public.stories
      add constraint stories_status_check
      check (status in ('active', 'deleted', 'hidden', 'reported', 'removed'));
  end if;
end $$;

create index if not exists stories_active_feed_idx
  on public.stories(author_name, expires_at desc, created_at desc)
  where deleted_at is null
    and hidden_at is null
    and reported_at is null
    and status = 'active';
create index if not exists stories_expires_at_idx on public.stories(expires_at);

create or replace function public.can_read_story_row(
  story_owner_name text,
  story_visibility text,
  story_expires_at timestamptz,
  story_deleted_at timestamptz,
  story_hidden_at timestamptz,
  story_reported_at timestamptz,
  story_status text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select public.current_profile_name() as name
  )
  select story_expires_at > now()
    and story_deleted_at is null
    and story_hidden_at is null
    and story_reported_at is null
    and coalesce(story_status, 'active') not in ('deleted', 'hidden', 'reported', 'removed')
    and (
      coalesce(story_visibility, 'circle') = 'public'
      or exists (
        select 1
        from viewer v
        where v.name is not null
          and v.name = story_owner_name
      )
      or (
        coalesce(story_visibility, 'circle') = 'circle'
        and exists (
          select 1
          from viewer v
          where v.name is not null
            and exists (
              select 1
              from public.circle_memberships cm
              where cm.user_name = story_owner_name
                and cm.member_name = v.name
            )
        )
      )
    )
$$;

grant execute on function public.can_read_story_row(text, text, timestamptz, timestamptz, timestamptz, timestamptz, text) to anon, authenticated;

alter table public.stories enable row level security;

drop policy if exists "Stories readable by visibility" on public.stories;
create policy "Stories readable by visibility"
  on public.stories for select to anon, authenticated
  using (
    public.can_read_story_row(
      author_name,
      visibility,
      expires_at,
      deleted_at,
      hidden_at,
      reported_at,
      status
    )
  );

drop policy if exists "Authenticated users can insert own stories" on public.stories;
create policy "Authenticated users can insert own stories"
  on public.stories for insert to authenticated
  with check (author_name = public.current_profile_name());

drop policy if exists "Users can update own stories" on public.stories;
create policy "Users can update own stories"
  on public.stories for update to authenticated
  using (author_name = public.current_profile_name())
  with check (author_name = public.current_profile_name());

drop policy if exists "Users can delete own stories" on public.stories;
create policy "Users can delete own stories"
  on public.stories for delete to authenticated
  using (author_name = public.current_profile_name());
