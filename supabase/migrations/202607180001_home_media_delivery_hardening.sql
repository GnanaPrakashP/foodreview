-- Home media delivery hardening: add the 720x900 feed derivative and expose a
-- single service-only authorization lookup for page covers and renewals.

alter table public.media_derivatives
  drop constraint if exists media_derivatives_kind_check;
alter table public.media_derivatives
  add constraint media_derivatives_kind_check
  check (kind in ('canonical', 'feed', 'thumbnail', 'poster'));

create or replace function public.complete_media_processing_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_generation bigint,
  p_claim_token uuid,
  p_width integer default null,
  p_height integer default null,
  p_duration_ms integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.media_processing_jobs%rowtype;
  v_asset public.media_assets%rowtype;
  v_expected_kinds text[];
  v_expected_bucket text;
  v_derivative_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_job from public.media_processing_jobs where id = p_job_id for update;
  if v_job.id is null
    or v_job.status <> 'running'
    or v_job.locked_by <> p_worker_id
    or v_job.lease_generation <> p_lease_generation
    or v_job.claim_token <> p_claim_token
    or v_job.lock_expires_at <= now()
  then
    return false;
  end if;

  select asset.* into v_asset
  from public.media_assets asset
  join public.profiles profile on profile.id = asset.owner_id
  where asset.id = v_job.asset_id
    and asset.status in ('uploaded', 'processing')
    and asset.consumed_at is null
    and profile.account_status = 'active'
    and profile.deletion_started_at is null
  for update of asset;
  if v_asset.id is null then return false; end if;

  v_expected_kinds := case
    when v_asset.media_type = 'image' and v_asset.surface = 'post'
      then array['canonical', 'feed', 'thumbnail']::text[]
    when v_asset.media_type = 'image'
      then array['canonical', 'thumbnail']::text[]
    else array['canonical', 'poster']::text[]
  end;
  v_expected_bucket := case when v_asset.surface = 'avatar' then 'media-public' else 'media-private' end;

  select count(*) into v_derivative_count
  from public.media_derivatives derivative
  where derivative.asset_id = v_asset.id
    and derivative.kind = any(v_expected_kinds)
    and derivative.bucket_id = v_expected_bucket
    and (
      (v_asset.surface = 'avatar' and derivative.storage_path like ('avatars/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'))
      or (v_asset.surface = 'post' and derivative.storage_path like ('private-posts/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'))
      or (v_asset.surface = 'memory' and derivative.storage_path like ('memories/' || v_asset.owner_id::text || '/' || v_asset.id::text || '/%'))
    )
    and (v_asset.surface = 'avatar' or derivative.public_url is null);
  if v_derivative_count <> cardinality(v_expected_kinds) then
    raise exception 'media_derivative_set_incomplete';
  end if;

  update public.media_assets
  set status = 'ready', failure_code = null, failure_reason = null,
      original_width = coalesce(original_width, p_width),
      original_height = coalesce(original_height, p_height),
      duration_ms = coalesce(p_duration_ms, duration_ms), processed_at = now(),
      source_cleanup_after = now() + interval '24 hours', updated_at = now()
  where id = v_asset.id;

  update public.media_processing_jobs
  set status = 'succeeded', completed_at = now(), locked_at = null, locked_by = null,
      lock_expires_at = null, heartbeat_at = null, claim_token = null, last_error = null,
      failure_code = null, failure_class = null, updated_at = now()
  where id = v_job.id;

  insert into public.media_processing_events (
    job_id, asset_id, event_type, worker_id, lease_generation, details
  ) values (
    v_job.id, v_asset.id, 'succeeded', left(p_worker_id, 120), p_lease_generation,
    jsonb_build_object('attempt', v_job.attempts)
  );
  return true;
end;
$$;

revoke all on function public.complete_media_processing_job(uuid, text, bigint, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.complete_media_processing_job(uuid, text, bigint, uuid, integer, integer, integer) to anon, authenticated, service_role;

create or replace function private.authorized_home_media_derivatives_v1(
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
  blurhash text
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
  derivative.blurhash
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
  and asset.owner_name = review.reviewer_name
  and derivative.bucket_id = 'media-private'
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

drop function if exists public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]);
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
revoke all on function public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) from public;
grant execute on function public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) to service_role;

comment on function public.authorized_home_media_derivatives_v1(uuid, uuid[], text[]) is
  'Service-only, batched Home media authorization. Rechecks moderation, owner state, visibility, membership, two-way blocks, access class, and ready/stable state.';

-- Existing assets deliberately are not requeued here: older workers may have
-- already deleted their private source after successful processing. The
-- operator backfill reads the authorized private canonical derivative and
-- writes only a feed derivative, without touching the review or original.
