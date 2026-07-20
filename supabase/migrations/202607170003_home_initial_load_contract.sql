-- Home/Circle initial-load contract: ten rows plus one cursor sentinel and a
-- single cover-media reference per review. Historical migrations remain
-- immutable; this replaces only the active private implementation and its
-- guarded public service wrapper.

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
), params as (
  select least(greatest(coalesce(p_limit, 10), 1), 10) as row_limit
), joined as (
  select distinct profile.id, profile.username
  from public.circle_memberships membership
  join viewer on membership.member_name = viewer.username
  join public.profiles profile on profile.username = membership.user_name
  where coalesce(profile.account_status, 'active') = 'active'
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
        'public_url', case when cover.media_asset_id is null then cover.public_url else null end,
        'media_type', cover.media_type,
        'position', cover.position
      ))
      from (
        select photo.media_asset_id, photo.public_url, photo.media_type, photo.position
        from public.review_photos photo
        where photo.review_id = selected.id
        order by photo.position asc, photo.id asc
        limit 1
      ) cover
    ), '[]'::jsonb) as review_photos,
    (
      select count(*)::integer
      from public.review_photos photo
      where photo.review_id = selected.id
    ) as media_count
  from selected
), authors as (
  select distinct p.id, p.username, p.first_name, p.last_name, p.account_type
  from public.profiles p
  join selected on selected.reviewer_name = p.username
), author_metadata as (
  select
    coalesce(jsonb_object_agg(a.username, coalesce(nullif(trim(concat_ws(' ', nullif(a.first_name, ''), nullif(a.last_name, ''))), ''), a.username)), '{}'::jsonb) as profile_map,
    coalesce(jsonb_object_agg(a.username, case when a.account_type = 'private' then 'private' else 'public' end), '{}'::jsonb) as account_type_map,
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
  'requestStatusMap', (select request_status_map from author_metadata),
  'hasMore', (select has_more from state),
  'nextCursor', case when (select has_more from state) then (
    select jsonb_build_object('createdAt', created_at, 'id', id)
    from selected order by created_at asc, id asc limit 1
  ) else null end
);
$$;

create or replace function public.circle_feed_page_v2(
  p_viewer_user_id uuid,
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
  return private.circle_feed_page_v2(p_viewer_user_id, p_cursor_created_at, p_cursor_id, p_limit, p_exclude_post_ids);
end;
$$;

revoke all on function private.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function private.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) to service_role;
revoke all on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) from public;
grant execute on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) to anon, authenticated, service_role;

comment on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) is
  'Guarded service wrapper for the ten-row Home/Circle page with an eleventh-row cursor sentinel and cover-only media references.';
