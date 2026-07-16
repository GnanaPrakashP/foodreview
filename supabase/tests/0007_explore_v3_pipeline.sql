begin;
select plan(17);

select has_column('public', 'place_stats', 'restaurant_primary_type', 'place projection stores Google primary type');
select has_column('public', 'place_stats', 'restaurant_types', 'place projection stores Google types');
select has_column('public', 'place_stats', 'category_tags', 'place projection stores structured Explore categories');

select has_function('public', 'place_identity_explore_categories', array['text', 'text[]'], 'Google type category mapper exists');
select has_function('public', 'explore_v3_pipeline_reconciliation', array[]::text[], 'read-only Explore reconciliation exists');
select has_function('public', 'rebuild_explore_v3_projections', array[]::text[], 'unified Explore rebuild exists');
select has_function('public', 'explore_discovery_canonical_v3', array['double precision', 'double precision', 'integer'], 'active Explore v3 RPC remains backward compatible');

select ok(
  has_function_privilege('service_role', 'public.rebuild_explore_v3_projections()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rebuild_explore_v3_projections()', 'EXECUTE'),
  'only service role can run the complete rebuild'
);
select ok(
  has_function_privilege('service_role', 'public.explore_v3_pipeline_reconciliation()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.explore_v3_pipeline_reconciliation()', 'EXECUTE'),
  'only service role can inspect global pipeline reconciliation'
);
select ok(
  has_function_privilege('authenticated', 'public.explore_discovery_canonical_v3(double precision,double precision,integer)', 'EXECUTE'),
  'authenticated mobile clients still execute Explore v3'
);
select ok(
  not has_function_privilege('authenticated', 'public.explore_discovery_canonical_v3_core(double precision,double precision,integer)', 'EXECUTE'),
  'the pre-enrichment Explore core is private'
);

select ok(
  (select position('explore_projection_blocked_by_orphan_mentions' in routine.prosrc) > 0
     and position('delete from public.place_stats' in routine.prosrc) > 0
     and position('delete from public.place_dish_stats' in routine.prosrc) > 0
     and position('delete from public.dish_place_stats' in routine.prosrc) > 0
   from pg_catalog.pg_proc routine
   where routine.oid = 'public.rebuild_dish_identity_stats()'::regprocedure),
  'projection rebuild rejects orphan mentions and rebuilds all three projections'
);
select ok(
  (select position('primaryType' in routine.prosrc) > 0
     and position('restaurant_primary_type' in routine.prosrc) > 0
     and position('categoryTags' in routine.prosrc) > 0
   from pg_catalog.pg_proc routine
   where routine.oid = 'public.explore_discovery_canonical_v3(double precision,double precision,integer)'::regprocedure),
  'Explore v3 carries structured Google classifications'
);

select is(
  public.place_identity_explore_categories('coffee_shop', array['cafe', 'restaurant']),
  array['cafe', 'restaurant']::text[],
  'primary type wins deterministic category ordering'
);
select is(
  public.place_identity_explore_categories('indian_restaurant', '{}'::text[]),
  array['restaurant']::text[],
  'cuisine restaurant types fall back to restaurant'
);
select is(
  public.place_identity_explore_categories(null, array['pizza_restaurant', 'fine_dining_restaurant']),
  array['quick_bites', 'fine_dining']::text[],
  'Google fast/fine dining types map to mobile category ids'
);
select is(
  public.place_identity_explore_categories(null, null),
  '{}'::text[],
  'missing Google metadata remains backward compatible'
);

select * from finish();
rollback;
