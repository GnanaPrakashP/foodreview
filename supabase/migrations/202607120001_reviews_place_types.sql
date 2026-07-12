-- Capture Google Places venue types on each review so places can later be
-- classified into an Explore "kind of place" (cafe / restaurant / quick bites /
-- desserts / fine dining / nightlife). This is the raw per-review signal —
-- mirroring how dish names are captured per review before canonical/family
-- curation. A later curation pass aggregates these per place_id into a
-- place category.
alter table public.reviews
  add column if not exists restaurant_primary_type text,
  add column if not exists restaurant_types text[];

comment on column public.reviews.restaurant_primary_type is
  'Google Places primaryType for the reviewed venue (e.g. coffee_shop, fine_dining_restaurant). Raw signal for place categorization.';
comment on column public.reviews.restaurant_types is
  'Google Places types array for the reviewed venue. Raw signal for place categorization.';
