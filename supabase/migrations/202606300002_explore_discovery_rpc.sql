-- Backend-shaped Explore discovery payload.
-- Returns the already-aggregated Places, Dishes, and People arrays that the
-- mobile Explore screen needs, so the app does not build discovery cards from
-- raw review rows during navigation.

create or replace function public.explore_discovery_v1(
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
viewer as (
  select public.current_profile_name() as username
),
params as (
  select
    greatest(1, least(coalesce(p_limit, 30), 60)) as row_limit,
    case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end as lat,
    case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end as lng
),
bounds as (
  select
    lat - (30.0 / 111.0) as min_lat,
    lat + (30.0 / 111.0) as max_lat,
    lng - (30.0 / (111.0 * greatest(0.2, cos(radians(lat))))) as min_lng,
    lng + (30.0 / (111.0 * greatest(0.2, cos(radians(lat))))) as max_lng
  from params
  where lat is not null and lng is not null
),
eligible_reviews as (
  select
    r.id,
    r.reviewer_name,
    r.restaurant_id,
    r.restaurant_name,
    r.area,
    r.restaurant_address,
    r.restaurant_lat,
    r.restaurant_lng,
    r.items,
    r.body,
    r.tags,
    r.photo_url,
    r.photo_urls,
    r.created_at,
    p.username as reviewer_username,
    trim(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, ''))) as reviewer_display_name,
    coalesce(
      (
        select rp.public_url
        from public.review_photos rp
        where rp.review_id = r.id
        order by rp.position asc, rp.created_at asc
        limit 1
      ),
      r.photo_urls[1],
      r.photo_url
    ) as photo
  from public.reviews r
  left join public.profiles p
    on p.username = r.reviewer_name
  where coalesce(r.visibility, 'public') = 'public'
    and r.deleted_at is null
    and r.hidden_at is null
    and r.reported_at is null
    and coalesce(r.status, 'active') = 'active'
    and r.reviewer_name !~* '^e2e_'
    and r.restaurant_name !~* '^e2e\\b'
),
nearby_reviews as (
  select er.*
  from eligible_reviews er
  join bounds b on true
  where er.restaurant_lat between b.min_lat and b.max_lat
    and er.restaurant_lng between b.min_lng and b.max_lng
  order by er.created_at desc, er.id desc
  limit (select row_limit from params)
),
fallback_reviews as (
  select er.*
  from eligible_reviews er
  where not exists (select 1 from nearby_reviews)
  order by er.created_at desc, er.id desc
  limit (select row_limit from params)
),
selected_reviews as (
  select * from nearby_reviews
  union all
  select * from fallback_reviews
),
review_items as (
  select
    sr.id as review_id,
    coalesce('place:' || nullif(sr.restaurant_id, ''), 'raw:' || lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, ''))) as place_key,
    sr.restaurant_name,
    sr.body,
    sr.tags,
    sr.photo,
    sr.created_at,
    nullif(trim(item.value ->> 'name'), '') as item_name,
    case
      when (item.value ->> 'rating') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        then nullif(item.value ->> 'rating', '')::numeric
      else null
    end as rating,
    case
      when item.value ->> 'dishFamilyId' in (
        'biryani', 'chicken', 'pizza', 'burger', 'shawarma', 'mandi',
        'ice_cream', 'milkshake', 'paneer', 'desserts', 'sweets', 'other'
      ) then item.value ->> 'dishFamilyId'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'biriyani|biryani|briyani' then 'biryani'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'shawarma|shawerma|shwarma' then 'shawarma'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'burger|cheeseburger' then 'burger'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'pizza|margherita|pepperoni' then 'pizza'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'chicken|tandoori|kebab|wings' then 'chicken'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'mandi|madhbi|kabsa|faham' then 'mandi'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'ice[[:space:]]*cream|gelato|sundae' then 'ice_cream'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'milk[[:space:]]*shake|thick[[:space:]]*shake' then 'milkshake'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'paneer|cottage cheese' then 'paneer'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'cake|brownie|waffle|pastry|cookie|dessert' then 'desserts'
      when lower(coalesce(item.value ->> 'name', '')) ~ 'gulab|jamun|ladoo|laddu|jalebi|mithai|barfi|rasmalai|sweet' then 'sweets'
      else 'other'
    end as family_id
  from selected_reviews sr
  left join lateral jsonb_array_elements(coalesce(sr.items, '[]'::jsonb)) as item(value) on true
),
place_rows as (
  select
    coalesce('place:' || nullif(sr.restaurant_id, ''), 'raw:' || lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, ''))) as key,
    (array_agg(sr.restaurant_name order by sr.created_at desc))[1] as name,
    (array_agg(sr.restaurant_id order by sr.created_at desc) filter (where sr.restaurant_id is not null))[1] as place_id,
    (array_agg(coalesce(sr.area, sr.restaurant_address) order by sr.created_at desc) filter (where coalesce(sr.area, sr.restaurant_address) is not null))[1] as area,
    (array_agg(sr.photo order by sr.created_at desc) filter (where sr.photo is not null))[1] as photo,
    count(distinct sr.id)::integer as post_count,
    jsonb_agg(distinct coalesce(nullif(sr.reviewer_display_name, ''), sr.reviewer_name))
      filter (
        where exists (
          select 1
          from viewer v
          join public.circle_memberships cm
            on cm.member_name = v.username
           and cm.user_name = coalesce(sr.reviewer_username, sr.reviewer_name)
        )
      ) as circle_reviewers
  from selected_reviews sr
  group by coalesce('place:' || nullif(sr.restaurant_id, ''), 'raw:' || lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, '')))
),
place_ratings as (
  select
    place_key as key,
    round(avg(rating) filter (where rating > 0), 2) as average_rating,
    (count(rating) filter (where rating > 0))::integer as rating_count
  from review_items
  group by place_key
),
place_top_dishes_ranked as (
  select
    place_key as key,
    item_name,
    count(*) as mention_count,
    row_number() over (partition by place_key order by count(*) desc, item_name asc) as rank
  from review_items
  where item_name is not null
  group by place_key, item_name
),
place_top_dishes as (
  select key, jsonb_agg(item_name order by mention_count desc, item_name asc) as top_dishes
  from place_top_dishes_ranked
  where rank <= 2
  group by key
),
place_tags_ranked as (
  select
    coalesce('place:' || nullif(sr.restaurant_id, ''), 'raw:' || lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, ''))) as key,
    tag_value.tag,
    count(*) as tag_count,
    row_number() over (
      partition by coalesce('place:' || nullif(sr.restaurant_id, ''), 'raw:' || lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, '')))
      order by count(*) desc, tag_value.tag asc
    ) as rank
  from selected_reviews sr
  cross join lateral unnest(coalesce(sr.tags, '{}'::text[])) as tag_value(tag)
  where nullif(tag_value.tag, '') is not null
  group by coalesce('place:' || nullif(sr.restaurant_id, ''), 'raw:' || lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, ''))), tag_value.tag
),
place_tags as (
  select key, jsonb_agg(tag order by tag_count desc, tag asc) as tags
  from place_tags_ranked
  where rank <= 2
  group by key
),
places_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key', pr.key,
      'name', pr.name,
      'placeId', pr.place_id,
      'area', pr.area,
      'photo', pr.photo,
      'averageRating', plr.average_rating,
      'categoryTags', '[]'::jsonb,
      'circleReviewers', coalesce(pr.circle_reviewers, '[]'::jsonb),
      'ratingCount', coalesce(plr.rating_count, 0),
      'tags', coalesce(pt.tags, '[]'::jsonb),
      'topDishes', coalesce(ptd.top_dishes, '[]'::jsonb),
      'postCount', pr.post_count
    )
    order by pr.post_count desc, coalesce(plr.average_rating, 0) desc, pr.name asc
  ), '[]'::jsonb) as payload
  from place_rows pr
  left join place_ratings plr on plr.key = pr.key
  left join place_top_dishes ptd on ptd.key = pr.key
  left join place_tags pt on pt.key = pr.key
),
dish_rows as (
  select
    'raw:' || lower(ri.item_name) as key,
    (array_agg(ri.item_name order by ri.created_at desc))[1] as name,
    (array_agg(ri.family_id order by ri.created_at desc))[1] as family_id,
    (array_agg(ri.photo order by ri.created_at desc) filter (where ri.photo is not null))[1] as photo,
    (array_agg(ri.body order by ri.created_at desc) filter (where ri.body is not null and ri.body <> ''))[1] as snippet,
    count(*)::integer as mention_count,
    round(avg(ri.rating) filter (where ri.rating > 0), 2) as average_rating,
    (count(ri.rating) filter (where ri.rating > 0))::integer as rating_count
  from review_items ri
  where ri.item_name is not null
  group by lower(ri.item_name)
),
dish_restaurants_ranked as (
  select
    'raw:' || lower(item_name) as key,
    restaurant_name,
    count(*) as review_count,
    row_number() over (partition by lower(item_name) order by count(*) desc, restaurant_name asc) as rank
  from review_items
  where item_name is not null
  group by lower(item_name), restaurant_name
),
dish_restaurants as (
  select key, jsonb_agg(restaurant_name order by review_count desc, restaurant_name asc) as restaurants
  from dish_restaurants_ranked
  where rank <= 3
  group by key
),
dish_tags_ranked as (
  select
    'raw:' || lower(ri.item_name) as key,
    tag_value.tag,
    count(*) as tag_count,
    row_number() over (partition by lower(ri.item_name) order by count(*) desc, tag_value.tag asc) as rank
  from review_items ri
  cross join lateral unnest(coalesce(ri.tags, '{}'::text[])) as tag_value(tag)
  where ri.item_name is not null
    and nullif(tag_value.tag, '') is not null
  group by lower(ri.item_name), tag_value.tag
),
dish_tags as (
  select key, jsonb_agg(tag order by tag_count desc, tag asc) as tags
  from dish_tags_ranked
  where rank <= 2
  group by key
),
dishes_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'key', dr.key,
      'name', dr.name,
      'familyId', coalesce(dr.family_id, 'other'),
      'familyName', initcap(replace(coalesce(dr.family_id, 'other'), '_', ' ')),
      'topRestaurantNames', coalesce(dres.restaurants, '[]'::jsonb),
      'photo', dr.photo,
      'averageRating', dr.average_rating,
      'categoryTags', '[]'::jsonb,
      'mentionCount', dr.mention_count,
      'ratingCount', coalesce(dr.rating_count, 0),
      'tags', coalesce(dt.tags, '[]'::jsonb),
      'snippet', dr.snippet
    )
    order by dr.mention_count desc, coalesce(dr.average_rating, 0) desc, dr.name asc
  ), '[]'::jsonb) as payload
  from dish_rows dr
  left join dish_restaurants dres on dres.key = dr.key
  left join dish_tags dt on dt.key = dr.key
),
people_rows as (
  select
    coalesce(sr.reviewer_username, sr.reviewer_name) as username,
    coalesce(nullif(sr.reviewer_display_name, ''), sr.reviewer_name) as display_name,
    count(distinct coalesce(sr.restaurant_id, lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, ''))))::integer as total_places
  from selected_reviews sr
  cross join viewer v
  where coalesce(sr.reviewer_username, sr.reviewer_name) <> coalesce(v.username, '')
    and sr.reviewer_name <> coalesce(v.username, '')
  group by
    coalesce(sr.reviewer_username, sr.reviewer_name),
    coalesce(nullif(sr.reviewer_display_name, ''), sr.reviewer_name)
),
people_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'username', username,
      'displayName', display_name,
      'initials', upper(left(nullif(regexp_replace(display_name, '[^[:alnum:]]', '', 'g'), ''), 2)),
      'totalPlaces', total_places
    )
    order by total_places desc, display_name asc
  ), '[]'::jsonb) as payload
  from people_rows
)
select jsonb_build_object(
  'viewerName', coalesce((select username from viewer), ''),
  'places', (select payload from places_json),
  'dishes', (select payload from dishes_json),
  'people', (select payload from people_json)
);
$$;

revoke all on function public.explore_discovery_v1(double precision, double precision, integer) from public;
grant execute on function public.explore_discovery_v1(double precision, double precision, integer) to authenticated;
