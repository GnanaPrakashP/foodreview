-- FoodReview production hardening Phase 5: bounded mobile read contracts.
-- All feed RPCs that can bypass RLS are service-only; client-callable Memory
-- and Explore functions enforce the authenticated profile in SQL.

-- Superseded by the narrower public cursor index below and the reviewer cursor
-- index used by Profile/Circle paths. Keeping both made PostgreSQL prefer an
-- incremental sort that omitted the stable UUID tie-breaker.
drop index if exists public.reviews_visible_feed_idx;

-- The generic chronological notification index and its older two-column
-- recipient variant caused sparse inbox reads to walk unrelated recipients
-- or add an incremental sort. All active reads are recipient-scoped, so the
-- stable three-column indexes below replace both.
drop index if exists public.notifications_created_at_idx;
drop index if exists public.notifications_recipient_created_idx;

-- Phase 3 added the stable three-column Memory chat cursor index. The original
-- two-column room/time index is now strictly redundant and can win the plan
-- with an incremental sort, so remove it before validating the stable cursor.
drop index if exists public.shared_memory_messages_room_created_idx;

create index if not exists reviews_active_cursor_idx
  on public.reviews(created_at desc, id desc)
  where deleted_at is null and hidden_at is null and reported_at is null
    and status = 'active';

create index if not exists reviews_public_cursor_idx
  on public.reviews(created_at desc, id desc)
  where visibility = 'public'
    and deleted_at is null and hidden_at is null and reported_at is null
    and status = 'active';

create index if not exists reviews_public_place_cursor_idx
  on public.reviews(restaurant_id, created_at desc, id desc)
  where visibility = 'public'
    and deleted_at is null and hidden_at is null and reported_at is null
    and status = 'active';

create index if not exists reviews_public_restaurant_cursor_idx
  on public.reviews(restaurant_name, created_at desc, id desc)
  where visibility = 'public'
    and deleted_at is null and hidden_at is null and reported_at is null
    and status = 'active';

create index if not exists reviews_reviewer_visible_cursor_idx
  on public.reviews(reviewer_name, visibility, created_at desc, id desc)
  where deleted_at is null and hidden_at is null and reported_at is null
    and status = 'active';

create index if not exists comments_post_cursor_idx
  on public.comments(post_id, created_at desc, id desc);

create index if not exists notifications_recipient_user_cursor_idx
  on public.notifications(recipient_user_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists notifications_recipient_name_cursor_idx
  on public.notifications(recipient_name, created_at desc, id desc)
  where deleted_at is null;

create index if not exists notifications_recipient_user_unread_phase5_idx
  on public.notifications(recipient_user_id)
  where deleted_at is null and is_read = false and read = false;

create index if not exists notifications_recipient_name_unread_phase5_idx
  on public.notifications(recipient_name)
  where deleted_at is null and is_read = false and read = false;

create index if not exists place_stats_recent_idx
  on public.place_stats(last_review_at desc, place_id);

create index if not exists place_stats_location_idx
  on public.place_stats(latitude, longitude)
  where latitude is not null and longitude is not null;

create index if not exists dish_place_stats_recent_idx
  on public.dish_place_stats(last_review_at desc, canonical_dish_id, place_id);

create or replace function public.mobile_post_engagement_v1(
  p_post_ids uuid[],
  p_viewer_user_id uuid default null
)
returns table(
  post_id uuid,
  like_count bigint,
  comment_count bigint,
  liked_by_me boolean,
  bookmarked_by_me boolean,
  must_try_count bigint,
  not_worth_it_count bigint,
  food_reaction text,
  latest_comment jsonb
)
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select p.id, p.username
  from public.profiles p
  where p.id = p_viewer_user_id
    and coalesce(p.account_status, 'active') = 'active'
), posts as (
  select distinct value as post_id
  from unnest(coalesce(p_post_ids, '{}'::uuid[])) value
  limit 100
)
select
  posts.post_id,
  coalesce(likes.count, 0),
  coalesce(comments.count, 0),
  coalesce(likes.liked_by_me, false),
  coalesce(bookmarks.bookmarked_by_me, false),
  coalesce(feedback.must_try_count, 0),
  coalesce(feedback.not_worth_it_count, 0),
  feedback.food_reaction,
  comments.latest_comment
