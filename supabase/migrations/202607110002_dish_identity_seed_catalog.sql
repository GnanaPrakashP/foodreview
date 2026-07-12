-- Minimal trusted dish identity catalogue for exact resolver matching.
-- This intentionally stays small, high-confidence, and idempotent.

with seed_families(id, name, slug) as (
  values
    ('10000000-0000-4000-8000-000000000001'::uuid, 'Biryani', 'biryani'),
    ('10000000-0000-4000-8000-000000000002'::uuid, 'Manchurian', 'manchurian'),
    ('10000000-0000-4000-8000-000000000003'::uuid, 'Paneer', 'paneer'),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'Chicken Curry', 'chicken-curry'),
    ('10000000-0000-4000-8000-000000000005'::uuid, 'Chicken Starter', 'chicken-starter'),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'Rice', 'rice'),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'Noodles', 'noodles'),
    ('10000000-0000-4000-8000-000000000008'::uuid, 'Dosa', 'dosa'),
    ('10000000-0000-4000-8000-000000000009'::uuid, 'Idli', 'idli'),
    ('10000000-0000-4000-8000-00000000000a'::uuid, 'Vada', 'vada'),
    ('10000000-0000-4000-8000-00000000000b'::uuid, 'Indian Bread', 'indian-bread'),
    ('10000000-0000-4000-8000-00000000000c'::uuid, 'Pizza', 'pizza'),
    ('10000000-0000-4000-8000-00000000000d'::uuid, 'Burger', 'burger'),
    ('10000000-0000-4000-8000-00000000000e'::uuid, 'Pasta', 'pasta'),
    ('10000000-0000-4000-8000-00000000000f'::uuid, 'Shawarma', 'shawarma'),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'Fries', 'fries'),
    ('10000000-0000-4000-8000-000000000011'::uuid, 'Dessert', 'dessert'),
    ('10000000-0000-4000-8000-000000000012'::uuid, 'Beverage', 'beverage')
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
    ('20000000-0000-4000-8000-000000000001'::uuid, 'Biryani', 'Chicken Biryani', 'chicken-biryani'),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'Biryani', 'Mutton Biryani', 'mutton-biryani'),
    ('20000000-0000-4000-8000-000000000003'::uuid, 'Biryani', 'Veg Biryani', 'veg-biryani'),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'Biryani', 'Hyderabadi Chicken Biryani', 'hyderabadi-chicken-biryani'),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'Biryani', 'Chicken Dum Biryani', 'chicken-dum-biryani'),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'Manchurian', 'Chicken Manchurian', 'chicken-manchurian'),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'Manchurian', 'Veg Manchurian', 'veg-manchurian'),
    ('20000000-0000-4000-8000-000000000008'::uuid, 'Manchurian', 'Gobi Manchurian', 'gobi-manchurian'),
    ('20000000-0000-4000-8000-000000000009'::uuid, 'Paneer', 'Paneer Butter Masala', 'paneer-butter-masala'),
    ('20000000-0000-4000-8000-00000000000a'::uuid, 'Chicken Curry', 'Butter Chicken', 'butter-chicken'),
    ('20000000-0000-4000-8000-00000000000b'::uuid, 'Chicken Starter', 'Chicken 65', 'chicken-65'),
    ('20000000-0000-4000-8000-00000000000c'::uuid, 'Rice', 'Chicken Fried Rice', 'chicken-fried-rice'),
    ('20000000-0000-4000-8000-00000000000d'::uuid, 'Rice', 'Veg Fried Rice', 'veg-fried-rice'),
    ('20000000-0000-4000-8000-00000000000e'::uuid, 'Rice', 'Egg Fried Rice', 'egg-fried-rice'),
    ('20000000-0000-4000-8000-00000000000f'::uuid, 'Noodles', 'Chicken Noodles', 'chicken-noodles'),
    ('20000000-0000-4000-8000-000000000010'::uuid, 'Noodles', 'Veg Noodles', 'veg-noodles'),
    ('20000000-0000-4000-8000-000000000011'::uuid, 'Dosa', 'Masala Dosa', 'masala-dosa'),
    ('20000000-0000-4000-8000-000000000012'::uuid, 'Dosa', 'Plain Dosa', 'plain-dosa'),
    ('20000000-0000-4000-8000-000000000013'::uuid, 'Idli', 'Idli', 'idli'),
    ('20000000-0000-4000-8000-000000000014'::uuid, 'Vada', 'Medu Vada', 'medu-vada'),
    ('20000000-0000-4000-8000-000000000015'::uuid, 'Indian Bread', 'Poori', 'poori'),
    ('20000000-0000-4000-8000-000000000016'::uuid, 'Indian Bread', 'Chapati', 'chapati'),
    ('20000000-0000-4000-8000-000000000017'::uuid, 'Indian Bread', 'Naan', 'naan'),
    ('20000000-0000-4000-8000-000000000018'::uuid, 'Indian Bread', 'Parotta', 'parotta'),
    ('20000000-0000-4000-8000-000000000019'::uuid, 'Pizza', 'Pizza', 'pizza'),
    ('20000000-0000-4000-8000-00000000001a'::uuid, 'Burger', 'Burger', 'burger'),
    ('20000000-0000-4000-8000-00000000001b'::uuid, 'Pasta', 'Pasta', 'pasta'),
    ('20000000-0000-4000-8000-00000000001c'::uuid, 'Shawarma', 'Shawarma', 'shawarma'),
    ('20000000-0000-4000-8000-00000000001d'::uuid, 'Fries', 'French Fries', 'french-fries'),
    ('20000000-0000-4000-8000-00000000001e'::uuid, 'Dessert', 'Ice Cream', 'ice-cream'),
    ('20000000-0000-4000-8000-00000000001f'::uuid, 'Dessert', 'Brownie', 'brownie'),
    ('20000000-0000-4000-8000-000000000020'::uuid, 'Beverage', 'Cold Coffee', 'cold-coffee'),
    ('20000000-0000-4000-8000-000000000021'::uuid, 'Beverage', 'Tea', 'tea'),
    ('20000000-0000-4000-8000-000000000022'::uuid, 'Beverage', 'Coffee', 'coffee'),
    ('20000000-0000-4000-8000-000000000023'::uuid, 'Beverage', 'Fresh Lime Soda', 'fresh-lime-soda')
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
    ('30000000-0000-4000-8000-000000000001'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'chiken biryani'),
    ('30000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'chicken biriyani'),
    ('30000000-0000-4000-8000-000000000003'::uuid, '20000000-0000-4000-8000-000000000001'::uuid, 'chiken biriyani'),
    ('30000000-0000-4000-8000-000000000004'::uuid, '20000000-0000-4000-8000-000000000002'::uuid, 'mutton biriyani'),
    ('30000000-0000-4000-8000-000000000005'::uuid, '20000000-0000-4000-8000-000000000003'::uuid, 'veg biriyani'),
    ('30000000-0000-4000-8000-000000000006'::uuid, '20000000-0000-4000-8000-000000000004'::uuid, 'hyderabadi chicken biriyani'),
    ('30000000-0000-4000-8000-000000000007'::uuid, '20000000-0000-4000-8000-000000000005'::uuid, 'chicken dum biriyani'),
    ('30000000-0000-4000-8000-000000000008'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'chicken manchuria'),
    ('30000000-0000-4000-8000-000000000009'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'chicken manjuri'),
    ('30000000-0000-4000-8000-00000000000a'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'chicken manjurian'),
    ('30000000-0000-4000-8000-00000000000b'::uuid, '20000000-0000-4000-8000-000000000006'::uuid, 'chiken manchurian'),
    ('30000000-0000-4000-8000-00000000000c'::uuid, '20000000-0000-4000-8000-000000000007'::uuid, 'veg manchuria'),
    ('30000000-0000-4000-8000-00000000000d'::uuid, '20000000-0000-4000-8000-000000000008'::uuid, 'gobi manchuria'),
    ('30000000-0000-4000-8000-00000000000e'::uuid, '20000000-0000-4000-8000-000000000009'::uuid, 'panneer butter masala'),
    ('30000000-0000-4000-8000-00000000000f'::uuid, '20000000-0000-4000-8000-000000000009'::uuid, 'paneer butter masala curry'),
    ('30000000-0000-4000-8000-000000000010'::uuid, '20000000-0000-4000-8000-00000000000a'::uuid, 'butter chiken'),
    ('30000000-0000-4000-8000-000000000011'::uuid, '20000000-0000-4000-8000-00000000000b'::uuid, 'chicken sixty five'),
    ('30000000-0000-4000-8000-000000000012'::uuid, '20000000-0000-4000-8000-00000000000b'::uuid, 'chiken 65'),
    ('30000000-0000-4000-8000-000000000013'::uuid, '20000000-0000-4000-8000-00000000000c'::uuid, 'fried rice chicken'),
    ('30000000-0000-4000-8000-000000000014'::uuid, '20000000-0000-4000-8000-00000000000c'::uuid, 'chicken friedrice'),
    ('30000000-0000-4000-8000-000000000015'::uuid, '20000000-0000-4000-8000-00000000000d'::uuid, 'veg friedrice'),
    ('30000000-0000-4000-8000-000000000016'::uuid, '20000000-0000-4000-8000-00000000000e'::uuid, 'egg friedrice'),
    ('30000000-0000-4000-8000-000000000017'::uuid, '20000000-0000-4000-8000-00000000000f'::uuid, 'chicken noodls'),
    ('30000000-0000-4000-8000-000000000018'::uuid, '20000000-0000-4000-8000-000000000010'::uuid, 'veg noodls'),
    ('30000000-0000-4000-8000-000000000019'::uuid, '20000000-0000-4000-8000-000000000011'::uuid, 'masala dose'),
    ('30000000-0000-4000-8000-00000000001a'::uuid, '20000000-0000-4000-8000-000000000012'::uuid, 'plain dose'),
    ('30000000-0000-4000-8000-00000000001b'::uuid, '20000000-0000-4000-8000-000000000014'::uuid, 'medu wada'),
    ('30000000-0000-4000-8000-00000000001c'::uuid, '20000000-0000-4000-8000-000000000018'::uuid, 'parota'),
    ('30000000-0000-4000-8000-00000000001d'::uuid, '20000000-0000-4000-8000-00000000001c'::uuid, 'shawarmaa'),
    ('30000000-0000-4000-8000-00000000001e'::uuid, '20000000-0000-4000-8000-00000000001c'::uuid, 'shavarma'),
    ('30000000-0000-4000-8000-00000000001f'::uuid, '20000000-0000-4000-8000-00000000001e'::uuid, 'icecream'),
    ('30000000-0000-4000-8000-000000000020'::uuid, '20000000-0000-4000-8000-00000000001f'::uuid, 'browniee'),
    ('30000000-0000-4000-8000-000000000021'::uuid, '20000000-0000-4000-8000-000000000020'::uuid, 'cold coffe'),
    ('30000000-0000-4000-8000-000000000022'::uuid, '20000000-0000-4000-8000-000000000023'::uuid, 'fresh lime sodha')
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
