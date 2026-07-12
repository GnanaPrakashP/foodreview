-- Canonical Explore discovery payload behind a mobile feature flag.
-- Keeps places review-based for coverage, while deriving place top dishes and
-- the Dishes tab from trusted canonical dish mentions only.

drop policy if exists "Verified canonical dishes are readable" on public.canonical_dishes;
drop policy if exists "Trusted canonical dishes are readable" on public.canonical_dishes;
create policy "Trusted canonical dishes are readable"
  on public.canonical_dishes for select to anon, authenticated
  using (status in ('verified', 'generated') and merged_into_dish_id is null);

create or replace function public.explore_discovery_canonical_v1(
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
    coalesce('place:' || nullif(r.restaurant_id, ''), 'raw:' || lower(r.restaurant_name) || '::' || lower(coalesce(r.area, r.restaurant_address, ''))) as place_key,
    r.reviewer_name,
    r.restaurant_id,
    r.restaurant_name,
    r.area,
    r.restaurant_address,
    r.restaurant_lat,
    r.restaurant_lng,
    r.body,
    r.tags,
    r.photo_url,
    r.photo_urls,
    r.created_at,
    p.username as reviewer_username,
    trim(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, ''))) as reviewer_display_name,
    coalesce(
      (
        select coalesce(nullif(thumbnail.public_url, ''), nullif(canonical.public_url, ''), nullif(rp.public_url, ''))
        from public.review_photos rp
        join public.media_assets asset
          on asset.id = rp.media_asset_id
         and asset.surface = 'post'
         and asset.media_type = 'image'
         and asset.status = 'ready'
         and asset.visibility = 'public'
         and (
           asset.original_width is null
           or asset.original_height is null
           or least(asset.original_width, asset.original_height)::double precision / greatest(asset.original_width, asset.original_height) >= 0.5
         )
        left join public.media_derivatives thumbnail
          on thumbnail.asset_id = asset.id
         and thumbnail.kind = 'thumbnail'
         and thumbnail.bucket_id = 'media-public'
        left join public.media_derivatives canonical
          on canonical.asset_id = asset.id
         and canonical.kind = 'canonical'
         and canonical.bucket_id = 'media-public'
        where rp.review_id = r.id
          and coalesce(rp.media_type, 'image') = 'image'
          and coalesce(nullif(thumbnail.public_url, ''), nullif(canonical.public_url, ''), nullif(rp.public_url, '')) ilike '%/storage/v1/object/public/media-public/%'
        order by rp.position asc, rp.created_at asc
        limit 1
      ),
      (
        select rp.public_url
        from public.review_photos rp
        where rp.review_id = r.id
          and coalesce(rp.media_type, 'image') = 'image'
          and nullif(rp.public_url, '') is not null
          and rp.public_url not ilike '%/storage/v1/object/public/media-public/%'
        order by rp.position asc, rp.created_at asc
        limit 1
      ),
      (
        select legacy_photo.url
        from unnest(coalesce(r.photo_urls, '{}'::text[])) as legacy_photo(url)
        where nullif(legacy_photo.url, '') is not null
          and legacy_photo.url not ilike '%/storage/v1/object/public/media-public/%'
        limit 1
      ),
      case
        when nullif(r.photo_url, '') is not null
          and r.photo_url not ilike '%/storage/v1/object/public/media-public/%'
        then r.photo_url
      end
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
canonical_mentions as (
  select distinct on (sr.id, rdm.item_position)
    sr.id as review_id,
    sr.place_key,
    sr.restaurant_name,
    sr.body,
    sr.tags,
    sr.photo,
    sr.created_at,
    rdm.item_position,
    rdm.review_rating as rating,
    cd.id as canonical_dish_id,
    cd.display_name as dish_name,
    case
      when df.slug in ('biryani', 'pizza', 'burger', 'shawarma', 'paneer') then df.slug
      when df.slug = 'dessert' then 'desserts'
      when lower(cd.display_name) ~ 'ice[[:space:]-]*cream|gelato|sundae' then 'ice_cream'
      when lower(cd.display_name) ~ 'milk[[:space:]-]*shake|thick[[:space:]-]*shake' then 'milkshake'
      when lower(cd.display_name) ~ 'chicken|tandoori|kebab|wings' then 'chicken'
      when lower(cd.display_name) ~ 'mandi|madhbi|kabsa|faham' then 'mandi'
      when lower(cd.display_name) ~ 'cake|brownie|waffle|pastry|cookie|dessert' then 'desserts'
      when lower(cd.display_name) ~ 'gulab|jamun|ladoo|laddu|jalebi|mithai|barfi|rasmalai|sweet' then 'sweets'
      else 'other'
    end as family_id,
    coalesce(nullif(df.name, ''), 'Other') as family_name
  from selected_reviews sr
  join public.review_dish_mentions rdm
    on rdm.review_id = sr.id
  join public.canonical_dishes cd
    on cd.id = rdm.canonical_dish_id
  left join public.dish_families df
    on df.id = cd.family_id
   and df.status = 'active'
  where rdm.deleted_at is null
    and rdm.canonical_dish_id is not null
    and rdm.candidate_id is null
    and cd.status in ('verified', 'generated')
    and cd.merged_into_dish_id is null
  order by sr.id, rdm.item_position, rdm.updated_at desc, rdm.id
),
place_rows as (
  select
    sr.place_key as key,
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
  group by sr.place_key
),
place_ratings as (
  select
    place_key as key,
    round(avg(rating) filter (where rating > 0), 2) as average_rating,
    (count(rating) filter (where rating > 0))::integer as rating_count
  from canonical_mentions
  group by place_key
),
place_top_dishes_ranked as (
  select
    place_key as key,
    canonical_dish_id,
    dish_name,
    count(distinct review_id::text || ':' || item_position::text) as mention_count,
    row_number() over (
      partition by place_key
      order by count(distinct review_id::text || ':' || item_position::text) desc, dish_name asc
    ) as rank
  from canonical_mentions
  group by place_key, canonical_dish_id, dish_name
),
place_top_dishes as (
  select key, jsonb_agg(dish_name order by mention_count desc, dish_name asc) as top_dishes
  from place_top_dishes_ranked
  where rank <= 2
  group by key
),
place_tags_ranked as (
  select
    sr.place_key as key,
    tag_value.tag,
    count(*) as tag_count,
    row_number() over (
      partition by sr.place_key
      order by count(*) desc, tag_value.tag asc
    ) as rank
  from selected_reviews sr
  cross join lateral unnest(coalesce(sr.tags, '{}'::text[])) as tag_value(tag)
  where nullif(tag_value.tag, '') is not null
  group by sr.place_key, tag_value.tag
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
    'canonical:' || canonical_dish_id::text as key,
    canonical_dish_id,
    dish_name as name,
    family_id,
    family_name,
    (array_agg(photo order by created_at desc) filter (where photo is not null))[1] as photo,
    (array_agg(body order by created_at desc) filter (where body is not null and body <> ''))[1] as snippet,
    count(distinct review_id::text || ':' || item_position::text)::integer as mention_count,
    round(avg(rating) filter (where rating > 0), 2) as average_rating,
    (count(rating) filter (where rating > 0))::integer as rating_count
  from canonical_mentions
  group by canonical_dish_id, dish_name, family_id, family_name
),
dish_restaurants_ranked as (
  select
    'canonical:' || canonical_dish_id::text as key,
    restaurant_name,
    count(distinct review_id)::integer as review_count,
    row_number() over (
      partition by canonical_dish_id
      order by count(distinct review_id) desc, restaurant_name asc
    ) as rank
  from canonical_mentions
  group by canonical_dish_id, restaurant_name
),
dish_restaurants as (
  select key, jsonb_agg(restaurant_name order by review_count desc, restaurant_name asc) as restaurants
  from dish_restaurants_ranked
  where rank <= 3
  group by key
),
dish_tags_ranked as (
  select
    'canonical:' || cm.canonical_dish_id::text as key,
    tag_value.tag,
    count(*) as tag_count,
    row_number() over (
      partition by cm.canonical_dish_id
      order by count(*) desc, tag_value.tag asc
    ) as rank
  from canonical_mentions cm
  cross join lateral unnest(coalesce(cm.tags, '{}'::text[])) as tag_value(tag)
  where nullif(tag_value.tag, '') is not null
  group by cm.canonical_dish_id, tag_value.tag
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
      'familyId', dr.family_id,
      'familyName', dr.family_name,
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

comment on function public.explore_discovery_canonical_v1(double precision, double precision, integer) is
  'Backend-shaped Explore payload with canonical dish grouping behind a mobile feature flag.';

revoke all on function public.explore_discovery_canonical_v1(double precision, double precision, integer) from public;
grant execute on function public.explore_discovery_canonical_v1(double precision, double precision, integer) to authenticated;
