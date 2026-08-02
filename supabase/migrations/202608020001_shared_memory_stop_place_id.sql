-- A stop is created from a places-autocomplete suggestion, but only the two
-- display lines were kept (`name` = main text, `note` = the address line). That
-- makes "open in Maps" a text SEARCH, which lands on a results list rather than
-- the venue whenever the name is generic. Keep the provider's place id so the
-- link can be an exact `query_place_id` match.
--
-- Nullable and unconstrained by design: every existing stop has no place id and
-- must keep working, and a stop can also be created without a suggestion.
alter table public.shared_memory_stops
  add column if not exists place_id text;

-- Provider ids are short opaque strings (Google's are ~27-300 chars). The bound
-- only stops an oversized value from being stored; it does not validate format,
-- because the id is opaque to us and its shape is the provider's to change.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shared_memory_stops_place_id_check'
  ) then
    alter table public.shared_memory_stops
      add constraint shared_memory_stops_place_id_check
      check (place_id is null or char_length(btrim(place_id)) between 1 and 512);
  end if;
end
$$;
