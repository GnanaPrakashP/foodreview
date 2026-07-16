-- Explore v3 pipeline integrity: canonicalization gates, complete projection
-- rebuild/reconciliation, and Google Places classification propagation.

alter table public.place_stats
  add column if not exists restaurant_primary_type text,
  add column if not exists restaurant_types text[] not null default '{}'::text[],
  add column if not exists category_tags text[] not null default '{}'::text[];

comment on column public.place_stats.restaurant_primary_type is
  'Deterministic winning Google Places primary type across eligible reviews for this place.';
comment on column public.place_stats.restaurant_types is
  'Deterministically ranked union of Google Places primary/type values across eligible reviews for this place.';
comment on column public.place_stats.category_tags is
  'Explore place categories derived from restaurant_primary_type and restaurant_types.';

create or replace function public.place_identity_explore_categories(
  p_primary_type text,
  p_types text[] default '{}'::text[]
)
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  with raw_types as (
    select lower(btrim(raw.value)) as place_type, raw.ordinality
    from unnest(array[p_primary_type] || coalesce(p_types, '{}'::text[])) with ordinality raw(value, ordinality)
    where nullif(btrim(raw.value), '') is not null
  ), mapped as (
    select case
      when place_type in ('cafe', 'coffee_shop', 'tea_house', 'cat_cafe', 'dog_cafe', 'juice_shop') then 'cafe'
      when place_type in ('bakery', 'dessert_shop', 'dessert_restaurant', 'ice_cream_shop', 'chocolate_shop', 'chocolate_factory', 'candy_store', 'confectionery', 'donut_shop', 'bagel_shop', 'acai_shop') then 'desserts'
      when place_type in ('bar', 'pub', 'wine_bar', 'night_club', 'bar_and_grill') then 'nightlife'
      when place_type = 'fine_dining_restaurant' then 'fine_dining'
      when place_type in ('fast_food_restaurant', 'meal_takeaway', 'meal_delivery', 'sandwich_shop', 'hamburger_restaurant', 'pizza_restaurant', 'food_court') then 'quick_bites'
      when place_type = 'restaurant' or place_type like '%\_restaurant' escape '\' then 'restaurant'
      else null
    end as category, ordinality
    from raw_types
  ), ranked as (
    select category, min(ordinality) as first_seen
    from mapped
    where category is not null
    group by category
  )
  select coalesce(array_agg(category order by first_seen, category), '{}'::text[])
  from ranked;
$$;

revoke all on function public.place_identity_explore_categories(text, text[]) from public, anon;
grant execute on function public.place_identity_explore_categories(text, text[]) to authenticated, service_role;

