-- Complete the Home media contract without changing feed size, ranking, or
-- derivative dimensions. Product-created reviews opt into a guarded media
-- invariant; legacy invalid rows remain reportable and are excluded from Home.

alter table public.reviews
  add column if not exists requires_ready_media boolean not null default false;

alter table public.reviews
  drop constraint if exists reviews_status_check;
alter table public.reviews
  add constraint reviews_status_check
  check (status in ('draft', 'active', 'deleted', 'hidden', 'reported', 'removed'));

create or replace function public.review_is_unsuppressed(
  review_deleted_at timestamptz,
  review_hidden_at timestamptz,
  review_reported_at timestamptz,
  review_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select review_deleted_at is null
     and review_hidden_at is null
     and review_reported_at is null
     and coalesce(review_status, 'active') = 'active'
$$;

revoke all on function public.review_is_unsuppressed(timestamptz, timestamptz, timestamptz, text) from public;
grant execute on function public.review_is_unsuppressed(timestamptz, timestamptz, timestamptz, text) to anon, authenticated, service_role;

create or replace function private.review_has_ready_media_v1(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reviews review
    join public.profiles author on author.username = review.reviewer_name
    join public.review_photos photo on photo.review_id = review.id
    join public.media_assets asset on asset.id = photo.media_asset_id
    where review.id = p_review_id
      and asset.owner_id = author.id
      and asset.owner_name = review.reviewer_name
      and asset.surface = 'post'
      and asset.status = 'ready'
      and asset.privacy_state = 'stable'
      and asset.moderation_status = 'approved'
      and asset.consumed_at is not null
      and asset.access_class = case review.visibility
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
  )
$$;

revoke all on function private.review_has_ready_media_v1(uuid) from public, anon, authenticated;
grant execute on function private.review_has_ready_media_v1(uuid) to service_role;

update public.reviews review
set requires_ready_media = true
where review.status = 'active'
  and private.review_has_ready_media_v1(review.id);

create or replace function private.assert_review_ready_media_v1(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requires_guard boolean;
begin
  select review.status = 'active' and review.requires_ready_media
  into v_requires_guard
  from public.reviews review
  where review.id = p_review_id;

  if coalesce(v_requires_guard, false) and not private.review_has_ready_media_v1(p_review_id) then
    raise exception 'published_review_requires_ready_media' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.assert_review_ready_media_v1(uuid) from public, anon, authenticated;
grant execute on function private.assert_review_ready_media_v1(uuid) to service_role;

create or replace function private.enforce_review_ready_media_row_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_review_ready_media_v1(new.id);
  return null;
end;
$$;

create or replace function private.enforce_review_media_link_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_review_ready_media_v1(old.review_id);
  if tg_op = 'UPDATE' and new.review_id is distinct from old.review_id then
    perform private.assert_review_ready_media_v1(new.review_id);
  end if;
  return null;
end;
$$;

create or replace function private.enforce_media_asset_review_links_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review_id uuid;
begin
  for v_review_id in
    select distinct photo.review_id
    from public.review_photos photo
    where photo.media_asset_id = new.id
  loop
    perform private.assert_review_ready_media_v1(v_review_id);
  end loop;
  return null;
end;
$$;

create or replace function private.enforce_media_derivative_review_links_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid := case when tg_op = 'DELETE' then old.asset_id else new.asset_id end;
  v_review_id uuid;
begin
  for v_review_id in
    select distinct photo.review_id
    from public.review_photos photo
    where photo.media_asset_id = v_asset_id
  loop
    perform private.assert_review_ready_media_v1(v_review_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists reviews_require_ready_media_v1 on public.reviews;
create constraint trigger reviews_require_ready_media_v1
after insert or update on public.reviews
deferrable initially deferred
for each row execute function private.enforce_review_ready_media_row_v1();

drop trigger if exists review_photos_preserve_ready_media_v1 on public.review_photos;
create constraint trigger review_photos_preserve_ready_media_v1
after delete or update on public.review_photos
deferrable initially deferred
for each row execute function private.enforce_review_media_link_v1();

drop trigger if exists media_assets_preserve_published_links_v1 on public.media_assets;
create constraint trigger media_assets_preserve_published_links_v1
after update on public.media_assets
deferrable initially deferred
for each row execute function private.enforce_media_asset_review_links_v1();

drop trigger if exists media_derivatives_preserve_published_links_v1 on public.media_derivatives;
create constraint trigger media_derivatives_preserve_published_links_v1
after delete or update on public.media_derivatives
deferrable initially deferred
for each row execute function private.enforce_media_derivative_review_links_v1();

-- Add moderation/consumption checks to the existing service-only media gate.
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

-- Preserve ten-row pages and cover-only delivery while excluding invalid rows
-- before pagination. Avatar metadata is resolved in the same page statement.
create or replace function private.circle_feed_page_v2(
  p_viewer_user_id uuid,
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
  select least(greatest(coalesce(p_limit, 10), 1), 10) as row_limit
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
      select 1 from public.post_views seen
      where seen.user_id = p_viewer_user_id and seen.post_id = r.id
    ) as seen_by_viewer
  from public.reviews r
  join public.profiles author on author.username = r.reviewer_name
  cross join viewer
  where r.deleted_at is null and r.hidden_at is null and r.reported_at is null
    and r.status = 'active'
    and coalesce(author.account_status, 'active') = 'active'
    and author.deletion_started_at is null
    and private.review_has_ready_media_v1(r.id)
    and (
      r.visibility = 'public'
      or r.reviewer_name = viewer.username
      or (r.visibility = 'circle' and exists (select 1 from joined where joined.username = r.reviewer_name))
    )
    and not (r.id = any(coalesce(p_exclude_post_ids, '{}'::uuid[])))
    and not exists (
      select 1 from public.blocked_users block
      where (block.blocker_name = viewer.username and block.blocked_name = r.reviewer_name)
         or (block.blocked_name = viewer.username and block.blocker_name = r.reviewer_name)
    )
    and (
      p_cursor_created_at is null
      or r.created_at < p_cursor_created_at
      or (p_cursor_id is not null and r.created_at = p_cursor_created_at and r.id < p_cursor_id)
    )
  order by r.created_at desc, r.id desc
  limit ((select row_limit from params) + 1)
), selected as (
  select * from candidates
  order by created_at desc, id desc
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
            select 1 from public.media_derivatives derivative
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
          select 1 from public.media_derivatives derivative
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
        when a.username = (select username from viewer) or exists (select 1 from joined where joined.username = a.username) then 'joined'
        when exists (
          select 1 from public.circle_requests request
          where request.sender_name = (select username from viewer)
            and request.receiver_name = a.username and request.status = 'pending'
        ) then 'pending'
        else 'idle'
      end
    ), '{}'::jsonb) as request_status_map
  from authors a
), state as (
  select count(*) > (select row_limit from params) as has_more from candidates
)
select jsonb_build_object(
  'viewerName', (select username from viewer),
  'viewerUserId', p_viewer_user_id,
  'joinedCircles', coalesce((select jsonb_agg(username order by username) from joined), '[]'::jsonb),
  'mutualMembers', coalesce((select jsonb_agg(username order by username) from joined), '[]'::jsonb),
  'reviews', coalesce((select jsonb_agg(to_jsonb(rows_with_media) order by created_at desc, id desc) from rows_with_media), '[]'::jsonb),
  'seenPostIds', coalesce((select jsonb_agg(id) filter (where seen_by_viewer) from selected), '[]'::jsonb),
  'profileMap', (select profile_map from author_metadata),
  'accountTypeMap', (select account_type_map from author_metadata),
  'authorAvatarMap', (select author_avatar_map from author_metadata),
  'requestStatusMap', (select request_status_map from author_metadata),
  'hasMore', (select has_more from state),
  'nextCursor', case when (select has_more from state) then (
    select jsonb_build_object('createdAt', created_at, 'id', id)
    from selected order by created_at asc, id asc limit 1
  ) else null end
);
$$;

