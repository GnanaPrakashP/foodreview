-- Collapse the viewer-dependent other-profile header into one service-only
-- database contract. Posts remain a separate cursor-paginated feed request.
create or replace function public.mobile_other_profile_shell_v1(
  p_viewer_user_id uuid,
  p_target_name text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with viewer as (
  select profile.id, profile.username
  from public.profiles profile
  where profile.id = p_viewer_user_id
    and public.is_profile_complete(profile.id)
), target as (
  select
    profile.id,
    coalesce(profile.first_name, '') as first_name,
    coalesce(profile.last_name, '') as last_name,
    profile.username,
    profile.avatar_url,
    profile.bio,
    profile.account_type,
    profile.trust_score,
    profile.trust_level,
    profile.confirmed_recommendations_count,
    profile.positive_confirmations_count,
    profile.negative_confirmations_count,
    profile.total_feedback_points,
    profile.created_at,
    coalesce(
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      profile.username
    ) as display_name
  from public.profiles profile
  where profile.username = lower(btrim(coalesce(p_target_name, '')))
    and public.is_profile_complete(profile.id)
), block_state as (
  select
    exists (
      select 1
      from public.blocked_users block
      cross join viewer
      cross join target
      where block.blocker_name = viewer.username
        and block.blocked_name = target.username
    ) as blocked_by_viewer,
    exists (
      select 1
      from public.blocked_users block
      cross join viewer
      cross join target
      where (block.blocker_name = viewer.username and block.blocked_name = target.username)
         or (block.blocker_name = target.username and block.blocked_name = viewer.username)
    ) as interaction_blocked
), aliases as (
  select target.username as reviewer_name from target
  union
  select target.display_name from target
), visible_reviews as (
  select review.*
  from public.reviews review
  cross join viewer
  cross join target
  cross join block_state
  where review.reviewer_name in (select aliases.reviewer_name from aliases)
    and review.deleted_at is null
    and review.hidden_at is null
    and review.reported_at is null
    and review.status = 'active'
    and not block_state.interaction_blocked
    and (
      review.visibility = 'public'
      or review.reviewer_name = viewer.username
      or (
        review.visibility = 'circle'
        and exists (
          select 1
          from public.circle_memberships membership
          where membership.user_name = target.username
            and membership.member_name = viewer.username
        )
      )
    )
), visible_dishes as (
  select
    coalesce(nullif(review.restaurant_id, ''), lower(review.restaurant_name)) as place_key,
    lower(btrim(item.value ->> 'name')) as dish_name
  from visible_reviews review
  cross join lateral jsonb_array_elements(coalesce(review.items, '[]'::jsonb)) item(value)
  where nullif(btrim(item.value ->> 'name'), '') is not null
), stats as (
  select
    (select count(*)::integer from visible_reviews) as total_visits,
    (
      select count(distinct coalesce(nullif(review.restaurant_id, ''), lower(review.restaurant_name)))::integer
      from visible_reviews review
    ) as unique_places,
    (
      select count(distinct (visible_dishes.place_key, visible_dishes.dish_name))::integer
      from visible_dishes
    ) as unique_dishes
), relationship as (
  select
    case
      when (select interaction_blocked from block_state) then 'idle'
      when exists (
        select 1
        from public.circle_memberships membership
        cross join viewer
        cross join target
        where membership.user_name = target.username
          and membership.member_name = viewer.username
      ) then 'joined'
      when exists (
        select 1
        from public.circle_requests request
        cross join viewer
        cross join target
        where request.sender_name = viewer.username
          and request.receiver_name = target.username
          and request.status = 'pending'
      ) then 'pending'
      else 'idle'
    end as status,
    case
      when (select interaction_blocked from block_state) then false
      else exists (
        select 1
        from public.circle_requests request
        cross join viewer
        cross join target
        where request.sender_name = target.username
          and request.receiver_name = viewer.username
          and request.status = 'pending'
      )
    end as has_incoming_request
), circle as (
  select count(*)::integer as member_count
  from public.circle_memberships membership
  cross join target
  where membership.user_name = target.username
)
select jsonb_build_object(
  'profile', jsonb_build_object(
    'id', target.id,
    'firstName', target.first_name,
    'lastName', target.last_name,
    'username', target.username,
    'avatarUrl', target.avatar_url,
    'bio', target.bio,
    'accountType', target.account_type,
    'trustScore', coalesce(target.trust_score, 20),
    'trustLevel', coalesce(target.trust_level, 'New Reviewer'),
    'confirmedRecommendationsCount', coalesce(target.confirmed_recommendations_count, 0),
    'positiveConfirmationsCount', coalesce(target.positive_confirmations_count, 0),
    'negativeConfirmationsCount', coalesce(target.negative_confirmations_count, 0),
    'totalFeedbackPoints', coalesce(target.total_feedback_points, 0),
    'createdAt', target.created_at
  ),
  'displayName', target.display_name,
  'stats', jsonb_build_object(
    'totalVisits', stats.total_visits,
    'uniquePlaces', stats.unique_places,
    'uniqueDishes', stats.unique_dishes
  ),
  'circleCount', circle.member_count,
  'blockedByViewer', block_state.blocked_by_viewer,
  'interactionBlocked', block_state.interaction_blocked,
  'relationship', jsonb_build_object(
    'status', relationship.status,
    'hasIncomingRequest', relationship.has_incoming_request
  )
)
from viewer
cross join target
cross join block_state
cross join stats
cross join relationship
cross join circle;
$$;

revoke all on function public.mobile_other_profile_shell_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.mobile_other_profile_shell_v1(uuid, text) to service_role;

comment on function public.mobile_other_profile_shell_v1(uuid, text) is
  'Service-only viewer-aware profile shell: public profile, visible stats, Circle count, relationship, and non-disclosing block state in one database call.';