from posts
left join lateral (
  select
    count(*)::bigint as count,
    bool_or(l.user_name = (select username from viewer)) filter (where (select username from viewer) is not null) as liked_by_me
  from public.likes l
  where l.post_id = posts.post_id
) likes on true
left join lateral (
  select
    count(*)::bigint as count,
    (
      select jsonb_build_object(
        'id', c.id,
        'post_id', c.post_id,
        'user_name', c.user_name,
        'content', c.content,
        'created_at', c.created_at
      )
      from public.comments c
      where c.post_id = posts.post_id
      order by c.created_at desc, c.id desc
      limit 1
    ) as latest_comment
  from public.comments counted
  where counted.post_id = posts.post_id
) comments on true
left join lateral (
  select true as bookmarked_by_me
  from public.wishlist w
  where w.post_id = posts.post_id
    and w.user_name = (select username from viewer)
  limit 1
) bookmarks on true
left join lateral (
  select
    count(*) filter (where rf.feedback_label = 'Helpful')::bigint as must_try_count,
    count(*) filter (where rf.feedback_label = 'Disagree')::bigint as not_worth_it_count,
    max(case
      when rf.feedback_user_id = p_viewer_user_id and rf.feedback_label = 'Helpful' then 'MUST_TRY'
      when rf.feedback_user_id = p_viewer_user_id and rf.feedback_label = 'Disagree' then 'NOT_WORTH_IT'
    end) as food_reaction
  from public.recommendation_feedback rf
  where rf.post_id = posts.post_id
) feedback on true;
$$;

revoke all on function public.mobile_post_engagement_v1(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.mobile_post_engagement_v1(uuid[], uuid) to service_role;
comment on function public.mobile_post_engagement_v1(uuid[], uuid) is
  'Service-only bounded engagement aggregation for at most 100 posts; avoids transferring raw likes/comments/feedback rows.';

create or replace function public.mobile_public_feed_page_v1(
  p_scope text default 'public',
  p_viewer_user_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 24,
  p_place_id text default null,
  p_restaurant_name text default null,
  p_restaurant_address text default null,
  p_canonical_dish_id uuid default null,
  p_dish_normalized_name text default null,
  p_post_id uuid default null,
  p_profile_name text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select
    case when p_scope in ('public', 'restaurant', 'dish', 'detail', 'profile') then p_scope else 'public' end as scope,
    least(greatest(coalesce(p_limit, 24), 1), 50) as row_limit,
    nullif(btrim(coalesce(p_place_id, '')), '') as place_id,
    nullif(btrim(coalesce(p_restaurant_name, '')), '') as restaurant_name,
    lower(nullif(btrim(coalesce(p_restaurant_address, '')), '')) as restaurant_address,
    lower(nullif(btrim(coalesce(p_dish_normalized_name, '')), '')) as dish_name
), viewer as (
  select p.id, p.username
  from public.profiles p
  where p.id = p_viewer_user_id
    and coalesce(p.account_status, 'active') = 'active'
), candidate_rows as (
  select r.*
  from public.reviews r
  cross join params x
  where (x.scope in ('detail', 'profile') or r.visibility = 'public')
    and r.deleted_at is null and r.hidden_at is null and r.reported_at is null
    and r.status = 'active'
    and (
      (x.scope = 'detail' and r.id = p_post_id)
      or (
        x.scope = 'profile'
        and r.reviewer_name = nullif(btrim(coalesce(p_profile_name, '')), '')
        and (
          r.visibility = 'public'
          or r.reviewer_name = (select username from viewer)
          or (
            r.visibility = 'circle'
            and exists (
              select 1 from public.circle_memberships membership
              where membership.user_name = r.reviewer_name
                and membership.member_name = (select username from viewer)
            )
          )
        )
      )
      or x.scope = 'public'
      or (
        x.scope in ('restaurant', 'dish')
        and (
          (x.place_id is not null and r.restaurant_id = x.place_id)
          or (
            x.place_id is null and x.restaurant_name is not null
            and r.restaurant_name = x.restaurant_name
            and (
              x.restaurant_address is null
              or lower(coalesce(r.area, '')) = x.restaurant_address
              or lower(coalesce(r.restaurant_address, '')) = x.restaurant_address
            )
          )
          or (x.scope = 'dish' and x.place_id is null and x.restaurant_name is null)
        )
      )
    )
    and (
      x.scope <> 'dish'
      or exists (
        select 1
        from public.review_dish_mentions mention
        where mention.review_id = r.id
          and mention.deleted_at is null
          and (
            (p_canonical_dish_id is not null and mention.canonical_dish_id = p_canonical_dish_id)
            or (p_canonical_dish_id is null and x.dish_name is not null and mention.normalized_name = x.dish_name)
          )
      )
    )
    and not exists (
      select 1
      from public.blocked_users block
      cross join viewer v
      where (block.blocker_name = v.username and block.blocked_name = r.reviewer_name)
         or (block.blocked_name = v.username and block.blocker_name = r.reviewer_name)
    )
    and (
      p_cursor_created_at is null
      or r.created_at < p_cursor_created_at
      or (p_cursor_id is not null and r.created_at = p_cursor_created_at and r.id < p_cursor_id)
    )
  order by r.created_at desc, r.id desc
  limit ((select row_limit from params) + 1)
), selected as (
  select *
  from candidate_rows
  order by created_at desc, id desc
  limit (select row_limit from params)
), rows_with_media as (
  select
    selected.*,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'media_asset_id', photo.media_asset_id,
        'public_url', case when photo.media_asset_id is null then photo.public_url else null end,
        'media_type', photo.media_type,
        'position', photo.position
      ) order by photo.position asc, photo.id asc)
      from public.review_photos photo
      where photo.review_id = selected.id
    ), '[]'::jsonb) as review_photos
  from selected
), page_state as (
  select
    count(*) > (select row_limit from params) as has_more
  from candidate_rows
)
select jsonb_build_object(
  'reviews', coalesce((select jsonb_agg(to_jsonb(rows_with_media) order by created_at desc, id desc) from rows_with_media), '[]'::jsonb),
  'hasMore', (select has_more from page_state),
  'nextCursor', case
    when (select has_more from page_state) then (
      select jsonb_build_object('createdAt', created_at, 'id', id)
      from selected order by created_at asc, id asc limit 1
    )
    else null
  end,
  'viewerName', coalesce((select username from viewer), '')
);
$$;