-- Read-only operator report. It deliberately returns IDs/reasons only and
-- performs no repair or deletion.
create or replace function private.home_media_integrity_report_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with published as (
  select review.id from public.reviews review where review.status = 'active'
), zero_links as (
  select published.id
  from published
  where not exists (select 1 from public.review_photos photo where photo.review_id = published.id)
), zero_ready as (
  select published.id from published where not private.review_has_ready_media_v1(published.id)
), broken_links as (
  select photo.id as link_id, photo.review_id, photo.media_asset_id
  from public.review_photos photo
  join public.reviews review on review.id = photo.review_id and review.status = 'active'
  left join public.media_assets asset on asset.id = photo.media_asset_id
  where photo.media_asset_id is null
     or asset.id is null
     or asset.surface <> 'post'
     or asset.owner_name <> review.reviewer_name
     or asset.status <> 'ready'
     or asset.privacy_state <> 'stable'
     or asset.moderation_status <> 'approved'
), missing_delivery as (
  select photo.review_id, asset.id as media_asset_id,
    case when asset.media_type = 'video' then 'poster' else 'feed' end as required_kind
  from public.review_photos photo
  join public.reviews review on review.id = photo.review_id and review.status = 'active'
  join public.media_assets asset on asset.id = photo.media_asset_id
  where asset.status = 'ready' and asset.privacy_state = 'stable'
    and not exists (
      select 1 from public.media_derivatives derivative
      where derivative.asset_id = asset.id
        and derivative.bucket_id = 'media-private'
        and derivative.public_url is null
        and derivative.kind = case when asset.media_type = 'video' then 'poster' else 'feed' end
    )
)
select jsonb_build_object(
  'publishedWithZeroLinks', coalesce((select jsonb_agg(id order by id) from zero_links), '[]'::jsonb),
  'publishedWithZeroReadyMedia', coalesce((select jsonb_agg(id order by id) from zero_ready), '[]'::jsonb),
  'brokenMediaLinks', coalesce((select jsonb_agg(to_jsonb(broken_links) order by review_id, link_id) from broken_links), '[]'::jsonb),
  'missingFeedDerivatives', coalesce((select jsonb_agg(to_jsonb(missing_delivery) order by review_id, media_asset_id) from missing_delivery), '[]'::jsonb)
);
$$;

create or replace function public.home_media_integrity_report_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return private.home_media_integrity_report_v1();
end;
$$;

revoke all on function private.home_media_integrity_report_v1() from public, anon, authenticated;
grant execute on function private.home_media_integrity_report_v1() to service_role;
revoke all on function public.home_media_integrity_report_v1() from public;
grant execute on function public.home_media_integrity_report_v1() to service_role;

comment on function public.home_media_integrity_report_v1() is
  'Read-only service report for media-less published posts, broken links, and missing Home feed/poster derivatives.';