create or replace function public.rebuild_dish_identity_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place_rows integer;
  v_place_dish_rows integer;
  v_dish_place_rows integer;
  v_orphan_mentions integer;
  v_both_backings integer;
  v_missing_family_tokens integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'dish_identity_stats_requires_service_role';
  end if;

  select
    count(*) filter (where canonical_dish_id is null and candidate_id is null),
    count(*) filter (where canonical_dish_id is not null and candidate_id is not null),
    count(*) filter (where canonical_dish_id is not null and coalesce(cardinality(family_tokens), 0) = 0)
  into v_orphan_mentions, v_both_backings, v_missing_family_tokens
  from public.review_dish_mentions
  where deleted_at is null;

  if v_orphan_mentions > 0 then
    raise exception 'explore_projection_blocked_by_orphan_mentions:%', v_orphan_mentions;
  end if;
  if v_both_backings > 0 then
    raise exception 'explore_projection_blocked_by_ambiguous_mentions:%', v_both_backings;
  end if;
  if v_missing_family_tokens > 0 then
    raise exception 'explore_projection_blocked_by_missing_family_tokens:%', v_missing_family_tokens;
  end if;

  delete from public.place_stats where true;
  with eligible_reviews as (
    select r.*
    from public.reviews r
    where coalesce(r.visibility, 'public') = 'public'
      and r.deleted_at is null
      and r.hidden_at is null
      and r.reported_at is null
      and coalesce(r.status, 'active') = 'active'
      and r.reviewer_name !~* '^e2e_'
      and r.restaurant_name !~* '^e2e\b'
      and nullif(btrim(r.restaurant_id), '') is not null
  ), place_base as (
    select
      r.restaurant_id as place_id,
      (array_agg(r.restaurant_name order by r.created_at desc, r.id desc))[1] as display_name,
      (array_agg(coalesce(r.area, r.restaurant_address) order by r.created_at desc, r.id desc)
        filter (where coalesce(r.area, r.restaurant_address) is not null))[1] as area,
      (array_agg(r.restaurant_address order by r.created_at desc, r.id desc)
        filter (where r.restaurant_address is not null))[1] as address,
      (array_agg(r.restaurant_lat order by r.created_at desc, r.id desc)
        filter (where r.restaurant_lat is not null))[1] as latitude,
      (array_agg(r.restaurant_lng order by r.created_at desc, r.id desc)
        filter (where r.restaurant_lng is not null))[1] as longitude,
      count(distinct r.id)::integer as review_count,
      count(distinct r.reviewer_name)::integer as unique_reviewer_count,
      (count(distinct rdm.canonical_dish_id) filter (where rdm.canonical_dish_id is not null))::integer as dish_count,
      round(avg(rdm.review_rating) filter (where rdm.review_rating > 0), 2) as average_rating,
      min(r.created_at) as first_review_at,
      max(r.created_at) as last_review_at
    from eligible_reviews r
    left join public.review_dish_mentions rdm
      on rdm.review_id = r.id and rdm.deleted_at is null and rdm.candidate_id is null
    group by r.restaurant_id
  ), primary_counts as (
    select r.restaurant_id as place_id, lower(btrim(r.restaurant_primary_type)) as place_type,
      count(*) as use_count, max(r.created_at) as last_seen_at
    from eligible_reviews r
    where nullif(btrim(r.restaurant_primary_type), '') is not null
    group by r.restaurant_id, lower(btrim(r.restaurant_primary_type))
  ), winning_primary as (
    select distinct on (place_id) place_id, place_type
    from primary_counts
    order by place_id, use_count desc, last_seen_at desc, place_type
  ), type_counts as (
    select r.restaurant_id as place_id, lower(btrim(t.place_type)) as place_type,
      count(*) as use_count, max(r.created_at) as last_seen_at
    from eligible_reviews r
    cross join lateral unnest(
      array_remove(coalesce(r.restaurant_types, '{}'::text[]) || array[r.restaurant_primary_type], null)
    ) t(place_type)
    where nullif(btrim(t.place_type), '') is not null
    group by r.restaurant_id, lower(btrim(t.place_type))
  ), aggregated_types as (
    select place_id, array_agg(place_type order by use_count desc, last_seen_at desc, place_type) as place_types
    from type_counts
    group by place_id
  )
  insert into public.place_stats (
    place_id, display_name, normalized_name, area, address, latitude, longitude,
    review_count, unique_reviewer_count, dish_count, average_rating,
    first_review_at, last_review_at, restaurant_primary_type, restaurant_types,
    category_tags, rebuilt_at, source
  )
  select
    base.place_id, base.display_name, lower(btrim(base.display_name)), base.area, base.address,
    base.latitude, base.longitude, base.review_count, base.unique_reviewer_count, base.dish_count,
    base.average_rating, base.first_review_at, base.last_review_at, winning.place_type,
    coalesce(types.place_types, '{}'::text[]),
    public.place_identity_explore_categories(winning.place_type, coalesce(types.place_types, '{}'::text[])),
    now(), 'rebuild'
  from place_base base
  left join winning_primary winning on winning.place_id = base.place_id
  left join aggregated_types types on types.place_id = base.place_id;
  get diagnostics v_place_rows = row_count;

  delete from public.place_dish_stats where true;
  insert into public.place_dish_stats (
    place_id, canonical_dish_id, family_id, family_tokens, mention_count,
    unique_reviewer_count, average_rating, first_review_at, last_review_at, rebuilt_at, source
  )
  select
    rdm.place_id, cd.id, cd.family_id, cd.family_tokens,
    count(*)::integer, count(distinct rdm.user_id)::integer,
    round(avg(rdm.review_rating) filter (where rdm.review_rating > 0), 2),
    min(r.created_at), max(r.created_at), now(), 'rebuild'
  from public.review_dish_mentions rdm
  join public.reviews r on r.id = rdm.review_id
  join public.canonical_dishes cd on cd.id = rdm.canonical_dish_id
  where rdm.deleted_at is null
    and rdm.candidate_id is null
    and nullif(btrim(rdm.place_id), '') is not null
    and cd.status in ('verified', 'generated')
    and cd.merged_into_dish_id is null
    and coalesce(r.visibility, 'public') = 'public'
    and r.deleted_at is null and r.hidden_at is null and r.reported_at is null
    and coalesce(r.status, 'active') = 'active'
    and r.reviewer_name !~* '^e2e_'
    and r.restaurant_name !~* '^e2e\b'
  group by rdm.place_id, cd.id, cd.family_id, cd.family_tokens;
  get diagnostics v_place_dish_rows = row_count;

  delete from public.dish_place_stats where true;
  insert into public.dish_place_stats (
    canonical_dish_id, place_id, family_id, family_tokens, mention_count,
    unique_reviewer_count, average_rating, first_review_at, last_review_at, rebuilt_at, source
  )
  select canonical_dish_id, place_id, family_id, family_tokens, mention_count,
    unique_reviewer_count, average_rating, first_review_at, last_review_at, now(), 'rebuild'
  from public.place_dish_stats;
  get diagnostics v_dish_place_rows = row_count;

  return jsonb_build_object(
    'placeStats', v_place_rows,
    'placeDishStats', v_place_dish_rows,
    'dishPlaceStats', v_dish_place_rows
  );