revoke all on function public.mobile_public_feed_page_v1(text, uuid, timestamptz, uuid, integer, text, text, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.mobile_public_feed_page_v1(text, uuid, timestamptz, uuid, integer, text, text, text, uuid, text, uuid, text) to service_role;

create or replace function public.circle_feed_page_v2(
  p_viewer_user_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 24,
  p_exclude_post_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select p.id, p.username,
    coalesce(nullif(trim(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, ''))), ''), p.username) as display_name
  from public.profiles p
  where p.id = p_viewer_user_id
    and coalesce(p.account_status, 'active') = 'active'
), params as (
  select least(greatest(coalesce(p_limit, 24), 1), 50) as row_limit
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
        'media_asset_id', photo.media_asset_id,
        'public_url', case when photo.media_asset_id is null then photo.public_url else null end,
        'media_type', photo.media_type,
        'position', photo.position
      ) order by photo.position asc, photo.id asc)
      from public.review_photos photo where photo.review_id = selected.id
    ), '[]'::jsonb) as review_photos
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

revoke all on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) to service_role;
comment on function public.circle_feed_page_v2(uuid, timestamptz, uuid, integer, uuid[]) is
  'Service-only canonical Circle page: one actor ID, SQL visibility/block enforcement, bounded composite cursor, author metadata and media references.';

create or replace function public.touch_shared_memory_room_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shared_memory_rooms
  set updated_at = greatest(coalesce(updated_at, created_at), now())
  where id = case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists touch_shared_memory_room_on_message on public.shared_memory_messages;
create trigger touch_shared_memory_room_on_message
after insert or update or delete on public.shared_memory_messages
for each row execute function public.touch_shared_memory_room_activity();

drop trigger if exists touch_shared_memory_room_on_photo on public.shared_memory_photos;
create trigger touch_shared_memory_room_on_photo
after insert or update or delete on public.shared_memory_photos
for each row execute function public.touch_shared_memory_room_activity();

drop trigger if exists touch_shared_memory_room_on_dish on public.shared_memory_dishes;
create trigger touch_shared_memory_room_on_dish
after insert or update or delete on public.shared_memory_dishes
for each row execute function public.touch_shared_memory_room_activity();

drop trigger if exists touch_shared_memory_room_on_stop on public.shared_memory_stops;
create trigger touch_shared_memory_room_on_stop
after insert or update or delete on public.shared_memory_stops
for each row execute function public.touch_shared_memory_room_activity();

update public.shared_memory_rooms room
set updated_at = greatest(
  coalesce(room.updated_at, room.created_at),
  coalesce((select max(message.created_at) from public.shared_memory_messages message where message.room_id = room.id), room.created_at),
  coalesce((select max(photo.created_at) from public.shared_memory_photos photo where photo.room_id = room.id), room.created_at),
  coalesce((select max(dish.created_at) from public.shared_memory_dishes dish where dish.room_id = room.id), room.created_at)
);

create index if not exists shared_memory_rooms_activity_cursor_idx
  on public.shared_memory_rooms(updated_at desc, id desc);

