-- Dish identity token-family model.
-- Keep this file in sync between mobile/supabase/migrations and supabase/migrations.
--
-- Families are now derived mechanically from the canonical name tokens:
-- "Chicken Biryani" belongs to both "chicken" and "biryani".
-- The older single family_id columns remain for compatibility, but Explore v2
-- and new writes should treat family_tokens as the source of truth.

create or replace function public.dish_identity_family_tokens(input text)
returns text[]
language sql
immutable
set search_path = public
as $$
  with tokens as (
    select token, ordinality
    from unnest(regexp_split_to_array(public.normalize_dish_identity_name(input), '[[:space:]]+'))
      with ordinality as token_row(token, ordinality)
    where nullif(token, '') is not null
  ),
  deduped as (
    select token, min(ordinality) as first_ordinal
    from tokens
    group by token
  )
  select coalesce(array_agg(token order by first_ordinal), '{}'::text[])
  from deduped
$$;

create or replace function public.dish_identity_explore_categories(input text)
returns text[]
language sql
immutable
set search_path = public
as $$
  with normalized as (
    select public.normalize_dish_identity_name(input) as name
  ),
  candidates(category, ordinal) as (
    select 'biryani', 1 from normalized where name ~ '(^| )(biryani|biriyani|briyani)( |$)'
    union all select 'chicken', 2 from normalized where name ~ '(^| )(chicken|ckn|tandoori|kebab|wings)( |$)'
    union all select 'pizza', 3 from normalized where name ~ '(^| )(pizza|margherita|pepperoni)( |$)'
    union all select 'burger', 4 from normalized where name ~ '(^| )(burger|cheeseburger)( |$)'
    union all select 'shawarma', 5 from normalized where name ~ '(^| )(shawarma|shawerma|shwarma)( |$)'
    union all select 'mandi', 6 from normalized where name ~ '(^| )(mandi|mady|madhbi|kabsa|faham)( |$)'
    union all select 'ice_cream', 7 from normalized where name ~ 'ice[[:space:]]*cream|(^| )(gelato|sundae)( |$)'
    union all select 'milkshake', 8 from normalized where name ~ 'milk[[:space:]]*shake|(^| )(shake|thick[[:space:]]*shake)( |$)'
    union all select 'paneer', 9 from normalized where name ~ '(^| )(paneer)( |$)|cottage[[:space:]]*cheese'
    union all select 'desserts', 10 from normalized where name ~ '(^| )(dessert|cake|brownie|waffle|pastry|cookie)( |$)'
    union all select 'sweets', 11 from normalized where name ~ '(^| )(sweet|sweets|mithai|gulab|jamun|ladoo|laddu|jalebi|barfi|rasmalai)( |$)'
  ),
  deduped as (
    select category, min(ordinal) as first_ordinal
    from candidates
    group by category
  )
  select coalesce(array_agg(category order by first_ordinal), '{}'::text[])
  from deduped
$$;

alter table public.canonical_dishes
  add column if not exists family_tokens text[] not null default '{}'::text[];

alter table public.review_dish_mentions
  add column if not exists family_tokens text[] not null default '{}'::text[];

alter table public.place_dish_stats
  add column if not exists family_tokens text[] not null default '{}'::text[];

alter table public.dish_place_stats
  add column if not exists family_tokens text[] not null default '{}'::text[];

create index if not exists canonical_dishes_family_tokens_gin_idx
  on public.canonical_dishes using gin (family_tokens);

create index if not exists review_dish_mentions_family_tokens_gin_idx
  on public.review_dish_mentions using gin (family_tokens);

create index if not exists place_dish_stats_family_tokens_gin_idx
  on public.place_dish_stats using gin (family_tokens);

create index if not exists dish_place_stats_family_tokens_gin_idx
  on public.dish_place_stats using gin (family_tokens);

update public.canonical_dishes
set family_tokens = public.dish_identity_family_tokens(normalized_name),
    updated_at = now()
where family_tokens = '{}'::text[];

update public.review_dish_mentions rdm
set family_tokens = public.dish_identity_family_tokens(coalesce(cd.normalized_name, rdm.normalized_name)),
    updated_at = now()
from public.canonical_dishes cd
where cd.id = rdm.canonical_dish_id
  and rdm.family_tokens = '{}'::text[];

update public.review_dish_mentions
set family_tokens = public.dish_identity_family_tokens(normalized_name),
    updated_at = now()
