-- Phase 1A: visibility-aware post media.
-- Mutable post media is private canonical storage even when the review is public.

alter table public.media_assets
  add column if not exists access_class text;

alter table public.media_assets
  add column if not exists privacy_state text not null default 'stable';

alter table public.media_assets
  drop constraint if exists media_assets_privacy_state_check;
alter table public.media_assets
  add constraint media_assets_privacy_state_check
  check (privacy_state in ('stable', 'needs_backfill', 'migrating', 'failed'));

update public.media_assets asset
set access_class = case
  when asset.surface = 'avatar' then 'avatar_public'
  when asset.surface = 'memory' then 'memory_private'
  when asset.surface = 'post' and exists (
    select 1 from public.review_photos rp
    join public.reviews r on r.id = rp.review_id
    where rp.media_asset_id = asset.id and r.visibility = 'me'
  ) then 'private_post'
  when asset.surface = 'post' and exists (
    select 1 from public.review_photos rp
    join public.reviews r on r.id = rp.review_id
    where rp.media_asset_id = asset.id and r.visibility = 'circle'
  ) then 'circle_post'
  when asset.surface = 'post' and exists (
    select 1 from public.review_photos rp
    join public.reviews r on r.id = rp.review_id
    where rp.media_asset_id = asset.id and r.visibility = 'public'
  ) then 'public_post'
  else 'private_post'
end
where access_class is null;

alter table public.media_assets
  alter column access_class set default 'private_post',
  alter column access_class set not null,
  drop constraint if exists media_assets_access_class_check;

alter table public.media_assets
  add constraint media_assets_access_class_check
  check (access_class in ('public_post', 'circle_post', 'private_post', 'avatar_public', 'memory_private'));

update public.media_assets
set visibility = case when access_class = 'avatar_public' then 'public' else 'private' end
where visibility is distinct from case when access_class = 'avatar_public' then 'public' else 'private' end;

update public.media_assets asset
set privacy_state = 'needs_backfill'
where asset.surface = 'post'
  and exists (
    select 1 from public.media_derivatives derivative
    where derivative.asset_id = asset.id
      and (derivative.bucket_id <> 'media-private' or derivative.public_url is not null)
  );

create table if not exists public.media_privacy_migration_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.media_assets(id) on delete cascade,
  review_id uuid references public.reviews(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'copying', 'metadata_updated', 'complete', 'failed')),
  old_objects jsonb not null default '[]'::jsonb,
  new_objects jsonb not null default '[]'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.media_privacy_migration_jobs enable row level security;
revoke all on table public.media_privacy_migration_jobs from public, anon, authenticated;
grant all privileges on table public.media_privacy_migration_jobs to service_role;

alter table public.review_photos
  alter column public_url drop not null;

create unique index if not exists review_photos_media_asset_unique_idx
  on public.review_photos(media_asset_id)
  where media_asset_id is not null;

create or replace function public.enforce_visibility_aware_media_derivative()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_surface text;
  v_access_class text;
begin
  select surface, access_class
  into v_surface, v_access_class
  from public.media_assets
  where id = new.asset_id;

  if v_surface in ('post', 'memory') and (new.bucket_id <> 'media-private' or new.public_url is not null) then
    raise exception 'private_media_derivative_requires_private_bucket';
  end if;
  if v_surface = 'avatar' and v_access_class = 'avatar_public' and new.bucket_id <> 'media-public' then
    raise exception 'public_avatar_derivative_requires_public_bucket';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_visibility_aware_media_derivative_trigger on public.media_derivatives;
create trigger enforce_visibility_aware_media_derivative_trigger
before insert or update of asset_id, bucket_id, public_url
on public.media_derivatives
for each row execute function public.enforce_visibility_aware_media_derivative();

drop policy if exists "Ready public media assets are readable" on public.media_assets;
create policy "Ready public media assets are readable"
  on public.media_assets for select to anon, authenticated
  using (access_class = 'avatar_public' and visibility = 'public' and status = 'ready');

drop policy if exists "Public media derivatives are readable" on public.media_derivatives;
create policy "Public media derivatives are readable"
  on public.media_derivatives for select to anon, authenticated
  using (
    bucket_id = 'media-public'
    and exists (
      select 1
      from public.media_assets asset
      where asset.id = media_derivatives.asset_id
        and asset.access_class = 'avatar_public'
        and asset.visibility = 'public'
        and asset.status = 'ready'
    )
  );

drop policy if exists "Anyone can view public processed media" on storage.objects;
create policy "Anyone can view public processed media"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'media-public'
    and exists (
      select 1
      from public.media_derivatives derivative
      join public.media_assets asset on asset.id = derivative.asset_id
      where derivative.bucket_id = storage.objects.bucket_id
        and derivative.storage_path = storage.objects.name
        and asset.access_class = 'avatar_public'
        and asset.status = 'ready'
    )
  );

create or replace function public.set_review_visibility_with_media_access(
  p_review_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_visibility text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_class text;
begin
  if p_visibility not in ('public', 'circle', 'me') then
    raise exception 'review_visibility_invalid';
  end if;
  v_access_class := case p_visibility
    when 'public' then 'public_post'
    when 'circle' then 'circle_post'
    else 'private_post'
  end;

  perform 1
  from public.reviews
  where id = p_review_id and reviewer_name = p_owner_name
  for update;
  if not found then
    raise exception 'review_not_owned';
  end if;

  if exists (
    select 1
    from public.review_photos rp
    left join public.media_assets asset on asset.id = rp.media_asset_id
    where rp.review_id = p_review_id
      and (
        rp.media_asset_id is null
        or rp.public_url is not null
        or asset.id is null
        or asset.owner_id <> p_owner_id
        or asset.owner_name <> p_owner_name
        or asset.surface <> 'post'
        or asset.status <> 'ready'
        or asset.privacy_state <> 'stable'
        or exists (
          select 1
          from public.media_derivatives derivative
          where derivative.asset_id = asset.id
            and (derivative.bucket_id <> 'media-private' or derivative.public_url is not null)
        )
      )
  ) then
    raise exception 'review_media_requires_private_backfill';
  end if;

  update public.media_assets asset
  set access_class = v_access_class,
      visibility = 'private',
      updated_at = now()
  from public.review_photos rp
  where rp.review_id = p_review_id
    and rp.media_asset_id = asset.id;

  update public.review_photos
  set public_url = null
  where review_id = p_review_id;

  update public.reviews
  set visibility = p_visibility,
      photo_url = null,
      photo_urls = '{}'::text[]
  where id = p_review_id
    and reviewer_name = p_owner_name;

  return found;
end;
$$;

revoke all on function public.set_review_visibility_with_media_access(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_review_visibility_with_media_access(uuid, uuid, text, text) to service_role;

comment on column public.media_assets.access_class is
  'Authoritative delivery class. Post classes all use private derivatives; review visibility controls signed delivery.';
comment on function public.set_review_visibility_with_media_access(uuid, uuid, text, text) is
  'Atomically changes review visibility and post media access class after proving all linked derivatives are private.';