create or replace function public.shared_memory_room_summaries_v2(
  p_limit integer default 50,
  p_before_activity_at timestamptz default null,
  p_before_room_id uuid default null
)
returns table(
  id uuid,
  title text,
  occasion_type text,
  occasion_confidence numeric,
  occasion_confirmed_by_user boolean,
  theme_key text,
  restaurant_name text,
  area text,
  visit_date date,
  source_post_id uuid,
  created_by text,
  participant_count bigint,
  photo_count bigint,
  message_count bigint,
  dish_count bigint,
  unread_count bigint,
  latest_message text,
  latest_activity_at timestamptz,
  place_names text[],
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select public.current_profile_name() as username
), rooms as (
  select room.*
  from public.shared_memory_members member
  join public.shared_memory_rooms room on room.id = member.room_id
  cross join viewer
  where viewer.username is not null
    and member.user_name = viewer.username
    and not public.shared_memory_room_has_blocked_relationship(room.id, viewer.username)
    and (
      p_before_activity_at is null
      or room.updated_at < p_before_activity_at
      or (p_before_room_id is not null and room.updated_at = p_before_activity_at and room.id < p_before_room_id)
    )
  order by room.updated_at desc, room.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
)
select
  room.id, room.title, room.occasion_type, room.occasion_confidence,
  room.occasion_confirmed_by_user, room.theme_key, room.restaurant_name,
  room.area, room.visit_date, room.source_post_id, room.created_by,
  (select count(*) from public.shared_memory_members member where member.room_id = room.id),
  (select count(*) from public.shared_memory_photos photo where photo.room_id = room.id and coalesce(photo.moderation_status, 'approved') = 'approved'),
  (select count(*) from public.shared_memory_messages message where message.room_id = room.id),
  (select count(*) from public.shared_memory_dishes dish where dish.room_id = room.id),
  (select count(*) from public.shared_memory_messages message
    where message.room_id = room.id
      and message.author_name <> (select username from viewer)
      and message.created_at > coalesce((select read.last_read_at from public.shared_memory_reads read where read.room_id = room.id and read.user_name = (select username from viewer)), '-infinity'::timestamptz)),
  (select left(message.body, 160) from public.shared_memory_messages message where message.room_id = room.id order by message.created_at desc, message.id desc limit 1),
  room.updated_at,
  array_remove(array_prepend(room.restaurant_name, array(select stop.name from public.shared_memory_stops stop where stop.room_id = room.id order by stop.position, stop.id)), null),
  room.created_at
from rooms room
order by room.updated_at desc, room.id desc;
$$;

revoke all on function public.shared_memory_room_summaries_v2(integer, timestamptz, uuid) from public, anon;
grant execute on function public.shared_memory_room_summaries_v2(integer, timestamptz, uuid) to authenticated, service_role;

-- Replace the Phase 2 chat payload with the same bounded contract while keeping
-- private Storage identifiers behind the API server. The API resolves only the
-- returned photo ids to short-lived signed URLs after this membership-aware RPC
-- succeeds.
create or replace function public.shared_memory_chat_page(
  p_room_id uuid,
  p_before_created_at timestamptz default null,
  p_before_message_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_name text := public.current_profile_name();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_payload jsonb := '{}'::jsonb;
begin
  if v_user_name is null or not public.can_read_shared_memory(p_room_id) then
    raise exception 'Memory room not found' using errcode = 'P0001';
  end if;

  with paged_desc as (
    select
      message.id, message.room_id, message.author_name, message.body,
      message.reply_to_message_id, message.created_at, message.edited_at
    from public.shared_memory_messages message
    where message.room_id = p_room_id
      and (
        p_before_created_at is null
        or message.created_at < p_before_created_at
        or (
          p_before_message_id is not null
          and message.created_at = p_before_created_at
          and message.id < p_before_message_id
        )
      )
    order by message.created_at desc, message.id desc
    limit (v_limit + 1)
  ), selected_desc as (
    select * from paged_desc order by created_at desc, id desc limit v_limit
  ), selected_messages as (
    select * from selected_desc order by created_at asc, id asc
  ), page_state as (
    select
      (select count(*) > v_limit from paged_desc) as has_more,
      (select created_at from selected_messages order by created_at asc, id asc limit 1) as next_created_at,
      (select id from selected_messages order by created_at asc, id asc limit 1) as next_message_id
  ), reply_messages as (
    select
      reply.id, reply.room_id, reply.author_name, reply.body,
      reply.reply_to_message_id, reply.created_at, reply.edited_at
    from public.shared_memory_messages reply
    where reply.room_id = p_room_id
      and reply.id in (
        select selected_messages.reply_to_message_id
        from selected_messages
        where selected_messages.reply_to_message_id is not null
      )
      and not exists (
        select 1 from selected_messages where selected_messages.id = reply.id
      )
  ), page_photos as (
    select
      photo.id, photo.room_id, photo.stop_id, photo.message_id,
      photo.uploader_name, photo.uploader_id, photo.media_type,
      photo.image_width, photo.image_height, photo.position,
      photo.upload_intent_id, photo.moderation_status,
      photo.moderation_reason, photo.file_size_bytes, photo.mime_type,
      photo.duration_ms, photo.created_at
    from public.shared_memory_photos photo
    where photo.room_id = p_room_id
      and photo.message_id in (select id from selected_messages)
      and (
        coalesce(photo.moderation_status, 'approved') = 'approved'
        or (photo.moderation_status = 'pending' and photo.uploader_name = v_user_name)
      )
  ), profile_names as (
    select author_name as username from selected_messages
    union select author_name from reply_messages
    union select uploader_name from page_photos
  ), page_profiles as (
    select profile.username, profile.first_name, profile.last_name
    from public.profiles profile
    join profile_names on profile_names.username = profile.username
  )
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(to_jsonb(selected_messages) order by created_at asc, id asc)
      from selected_messages
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(to_jsonb(page_photos) order by position asc nulls last, created_at asc, id asc)
      from page_photos
    ), '[]'::jsonb),
    'replyMessages', coalesce((
      select jsonb_agg(to_jsonb(reply_messages) order by created_at asc, id asc)
      from reply_messages
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(page_profiles) order by username asc)
      from page_profiles
    ), '[]'::jsonb),
    'nextCursor', case
      when page_state.has_more and page_state.next_created_at is not null and page_state.next_message_id is not null
        then page_state.next_created_at::text || '|' || page_state.next_message_id::text
      else null
    end
  ) into v_payload
  from page_state;

  return coalesce(v_payload, jsonb_build_object(
    'messages', '[]'::jsonb,
    'photos', '[]'::jsonb,
    'replyMessages', '[]'::jsonb,
    'profiles', '[]'::jsonb,
    'nextCursor', null
  ));
