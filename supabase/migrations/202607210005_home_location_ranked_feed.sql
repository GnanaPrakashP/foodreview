-- Stable Home ordering across pagination: unseen posts first, then nearest
-- restaurant first, with newest/id tie-breakers. A fixed seen cutoff prevents
-- posts viewed during the current scroll session from moving between pages.

alter table public.post_views
  add column if not exists first_viewed_at timestamptz;

update public.post_views
set first_viewed_at = viewed_at
where first_viewed_at is null;

alter table public.post_views
  alter column first_viewed_at set default now(),
  alter column first_viewed_at set not null;

create or replace function private.preserve_post_first_viewed_at_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.first_viewed_at := old.first_viewed_at;
  else
    new.first_viewed_at := coalesce(new.first_viewed_at, new.viewed_at, statement_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_post_first_viewed_at on public.post_views;
create trigger preserve_post_first_viewed_at
before insert or update on public.post_views
for each row execute function private.preserve_post_first_viewed_at_v1();

revoke all on function private.preserve_post_first_viewed_at_v1() from public, anon, authenticated;
grant execute on function private.preserve_post_first_viewed_at_v1() to service_role;

comment on column public.post_views.first_viewed_at is
  'Immutable first-seen timestamp used to keep unseen/seen feed pagination stable.';

create or replace function private.circle_feed_page_v3(
  p_viewer_user_id uuid,
  p_viewer_lat double precision default null,
  p_viewer_lng double precision default null,
  p_seen_cutoff timestamptz default null,
  p_cursor_seen boolean default null,
  p_cursor_distance_meters bigint default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 10,
  p_exclude_post_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with viewer as (
  select p.id, p.username,
    coalesce(nullif(trim(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, ''))), ''), p.username) as display_name
  from public.profiles p
  where p.id = p_viewer_user_id
    and coalesce(p.account_status, 'active') = 'active'
    and p.deletion_started_at is null
), params as (
  select
    least(greatest(coalesce(p_limit, 10), 1), 10) as row_limit,
    coalesce(p_seen_cutoff, statement_timestamp()) as seen_cutoff,
    p_viewer_lat between -90 and 90
      and p_viewer_lng between -180 and 180 as has_location,
    p_viewer_lat as viewer_lat,
    p_viewer_lng as viewer_lng
), joined as (
  select distinct profile.id, profile.username
  from public.circle_memberships membership
  join viewer on membership.member_name = viewer.username
  join public.profiles profile on profile.username = membership.user_name
  where coalesce(profile.account_status, 'active') = 'active'
    and profile.deletion_started_at is null
), candidates as (
  select r.*,
    exists (
      select 1
      from public.post_views seen
      where seen.user_id = p_viewer_user_id
        and seen.post_id = r.id
        and seen.first_viewed_at <= params.seen_cutoff
    ) as seen_by_viewer,
    case
      when params.has_location
        and r.restaurant_lat between -90 and 90
        and r.restaurant_lng between -180 and 180
      then round(
        6371000.0 * 2.0 * asin(sqrt(least(1.0, greatest(0.0,
          power(sin(radians((r.restaurant_lat - params.viewer_lat) / 2.0)), 2)
          + cos(radians(params.viewer_lat)) * cos(radians(r.restaurant_lat))
          * power(sin(radians((r.restaurant_lng - params.viewer_lng) / 2.0)), 2)
        ))))
      )::bigint
      else null
    end as distance_meters
  from public.reviews r
  join public.profiles author on author.username = r.reviewer_name
  cross join viewer
  cross join params
  where r.deleted_at is null
    and r.hidden_at is null
    and r.reported_at is null
    and r.status = 'active'
    and coalesce(author.account_status, 'active') = 'active'
    and author.deletion_started_at is null
    and private.review_has_ready_media_v1(r.id)
    and (
      r.visibility = 'public'
      or r.reviewer_name = viewer.username
      or (
        r.visibility = 'circle'
        and exists (select 1 from joined where joined.username = r.reviewer_name)
      )
    )
    and not (r.id = any(coalesce(p_exclude_post_ids, '{}'::uuid[])))
    and not exists (
      select 1
      from public.blocked_users block
      where (block.blocker_name = viewer.username and block.blocked_name = r.reviewer_name)
         or (block.blocked_name = viewer.username and block.blocker_name = r.reviewer_name)
    )
), ranked_candidates as (
  select candidates.*,
    case when seen_by_viewer then 1 else 0 end as seen_bucket,
    coalesce(distance_meters, 9223372036854775807::bigint) as distance_sort
  from candidates
), page_candidates as (
  select ranked_candidates.*
  from ranked_candidates
  where
    p_cursor_created_at is null
    or (
      p_cursor_seen is null
      and (
        created_at < p_cursor_created_at
        or (p_cursor_id is not null and created_at = p_cursor_created_at and id < p_cursor_id)
      )
    )
    or (
      p_cursor_seen is not null
      and p_cursor_id is not null
      and (
        seen_bucket > case when p_cursor_seen then 1 else 0 end
        or (
          seen_bucket = case when p_cursor_seen then 1 else 0 end
          and distance_sort > coalesce(p_cursor_distance_meters, 9223372036854775807::bigint)
        )
        or (
          seen_bucket = case when p_cursor_seen then 1 else 0 end
          and distance_sort = coalesce(p_cursor_distance_meters, 9223372036854775807::bigint)
          and created_at < p_cursor_created_at
        )
        or (
          seen_bucket = case when p_cursor_seen then 1 else 0 end
          and distance_sort = coalesce(p_cursor_distance_meters, 9223372036854775807::bigint)
          and created_at = p_cursor_created_at
          and id < p_cursor_id
        )
      )
    )
  order by seen_bucket asc, distance_sort asc, created_at desc, id desc
  limit ((select row_limit from params) + 1)
), selected as (
  select *
  from page_candidates
  order by seen_bucket asc, distance_sort asc, created_at desc, id desc
  limit (select row_limit from params)
), rows_with_media as (
  select selected.*,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'media_asset_id', cover.media_asset_id,
        'public_url', null,
        'media_type', cover.media_type,
        'position', cover.position
      ))
      from (
        select photo.media_asset_id, photo.media_type, photo.position
        from public.review_photos photo
        join public.media_assets asset on asset.id = photo.media_asset_id
        where photo.review_id = selected.id
          and asset.status = 'ready'
          and asset.privacy_state = 'stable'
          and asset.moderation_status = 'approved'
          and asset.consumed_at is not null
          and asset.owner_name = selected.reviewer_name
          and asset.access_class = case selected.visibility
            when 'public' then 'public_post'
            when 'circle' then 'circle_post'
            when 'me' then 'private_post'
            else '__invalid__'
          end
          and exists (
            select 1
            from public.media_derivatives derivative
            where derivative.asset_id = asset.id
              and derivative.bucket_id = 'media-private'
              and derivative.public_url is null
              and derivative.kind = case when asset.media_type = 'video' then 'poster' else 'feed' end
          )
        order by photo.position asc, photo.id asc
        limit 1
      ) cover
    ), '[]'::jsonb) as review_photos,
    (
      select count(*)::integer
      from public.review_photos photo
      join public.media_assets asset on asset.id = photo.media_asset_id
      where photo.review_id = selected.id
        and asset.status = 'ready'
        and asset.privacy_state = 'stable'
        and asset.moderation_status = 'approved'
        and asset.consumed_at is not null
        and asset.owner_name = selected.reviewer_name
        and asset.access_class = case selected.visibility
          when 'public' then 'public_post'
          when 'circle' then 'circle_post'
          when 'me' then 'private_post'
          else '__invalid__'
        end
        and exists (
          select 1
          from public.media_derivatives derivative
          where derivative.asset_id = asset.id
            and derivative.bucket_id = 'media-private'
            and derivative.public_url is null
            and derivative.kind = case when asset.media_type = 'video' then 'poster' else 'feed' end
        )
    ) as media_count
  from selected
), authors as (
  select distinct
    p.id, p.username, p.first_name, p.last_name, p.account_type,
    avatar.asset_id as avatar_media_asset_id,
    avatar.thumbnail_url as avatar_thumbnail_url,
    avatar.placeholder as avatar_placeholder
  from public.profiles p
  join selected on selected.reviewer_name = p.username
  left join lateral (
    select asset.id as asset_id, derivative.public_url as thumbnail_url, derivative.blurhash as placeholder
    from public.media_assets asset
    join public.media_derivatives derivative on derivative.asset_id = asset.id
    where asset.id = p.avatar_media_asset_id
      and asset.owner_id = p.id
      and asset.owner_name = p.username
      and asset.surface = 'avatar'
      and asset.access_class = 'avatar_public'
      and asset.status = 'ready'
      and asset.privacy_state = 'stable'
      and asset.moderation_status = 'approved'
      and derivative.kind = 'thumbnail'
      and derivative.bucket_id = 'media-public'
      and derivative.public_url is not null
    limit 1
  ) avatar on true
), author_metadata as (
  select
    coalesce(jsonb_object_agg(a.username, coalesce(nullif(trim(concat_ws(' ', nullif(a.first_name, ''), nullif(a.last_name, ''))), ''), a.username)), '{}'::jsonb) as profile_map,
    coalesce(jsonb_object_agg(a.username, case when a.account_type = 'private' then 'private' else 'public' end), '{}'::jsonb) as account_type_map,
    coalesce(jsonb_object_agg(a.username, jsonb_build_object(
      'profileId', a.id,
      'avatarMediaAssetId', a.avatar_media_asset_id,
      'avatarThumbnailUrl', a.avatar_thumbnail_url,
      'avatarPlaceholder', a.avatar_placeholder
    )), '{}'::jsonb) as author_avatar_map,
    coalesce(jsonb_object_agg(a.username,
      case
        when a.username = (select username from viewer)
          or exists (select 1 from joined where joined.username = a.username) then 'joined'
        when exists (
          select 1
          from public.circle_requests request
          where request.sender_name = (select username from viewer)
            and request.receiver_name = a.username
            and request.status = 'pending'
        ) then 'pending'
        else 'idle'
      end
    ), '{}'::jsonb) as request_status_map
  from authors a
), state as (
  select count(*) > (select row_limit from params) as has_more
  from page_candidates
), cursor_row as (
  select *
  from selected
  order by seen_bucket desc, distance_sort desc, created_at asc, id asc
  limit 1
)
select jsonb_build_object(
  'viewerName', (select username from viewer),
  'viewerUserId', p_viewer_user_id,
  'joinedCircles', coalesce((select jsonb_agg(username order by username) from joined), '[]'::jsonb),
  'mutualMembers', coalesce((select jsonb_agg(username order by username) from joined), '[]'::jsonb),
  'reviews', coalesce((
    select jsonb_agg(
      to_jsonb(rows_with_media)
        - 'seen_by_viewer'
        - 'distance_meters'
        - 'seen_bucket'
        - 'distance_sort'
      order by seen_bucket asc, distance_sort asc, created_at desc, id desc
    )
    from rows_with_media
  ), '[]'::jsonb),
  'seenPostIds', coalesce((select jsonb_agg(id) filter (where seen_by_viewer) from selected), '[]'::jsonb),
  'profileMap', (select profile_map from author_metadata),
  'accountTypeMap', (select account_type_map from author_metadata),
  'authorAvatarMap', (select author_avatar_map from author_metadata),
  'requestStatusMap', (select request_status_map from author_metadata),
  'hasMore', (select has_more from state),
  'nextCursor', case when (select has_more from state) then (
    select jsonb_build_object(
      'createdAt', created_at,
      'distanceMeters', distance_meters,
      'id', id,
      'seen', seen_by_viewer,
      'seenCutoff', (select seen_cutoff from params)
    )
    from cursor_row
  ) else null end
);
$$;

