-- Backend-ranked Circle feed page for mobile.
--
-- Ordering:
--   1. unseen posts before seen posts
--   2. joined-circle authors before my own posts before public discovery
--   3. engagement/media score
--   4. recency

create or replace function public.circle_feed_page_v1(
  p_cursor text default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_viewer_name text := public.current_profile_name();
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_cursor jsonb := null;
  v_cursor_seen_bucket integer := null;
  v_cursor_author_priority integer := null;
  v_cursor_rank_score numeric := null;
  v_cursor_created_at timestamptz := null;
  v_cursor_id uuid := null;
  v_payload jsonb := '{}'::jsonb;
begin
  if v_user_id is null or v_viewer_name is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null, 'viewerName', '');
  end if;

  if p_cursor is not null and btrim(p_cursor) <> '' then
    begin
      v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_seen_bucket := (v_cursor ->> 'seenBucket')::integer;
      v_cursor_author_priority := (v_cursor ->> 'authorPriority')::integer;
      v_cursor_rank_score := (v_cursor ->> 'rankScore')::numeric;
      v_cursor_created_at := (v_cursor ->> 'createdAt')::timestamptz;
      v_cursor_id := (v_cursor ->> 'id')::uuid;
    exception
      when others then
        v_cursor := null;
    end;
  end if;

  with joined_circle_owners as (
    select distinct membership.user_name
    from public.circle_memberships membership
    where membership.member_name = v_viewer_name
  ),
  pending_sent_owners as (
    select distinct request.receiver_name
    from public.circle_requests request
    where request.sender_name = v_viewer_name
      and request.status = 'pending'
  ),
  circle_candidates as (
    select
      review.*,
      case
        when review.reviewer_name = v_viewer_name then 'self'
        else 'circle'
      end as feed_source
    from public.reviews review
    where review.reviewer_name in (
        select v_viewer_name
        union
        select joined_circle_owners.user_name from joined_circle_owners
      )
      and review.visibility in ('public', 'circle')
      and review.deleted_at is null
      and review.hidden_at is null
      and review.reported_at is null
      and review.status = 'active'
      and not public.is_blocked_with(review.reviewer_name)
    order by review.created_at desc, review.id desc
    limit (v_limit * 12)
  ),
  public_candidates as (
    select
      review.*,
      'public_discovery'::text as feed_source
    from public.reviews review
    where review.visibility = 'public'
      and review.deleted_at is null
      and review.hidden_at is null
      and review.reported_at is null
      and review.status = 'active'
      and review.reviewer_name <> v_viewer_name
      and not exists (
        select 1
        from joined_circle_owners owner
        where owner.user_name = review.reviewer_name
      )
      and not exists (
        select 1
        from pending_sent_owners owner
        where owner.receiver_name = review.reviewer_name
      )
      and not public.is_blocked_with(review.reviewer_name)
    order by review.created_at desc, review.id desc
    limit (v_limit * 6)
  ),
  candidates as (
    select * from circle_candidates
    union all
    select * from public_candidates
  ),
  enriched as (
    select
      candidate.*,
      case
        when impression.post_id is null then 0
        else 1
      end as seen_bucket,
      case
        when candidate.feed_source = 'circle' then 2
        when candidate.feed_source = 'self' then 1
        else 0
      end as author_priority,
      (impression.post_id is not null) as has_seen,
      coalesce(like_stats.like_count, 0)::integer as like_count,
      coalesce(comment_stats.comment_count, 0)::integer as comment_count,
      coalesce(like_stats.liked_by_me, false) as liked_by_me,
      exists (
        select 1
        from public.wishlist wishlist
        where wishlist.post_id = candidate.id
          and wishlist.user_name = v_viewer_name
      ) as bookmarked_by_me,
      (
        coalesce(comment_stats.comment_count, 0) * 3
        + coalesce(like_stats.like_count, 0) * 2
        + least(coalesce(photo_stats.photo_count, 0) + coalesce(array_length(candidate.photo_urls, 1), 0) + case when candidate.photo_url is null then 0 else 1 end, 3)
      )::numeric as rank_score
    from candidates candidate
    left join public.post_impressions impression
      on impression.post_id = candidate.id
     and impression.viewer_user_id = v_user_id
    left join lateral (
      select
        count(*)::integer as like_count,
        coalesce(bool_or(like_row.user_name = v_viewer_name), false) as liked_by_me
      from public.likes like_row
      where like_row.post_id = candidate.id
        and not public.is_blocked_with(like_row.user_name)
    ) like_stats on true
    left join lateral (
      select count(*)::integer as comment_count
      from public.comments comment_row
      where comment_row.post_id = candidate.id
        and not public.is_blocked_with(comment_row.user_name)
    ) comment_stats on true
    left join lateral (
      select count(*)::integer as photo_count
      from public.review_photos photo
      where photo.review_id = candidate.id
    ) photo_stats on true
  ),
  after_cursor as (
    select *
    from enriched
    where v_cursor is null
      or enriched.seen_bucket > v_cursor_seen_bucket
      or (
        enriched.seen_bucket = v_cursor_seen_bucket
        and enriched.author_priority < v_cursor_author_priority
      )
      or (
        enriched.seen_bucket = v_cursor_seen_bucket
        and enriched.author_priority = v_cursor_author_priority
        and enriched.rank_score < v_cursor_rank_score
      )
      or (
        enriched.seen_bucket = v_cursor_seen_bucket
        and enriched.author_priority = v_cursor_author_priority
        and enriched.rank_score = v_cursor_rank_score
        and enriched.created_at < v_cursor_created_at
      )
      or (
        enriched.seen_bucket = v_cursor_seen_bucket
        and enriched.author_priority = v_cursor_author_priority
        and enriched.rank_score = v_cursor_rank_score
        and enriched.created_at = v_cursor_created_at
        and enriched.id < v_cursor_id
      )
  ),
  page_plus as (
    select *
    from after_cursor
    order by seen_bucket asc, author_priority desc, rank_score desc, created_at desc, id desc
    limit (v_limit + 1)
  ),
  selected as (
    select *
    from page_plus
    order by seen_bucket asc, author_priority desc, rank_score desc, created_at desc, id desc
    limit v_limit
  ),
  selected_photos as (
    select
      photo.review_id,
      jsonb_agg(
        jsonb_build_object(
          'public_url', photo.public_url,
          'media_type', photo.media_type,
          'position', photo.position
        )
        order by photo.position asc nulls last, photo.created_at asc, photo.id asc
      ) as review_photos
    from public.review_photos photo
    where photo.review_id in (select selected.id from selected)
    group by photo.review_id
  ),
  page_state as (
    select
      (select count(*) > v_limit from page_plus) as has_more,
      (
        select selected.seen_bucket
        from selected
        order by seen_bucket desc, author_priority asc, rank_score asc, created_at asc, id asc
        limit 1
      ) as next_seen_bucket,
      (
        select selected.author_priority
        from selected
        order by seen_bucket desc, author_priority asc, rank_score asc, created_at asc, id asc
        limit 1
      ) as next_author_priority,
      (
        select selected.rank_score
        from selected
        order by seen_bucket desc, author_priority asc, rank_score asc, created_at asc, id asc
        limit 1
      ) as next_rank_score,
      (
        select selected.created_at
        from selected
        order by seen_bucket desc, author_priority asc, rank_score asc, created_at asc, id asc
        limit 1
      ) as next_created_at,
      (
        select selected.id
        from selected
        order by seen_bucket desc, author_priority asc, rank_score asc, created_at asc, id asc
        limit 1
      ) as next_id
  )
  select jsonb_build_object(
    'viewerName', v_viewer_name,
    'nextCursor',
      case
        when page_state.has_more and page_state.next_id is not null then
          encode(convert_to(jsonb_build_object(
            'seenBucket', page_state.next_seen_bucket,
            'authorPriority', page_state.next_author_priority,
            'rankScore', page_state.next_rank_score,
            'createdAt', page_state.next_created_at,
            'id', page_state.next_id
          )::text, 'UTF8'), 'base64')
        else null
      end,
    'rows',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', selected.id,
            'reviewer_name', selected.reviewer_name,
            'restaurant_id', selected.restaurant_id,
            'restaurant_name', selected.restaurant_name,
            'area', selected.area,
            'restaurant_address', selected.restaurant_address,
            'restaurant_lat', selected.restaurant_lat,
            'restaurant_lng', selected.restaurant_lng,
            'items', selected.items,
            'body', selected.body,
            'tags', selected.tags,
            'photo_url', selected.photo_url,
            'photo_urls', selected.photo_urls,
            'review_photos', coalesce(selected_photos.review_photos, '[]'::jsonb),
            'visibility', selected.visibility,
            'deleted_at', selected.deleted_at,
            'hidden_at', selected.hidden_at,
            'reported_at', selected.reported_at,
            'status', selected.status,
            'created_at', selected.created_at,
            'feed_source', selected.feed_source,
            'has_seen', selected.has_seen,
            'like_count', selected.like_count,
            'comment_count', selected.comment_count,
            'liked_by_me', selected.liked_by_me,
            'bookmarked_by_me', selected.bookmarked_by_me
          )
          order by selected.seen_bucket asc, selected.author_priority desc, selected.rank_score desc, selected.created_at desc, selected.id desc
        )
        from selected
        left join selected_photos on selected_photos.review_id = selected.id
      ), '[]'::jsonb)
  )
  into v_payload
  from page_state;

  return coalesce(v_payload, jsonb_build_object('rows', '[]'::jsonb, 'nextCursor', null, 'viewerName', v_viewer_name));
end;
$$;

revoke all on function public.circle_feed_page_v1(text, integer) from public;
revoke all on function public.circle_feed_page_v1(text, integer) from anon;
grant execute on function public.circle_feed_page_v1(text, integer) to authenticated, service_role;

comment on function public.circle_feed_page_v1(text, integer) is
  'Backend-ranked Circle feed page for mobile: social graph filtering, seen/unseen ordering, engagement state, media rows, and opaque pagination cursor.';