end;
$$;

revoke all on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) to authenticated, service_role;

comment on function public.shared_memory_chat_page(uuid, timestamptz, uuid, integer) is
  'Bounded membership-aware chat page. Media DTOs intentionally omit private Storage paths and stored signed URLs.';

create or replace function public.shared_memory_room_bootstrap_v1(
  p_room_id uuid,
  p_message_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select public.current_profile_name() as username
), allowed as (
  select room.*
  from public.shared_memory_rooms room
  cross join viewer
  where room.id = p_room_id
    and viewer.username is not null
    and public.can_read_shared_memory(room.id)
), names as (
  select member.user_name as username from public.shared_memory_members member where member.room_id = p_room_id
  union select stop.created_by from public.shared_memory_stops stop where stop.room_id = p_room_id
  union select dish.added_by from public.shared_memory_dishes dish where dish.room_id = p_room_id
  union select rating.rated_by from public.shared_memory_dish_ratings rating where rating.room_id = p_room_id
), profiles as (
  select profile.username, profile.first_name, profile.last_name
  from public.profiles profile join names on names.username = profile.username
)
select case when not exists (select 1 from allowed) then null else jsonb_build_object(
  'room', (select to_jsonb(allowed) from allowed),
  'members', coalesce((select jsonb_agg(to_jsonb(member) order by member.created_at, member.id) from public.shared_memory_members member where member.room_id = p_room_id), '[]'::jsonb),
  'stops', coalesce((select jsonb_agg(to_jsonb(stop) order by stop.position, stop.created_at, stop.id) from public.shared_memory_stops stop where stop.room_id = p_room_id), '[]'::jsonb),
  'dishes', coalesce((select jsonb_agg(to_jsonb(dish) order by dish.created_at, dish.id) from public.shared_memory_dishes dish where dish.room_id = p_room_id), '[]'::jsonb),
  'dishRatings', coalesce((select jsonb_agg(to_jsonb(rating) order by rating.created_at, rating.id) from public.shared_memory_dish_ratings rating where rating.room_id = p_room_id), '[]'::jsonb),
  'read', (select to_jsonb(read) from public.shared_memory_reads read where read.room_id = p_room_id and read.user_name = (select username from viewer)),
  'profiles', coalesce((select jsonb_agg(to_jsonb(profiles) order by username) from profiles), '[]'::jsonb),
  'chat', public.shared_memory_chat_page(p_room_id, null, null, least(greatest(coalesce(p_message_limit, 50), 1), 100))
) end;
$$;

revoke all on function public.shared_memory_room_bootstrap_v1(uuid, integer) from public, anon;
grant execute on function public.shared_memory_room_bootstrap_v1(uuid, integer) to authenticated, service_role;

