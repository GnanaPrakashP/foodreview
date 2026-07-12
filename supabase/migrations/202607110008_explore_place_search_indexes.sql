-- Keep Explore's app-wide place search responsive as review volume grows.

create extension if not exists pg_trgm with schema extensions;

create index if not exists reviews_restaurant_name_trgm_idx
  on public.reviews using gin (restaurant_name gin_trgm_ops);

create index if not exists reviews_area_trgm_idx
  on public.reviews using gin (area gin_trgm_ops);

create index if not exists reviews_restaurant_address_trgm_idx
  on public.reviews using gin (restaurant_address gin_trgm_ops);
