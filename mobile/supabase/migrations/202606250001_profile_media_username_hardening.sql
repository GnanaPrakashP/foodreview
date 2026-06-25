-- Profile production hardening: review media upload intents, aggregate profile
-- stats, atomic username changes, and storage cleanup helpers.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Review/avatar media upload intents. Authenticated clients can only upload to a
-- storage path produced by trusted server code and recorded here.
-- ---------------------------------------------------------------------------
create table if not exists public.review_media_upload_intents (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users(id) on delete cascade,
  user_name             text        not null,
  category              text        not null,
  media_type            text        not null,
  mime_type             text        not null,
  extension             text        not null,
  file_size_bytes       bigint      not null,
  max_file_size_bytes   bigint      not null,
  final_bucket_id       text        not null default 'review-photos',
  quarantine_bucket_id  text        not null default 'review-media-quarantine',
  quarantine_storage_path text      not null unique,
  storage_path          text        not null unique,
  status                text        not null default 'created',
  moderation_status     text,
  moderation_reason     text,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  finalized_at          timestamptz,
  check (category in ('avatar', 'post')),
  check (media_type in ('image', 'video')),
  check (status in ('created', 'finalized', 'consumed', 'expired', 'rejected', 'abandoned')),
  check (final_bucket_id = 'review-photos'),
  check (quarantine_bucket_id = 'review-media-quarantine'),
  check (file_size_bytes > 0),
  check (max_file_size_bytes > 0),
  check (file_size_bytes <= max_file_size_bytes),
  check (storage_path = btrim(storage_path)),
  check (
    storage_path not like '/%'
    and storage_path not like '%/'
    and storage_path not like '%//%'
    and position('..' in storage_path) = 0
    and position('?' in storage_path) = 0
    and position('#' in storage_path) = 0
    and position(chr(92) in storage_path) = 0
  ),
  check (storage_path ~ '^[A-Za-z0-9._~/-]+$'),
  check (quarantine_storage_path = btrim(quarantine_storage_path)),
  check (
    quarantine_storage_path not like '/%'
    and quarantine_storage_path not like '%/'
    and quarantine_storage_path not like '%//%'
    and position('..' in quarantine_storage_path) = 0
    and position('?' in quarantine_storage_path) = 0
    and position('#' in quarantine_storage_path) = 0
    and position(chr(92) in quarantine_storage_path) = 0
  ),
  check (quarantine_storage_path ~ '^[A-Za-z0-9._~/-]+$'),
  check (quarantine_storage_path ~ ('^pending/' || user_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$')),
  check (
    (category = 'avatar' and media_type = 'image' and storage_path ~ ('^avatars/' || user_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$'))
    or
    (category = 'post' and storage_path ~ ('^posts/' || user_id::text || '/' || id::text || '/[A-Za-z0-9._~-]+$'))
  )
);

create index if not exists review_media_upload_intents_user_status_idx
  on public.review_media_upload_intents(user_id, status, expires_at desc);
create index if not exists review_media_upload_intents_storage_path_idx
  on public.review_media_upload_intents(storage_path);
create index if not exists review_media_upload_intents_quarantine_path_idx
  on public.review_media_upload_intents(quarantine_storage_path);

alter table public.review_media_upload_intents enable row level security;

drop policy if exists "Users can read own review media upload intents" on public.review_media_upload_intents;
create policy "Users can read own review media upload intents"
  on public.review_media_upload_intents for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert review media upload intents" on public.review_media_upload_intents;
drop policy if exists "Users can update review media upload intents" on public.review_media_upload_intents;
drop policy if exists "Users can delete review media upload intents" on public.review_media_upload_intents;

-- ---------------------------------------------------------------------------
-- Review photo ownership and finalized-intent enforcement for new media rows.
-- Legacy rows remain readable, but rows tied to new upload intents must match
-- the authenticated owner, review owner, generated path, and finalized status.
-- ---------------------------------------------------------------------------
alter table public.review_photos
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists upload_intent_id uuid references public.review_media_upload_intents(id) on delete restrict,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'review_photos'
      and column_name = 'size_bytes'
  ) then
    execute 'update public.review_photos set file_size_bytes = size_bytes where file_size_bytes is null and size_bytes is not null';
  end if;
end $$;

update public.review_photos photo
set owner_id = profile.id
from public.reviews review
join public.profiles profile
  on profile.username = review.reviewer_name
where photo.review_id = review.id
  and photo.owner_id is null;

create unique index if not exists review_photos_upload_intent_unique_idx
  on public.review_photos(upload_intent_id)
  where upload_intent_id is not null;
create index if not exists review_photos_owner_id_idx on public.review_photos(owner_id);
create index if not exists review_photos_storage_path_idx on public.review_photos(storage_path);

create or replace function public.review_media_path_is_owned_by(p_path text, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_owner_id is not null
    and p_path is not null
    and (
      p_path like ('posts/' || p_owner_id::text || '/%')
      or p_path like ('avatars/' || p_owner_id::text || '/%')
      or p_path like ('public/mobile/' || p_owner_id::text || '/%')
      or p_path like ('public/avatars/' || p_owner_id::text || '/%')
    )
$$;

revoke all on function public.review_media_path_is_owned_by(text, uuid) from public;
grant execute on function public.review_media_path_is_owned_by(text, uuid) to authenticated, service_role;

create or replace function public.enforce_review_photo_upload_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.review_media_upload_intents%rowtype;
  v_review_owner text;
begin
  if new.upload_intent_id is null then
    if new.owner_id is not null and not public.review_media_path_is_owned_by(new.storage_path, new.owner_id) then
      raise exception 'review_media_storage_path_owner_mismatch' using errcode = '23514';
    end if;
    return new;
  end if;

  select * into v_intent
  from public.review_media_upload_intents intent
  where intent.id = new.upload_intent_id
  for update;

  if not found then
    raise exception 'review_media_upload_intent_not_found' using errcode = '23514';
  end if;
  if v_intent.status not in ('finalized', 'consumed') then
    raise exception 'review_media_upload_intent_not_finalized' using errcode = '23514';
  end if;
  if v_intent.category <> 'post' then
    raise exception 'review_media_upload_intent_wrong_category' using errcode = '23514';
  end if;
  if new.storage_path <> v_intent.storage_path then
    raise exception 'review_media_storage_path_mismatch' using errcode = '23514';
  end if;
  if coalesce(new.owner_id, v_intent.user_id) <> v_intent.user_id then
    raise exception 'review_media_owner_mismatch' using errcode = '23514';
  end if;
  if new.media_type <> v_intent.media_type then
    raise exception 'review_media_type_mismatch' using errcode = '23514';
  end if;
  if new.mime_type is not null and new.mime_type <> v_intent.mime_type then
    raise exception 'review_media_mime_type_mismatch' using errcode = '23514';
  end if;
  if new.file_size_bytes is not null and new.file_size_bytes <> v_intent.file_size_bytes then
    raise exception 'review_media_size_mismatch' using errcode = '23514';
  end if;

  select review.reviewer_name into v_review_owner
  from public.reviews review
  where review.id = new.review_id;

  if v_review_owner is null or v_review_owner <> v_intent.user_name then
    raise exception 'review_media_review_owner_mismatch' using errcode = '23514';
  end if;

  new.owner_id := v_intent.user_id;
  new.mime_type := v_intent.mime_type;
  new.file_size_bytes := v_intent.file_size_bytes;
  return new;
end;
$$;

drop trigger if exists enforce_review_photo_upload_intent_trigger on public.review_photos;
create trigger enforce_review_photo_upload_intent_trigger
  before insert or update of upload_intent_id, storage_path, owner_id, media_type, mime_type, file_size_bytes, review_id
  on public.review_photos
  for each row
  execute function public.enforce_review_photo_upload_intent();

-- Direct authenticated review inserts can no longer attach arbitrary media URLs.
-- Trusted API routes use the service role after validating finalized intents.
create or replace function public.prevent_untrusted_review_media_urls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.photo_url, '')), '') is not null
      or coalesce(array_length(new.photo_urls, 1), 0) > 0 then
      raise exception 'review_media_requires_server_finalization' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if coalesce(new.photo_url, '') is distinct from coalesce(old.photo_url, '')
      or coalesce(new.photo_urls, '{}'::text[]) is distinct from coalesce(old.photo_urls, '{}'::text[]) then
      raise exception 'review_media_requires_server_finalization' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_untrusted_review_media_urls_trigger on public.reviews;
create trigger prevent_untrusted_review_media_urls_trigger
  before insert or update of photo_url, photo_urls
  on public.reviews
  for each row
  execute function public.prevent_untrusted_review_media_urls();

-- ---------------------------------------------------------------------------
-- Storage policy tightening for review media. Pending uploads go to a private
-- quarantine bucket; the public review-photos bucket is written only by trusted
-- server code after image validation and normalization. Review/post videos stay
-- disabled until a trusted transcode and metadata-stripping pipeline exists.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-media-quarantine',
  'review-media-quarantine',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set public = true,
    file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'review-photos';

drop policy if exists "Anyone can upload review photos" on storage.objects;
drop policy if exists "Authenticated users can upload review photos" on storage.objects;
drop policy if exists "Authenticated users can upload to quarantine" on storage.objects;
drop policy if exists "Users can delete their own review photos" on storage.objects;
drop policy if exists "Authenticated users can upload scoped review media intents" on storage.objects;
drop policy if exists "Authenticated users can upload scoped review media quarantine intents" on storage.objects;

create policy "Authenticated users can upload scoped review media quarantine intents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'review-media-quarantine'
    and exists (
      select 1
      from public.review_media_upload_intents intent
      where intent.quarantine_bucket_id = storage.objects.bucket_id
        and intent.quarantine_storage_path = storage.objects.name
        and intent.user_id = auth.uid()
        and intent.status = 'created'
        and intent.expires_at > now()
        and intent.quarantine_storage_path like ('pending/' || auth.uid()::text || '/' || intent.id::text || '/%')
    )
  );

