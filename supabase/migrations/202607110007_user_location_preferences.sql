-- Private app-wide location preference for location-aware discovery surfaces.
-- The mobile app keeps a local copy for fast startup and syncs this row when
-- authenticated so future tabs can share the same user-selected/device location.

create table if not exists public.user_location_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  label text not null,
  source text not null default 'manual',
  place_id text,
  updated_at timestamptz not null default now(),
  constraint user_location_preferences_latitude_check check (latitude between -90 and 90),
  constraint user_location_preferences_longitude_check check (longitude between -180 and 180),
  constraint user_location_preferences_label_check check (length(btrim(label)) between 1 and 80),
  constraint user_location_preferences_source_check check (source in ('device', 'manual'))
);

create index if not exists user_location_preferences_updated_at_idx
  on public.user_location_preferences(updated_at desc);

alter table public.user_location_preferences enable row level security;

drop policy if exists "Users can read own app location" on public.user_location_preferences;
create policy "Users can read own app location"
  on public.user_location_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own app location" on public.user_location_preferences;
create policy "Users can insert own app location"
  on public.user_location_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can update own app location" on public.user_location_preferences;
create policy "Users can update own app location"
  on public.user_location_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own app location" on public.user_location_preferences;
create policy "Users can delete own app location"
  on public.user_location_preferences for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.user_location_preferences to authenticated;

comment on table public.user_location_preferences is
  'Private per-user app location preference shared by Explore, Circle public discovery, and future location-aware surfaces.';