end;
$$;

comment on function public.rebuild_dish_identity_stats() is
  'Service-only complete Explore projection rebuild. Refuses to run while active dish mentions violate identity invariants.';
revoke all on function public.rebuild_dish_identity_stats() from public, anon, authenticated;
grant execute on function public.rebuild_dish_identity_stats() to service_role;

create or replace function public.explore_v3_pipeline_reconciliation()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'explore_v3_reconciliation_requires_service_role';
  end if;

  with eligible_reviews as (
    select r.*
    from public.reviews r
    where coalesce(r.visibility, 'public') = 'public'
      and r.deleted_at is null and r.hidden_at is null and r.reported_at is null
      and coalesce(r.status, 'active') = 'active'
      and r.reviewer_name !~* '^e2e_'
      and r.restaurant_name !~* '^e2e\b'
      and nullif(btrim(r.restaurant_id), '') is not null
  ), expected_places as (
    select distinct restaurant_id as place_id from eligible_reviews
  ), expected_pairs as (
    select distinct rdm.place_id, rdm.canonical_dish_id
    from public.review_dish_mentions rdm
    join eligible_reviews r on r.id = rdm.review_id
    join public.canonical_dishes cd on cd.id = rdm.canonical_dish_id
    where rdm.deleted_at is null and rdm.candidate_id is null
      and nullif(btrim(rdm.place_id), '') is not null
      and cd.status in ('verified', 'generated') and cd.merged_into_dish_id is null
  ), mention_counts as (
    select
      count(*)::integer as total_active,
      count(*) filter (where canonical_dish_id is not null and candidate_id is null)::integer as canonical,
      count(*) filter (where candidate_id is not null and canonical_dish_id is null)::integer as candidate,
      count(*) filter (where canonical_dish_id is null and candidate_id is null)::integer as orphan,
      count(*) filter (where canonical_dish_id is not null and candidate_id is not null)::integer as ambiguous,
      count(*) filter (where canonical_dish_id is not null and coalesce(cardinality(family_tokens), 0) = 0)::integer as missing_family_tokens
    from public.review_dish_mentions where deleted_at is null
  ), counts as (
    select
      (select count(*)::integer from expected_places) as expected_places,
      (select count(*)::integer from public.place_stats) as actual_places,
      (select count(*)::integer from expected_places ep where not exists (select 1 from public.place_stats ps where ps.place_id = ep.place_id)) as missing_places,
      (select count(*)::integer from public.place_stats ps where not exists (select 1 from expected_places ep where ep.place_id = ps.place_id)) as extra_places,
      (select count(*)::integer from expected_pairs) as expected_place_dishes,
      (select count(*)::integer from public.place_dish_stats) as actual_place_dishes,
      (select count(*)::integer from expected_pairs ep where not exists (select 1 from public.place_dish_stats ps where ps.place_id = ep.place_id and ps.canonical_dish_id = ep.canonical_dish_id)) as missing_place_dishes,
      (select count(*)::integer from public.place_dish_stats ps where not exists (select 1 from expected_pairs ep where ep.place_id = ps.place_id and ep.canonical_dish_id = ps.canonical_dish_id)) as extra_place_dishes,
      (select count(*)::integer from public.dish_place_stats) as actual_dish_places,
      (select count(*)::integer from expected_pairs ep where not exists (select 1 from public.dish_place_stats ds where ds.place_id = ep.place_id and ds.canonical_dish_id = ep.canonical_dish_id)) as missing_dish_places,
      (select count(*)::integer from public.dish_place_stats ds where not exists (select 1 from expected_pairs ep where ep.place_id = ds.place_id and ep.canonical_dish_id = ds.canonical_dish_id)) as extra_dish_places
  )
  select jsonb_build_object(
    'mentions', jsonb_build_object(
      'totalActive', mentions.total_active,
      'canonical', mentions.canonical,
      'candidate', mentions.candidate,
      'orphan', mentions.orphan,
      'ambiguous', mentions.ambiguous,
      'missingFamilyTokens', mentions.missing_family_tokens
    ),
    'placeStats', jsonb_build_object('expected', counts.expected_places, 'actual', counts.actual_places, 'missing', counts.missing_places, 'extra', counts.extra_places),
    'placeDishStats', jsonb_build_object('expected', counts.expected_place_dishes, 'actual', counts.actual_place_dishes, 'missing', counts.missing_place_dishes, 'extra', counts.extra_place_dishes),
    'dishPlaceStats', jsonb_build_object('expected', counts.expected_place_dishes, 'actual', counts.actual_dish_places, 'missing', counts.missing_dish_places, 'extra', counts.extra_dish_places),
    'ready', mentions.orphan = 0 and mentions.ambiguous = 0 and mentions.missing_family_tokens = 0
      and counts.missing_places = 0 and counts.extra_places = 0
      and counts.missing_place_dishes = 0 and counts.extra_place_dishes = 0
      and counts.missing_dish_places = 0 and counts.extra_dish_places = 0
  ) into v_result
  from mention_counts mentions cross join counts;
  return v_result;