where canonical_dish_id is null
  and family_tokens = '{}'::text[];

create or replace function public.rebuild_dish_identity_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  place_rows integer;
  place_dish_rows integer;
  dish_place_rows integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'dish_identity_stats_requires_service_role';
  end if;

  delete from public.place_stats;
  insert into public.place_stats (
    place_id,
    display_name,
    normalized_name,
    area,
    address,
    latitude,
    longitude,
    review_count,
    unique_reviewer_count,
    dish_count,
    average_rating,
    first_review_at,
    last_review_at,
    rebuilt_at,
    source
  )
  select
    r.restaurant_id,
    (array_agg(r.restaurant_name order by r.created_at desc))[1],
    lower(btrim((array_agg(r.restaurant_name order by r.created_at desc))[1])),
    (array_agg(coalesce(r.area, r.restaurant_address) order by r.created_at desc) filter (where coalesce(r.area, r.restaurant_address) is not null))[1],
    (array_agg(r.restaurant_address order by r.created_at desc) filter (where r.restaurant_address is not null))[1],
    (array_agg(r.restaurant_lat order by r.created_at desc) filter (where r.restaurant_lat is not null))[1],
    (array_agg(r.restaurant_lng order by r.created_at desc) filter (where r.restaurant_lng is not null))[1],
    (count(distinct r.id))::integer,
    (count(distinct r.reviewer_name))::integer,
    (count(distinct rdm.canonical_dish_id) filter (where rdm.canonical_dish_id is not null))::integer,
    round(avg(rdm.review_rating) filter (where rdm.review_rating > 0), 2),
    min(r.created_at),
    max(r.created_at),
    now(),
    'rebuild'
  from public.reviews r
  left join public.review_dish_mentions rdm
    on rdm.review_id = r.id
   and rdm.deleted_at is null
   and rdm.candidate_id is null
  where coalesce(r.visibility, 'public') = 'public'
    and r.deleted_at is null
    and r.hidden_at is null
    and r.reported_at is null
    and coalesce(r.status, 'active') = 'active'
    and r.reviewer_name !~* '^e2e_'
    and r.restaurant_name !~* '^e2e\\b'
    and nullif(btrim(r.restaurant_id), '') is not null
  group by r.restaurant_id;
  get diagnostics place_rows = row_count;

  delete from public.place_dish_stats;
  insert into public.place_dish_stats (
    place_id,
    canonical_dish_id,
    family_id,
    family_tokens,
    mention_count,
    unique_reviewer_count,
    average_rating,
    first_review_at,
    last_review_at,
    rebuilt_at,
    source
  )
  select
    rdm.place_id,
    cd.id,
    cd.family_id,
    case
      when cd.family_tokens = '{}'::text[] then public.dish_identity_family_tokens(cd.normalized_name)
      else cd.family_tokens
    end,
    (count(*))::integer,
    (count(distinct rdm.user_id))::integer,
    round(avg(rdm.review_rating) filter (where rdm.review_rating > 0), 2),
    min(r.created_at),
    max(r.created_at),
    now(),
    'rebuild'
  from public.review_dish_mentions rdm
  join public.reviews r
    on r.id = rdm.review_id
  join public.canonical_dishes cd
    on cd.id = rdm.canonical_dish_id
  where rdm.deleted_at is null
    and rdm.candidate_id is null
    and nullif(btrim(rdm.place_id), '') is not null
    and cd.status in ('verified', 'generated')
    and cd.merged_into_dish_id is null
    and coalesce(r.visibility, 'public') = 'public'
    and r.deleted_at is null
    and r.hidden_at is null
    and r.reported_at is null
    and coalesce(r.status, 'active') = 'active'
    and r.reviewer_name !~* '^e2e_'
    and r.restaurant_name !~* '^e2e\\b'
  group by rdm.place_id, cd.id, cd.family_id, cd.family_tokens, cd.normalized_name;
  get diagnostics place_dish_rows = row_count;

  delete from public.dish_place_stats;
  insert into public.dish_place_stats (
    canonical_dish_id,
    place_id,
    family_id,
    family_tokens,
    mention_count,
    unique_reviewer_count,
    average_rating,
    first_review_at,
    last_review_at,
    rebuilt_at,
    source
  )
  select
    canonical_dish_id,
    place_id,
    family_id,
    family_tokens,
    mention_count,
    unique_reviewer_count,
    average_rating,
    first_review_at,
    last_review_at,
    now(),
    'rebuild'
  from public.place_dish_stats;
  get diagnostics dish_place_rows = row_count;

  return jsonb_build_object(
    'placeStats', place_rows,
    'placeDishStats', place_dish_rows,
    'dishPlaceStats', dish_place_rows
  );
