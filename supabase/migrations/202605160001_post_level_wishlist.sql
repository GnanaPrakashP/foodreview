-- Make post bookmarks independent per post. Legacy restaurant-only wishlist rows
-- remain supported as saved places with post_id null.
alter table public.wishlist
  drop constraint if exists wishlist_user_name_restaurant_name_key;

create unique index if not exists wishlist_user_post_unique
  on public.wishlist(user_name, post_id)
  where post_id is not null;

create unique index if not exists wishlist_user_place_unique
  on public.wishlist(user_name, restaurant_name)
  where post_id is null;
