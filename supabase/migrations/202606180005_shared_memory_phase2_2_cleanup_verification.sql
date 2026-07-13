-- Phase 2.2: cleanup correctness and production DB verification helpers.
--
-- This migration keeps Phase 2/2.1 trust-boundary enforcement intact while
-- moving cleanup state transitions into a service-role-only RPC. Storage
-- objects should be deleted by the operator route only after this function has
-- successfully moved DB rows into terminal cleanup states.

create or replace function public.cleanup_shared_memory_media(
  p_expired_intent_ids uuid[] default '{}'::uuid[],
  p_pending_photo_ids uuid[] default '{}'::uuid[],
  p_pending_reason text default 'pending_review_expired',
  p_now timestamptz default now()
)
returns table(cleanup_kind text, storage_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return query
  with requested_intents as (
    select unnest(coalesce(p_expired_intent_ids, '{}'::uuid[])) as id
  ),
  safe_expired_intents as (
    select intent.id
    from public.shared_memory_upload_intents intent
    join requested_intents requested on requested.id = intent.id
    where intent.status = 'created'
      and intent.expires_at <= p_now
      and intent.storage_path is not null
      and not exists (
        select 1
        from public.shared_memory_photos photo
        where photo.storage_path = intent.storage_path
          and coalesce(photo.moderation_status, 'approved') not in ('pending', 'rejected')
      )
  ),
  updated_intents as (
    update public.shared_memory_upload_intents intent
    set status = 'expired'
    from safe_expired_intents safe
    where intent.id = safe.id
      and intent.status = 'created'
    returning 'expired_intent'::text as cleanup_kind, intent.storage_path
  )
  select updated_intents.cleanup_kind, updated_intents.storage_path
  from updated_intents;

  with requested_photos as (
    select unnest(coalesce(p_pending_photo_ids, '{}'::uuid[])) as id
  ),
  safe_pending_photos as (
    select photo.id, photo.upload_intent_id, photo.storage_path
    from public.shared_memory_photos photo
    join requested_photos requested on requested.id = photo.id
    left join public.shared_memory_upload_intents intent on intent.id = photo.upload_intent_id
    where photo.moderation_status = 'pending'
      and photo.storage_path is not null
      and (
        photo.upload_intent_id is null
        or intent.status = 'finalized'
      )
      and not exists (
        select 1
        from public.shared_memory_photos other_photo
        where other_photo.storage_path = photo.storage_path
          and coalesce(other_photo.moderation_status, 'approved') not in ('pending', 'rejected')
      )
  )
  update public.shared_memory_upload_intents intent
  set moderation_status = 'rejected',
      moderation_reason = p_pending_reason
  from safe_pending_photos safe
  where intent.id = safe.upload_intent_id
    and intent.status = 'finalized';

  return query
  with requested_photos as (
    select unnest(coalesce(p_pending_photo_ids, '{}'::uuid[])) as id
  ),
  safe_pending_photos as (
    select photo.id
    from public.shared_memory_photos photo
    join requested_photos requested on requested.id = photo.id
    left join public.shared_memory_upload_intents intent on intent.id = photo.upload_intent_id
    where photo.moderation_status = 'pending'
      and photo.storage_path is not null
      and (
        photo.upload_intent_id is null
        or (
          intent.status = 'finalized'
          and intent.moderation_status = 'rejected'
          and intent.moderation_reason is not distinct from p_pending_reason
        )
      )
      and not exists (
        select 1
        from public.shared_memory_photos other_photo
        where other_photo.storage_path = photo.storage_path
          and coalesce(other_photo.moderation_status, 'approved') not in ('pending', 'rejected')
      )
  ),
  updated_photos as (
    update public.shared_memory_photos photo
    set moderation_status = 'rejected',
        moderation_reason = p_pending_reason,
        moderated_at = p_now
    from safe_pending_photos safe
    where photo.id = safe.id
      and photo.moderation_status = 'pending'
    returning 'stale_pending_photo'::text as cleanup_kind, photo.storage_path
  )
  select updated_photos.cleanup_kind, updated_photos.storage_path
  from updated_photos;
end;
$$;

revoke all on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) from public;
revoke all on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) from anon;
revoke all on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) from authenticated;
grant execute on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) to service_role;

comment on function public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz) is
  'Service-role-only cleanup transition for expired memory upload intents and stale pending memory media. Delete Storage objects only after this function returns their paths.';

create or replace function public.shared_memory_room_media_paths(p_room_id uuid)
returns table(storage_path text)
language sql
security definer
set search_path = public
as $$
  select distinct photo.storage_path
  from public.shared_memory_photos photo
  where photo.room_id = p_room_id
    and photo.storage_path is not null
    and photo.storage_path like ('memories/' || p_room_id::text || '/%');
$$;

revoke all on function public.shared_memory_room_media_paths(uuid) from public;
revoke all on function public.shared_memory_room_media_paths(uuid) from anon;
revoke all on function public.shared_memory_room_media_paths(uuid) from authenticated;
grant execute on function public.shared_memory_room_media_paths(uuid) to service_role;

comment on function public.shared_memory_room_media_paths(uuid) is
  'Service-role-only helper for verified room media sweeps. It returns DB-backed paths scoped by room_id and the memories/{room_id}/ prefix.';

create or replace function public.shared_memory_account_media_paths(p_user_id uuid)
returns table(storage_path text)
language sql
security definer
set search_path = public
as $$
  select distinct photo.storage_path
  from public.shared_memory_photos photo
  where photo.uploader_id = p_user_id
    and photo.storage_path is not null
    and (
      photo.storage_path like ('memories/' || photo.room_id::text || '/' || p_user_id::text || '/%')
      or photo.upload_intent_id is not null
    );
$$;

revoke all on function public.shared_memory_account_media_paths(uuid) from public;
revoke all on function public.shared_memory_account_media_paths(uuid) from anon;
revoke all on function public.shared_memory_account_media_paths(uuid) from authenticated;
grant execute on function public.shared_memory_account_media_paths(uuid) to service_role;

comment on function public.shared_memory_account_media_paths(uuid) is
  'Service-role-only helper for account media sweeps. It intentionally relies on immutable uploader_id/upload_intent_id data, not mutable usernames.';
