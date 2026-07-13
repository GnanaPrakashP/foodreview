-- Conservative dish identity seed expansion from reviewed candidates.
-- Keep this file in sync between mobile/supabase/migrations and supabase/migrations.
-- This migration is idempotent and intentionally avoids junk, test, and vague inputs.

with seed_families(id, name, slug) as (
  values
    ('10000000-0000-4000-8000-000000000013'::uuid, 'Mutton Curry', 'mutton-curry'),
    ('10000000-0000-4000-8000-000000000014'::uuid, 'Mezze', 'mezze')
),
normalized_seed_families as (
  select
    id,
    name,
    public.normalize_dish_identity_name(name) as normalized_name,
    slug
  from seed_families
)
insert into public.dish_families (id, name, normalized_name, slug, status)
select id, name, normalized_name, slug, 'active'
from normalized_seed_families seed
where not exists (
  select 1
  from public.dish_families existing
  where existing.id = seed.id
    or (
      existing.normalized_name = seed.normalized_name
      and existing.status = 'active'
    )
);

with seed_dishes(id, family_name, display_name, slug) as (
  values
    ('20000000-0000-4000-8000-000000000024'::uuid, 'Noodles', 'Khow Suey', 'khow-suey'),
    ('20000000-0000-4000-8000-000000000025'::uuid, 'Biryani', 'Dindigul Biryani', 'dindigul-biryani'),
    ('20000000-0000-4000-8000-000000000026'::uuid, 'Shawarma', 'Chicken Shawarma', 'chicken-shawarma'),
    ('20000000-0000-4000-8000-000000000027'::uuid, 'Mezze', 'Hummus', 'hummus'),
    ('20000000-0000-4000-8000-000000000028'::uuid, 'Mutton Curry', 'Mutton Kuzhambu', 'mutton-kuzhambu'),
    ('20000000-0000-4000-8000-000000000029'::uuid, 'Noodles', 'Shan Noodles', 'shan-noodles'),
    ('20000000-0000-4000-8000-00000000002a'::uuid, 'Noodles', 'Tonkotsu Ramen', 'tonkotsu-ramen'),
    ('20000000-0000-4000-8000-00000000002b'::uuid, 'Mutton Curry', 'Mutton Curry', 'mutton-curry')
),
normalized_seed_dishes as (
  select
    id,
    public.normalize_dish_identity_name(family_name) as normalized_family_name,
    display_name,
    public.normalize_dish_identity_name(display_name) as normalized_name,
    slug
  from seed_dishes
)
insert into public.canonical_dishes (id, family_id, display_name, normalized_name, slug, status)
select
  seed.id,
  family.id,
  seed.display_name,
  seed.normalized_name,
  seed.slug,
  'verified'
from normalized_seed_dishes seed
join public.dish_families family
  on family.normalized_name = seed.normalized_family_name
  and family.status = 'active'
where not exists (
  select 1
  from public.canonical_dishes existing
  where existing.id = seed.id
    or (
      existing.normalized_name = seed.normalized_name
      and existing.status in ('verified', 'generated')
      and existing.merged_into_dish_id is null
    )
);

with seed_aliases(id, canonical_dish_id, alias_text) as (
  values
    ('30000000-0000-4000-8000-000000000023'::uuid, '20000000-0000-4000-8000-000000000025'::uuid, 'dindigul biriyani'),
    ('30000000-0000-4000-8000-000000000024'::uuid, '20000000-0000-4000-8000-000000000026'::uuid, 'chicken shwarma'),
    ('30000000-0000-4000-8000-000000000025'::uuid, '20000000-0000-4000-8000-000000000027'::uuid, 'hummous'),
    ('30000000-0000-4000-8000-000000000026'::uuid, '20000000-0000-4000-8000-000000000027'::uuid, 'houmous'),
    ('30000000-0000-4000-8000-000000000027'::uuid, '20000000-0000-4000-8000-000000000028'::uuid, 'mutton kulambu'),
    ('30000000-0000-4000-8000-000000000028'::uuid, '20000000-0000-4000-8000-000000000029'::uuid, 'shan noodle')
),
normalized_seed_aliases as (
  select
    id,
    canonical_dish_id,
    alias_text,
    public.normalize_dish_identity_name(alias_text) as normalized_alias
  from seed_aliases
)
insert into public.dish_aliases (
  id,
  canonical_dish_id,
  alias_text,
  normalized_alias,
  alias_type,
  confidence,
  confirmation_count,
  status
)
select
  seed.id,
  dish.id,
  seed.alias_text,
  seed.normalized_alias,
  'seed',
  1.0,
  0,
  'active'
from normalized_seed_aliases seed
join public.canonical_dishes dish
  on dish.id = seed.canonical_dish_id
  and dish.status = 'verified'
  and dish.merged_into_dish_id is null
where not exists (
  select 1
  from public.dish_aliases existing
  where existing.id = seed.id
    or (
      existing.normalized_alias = seed.normalized_alias
      and existing.status = 'active'
    )
);
