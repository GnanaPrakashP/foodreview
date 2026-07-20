-- Alpha-normalized media repair metadata and a service-only atomic commit.
-- Source objects remain private and immutable; repaired derivatives are staged
-- at revisioned paths before this function switches their metadata together.

alter table public.media_derivatives
  add column if not exists content_revision integer not null default 1,
  add column if not exists content_sha256 text,
  add column if not exists processing_version text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.media_derivatives
  drop constraint if exists media_derivatives_content_revision_check;
alter table public.media_derivatives
  add constraint media_derivatives_content_revision_check
  check (content_revision >= 1);

alter table public.media_derivatives
  drop constraint if exists media_derivatives_content_sha256_check;
alter table public.media_derivatives
  add constraint media_derivatives_content_sha256_check
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

alter table public.media_derivatives
  drop constraint if exists media_derivatives_processing_version_check;
alter table public.media_derivatives
  add constraint media_derivatives_processing_version_check
  check (processing_version is null or processing_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$');

create or replace function public.commit_alpha_media_derivative_repair_v1(
  p_asset_id uuid,
  p_expected_revision integer,
  p_processing_version text,
  p_derivatives jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets%rowtype;
  v_expected_bucket text;
  v_expected_kinds text[];
  v_expected_prefix text;
  v_item jsonb;
  v_kind text;
  v_next_revision integer;
  v_old_objects jsonb;
  v_updated integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_expected_revision < 1
    or p_processing_version !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
    or jsonb_typeof(p_derivatives) <> 'array'
  then
    raise exception 'alpha_media_repair_input_invalid' using errcode = '22023';
  end if;

  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = p_asset_id
    and asset.media_type = 'image'
    and asset.surface in ('post', 'avatar')
    and asset.status = 'ready'
    and asset.privacy_state = 'stable'
    and asset.moderation_status = 'approved'
  for update;
  if v_asset.id is null then
    raise exception 'alpha_media_repair_asset_ineligible' using errcode = '23514';
  end if;

  v_expected_kinds := case
    when v_asset.surface = 'post' then array['canonical', 'feed', 'thumbnail']::text[]
    else array['canonical', 'thumbnail']::text[]
  end;
  v_expected_bucket := case when v_asset.surface = 'avatar' then 'media-public' else 'media-private' end;
  v_expected_prefix := case when v_asset.surface = 'avatar' then 'avatars/' else 'private-posts/' end
    || v_asset.owner_id::text || '/' || v_asset.id::text || '/';
  v_next_revision := p_expected_revision + 1;

  if jsonb_array_length(p_derivatives) <> cardinality(v_expected_kinds)
    or (
      select count(distinct item->>'kind')
      from jsonb_array_elements(p_derivatives) item
    ) <> cardinality(v_expected_kinds)
  then
    raise exception 'alpha_media_repair_derivative_set_invalid' using errcode = '23514';
  end if;

  for v_item in select item from jsonb_array_elements(p_derivatives) item
  loop
    v_kind := v_item->>'kind';
    if not (v_kind = any(v_expected_kinds))
      or v_item->>'bucket_id' <> v_expected_bucket
      or v_item->>'storage_path' <> v_expected_prefix || v_kind || '.r' || v_next_revision::text || '.jpg'
      or v_item->>'mime_type' <> 'image/jpeg'
      or (v_item->>'content_revision')::integer <> v_next_revision
      or v_item->>'processing_version' <> p_processing_version
      or coalesce(v_item->>'content_sha256', '') !~ '^[0-9a-f]{64}$'
      or coalesce((v_item->>'file_size_bytes')::bigint, 0) <= 0
      or (v_asset.surface = 'post' and v_item->>'public_url' is not null)
      or (v_asset.surface = 'avatar' and coalesce(v_item->>'public_url', '') = '')
    then
      raise exception 'alpha_media_repair_derivative_invalid' using errcode = '23514';
    end if;
  end loop;

  if (
    select count(*)
    from public.media_derivatives derivative
    where derivative.asset_id = v_asset.id
      and derivative.kind = any(v_expected_kinds)
      and derivative.bucket_id = v_expected_bucket
      and derivative.content_revision = p_expected_revision
  ) <> cardinality(v_expected_kinds)
  then
    raise exception 'alpha_media_repair_revision_conflict' using errcode = '40001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket_id', derivative.bucket_id,
    'storage_path', derivative.storage_path
  ) order by derivative.kind), '[]'::jsonb)
  into v_old_objects
  from public.media_derivatives derivative
  where derivative.asset_id = v_asset.id
    and derivative.kind = any(v_expected_kinds);

  update public.media_derivatives derivative
  set bucket_id = repaired.bucket_id,
      storage_path = repaired.storage_path,
      public_url = repaired.public_url,
      mime_type = repaired.mime_type,
      width = repaired.width,
      height = repaired.height,
      duration_ms = null,
      file_size_bytes = repaired.file_size_bytes,
      blurhash = repaired.blurhash,
      content_revision = repaired.content_revision,
      content_sha256 = repaired.content_sha256,
      processing_version = repaired.processing_version,
      updated_at = now()
  from jsonb_to_recordset(p_derivatives) as repaired(
    kind text,
    bucket_id text,
    storage_path text,
    public_url text,
    mime_type text,
    width integer,
    height integer,
    file_size_bytes bigint,
    blurhash text,
    content_revision integer,
    content_sha256 text,
    processing_version text
  )
  where derivative.asset_id = v_asset.id
    and derivative.kind = repaired.kind
    and derivative.content_revision = p_expected_revision;
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(v_expected_kinds) then
    raise exception 'alpha_media_repair_atomic_commit_failed' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'assetId', v_asset.id,
    'contentRevision', v_next_revision,
    'oldObjects', v_old_objects,
    'updatedDerivatives', v_updated
  );