end;
$$;

revoke all on function public.explore_v3_pipeline_reconciliation() from public, anon, authenticated;
grant execute on function public.explore_v3_pipeline_reconciliation() to service_role;

create or replace function public.rebuild_explore_v3_projections()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stats jsonb;
  v_reconciliation jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'explore_v3_rebuild_requires_service_role';
  end if;
  v_stats := public.rebuild_dish_identity_stats();
  v_reconciliation := public.explore_v3_pipeline_reconciliation();
  if not coalesce((v_reconciliation ->> 'ready')::boolean, false) then
    raise exception 'explore_v3_projection_reconciliation_failed:%', v_reconciliation;
  end if;
  return jsonb_build_object('stats', v_stats, 'reconciliation', v_reconciliation);
end;
$$;

revoke all on function public.rebuild_explore_v3_projections() from public, anon, authenticated;
grant execute on function public.rebuild_explore_v3_projections() to service_role;

-- Preserve the proven bounded/blocked-user v3 query as a private core, then
-- enrich its place payload from the projection. This avoids a second mobile
-- inference contract and keeps the public RPC signature backward compatible.
alter function public.explore_discovery_canonical_v3(double precision, double precision, integer)
  rename to explore_discovery_canonical_v3_core;
revoke all on function public.explore_discovery_canonical_v3_core(double precision, double precision, integer)
  from public, anon, authenticated;

create function public.explore_discovery_canonical_v3(
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
  with payload as (
    select public.explore_discovery_canonical_v3_core(p_lat, p_lng, p_limit) as value
  ), enriched_places as (
    select coalesce(jsonb_agg(
      place.value || jsonb_build_object(
        'primaryType', stats.restaurant_primary_type,
        'types', to_jsonb(coalesce(stats.restaurant_types, '{}'::text[])),
        'categoryTags', to_jsonb(coalesce(stats.category_tags, '{}'::text[]))
      ) order by place.ordinality
    ), '[]'::jsonb) as value
    from payload
    cross join lateral jsonb_array_elements(coalesce(payload.value -> 'places', '[]'::jsonb))
      with ordinality place(value, ordinality)
    left join public.place_stats stats on stats.place_id = place.value ->> 'placeId'
  )
  select jsonb_set(payload.value, '{places}', enriched_places.value, true)
  from payload cross join enriched_places;
$$;

revoke all on function public.explore_discovery_canonical_v3(double precision, double precision, integer)
  from public, anon;
grant execute on function public.explore_discovery_canonical_v3(double precision, double precision, integer)
  to authenticated;
comment on function public.explore_discovery_canonical_v3(double precision, double precision, integer) is
  'Explore v3 payload enriched with deterministic Google place types/categories from rebuilt place_stats.';
