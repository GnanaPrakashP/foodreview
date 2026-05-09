-- Store richer Google Places details captured when a user selects a restaurant.

alter table public.reviews
  add column if not exists restaurant_id text,
  add column if not exists area text,
  add column if not exists restaurant_address text,
  add column if not exists restaurant_lat double precision,
  add column if not exists restaurant_lng double precision;

create index if not exists reviews_restaurant_location_idx
  on public.reviews(restaurant_lat, restaurant_lng)
  where restaurant_lat is not null
    and restaurant_lng is not null;
