-- Atomically activate an already processed immutable avatar asset. The public
-- wrapper is service-only; the API supplies the authenticated user id.

create or replace function private.activate_processed_avatar_asset_v1(
  p_user_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avatar_url text;
  v_owner_name text;
  v_previous_asset_id uuid;
begin
  select profile.username, profile.avatar_media_asset_id
  into v_owner_name, v_previous_asset_id
  from public.profiles profile
  where profile.id = p_user_id
    and coalesce(profile.account_status, 'active') = 'active'
    and profile.deletion_started_at is null
  for update;

  if v_owner_name is null then
    return null;
  end if;

  select derivative.public_url
  into v_avatar_url
  from public.media_assets asset
  join public.media_derivatives derivative on derivative.asset_id = asset.id
  where asset.id = p_asset_id
    and asset.owner_id = p_user_id
    and asset.owner_name = v_owner_name
    and asset.surface = 'avatar'
    and asset.media_type = 'image'
    and asset.access_class = 'avatar_public'
    and asset.visibility = 'public'
    and asset.status = 'ready'
    and asset.privacy_state = 'stable'
    and asset.moderation_status = 'approved'
    and derivative.kind = 'thumbnail'
    and derivative.bucket_id = 'media-public'
    and derivative.public_url is not null
    and derivative.width = 128
    and derivative.height = 128
  limit 1;

  if v_avatar_url is null then
    return null;
  end if;

  update public.media_assets asset
  set consumed_at = coalesce(asset.consumed_at, now()), updated_at = now()
  where asset.id = p_asset_id
    and asset.owner_id = p_user_id;

  update public.profiles profile
  set avatar_media_asset_id = p_asset_id,
      avatar_url = v_avatar_url
  where profile.id = p_user_id;

  return jsonb_build_object(
    'assetId', p_asset_id,
    'avatarUrl', v_avatar_url,
    'previousAssetId', v_previous_asset_id
  );
end;
$$;

create or replace function public.activate_processed_avatar_asset_v1(
  p_user_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return private.activate_processed_avatar_asset_v1(p_user_id, p_asset_id);
end;
$$;

revoke all on function private.activate_processed_avatar_asset_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function private.activate_processed_avatar_asset_v1(uuid, uuid) to service_role;
revoke all on function public.activate_processed_avatar_asset_v1(uuid, uuid) from public;
grant execute on function public.activate_processed_avatar_asset_v1(uuid, uuid) to service_role;