create or replace function public.shared_memory_media_page_v1(
  p_room_id uuid,
  p_before_created_at timestamptz default null,
  p_before_photo_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select public.current_profile_name() as username
), allowed as (
  select 1
  from viewer
  where viewer.username is not null and public.can_read_shared_memory(p_room_id)
), params as (
  select least(greatest(coalesce(p_limit, 30), 1), 50) row_limit
), candidates as (
  select photo.*
  from public.shared_memory_photos photo cross join viewer
  where exists (select 1 from allowed)
    and photo.room_id = p_room_id
    and (
      coalesce(photo.moderation_status, 'approved') = 'approved'
      or (photo.moderation_status = 'pending' and photo.uploader_name = viewer.username)
    )
    and (
      p_before_created_at is null
      or photo.created_at < p_before_created_at
      or (p_before_photo_id is not null and photo.created_at = p_before_created_at and photo.id < p_before_photo_id)
    )
  order by photo.created_at desc, photo.id desc
  limit ((select row_limit from params) + 1)
), selected as (
  select * from candidates order by created_at desc, id desc limit (select row_limit from params)
), profiles as (
  select profile.username, profile.first_name, profile.last_name
  from public.profiles profile
  where profile.username in (select uploader_name from selected)
)
select jsonb_build_object(
  'photos', coalesce((select jsonb_agg(to_jsonb(selected) - 'storage_path' - 'public_url' order by created_at desc, id desc) from selected), '[]'::jsonb),
  'profiles', coalesce((select jsonb_agg(to_jsonb(profiles) order by username) from profiles), '[]'::jsonb),
  'nextCursor', case when (select count(*) from candidates) > (select row_limit from params) then (
    select created_at::text || '|' || id::text from selected order by created_at asc, id asc limit 1
  ) else null end
);
$$;