drop policy if exists "Service role can delete review photos" on storage.objects;
drop policy if exists "Service role can manage review media objects" on storage.objects;
create policy "Service role can manage review media objects"
  on storage.objects for delete to service_role
  using (bucket_id in ('review-photos', 'review-media-quarantine'));

-- ---------------------------------------------------------------------------
-- Service-role account media path helper and durable cleanup job records.
-- ---------------------------------------------------------------------------
create table if not exists public.account_media_cleanup_jobs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null,
  owner_names    text[]      not null default '{}'::text[],
  bucket_id      text        not null,
  storage_paths  text[]      not null default '{}'::text[],
  status         text        not null default 'pending',
  attempts       integer     not null default 0,
  last_error     text,
  next_retry_at  timestamptz not null default now(),
  locked_at      timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status in ('pending', 'running', 'succeeded', 'failed')),
  check (bucket_id in ('review-photos', 'review-media-quarantine', 'memory-media'))
);

alter table public.account_media_cleanup_jobs
  add column if not exists owner_names text[] not null default '{}'::text[],
  add column if not exists next_retry_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists completed_at timestamptz;

create index if not exists account_media_cleanup_jobs_ready_idx
  on public.account_media_cleanup_jobs(status, next_retry_at, created_at);

alter table public.account_media_cleanup_jobs enable row level security;
drop policy if exists "Account media cleanup jobs are service only" on public.account_media_cleanup_jobs;

