-- Pixelfed-inspired generic media pipeline.
-- Media sources stay private; workers generate canonical derivatives for the
-- surfaces that need them.

create extension if not exists pgcrypto;

create table if not exists public.media_assets (
  id                         uuid        primary key default gen_random_uuid(),
  owner_id                   uuid        not null references auth.users(id) on delete cascade,
  owner_name                 text        not null,
  surface                    text        not null,
  media_type                 text        not null,
  original_mime_type         text        not null,
  original_extension         text        not null,
  original_file_size_bytes   bigint      not null,
  original_width             integer,
  original_height            integer,
  duration_ms                integer,
  crop_rect                  jsonb       not null default '{}'::jsonb,
  source_bucket_id           text        not null default 'media-sources',
  source_storage_path        text        not null unique,
  status                     text        not null default 'created',
  visibility                 text        not null default 'private',
  failure_reason             text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  expires_at                 timestamptz not null,
  uploaded_at                timestamptz,
  processed_at               timestamptz,
  consumed_at                timestamptz,
  check (surface in ('post', 'avatar', 'memory')),
  check (media_type in ('image', 'video')),
  check (status in ('created', 'uploaded', 'processing', 'ready', 'failed', 'rejected', 'expired', 'abandoned')),
  check (visibility in ('public', 'private')),
  check (original_file_size_bytes > 0),
  check (original_width is null or original_width > 0),
  check (original_height is null or original_height > 0),
  check (duration_ms is null or duration_ms >= 0),
  check (jsonb_typeof(crop_rect) = 'object'),
  check (source_bucket_id = 'media-sources'),
  check (source_storage_path = btrim(source_storage_path)),
  check (
    source_storage_path not like '/%'
    and source_storage_path not like '%/'
    and source_storage_path not like '%//%'
    and position('..' in source_storage_path) = 0
    and position('?' in source_storage_path) = 0
    and position('#' in source_storage_path) = 0
    and position(chr(92) in source_storage_path) = 0
  ),
  check (source_storage_path ~ ('^sources/' || surface || '/' || owner_id::text || '/' || id::text || '/original\.[A-Za-z0-9]+$'))
);

create index if not exists media_assets_owner_status_idx
  on public.media_assets(owner_id, status, created_at desc);
create index if not exists media_assets_surface_status_idx
  on public.media_assets(surface, status, created_at desc);
create index if not exists media_assets_source_path_idx
  on public.media_assets(source_storage_path);

alter table public.media_assets enable row level security;

drop policy if exists "Users can read own media assets" on public.media_assets;
create policy "Users can read own media assets"
  on public.media_assets for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Ready public media assets are readable" on public.media_assets;
create policy "Ready public media assets are readable"
  on public.media_assets for select to anon, authenticated
  using (visibility = 'public' and status = 'ready');

revoke all on table public.media_assets from anon, authenticated;
grant select on table public.media_assets to anon, authenticated;
grant all privileges on table public.media_assets to service_role;

create table if not exists public.media_derivatives (
  id               uuid        primary key default gen_random_uuid(),
  asset_id         uuid        not null references public.media_assets(id) on delete cascade,
  kind             text        not null,
  bucket_id        text        not null,
  storage_path     text        not null unique,
  public_url       text,
  mime_type        text        not null,
  width            integer,
  height           integer,
  duration_ms      integer,
  file_size_bytes  bigint      not null,
  blurhash         text,
  created_at       timestamptz not null default now(),
  check (kind in ('canonical', 'thumbnail', 'poster')),
  check (bucket_id in ('media-public', 'media-private')),
  check (file_size_bytes > 0),
  check (width is null or width > 0),
  check (height is null or height > 0),
  check (duration_ms is null or duration_ms >= 0)
);

create unique index if not exists media_derivatives_asset_kind_idx
  on public.media_derivatives(asset_id, kind);
create index if not exists media_derivatives_asset_idx
  on public.media_derivatives(asset_id);

alter table public.media_derivatives enable row level security;