revoke all on function public.shared_memory_media_page_v1(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.shared_memory_media_page_v1(uuid, timestamptz, uuid, integer) to authenticated, service_role;

create or replace function public.explore_discovery_canonical_v3(
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with viewer as (
  select public.current_profile_name() as username
), params as (
  select
    least(greatest(coalesce(p_limit, 30), 1), 30) as row_limit,
    case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end as lat,
    case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end as lng
), place_candidates as (
  select stats.*,
    case when params.lat is null then null else
      power(stats.latitude - params.lat, 2) + power((stats.longitude - params.lng) * greatest(0.2, cos(radians(params.lat))), 2)
    end as distance_score
  from public.place_stats stats cross join params
  where params.lat is null
     or (stats.latitude between params.lat - 1 and params.lat + 1 and stats.longitude between params.lng - 1 and params.lng + 1)
  order by distance_score asc nulls last, stats.last_review_at desc, stats.place_id
  limit (select row_limit from params)
), places_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', 'place:' || place.place_id,
    'name', place.display_name,
    'placeId', place.place_id,
    'area', place.area,
    'photo', media.photo,
    'averageRating', place.average_rating,
    'categoryTags', '[]'::jsonb,
    'circleReviewers', coalesce(circle_review.reviewers, '[]'::jsonb),
    'ratingCount', place.review_count,
    'tags', '[]'::jsonb,
    'topDishes', coalesce(dishes.names, '[]'::jsonb),
    'postCount', place.review_count
  ) order by place.distance_score asc nulls last, place.last_review_at desc, place.place_id), '[]'::jsonb) payload
  from place_candidates place
  left join lateral (
    select jsonb_agg(dish.display_name order by stat.mention_count desc, dish.display_name) names
    from (
      select * from public.place_dish_stats stat
      where stat.place_id = place.place_id
      order by stat.mention_count desc, stat.canonical_dish_id
      limit 2
    ) stat
    join public.canonical_dishes dish on dish.id = stat.canonical_dish_id
  ) dishes on true
  left join lateral (
    select jsonb_agg(reviewer.display_name order by reviewer.latest_review_at desc, reviewer.username) reviewers
    from (
      select
        profile.username,
        coalesce(nullif(trim(concat_ws(' ', nullif(profile.first_name, ''), nullif(profile.last_name, ''))), ''), profile.username) display_name,
        max(review.created_at) latest_review_at
      from public.reviews review
      join public.profiles profile on profile.username = review.reviewer_name
      cross join viewer
      where review.restaurant_id = place.place_id
        and review.visibility = 'public'
        and review.deleted_at is null and review.hidden_at is null and review.reported_at is null
        and review.status = 'active'
        and coalesce(profile.account_status, 'active') = 'active'
        and not exists (
          select 1 from public.blocked_users block
          where (block.blocker_name = viewer.username and block.blocked_name = profile.username)
             or (block.blocked_name = viewer.username and block.blocker_name = profile.username)
        )
        and exists (
          select 1 from public.circle_memberships membership
          where membership.member_name = viewer.username
            and membership.user_name = profile.username
        )
      group by profile.username, profile.first_name, profile.last_name
      order by latest_review_at desc, profile.username
      limit 8
    ) reviewer
  ) circle_review on true
  left join lateral (
    select coalesce(derivative.public_url, case when photo.media_asset_id is null then photo.public_url end) photo
    from public.reviews review
    join public.review_photos photo on photo.review_id = review.id
    cross join viewer
    left join public.media_assets asset on asset.id = photo.media_asset_id
    left join public.media_derivatives derivative on derivative.asset_id = asset.id and derivative.kind = 'thumbnail' and derivative.bucket_id = 'media-public'
    where review.restaurant_id = place.place_id
      and review.visibility = 'public' and review.deleted_at is null and review.hidden_at is null and review.reported_at is null and review.status = 'active'
      and not exists (
        select 1 from public.blocked_users block
        where (block.blocker_name = viewer.username and block.blocked_name = review.reviewer_name)
           or (block.blocked_name = viewer.username and block.blocker_name = review.reviewer_name)
      )
      and (photo.media_asset_id is null or (asset.status = 'ready' and asset.visibility = 'public' and coalesce(asset.moderation_status, 'approved') = 'approved'))
    order by review.created_at desc, review.id desc, photo.position asc
    limit 1
  ) media on true
), dish_candidates as (
  select
    dish.id, dish.display_name, dish.normalized_name, dish.family_tokens,
    sum(stat.mention_count)::integer as mention_count,
    sum(stat.mention_count)::integer as rating_count,
    case when sum(stat.mention_count) > 0 then round(sum(stat.average_rating * stat.mention_count) / sum(stat.mention_count), 2) end as average_rating,
    max(stat.last_review_at) as last_review_at,
    (array_agg(place.display_name order by stat.mention_count desc, stat.last_review_at desc, place.display_name))[1:3] as top_restaurants,
    min(case when params.lat is null then null else power(place.latitude - params.lat, 2) + power((place.longitude - params.lng) * greatest(0.2, cos(radians(params.lat))), 2) end) as distance_score
  from public.dish_place_stats stat
  join public.canonical_dishes dish on dish.id = stat.canonical_dish_id and dish.status in ('verified', 'generated') and dish.merged_into_dish_id is null
  join public.place_stats place on place.place_id = stat.place_id
  cross join params
  where params.lat is null
     or (place.latitude between params.lat - 1 and params.lat + 1 and place.longitude between params.lng - 1 and params.lng + 1)
  group by dish.id, dish.display_name, dish.normalized_name, dish.family_tokens
  order by distance_score asc nulls last, mention_count desc, last_review_at desc, dish.id
  limit (select row_limit from params)
), dishes_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', 'canonical:' || dish.id,
    'name', dish.display_name,
    'familyId', coalesce((public.dish_identity_explore_categories(dish.normalized_name))[1], 'other'),
    'familyIds', to_jsonb(case when dish.family_tokens = '{}'::text[] then public.dish_identity_family_tokens(dish.normalized_name) else dish.family_tokens end),
    'familyName', initcap(coalesce((case when dish.family_tokens = '{}'::text[] then public.dish_identity_family_tokens(dish.normalized_name) else dish.family_tokens end)[1], 'other')),
    'familyNames', to_jsonb(array(select initcap(token) from unnest(case when dish.family_tokens = '{}'::text[] then public.dish_identity_family_tokens(dish.normalized_name) else dish.family_tokens end) token)),
    'topRestaurantNames', to_jsonb(coalesce(dish.top_restaurants, '{}'::text[])),
    'photo', image.image_url,
    'averageRating', dish.average_rating,
    'categoryTags', to_jsonb(public.dish_identity_explore_categories(dish.normalized_name)),
    'mentionCount', dish.mention_count,
    'ratingCount', dish.rating_count,
    'tags', '[]'::jsonb,
    'snippet', null
  ) order by dish.distance_score asc nulls last, dish.mention_count desc, dish.last_review_at desc, dish.id), '[]'::jsonb) payload
  from dish_candidates dish
  left join lateral (
    select image.image_url from public.canonical_dish_images image
    where image.canonical_dish_id = dish.id and image.status = 'approved'
    order by image.is_primary desc, image.approved_at desc nulls last, image.id
    limit 1
  ) image on true
), recent_people_reviews as (
  select review.reviewer_name, review.restaurant_id, review.restaurant_name, review.area
  from public.reviews review
  where review.visibility = 'public' and review.deleted_at is null and review.hidden_at is null and review.reported_at is null and review.status = 'active'
  order by review.created_at desc, review.id desc
  limit 120
), people_candidates as (
  select profile.username,
    coalesce(nullif(trim(concat_ws(' ', nullif(profile.first_name, ''), nullif(profile.last_name, ''))), ''), profile.username) display_name,
    case when profile.account_type = 'private' then 'private' else 'public' end account_type,
    count(distinct coalesce(review.restaurant_id, lower(review.restaurant_name) || '::' || lower(coalesce(review.area, ''))))::integer total_places
  from recent_people_reviews review
  join public.profiles profile on profile.username = review.reviewer_name
  cross join viewer
  where profile.username <> coalesce(viewer.username, '') and coalesce(profile.account_status, 'active') = 'active'
    and not exists (
      select 1 from public.blocked_users block
      where (block.blocker_name = viewer.username and block.blocked_name = profile.username)
         or (block.blocked_name = viewer.username and block.blocker_name = profile.username)
    )
  group by profile.username, profile.first_name, profile.last_name, profile.account_type
  order by total_places desc, display_name, profile.username
  limit (select row_limit from params)
), people_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'username', person.username,
    'displayName', person.display_name,
    'initials', upper(left(regexp_replace(person.display_name, '[^[:alnum:]]', '', 'g'), 2)),
    'totalPlaces', person.total_places,
    'accountType', person.account_type,
    'circleStatus', case
      when exists (select 1 from public.circle_memberships membership cross join viewer where membership.member_name = viewer.username and membership.user_name = person.username) then 'joined'
      when exists (select 1 from public.circle_requests request cross join viewer where request.sender_name = viewer.username and request.receiver_name = person.username and request.status = 'pending') then 'pending'
      else 'idle' end
  ) order by person.total_places desc, person.display_name, person.username), '[]'::jsonb) payload
  from people_candidates person
)
select jsonb_build_object(
  'viewerName', viewer.username,
  'places', (select payload from places_json),
  'dishes', (select payload from dishes_json),
  'people', (select payload from people_json)
)
from viewer;
$$;