create or replace function public.review_media_account_storage_paths(p_user_id uuid)
returns table(storage_path text)
language sql
security definer
set search_path = public
as $$
  with target_profile as (
    select profile.id, profile.username
    from public.profiles profile
    where profile.id = p_user_id
  ),
  db_photo_paths as (
  select distinct photo.storage_path
  from public.review_photos photo
  join public.reviews review on review.id = photo.review_id
  join target_profile profile
    on photo.owner_id = profile.id
    or review.reviewer_name = profile.username
  where photo.storage_path is not null
    and (
      public.review_media_path_is_owned_by(photo.storage_path, profile.id)
      or photo.upload_intent_id is not null
    )
  ),
  intent_paths as (
    select intent.storage_path
    from public.review_media_upload_intents intent
    where intent.user_id = p_user_id
    union
    select intent.quarantine_storage_path
    from public.review_media_upload_intents intent
    where intent.user_id = p_user_id
  )
  select storage_path from db_photo_paths
  union
  select storage_path from intent_paths;
$$;

revoke all on function public.review_media_account_storage_paths(uuid) from public;
revoke all on function public.review_media_account_storage_paths(uuid) from anon;
revoke all on function public.review_media_account_storage_paths(uuid) from authenticated;
grant execute on function public.review_media_account_storage_paths(uuid) to service_role;

comment on function public.review_media_account_storage_paths(uuid) is
  'Service-role-only account media sweep helper for DB-backed review media. Prefix scans in storage.objects should also be used for avatars and legacy owner paths.';