end;
$$;

comment on function public.rebuild_dish_identity_stats() is
  'Deletes and repopulates place_stats, place_dish_stats, and dish_place_stats from eligible public reviews and trusted canonical mentions. Dish families are token-derived.';

revoke all on function public.rebuild_dish_identity_stats() from public;
grant execute on function public.rebuild_dish_identity_stats() to service_role;

create or replace function public.explore_discovery_canonical_v2(
  p_lat double precision default null,
  p_lng double precision default null,
  p_limit integer default 60
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
    greatest(1, least(coalesce(p_limit, 60), 60)) as row_limit,
    1000 as review_scan_limit,
    case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end as lat,
    case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end as lng
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
ranked_reviews as (
  select
    er.*,
    case
      when p.lat is not null
        and p.lng is not null
        and er.restaurant_lat between -90 and 90
        and er.restaurant_lng between -180 and 180
      then
        power(er.restaurant_lat - p.lat, 2)
        + power((er.restaurant_lng - p.lng) * greatest(0.2, cos(radians(p.lat))), 2)
      else null
    end as location_rank_score
  from eligible_reviews er
  cross join params p
),
discovery_reviews as (
  select *
  from ranked_reviews
  order by
    case
      when (select lat from params) is null then 0
      when location_rank_score is null then 1
      else 0
    end asc,
    location_rank_score asc nulls last,
    created_at desc,
    id desc
  limit (select review_scan_limit from params)
),
selected_reviews as (
  select *
  from discovery_reviews
  order by
    case
      when (select lat from params) is null then 0
      when location_rank_score is null then 1
      else 0
    end asc,
    location_rank_score asc nulls last,
    created_at desc,
    id desc
  limit (select row_limit from params)
),
canonical_mentions as (
  select distinct on (sr.id, rdm.item_position)
    sr.id as review_id,
    sr.place_key,
    rdm.item_position,
    rdm.review_rating as rating,
    cd.id as canonical_dish_id,
    cd.display_name as dish_name,
    sr.location_rank_score
  from discovery_reviews sr
  join public.review_dish_mentions rdm
    on rdm.review_id = sr.id
  join public.canonical_dishes cd
    on cd.id = rdm.canonical_dish_id
  where rdm.deleted_at is null
    and rdm.canonical_dish_id is not null
    and rdm.candidate_id is null
    and cd.status in ('verified', 'generated')
    and cd.merged_into_dish_id is null
  order by sr.id, rdm.item_position, rdm.updated_at desc, rdm.id
),
all_canonical_mentions as (
  select distinct on (er.id, rdm.item_position)
    er.id as review_id,
    er.place_key,
    er.restaurant_name,
    er.body,
    er.tags,
    er.photo,
    er.created_at,
    rdm.item_position,
    rdm.review_rating as rating,
    cd.id as canonical_dish_id,
    cd.display_name as dish_name,
    er.location_rank_score,
    case
      when cd.family_tokens = '{}'::text[] then public.dish_identity_family_tokens(cd.normalized_name)
      else cd.family_tokens
    end as family_tokens,
    public.dish_identity_explore_categories(cd.normalized_name) as category_tags
  from discovery_reviews er
  join public.review_dish_mentions rdm
    on rdm.review_id = er.id
  join public.canonical_dishes cd
    on cd.id = rdm.canonical_dish_id
  where rdm.deleted_at is null
    and rdm.canonical_dish_id is not null
    and rdm.candidate_id is null
    and cd.status in ('verified', 'generated')
    and cd.merged_into_dish_id is null
  order by er.id, rdm.item_position, rdm.updated_at desc, rdm.id
),
place_rows as (
  select
    sr.place_key as key,
    (array_agg(sr.restaurant_name order by sr.created_at desc))[1] as name,
    (array_agg(sr.restaurant_id order by sr.created_at desc) filter (where sr.restaurant_id is not null))[1] as place_id,
    (array_agg(coalesce(sr.area, sr.restaurant_address) order by sr.created_at desc) filter (where coalesce(sr.area, sr.restaurant_address) is not null))[1] as area,
    (array_agg(sr.photo order by sr.created_at desc) filter (where sr.photo is not null))[1] as photo,
    min(sr.location_rank_score) as location_rank_score,
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
  from discovery_reviews sr
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
  from discovery_reviews sr
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
    order by
      case when pr.location_rank_score is null then 1 else 0 end asc,
      pr.location_rank_score asc nulls last,
      pr.post_count desc,
      coalesce(plr.average_rating, 0) desc,
      pr.name asc
  ), '[]'::jsonb) as payload
  from place_rows pr
  left join place_ratings plr on plr.key = pr.key
  left join place_top_dishes ptd on ptd.key = pr.key
  left join place_tags pt on pt.key = pr.key
),
global_dish_rating as (
  select avg(rating) as mean
  from all_canonical_mentions
  where rating > 0
),
dish_place_base as (
  select
    'canonical:' || canonical_dish_id::text as key,
    canonical_dish_id,
    dish_name as name,
    family_tokens,
    category_tags,
    place_key,
    restaurant_name,
    (array_agg(body order by created_at desc) filter (where body is not null and body <> ''))[1] as snippet,
    min(location_rank_score) as location_rank_score,
    case
      when min(location_rank_score) is null then null
      else sqrt(greatest(min(location_rank_score), 0)) * 111.0
    end as distance_km,
    count(distinct review_id::text || ':' || item_position::text)::integer as mention_count,
    round(avg(rating) filter (where rating > 0), 2) as average_rating,
    (count(rating) filter (where rating > 0))::integer as rating_count,
    coalesce(sum(rating) filter (where rating > 0), 0) as rating_sum,
    max(created_at) as latest_seen_at,
    (
      (
        coalesce(sum(rating) filter (where rating > 0), 0)
        + 5.0 * coalesce((select mean from global_dish_rating), 4.0)
      )
      / ((count(rating) filter (where rating > 0)) + 5.0)
    ) as smoothed_rating
  from all_canonical_mentions
  group by canonical_dish_id, dish_name, family_tokens, category_tags, place_key, restaurant_name
),
dish_place_rows as (
  select
    *,
    case
      when (select lat from params) is null then 0
      when distance_km is null then 5
      when distance_km <= 10 then 0
      when distance_km <= 30 then 1
      when distance_km <= 60 then 2
      when distance_km <= 100 then 3
      else 4
    end as location_band,
    (
      smoothed_rating
      + ln(1 + greatest(mention_count, 0)) * 0.35
      + greatest(
        0,
        1 - (extract(epoch from (now() - latest_seen_at)) / (60.0 * 60.0 * 24.0 * 180.0))
      ) * 0.15
    ) as place_score
  from dish_place_base
),
dish_place_ranked as (
  select
    *,
    row_number() over (
      partition by canonical_dish_id
      order by
        location_band asc,
        place_score desc,
        location_rank_score asc nulls last,
        mention_count desc,
        restaurant_name asc
    ) as place_rank
  from dish_place_rows
),
dish_rows as (
  select
    key,
    canonical_dish_id,
    name,
    family_tokens,
    category_tags,
    coalesce(category_tags[1], 'other') as family_id,
    coalesce(
      array_to_string(array(select initcap(token) from unnest(family_tokens) as token_row(token)), ', '),
      'Other'
    ) as family_name,
    null::text as photo,
    (array_agg(snippet order by place_rank asc) filter (where snippet is not null and snippet <> ''))[1] as snippet,
    min(location_rank_score) as location_rank_score,
    min(location_band) as location_band,
    sum(mention_count)::integer as mention_count,
    case
      when sum(rating_count) > 0 then round((sum(rating_sum) / sum(rating_count))::numeric, 2)
      else null
    end as average_rating,
    sum(rating_count)::integer as rating_count,
    max(place_score) filter (where place_rank = 1) as best_place_score,
    coalesce(sum(
      case
        when place_rank = 1 then place_score
        when place_rank = 2 then place_score * 0.35
        when place_rank = 3 then place_score * 0.20
        else 0
      end
    ), 0) as dish_score
  from dish_place_ranked
  group by key, canonical_dish_id, name, family_tokens, category_tags
),
dish_rows_limited as (
  select *
  from (
    select
      dr.*,
      row_number() over (
        order by
          dr.location_band asc,
          dr.dish_score desc,
          dr.mention_count desc,
          dr.location_rank_score asc nulls last,
          dr.name asc
      ) as rank
    from dish_rows dr
  ) ranked
  where rank <= 60
),
dish_restaurants_ranked as (
  select
    key,
    restaurant_name,
    mention_count as review_count,
    location_band,
    location_rank_score,
    place_score,
    row_number() over (
      partition by key
      order by
        location_band asc,
        place_score desc,
        location_rank_score asc nulls last,
        mention_count desc,
        restaurant_name asc
    ) as rank
  from dish_place_rows
  where nullif(restaurant_name, '') is not null
),
dish_restaurants as (
  select
    key,
    jsonb_agg(
      restaurant_name
      order by location_band asc, place_score desc, location_rank_score asc nulls last, review_count desc, restaurant_name asc
    ) as restaurants
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
  from all_canonical_mentions cm
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
      'familyIds', to_jsonb(dr.family_tokens),
      'familyNames', to_jsonb(array(select initcap(token) from unnest(dr.family_tokens) as token_row(token))),
      'topRestaurantNames', coalesce(dres.restaurants, '[]'::jsonb),
      'photo', dr.photo,
      'averageRating', dr.average_rating,
      'categoryTags', to_jsonb(dr.category_tags),
      'mentionCount', dr.mention_count,
      'ratingCount', coalesce(dr.rating_count, 0),
      'tags', coalesce(dt.tags, '[]'::jsonb),
      'snippet', dr.snippet
    )
    order by
      dr.location_band asc,
      dr.dish_score desc,
      dr.mention_count desc,
      dr.location_rank_score asc nulls last,
      dr.name asc
  ), '[]'::jsonb) as payload
  from dish_rows_limited dr
  left join dish_restaurants dres on dres.key = dr.key
  left join dish_tags dt on dt.key = dr.key
),
people_rows as (
  select
    p.username,
    coalesce(nullif(trim(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, ''))), ''), p.username) as display_name,
    case when p.account_type = 'private' then 'private' else 'public' end as account_type,
    case
      when exists (
        select 1
        from public.circle_memberships cm
        cross join viewer v
        where cm.user_name = p.username
          and cm.member_name = coalesce(v.username, '')
      ) then 'joined'
      when exists (
        select 1
        from public.circle_requests cr
        cross join viewer v
        where cr.sender_name = coalesce(v.username, '')
          and cr.receiver_name = p.username
          and cr.status = 'pending'
      ) then 'pending'
      else 'idle'
    end as circle_status,
    count(distinct coalesce(sr.restaurant_id, lower(sr.restaurant_name) || '::' || lower(coalesce(sr.area, sr.restaurant_address, ''))))::integer as total_places
  from public.profiles p
  cross join viewer v
  left join discovery_reviews sr
    on coalesce(sr.reviewer_username, sr.reviewer_name) = p.username
    or sr.reviewer_name = p.username
  where p.username <> coalesce(v.username, '')
    and p.username !~* '^e2e_'
  group by
    p.username,
    coalesce(nullif(trim(concat_ws(' ', nullif(p.first_name, ''), nullif(p.last_name, ''))), ''), p.username),
    p.account_type
),
people_json as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'username', username,
      'displayName', display_name,
      'initials', upper(left(nullif(regexp_replace(display_name, '[^[:alnum:]]', '', 'g'), ''), 2)),
      'totalPlaces', total_places,
      'accountType', account_type,
      'circleStatus', circle_status
    )
    order by total_places desc, display_name asc
  ), '[]'::jsonb) as payload
  from (
    select *
    from people_rows
    order by total_places desc, display_name asc
    limit (select row_limit from params)
  ) ranked_people
)
select jsonb_build_object(
  'viewerName', coalesce((select username from viewer), ''),
  'places', (select payload from places_json),
  'dishes', (select payload from dishes_json),
  'people', (select payload from people_json)
);
$$;

comment on function public.explore_discovery_canonical_v2(double precision, double precision, integer) is
  'Canonical Explore payload v2: recent-window places and people, globally aggregated canonical dishes ranked by Bayesian-smoothed rating, with token-derived dish families and category tags.';

revoke all on function public.explore_discovery_canonical_v2(double precision, double precision, integer) from public;
grant execute on function public.explore_discovery_canonical_v2(double precision, double precision, integer) to authenticated;