revoke all on function public.explore_discovery_canonical_v3(double precision, double precision, integer) from public, anon;
grant execute on function public.explore_discovery_canonical_v3(double precision, double precision, integer) to authenticated;
comment on function public.explore_discovery_canonical_v3(double precision, double precision, integer) is
  'Authenticated-profile-gated projection Explore payload. SECURITY DEFINER keeps raw projection tables private; public content is bounded and account/block rules remain inside the function.';

create or replace function public.reconcile_phase5_projections(
  p_apply boolean default false,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_room_drift integer := 0;
  v_rooms_repaired integer := 0;
  v_missing_places integer := 0;
  v_missing_dish_places integer := 0;
begin
  with expected as (
    select room.id,
      greatest(
        room.created_at,
        coalesce((select max(message.created_at) from public.shared_memory_messages message where message.room_id = room.id), room.created_at),
        coalesce((select max(photo.created_at) from public.shared_memory_photos photo where photo.room_id = room.id), room.created_at),
        coalesce((select max(dish.created_at) from public.shared_memory_dishes dish where dish.room_id = room.id), room.created_at)
      ) expected_at
    from public.shared_memory_rooms room
    order by room.id
    limit v_limit
  )
  select count(*) into v_room_drift
  from expected join public.shared_memory_rooms room using (id)
  where room.updated_at < expected.expected_at;

  select count(*) into v_missing_places
  from (
    select distinct review.restaurant_id
    from public.reviews review
    where review.restaurant_id is not null
      and review.visibility = 'public' and review.deleted_at is null and review.hidden_at is null
      and review.reported_at is null and review.status = 'active'
    order by review.restaurant_id
    limit v_limit
  ) review_place
  left join public.place_stats stats on stats.place_id = review_place.restaurant_id
  where stats.place_id is null;

  select count(*) into v_missing_dish_places
  from (
    select distinct mention.canonical_dish_id, mention.place_id
    from public.review_dish_mentions mention
    where mention.deleted_at is null and mention.canonical_dish_id is not null and mention.place_id is not null
    order by mention.canonical_dish_id, mention.place_id
    limit v_limit
  ) mention_pair
  left join public.dish_place_stats stats
    on stats.canonical_dish_id = mention_pair.canonical_dish_id and stats.place_id = mention_pair.place_id
  where stats.canonical_dish_id is null;

  if p_apply then
    with expected as (
      select room.id,
        greatest(
          room.created_at,
          coalesce((select max(message.created_at) from public.shared_memory_messages message where message.room_id = room.id), room.created_at),
          coalesce((select max(photo.created_at) from public.shared_memory_photos photo where photo.room_id = room.id), room.created_at),
          coalesce((select max(dish.created_at) from public.shared_memory_dishes dish where dish.room_id = room.id), room.created_at)
        ) expected_at
      from public.shared_memory_rooms room
      order by room.id
      limit v_limit
    )
    update public.shared_memory_rooms room
    set updated_at = expected.expected_at
    from expected
    where room.id = expected.id and room.updated_at < expected.expected_at;
    get diagnostics v_rooms_repaired = row_count;
  end if;

  return jsonb_build_object(
    'apply', p_apply,
    'limit', v_limit,
    'roomActivityDrift', v_room_drift,
    'roomsRepaired', v_rooms_repaired,
    'missingPlaceStats', v_missing_places,
    'missingDishPlaceStats', v_missing_dish_places
  );
end;
$$;

revoke all on function public.reconcile_phase5_projections(boolean, integer) from public, anon, authenticated;
grant execute on function public.reconcile_phase5_projections(boolean, integer) to service_role;