end;
$$;

revoke all on function public.commit_alpha_media_derivative_repair_v1(uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.commit_alpha_media_derivative_repair_v1(uuid, integer, text, jsonb) to service_role;

drop function if exists public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]);
drop function if exists private.authorized_home_media_derivatives_v1(uuid, uuid[], text[]);

create function private.authorized_home_media_derivatives_v1(
  p_viewer_user_id uuid,
  p_asset_ids uuid[],
  p_derivative_kinds text[] default array['feed', 'canonical', 'poster']::text[]
)
returns table (
  asset_id uuid,
  media_type text,
  access_class text,
  media_position integer,
  kind text,
  bucket_id text,
  storage_path text,
  mime_type text,
  width integer,
  height integer,
  duration_ms integer,
  blurhash text,
  content_revision integer
)
language sql
stable
security definer
set search_path = ''
as $$
with viewer as (
  select profile.username
  from public.profiles profile
  where profile.id = p_viewer_user_id
    and coalesce(profile.account_status, 'active') = 'active'
    and profile.deletion_started_at is null
), requested as (
  select distinct requested_id
  from unnest(coalesce(p_asset_ids, '{}'::uuid[])) requested_id
  limit 50
)
select
  asset.id,
  asset.media_type,
  asset.access_class,
  coalesce(photo.position, 0),
  derivative.kind,
  derivative.bucket_id,
  derivative.storage_path,
  derivative.mime_type,
  derivative.width,
  derivative.height,
  derivative.duration_ms,
  derivative.blurhash,
  derivative.content_revision
from requested
join public.media_assets asset on asset.id = requested.requested_id
join public.review_photos photo on photo.media_asset_id = asset.id
join public.reviews review on review.id = photo.review_id
join public.profiles author on author.username = review.reviewer_name
join public.media_derivatives derivative on derivative.asset_id = asset.id
cross join viewer
where asset.surface = 'post'
  and asset.status = 'ready'
  and asset.privacy_state = 'stable'
  and asset.moderation_status = 'approved'
  and asset.consumed_at is not null
  and asset.owner_id = author.id
  and asset.owner_name = review.reviewer_name
  and derivative.bucket_id = 'media-private'
  and derivative.public_url is null
  and derivative.kind = any(coalesce(p_derivative_kinds, '{}'::text[]))
  and review.deleted_at is null
  and review.hidden_at is null
  and review.reported_at is null
  and review.status = 'active'
  and coalesce(author.account_status, 'active') = 'active'
  and author.deletion_started_at is null
  and asset.access_class = case review.visibility
    when 'public' then 'public_post'
    when 'circle' then 'circle_post'
    when 'me' then 'private_post'
    else '__invalid__'
  end
  and not exists (
    select 1
    from public.blocked_users block
    where (block.blocker_name = viewer.username and block.blocked_name = review.reviewer_name)
       or (block.blocked_name = viewer.username and block.blocker_name = review.reviewer_name)
  )
  and (
    review.reviewer_name = viewer.username
    or review.visibility = 'public'
    or (
      review.visibility = 'circle'
      and exists (
        select 1
        from public.circle_memberships membership
        where membership.user_name = review.reviewer_name
          and membership.member_name = viewer.username
      )
    )
  );
$$;

create function public.authorized_home_media_derivatives_v1(
  p_viewer_user_id uuid,
  p_asset_ids uuid[],
  p_derivative_kinds text[] default array['feed', 'canonical', 'poster']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(authorized_row)), '[]'::jsonb)
  into v_rows
  from private.authorized_home_media_derivatives_v1(
    p_viewer_user_id,
    p_asset_ids,
    p_derivative_kinds
  ) authorized_row;
  return v_rows;
end;
$$;

revoke all on function private.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) from public, anon, authenticated;
grant execute on function private.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) to service_role;
revoke all on function public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) to service_role;

comment on function public.commit_alpha_media_derivative_repair_v1(uuid, integer, text, jsonb) is
  'Service-only atomic metadata switch for staged alpha-normalized post/avatar JPEG derivatives.';