-- ---------------------------------------------------------------------------
-- Server-derived profile statistics. Uses the same review visibility helper as
-- feed reads, so private/circle posts are not exposed through aggregate counts.
-- ---------------------------------------------------------------------------
create or replace function public.profile_post_stats(p_username text)
returns table(total_visits integer, unique_places integer, unique_dishes integer)
language sql
stable
security definer
set search_path = public
as $$
  with target_profile as (
    select
      profile.username,
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '') as display_name
    from public.profiles profile
    where profile.username = lower(btrim(p_username))
  ),
  aliases as (
    select username as reviewer_name from target_profile
    union
    select display_name from target_profile where display_name is not null
  ),
  visible_reviews as (
    select review.*
    from public.reviews review
    where review.reviewer_name in (select reviewer_name from aliases)
      and public.can_read_review_row(
        review.reviewer_name,
        review.visibility,
        review.deleted_at,
        review.hidden_at,
        review.reported_at,
        review.status
      )
  ),
  visible_dishes as (
    select
      coalesce(nullif(review.restaurant_id, ''), lower(review.restaurant_name)) as place_key,
      lower(btrim(item.value ->> 'name')) as dish_name
    from visible_reviews review
    cross join lateral jsonb_array_elements(coalesce(review.items, '[]'::jsonb)) item(value)
    where nullif(btrim(item.value ->> 'name'), '') is not null
  )
  select
    (select count(*)::integer from visible_reviews) as total_visits,
    (
      select count(distinct coalesce(nullif(visible_reviews.restaurant_id, ''), lower(visible_reviews.restaurant_name)))::integer
      from visible_reviews
    ) as unique_places,
    (
      select count(distinct visible_dishes.place_key || chr(0) || visible_dishes.dish_name)::integer
      from visible_dishes
    ) as unique_dishes;
$$;

revoke all on function public.profile_post_stats(text) from public;
grant execute on function public.profile_post_stats(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic username changes. The caller is derived from auth.uid(); all username
-- copies update in one transaction or roll back together.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.profiles
    group by lower(username)
    having count(*) > 1
  ) then
    raise exception 'profiles_username_lower_unique_preflight_failed' using errcode = '23505';
  end if;
end $$;

create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles(lower(username));

create or replace function public.update_current_username(p_username text)
returns table(username text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_next text := lower(btrim(coalesce(p_username, '')));
  v_previous text;
  v_pair record;
begin
  if v_uid is null then
    raise exception 'username_not_authenticated' using errcode = '28000';
  end if;

  if v_next !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'username_invalid' using errcode = '22023';
  end if;

  select profile.username into v_previous
  from public.profiles profile
  where profile.id = v_uid
  for update;

  if v_previous is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  v_previous := lower(btrim(v_previous));
  if v_previous = v_next then
    return query select v_next;
    return;
  end if;

  if exists (
    select 1
    from public.profiles profile
    where lower(profile.username) = v_next
      and profile.id <> v_uid
  ) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  update public.profiles
  set username = v_next
  where id = v_uid;

  for v_pair in
    select * from (values
      ('reviews', 'reviewer_name'),
      ('stories', 'author_name'),
      ('likes', 'user_name'),
      ('comments', 'user_name'),
      ('wishlist', 'user_name'),
      ('hungry_picks', 'user_name'),
      ('circle_requests', 'sender_name'),
      ('circle_requests', 'receiver_name'),
      ('circle_memberships', 'user_name'),
      ('circle_memberships', 'member_name'),
      ('notifications', 'recipient_name'),
      ('notifications', 'actor_name'),
      ('push_tokens', 'user_name'),
      ('shared_memory_rooms', 'created_by'),
      ('shared_memory_members', 'user_name'),
      ('shared_memory_messages', 'author_name'),
      ('shared_memory_photos', 'uploader_name'),
      ('shared_memory_dishes', 'added_by'),
      ('shared_memory_reads', 'user_name'),
      ('shared_memory_invites', 'sender_name'),
      ('shared_memory_invites', 'receiver_name'),
      ('notification_settings', 'user_name'),
      ('blocked_users', 'blocker_name'),
      ('blocked_users', 'blocked_name')
    ) as target(table_name, column_name)
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_pair.table_name
        and column_name = v_pair.column_name
    ) then
      execute format('update public.%I set %I = $1 where %I = $2', v_pair.table_name, v_pair.column_name, v_pair.column_name)
        using v_next, v_previous;
    end if;
  end loop;

  return query select v_next;
exception
  when unique_violation then
    raise exception 'username_taken' using errcode = '23505';
end;
$$;

revoke all on function public.update_current_username(text) from public;
revoke all on function public.update_current_username(text) from anon;
grant execute on function public.update_current_username(text) to authenticated;

comment on function public.update_current_username(text) is
  'Authenticated transactional username change. Locks the caller profile row and updates denormalized username columns atomically.';
