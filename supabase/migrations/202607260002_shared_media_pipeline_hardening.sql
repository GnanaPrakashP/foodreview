-- Shared media pipeline hardening:
-- - preserve complete Table Memory frames;
-- - persist the requested video audio policy;
-- - let the leased worker moderate pending assets before deriving them.

alter table public.media_assets
  add column if not exists audio_policy text not null default 'preserve';

alter table public.media_assets
  drop constraint if exists media_assets_audio_policy_check;
alter table public.media_assets
  add constraint media_assets_audio_policy_check
  check (
    audio_policy in ('preserve', 'strip')
    and (
      audio_policy = 'preserve'
      or (surface = 'post' and media_type = 'video')
    )
  );

-- Existing derivatives cannot always be regenerated because their original
-- source may already have been cleaned up. Enforce the no-crop contract for
-- every new/updated Table Memory asset without falsifying historic metadata.
alter table public.media_assets
  drop constraint if exists media_assets_memory_full_frame_check;
alter table public.media_assets
  add constraint media_assets_memory_full_frame_check
  check (
    surface <> 'memory'
    or crop_rect = jsonb_build_object(
      'x', 0,
      'y', 0,
      'width', 1,
      'height', 1,
      'targetAspect', null
    )
  ) not valid;

create or replace function private.claim_media_processing_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_max_attempts integer default 5
)
returns table (
  id uuid,
  asset_id uuid,
  job_type text,
  attempts integer,
  max_attempts integer,
  lease_generation bigint,
  claim_token uuid,
  lock_expires_at timestamptz,
  stale_reclaimed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_worker_id is null or btrim(p_worker_id) = '' or length(p_worker_id) > 120 then
    raise exception 'media_worker_id_invalid' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 25 or p_lease_seconds < 15 or p_lease_seconds > 900
    or p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'media_claim_parameters_invalid' using errcode = '22023';
  end if;

  update public.media_processing_jobs job
  set status = 'dead_letter', failure_code = 'retry_exhausted_after_worker_loss',
      failure_class = 'retryable', dead_lettered_at = now(), completed_at = now(),
      locked_at = null, locked_by = null, lock_expires_at = null,
      heartbeat_at = null, claim_token = null, updated_at = now()
  where job.status = 'running' and job.lock_expires_at <= now() and job.attempts >= job.max_attempts;

  return query
  with candidates as (
    select job.id, job.status = 'running' as was_stale
    from public.media_processing_jobs job
    join public.media_assets asset on asset.id = job.asset_id
    join public.profiles profile on profile.id = asset.owner_id
    where job.attempts < job.max_attempts
      and (
        (job.status in ('queued', 'retry_wait') and job.next_attempt_at <= now())
        or (job.status = 'running' and job.lock_expires_at <= now())
      )
      and asset.status in ('uploaded', 'processing')
      and asset.moderation_status in ('pending', 'approved')
      and asset.consumed_at is null
      and profile.account_status = 'active'
      and profile.deletion_started_at is null
    order by case when job.status = 'running' then 0 else 1 end,
      coalesce(job.lock_expires_at, job.next_attempt_at), job.created_at, job.id
    for update of job skip locked
    limit p_limit
  ), claimed as (
    update public.media_processing_jobs job
    set status = 'running', attempts = job.attempts + 1, max_attempts = p_max_attempts,
        locked_at = now(), locked_by = left(btrim(p_worker_id), 120),
        lock_expires_at = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now(),
        lease_generation = job.lease_generation + 1, claim_token = gen_random_uuid(),
        started_at = coalesce(job.started_at, now()), completed_at = null,
        failure_code = null, failure_class = null,
        stale_reclaims = job.stale_reclaims + case when candidates.was_stale then 1 else 0 end,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.id, job.asset_id, job.job_type, job.attempts, job.max_attempts,
      job.lease_generation, job.claim_token, job.lock_expires_at, candidates.was_stale
  ), events as (
    insert into public.media_processing_events (
      job_id, asset_id, event_type, worker_id, lease_generation, details
    )
    select claimed.id, claimed.asset_id,
      case when claimed.was_stale then 'lease_reclaimed' else 'claimed' end,
      left(btrim(p_worker_id), 120), claimed.lease_generation,
      jsonb_build_object('attempt', claimed.attempts)
    from claimed
    returning job_id
  )
  select claimed.id, claimed.asset_id, claimed.job_type, claimed.attempts,
    claimed.max_attempts, claimed.lease_generation, claimed.claim_token,
    claimed.lock_expires_at, claimed.was_stale
  from claimed;
end;
$$;

revoke all on function private.claim_media_processing_jobs(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function private.claim_media_processing_jobs(text, integer, integer, integer)
  to service_role;

comment on column public.media_assets.audio_policy is
  'Server-authoritative video audio handling. strip is allowed only for Dining Experience post videos.';
comment on function private.claim_media_processing_jobs(text, integer, integer, integer) is
  'Leased media worker claims pending or approved assets; pending assets must pass moderation before derivative generation.';

create or replace function public.cancel_owned_media_uploads_v1(
  p_owner_id uuid,
  p_asset_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids uuid[];
  v_changed integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_owner_id is null or cardinality(coalesce(p_asset_ids, '{}'::uuid[])) < 1
    or cardinality(p_asset_ids) > 10 then
    raise exception 'media_cancel_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(asset.id), '{}'::uuid[])
  into v_asset_ids
  from public.media_assets asset
  where asset.id = any(p_asset_ids)
    and asset.owner_id = p_owner_id
    and asset.consumed_at is null
    and asset.status in ('created', 'uploaded', 'processing', 'ready');

  if cardinality(v_asset_ids) = 0 then
    return 0;
  end if;

  update public.media_processing_jobs job
  set status = 'cancelled',
      failure_code = 'owner_cancelled',
      failure_class = 'cancelled',
      last_error = 'owner_cancelled',
      completed_at = now(),
      cancelled_at = now(),
      locked_at = null,
      locked_by = null,
      lock_expires_at = null,
      heartbeat_at = null,
      claim_token = null,
      lease_generation = job.lease_generation + 1,
      updated_at = now()
  where job.asset_id = any(v_asset_ids)
    and job.status in ('queued', 'running', 'retry_wait');

  update public.media_assets asset
  set status = 'cancelled',
      failure_code = 'owner_cancelled',
      failure_reason = null,
      source_cleanup_after = now(),
      updated_at = now()
  where asset.id = any(v_asset_ids)
    and asset.owner_id = p_owner_id
    and asset.consumed_at is null;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.cancel_owned_media_uploads_v1(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.cancel_owned_media_uploads_v1(uuid, uuid[])
  to service_role;

comment on function public.cancel_owned_media_uploads_v1(uuid, uuid[]) is
  'Service-guarded owner cancellation that fences active jobs and schedules source/derivative cleanup.';

create or replace function public.attach_review_media_assets_v1(
  p_review_id uuid,
  p_owner_id uuid,
  p_owner_name text,
  p_asset_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids uuid[];
  v_expected_count integer;
  v_changed integer;
  v_visibility text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_review_id is null or p_owner_id is null or nullif(btrim(p_owner_name), '') is null then
    raise exception 'review_media_attach_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct asset_id), '{}'::uuid[])
  into v_asset_ids
  from unnest(coalesce(p_asset_ids, '{}'::uuid[])) asset_id
  where asset_id is not null;
  v_expected_count := cardinality(coalesce(p_asset_ids, '{}'::uuid[]));
  if v_expected_count < 1 or v_expected_count > 10
    or cardinality(v_asset_ids) <> v_expected_count then
    raise exception 'review_media_attach_selection_invalid' using errcode = '22023';
  end if;

  select review.visibility
  into v_visibility
  from public.reviews review
  where review.id = p_review_id
    and review.reviewer_name = p_owner_name
    and review.status = 'draft'
    and review.requires_ready_media = true
    and exists (
      select 1 from public.profiles profile
      where profile.id = p_owner_id and profile.username = p_owner_name
    )
  for update;
  if v_visibility is null then
    raise exception 'review_media_attach_review_invalid' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.media_assets asset
    where asset.id = any(v_asset_ids)
      and asset.owner_id = p_owner_id
      and asset.owner_name = p_owner_name
      and asset.surface = 'post'
      and asset.status = 'ready'
      and asset.privacy_state = 'stable'
      and asset.moderation_status = 'approved'
      and asset.consumed_at is null
      and asset.access_class = case v_visibility
        when 'public' then 'public_post'
        when 'circle' then 'circle_post'
        when 'me' then 'private_post'
        else '__invalid__'
      end
      and exists (
        select 1
        from public.media_derivatives canonical
        where canonical.asset_id = asset.id
          and canonical.kind = 'canonical'
          and canonical.bucket_id = 'media-private'
          and canonical.public_url is null
      )
      and exists (
        select 1
        from public.media_derivatives display
        where display.asset_id = asset.id
          and display.kind = case when asset.media_type = 'video' then 'poster' else 'feed' end
          and display.bucket_id = 'media-private'
          and display.public_url is null
      )
  ) <> v_expected_count then
    raise exception 'review_media_attach_asset_invalid' using errcode = '42501';
  end if;

  insert into public.review_photos (
    review_id,
    storage_path,
    public_url,
    media_type,
    width,
    height,
    size_bytes,
    media_asset_id,
    position
  )
  select
    p_review_id,
    canonical.storage_path,
    null,
    asset.media_type,
    canonical.width,
    canonical.height,
    canonical.file_size_bytes,
    asset.id,
    (ordered.ordinality - 1)::smallint
  from unnest(p_asset_ids) with ordinality ordered(asset_id, ordinality)
  join public.media_assets asset on asset.id = ordered.asset_id
  join public.media_derivatives canonical
    on canonical.asset_id = asset.id and canonical.kind = 'canonical'
  order by ordered.ordinality;
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected_count then
    raise exception 'review_media_attach_insert_incomplete';
  end if;

  update public.media_assets asset
  set consumed_at = now(), updated_at = now()
  where asset.id = any(v_asset_ids)
    and asset.owner_id = p_owner_id
    and asset.surface = 'post'
    and asset.status = 'ready'
    and asset.moderation_status = 'approved'
    and asset.consumed_at is null;
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected_count then
    raise exception 'review_media_attach_consume_incomplete';
  end if;

  update public.reviews review
  set status = 'active'
  where review.id = p_review_id
    and review.reviewer_name = p_owner_name
    and review.status = 'draft';
  if not found then
    raise exception 'review_media_attach_publish_failed';
  end if;
  return true;
end;
$$;

revoke all on function public.attach_review_media_assets_v1(uuid, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.attach_review_media_assets_v1(uuid, uuid, text, uuid[])
  to service_role;

comment on function public.attach_review_media_assets_v1(uuid, uuid, text, uuid[]) is
  'Service-guarded atomic Dining Experience media attachment, asset consumption, and review activation.';