create or replace function public.circle_feed_page_v3(
  p_viewer_user_id uuid,
  p_viewer_lat double precision default null,
  p_viewer_lng double precision default null,
  p_seen_cutoff timestamptz default null,
  p_cursor_seen boolean default null,
  p_cursor_distance_meters bigint default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 10,
  p_exclude_post_ids uuid[] default '{}'::uuid[]
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
  return private.circle_feed_page_v3(
    p_viewer_user_id,
    p_viewer_lat,
    p_viewer_lng,
    p_seen_cutoff,
    p_cursor_seen,
    p_cursor_distance_meters,
    p_cursor_created_at,
    p_cursor_id,
    p_limit,
    p_exclude_post_ids
  );
end;
$$;

revoke all on function private.circle_feed_page_v3(uuid, double precision, double precision, timestamptz, boolean, bigint, timestamptz, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function private.circle_feed_page_v3(uuid, double precision, double precision, timestamptz, boolean, bigint, timestamptz, uuid, integer, uuid[]) to service_role;
revoke all on function public.circle_feed_page_v3(uuid, double precision, double precision, timestamptz, boolean, bigint, timestamptz, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.circle_feed_page_v3(uuid, double precision, double precision, timestamptz, boolean, bigint, timestamptz, uuid, integer, uuid[]) to service_role;

comment on function public.circle_feed_page_v3(uuid, double precision, double precision, timestamptz, boolean, bigint, timestamptz, uuid, integer, uuid[]) is
  'Guarded Home feed page ordered by fixed-cutoff unseen state, nearest distance, creation time, and id.';