drop policy if exists "Users can read own media derivatives" on public.media_derivatives;
create policy "Users can read own media derivatives"
  on public.media_derivatives for select to authenticated
  using (
    exists (
      select 1
      from public.media_assets asset
      where asset.id = media_derivatives.asset_id
        and asset.owner_id = auth.uid()
    )
  );

drop policy if exists "Public media derivatives are readable" on public.media_derivatives;
create policy "Public media derivatives are readable"
  on public.media_derivatives for select to anon, authenticated
  using (
    bucket_id = 'media-public'
    and exists (
      select 1
      from public.media_assets asset
      where asset.id = media_derivatives.asset_id
        and asset.visibility = 'public'
        and asset.status = 'ready'
    )
  );

revoke all on table public.media_derivatives from anon, authenticated;
grant select on table public.media_derivatives to anon, authenticated;
grant all privileges on table public.media_derivatives to service_role;

create table if not exists public.media_processing_jobs (
  id             uuid        primary key default gen_random_uuid(),
  asset_id       uuid        not null references public.media_assets(id) on delete cascade,
  job_type       text        not null,
  status         text        not null default 'queued',
  attempts       integer     not null default 0,
  max_attempts   integer     not null default 3,
  locked_at      timestamptz,
  next_retry_at  timestamptz not null default now(),
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (job_type in ('image_derivatives', 'video_derivatives', 'cleanup')),
  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  check (attempts >= 0),
  check (max_attempts > 0)
);

create unique index if not exists media_processing_jobs_asset_type_idx
  on public.media_processing_jobs(asset_id, job_type)
;
create index if not exists media_processing_jobs_ready_idx
  on public.media_processing_jobs(status, next_retry_at, created_at);

alter table public.media_processing_jobs enable row level security;
revoke all on table public.media_processing_jobs from anon, authenticated;
grant all privileges on table public.media_processing_jobs to service_role;

alter table public.review_photos
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null;
create index if not exists review_photos_media_asset_id_idx
  on public.review_photos(media_asset_id);

alter table public.profiles
  add column if not exists avatar_media_asset_id uuid references public.media_assets(id) on delete set null;

do $$
begin
  if to_regclass('public.account_media_cleanup_jobs') is not null then
    alter table public.account_media_cleanup_jobs
      drop constraint if exists account_media_cleanup_jobs_bucket_id_check;
    alter table public.account_media_cleanup_jobs
      add constraint account_media_cleanup_jobs_bucket_id_check
      check (bucket_id in ('review-photos', 'review-media-quarantine', 'memory-media', 'media-sources', 'media-public', 'media-private'));
  end if;

  if to_regclass('public.shared_memory_photos') is not null then
    alter table public.shared_memory_photos
      add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null;
    create index if not exists shared_memory_photos_media_asset_id_idx
      on public.shared_memory_photos(media_asset_id);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-sources',
  'media-sources',
  false,
  209715200,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-public',
  'media-public',
  true,
  209715200,
  array['image/jpeg', 'video/mp4']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-private',
  'media-private',
  false,
  209715200,
  array['image/jpeg', 'video/mp4']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can upload scoped media sources" on storage.objects;
create policy "Authenticated users can upload scoped media sources"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media-sources'
    and exists (
      select 1
      from public.media_assets asset
      where asset.source_bucket_id = storage.objects.bucket_id
        and asset.source_storage_path = storage.objects.name
        and asset.owner_id = auth.uid()
        and asset.status = 'created'
        and asset.expires_at > now()
    )
  );

drop policy if exists "Anyone can view public processed media" on storage.objects;
create policy "Anyone can view public processed media"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'media-public');

drop policy if exists "Service role can manage generic media objects" on storage.objects;
create policy "Service role can manage generic media objects"
  on storage.objects for all to service_role
  using (bucket_id in ('media-sources', 'media-public', 'media-private'))
  with check (bucket_id in ('media-sources', 'media-public', 'media-private'));
