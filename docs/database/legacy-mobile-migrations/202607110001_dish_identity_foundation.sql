-- Production dish identity foundation.
-- Keep this file in sync between mobile/supabase/migrations and supabase/migrations.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.normalize_dish_identity_name(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(btrim(coalesce(input, ''))),
        '[^[:alnum:][:space:]]',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

revoke all on function public.normalize_dish_identity_name(text) from public;
grant execute on function public.normalize_dish_identity_name(text) to service_role;

create table if not exists public.dish_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  slug text,
  parent_family_id uuid references public.dish_families(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dish_families_name_not_blank check (btrim(name) <> ''),
  constraint dish_families_normalized_name_not_blank check (btrim(normalized_name) <> ''),
  constraint dish_families_status_check check (status in ('active', 'hidden', 'merged')),
  constraint dish_families_parent_not_self check (parent_family_id is null or parent_family_id <> id)
);

comment on table public.dish_families is
  'Stable dish family taxonomy for future dish discovery. Phase 1 does not change runtime Explore behavior.';

create unique index if not exists dish_families_active_normalized_name_unique
  on public.dish_families(normalized_name)
  where status = 'active';
create index if not exists dish_families_normalized_name_idx
  on public.dish_families(normalized_name);
create index if not exists dish_families_parent_family_id_idx
  on public.dish_families(parent_family_id);
create index if not exists dish_families_status_idx
  on public.dish_families(status);

create table if not exists public.canonical_dishes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.dish_families(id) on delete set null,
  display_name text not null,
  normalized_name text not null,
  slug text,
  status text not null default 'verified',
  merged_into_dish_id uuid references public.canonical_dishes(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_dishes_display_name_not_blank check (btrim(display_name) <> ''),
  constraint canonical_dishes_normalized_name_not_blank check (btrim(normalized_name) <> ''),
  constraint canonical_dishes_status_check check (status in ('verified', 'generated', 'merged', 'hidden', 'rejected')),
  constraint canonical_dishes_merge_not_self check (merged_into_dish_id is null or merged_into_dish_id <> id),
  constraint canonical_dishes_merged_pointer_check check (
    (status = 'merged' and merged_into_dish_id is not null)
    or (status <> 'merged' and merged_into_dish_id is null)
  )
);

comment on table public.canonical_dishes is
  'Trusted canonical dish identities. Unknown user input should land in dish_candidates until verified or promoted.';

create unique index if not exists canonical_dishes_live_normalized_name_unique
  on public.canonical_dishes(normalized_name)
  where status in ('verified', 'generated')
    and merged_into_dish_id is null;
create index if not exists canonical_dishes_normalized_name_idx
  on public.canonical_dishes(normalized_name);
create index if not exists canonical_dishes_family_id_idx
  on public.canonical_dishes(family_id);
create index if not exists canonical_dishes_status_idx
  on public.canonical_dishes(status);
create index if not exists canonical_dishes_merged_into_dish_id_idx
  on public.canonical_dishes(merged_into_dish_id);
create index if not exists canonical_dishes_normalized_name_trgm_idx
  on public.canonical_dishes using gin (normalized_name gin_trgm_ops);

create table if not exists public.dish_aliases (
  id uuid primary key default gen_random_uuid(),
  canonical_dish_id uuid not null references public.canonical_dishes(id) on delete cascade,
  alias_text text not null,
  normalized_alias text not null,
  alias_type text not null,
  confidence numeric,
  confirmation_count integer not null default 0,
  status text not null default 'candidate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dish_aliases_alias_text_not_blank check (btrim(alias_text) <> ''),
  constraint dish_aliases_normalized_alias_not_blank check (btrim(normalized_alias) <> ''),
  constraint dish_aliases_alias_type_check check (
    alias_type in (
      'typo',
      'spelling_variant',
      'abbreviation',
      'regional_name',
      'transliteration',
      'menu_name',
      'user_confirmed',
      'admin',
      'seed'
    )
  ),
  constraint dish_aliases_status_check check (status in ('active', 'candidate', 'rejected', 'hidden')),
  constraint dish_aliases_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint dish_aliases_confirmation_count_check check (confirmation_count >= 0)
);

comment on table public.dish_aliases is
  'Alias dictionary for exact or verified dish-name variants. Active aliases are unique globally to avoid silent many-to-one conflicts.';

create unique index if not exists dish_aliases_active_normalized_alias_unique
  on public.dish_aliases(normalized_alias)
  where status = 'active';
create index if not exists dish_aliases_normalized_alias_idx
  on public.dish_aliases(normalized_alias);
create index if not exists dish_aliases_canonical_dish_id_idx
  on public.dish_aliases(canonical_dish_id);
create index if not exists dish_aliases_status_idx
  on public.dish_aliases(status);
create index if not exists dish_aliases_normalized_alias_trgm_idx
  on public.dish_aliases using gin (normalized_alias gin_trgm_ops);

create table if not exists public.dish_candidates (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null,
  normalized_name text not null,
  suggested_canonical_dish_id uuid references public.canonical_dishes(id) on delete set null,
  place_id text,
  created_by uuid references auth.users(id) on delete set null,
  first_review_id uuid references public.reviews(id) on delete set null,
  evidence_count integer not null default 1,
  status text not null default 'new',
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dish_candidates_raw_name_not_blank check (btrim(raw_name) <> ''),
  constraint dish_candidates_normalized_name_not_blank check (btrim(normalized_name) <> ''),
  constraint dish_candidates_status_check check (status in ('new', 'needs_review', 'promoted', 'rejected', 'hidden', 'merged')),
  constraint dish_candidates_evidence_count_check check (evidence_count >= 1),
  constraint dish_candidates_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 1))
);

comment on table public.dish_candidates is
  'Holding area for unknown or low-confidence dish inputs. Candidates are not trusted canonical dishes.';

create unique index if not exists dish_candidates_open_normalized_place_unique
  on public.dish_candidates(normalized_name, coalesce(place_id, ''))
  where status in ('new', 'needs_review');
create index if not exists dish_candidates_normalized_name_idx
  on public.dish_candidates(normalized_name);
create index if not exists dish_candidates_status_idx
  on public.dish_candidates(status);
create index if not exists dish_candidates_suggested_canonical_dish_id_idx
  on public.dish_candidates(suggested_canonical_dish_id);
create index if not exists dish_candidates_place_id_idx
  on public.dish_candidates(place_id);
create index if not exists dish_candidates_created_by_idx
  on public.dish_candidates(created_by);
create index if not exists dish_candidates_normalized_name_trgm_idx
  on public.dish_candidates using gin (normalized_name gin_trgm_ops);

create table if not exists public.review_dish_mentions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id text,
  item_position integer not null default 0,
  raw_name text not null,
  normalized_name text not null,
  display_name text not null,
  canonical_dish_id uuid references public.canonical_dishes(id) on delete set null,
  candidate_id uuid references public.dish_candidates(id) on delete set null,
  family_id uuid references public.dish_families(id) on delete set null,
  source text not null,
  match_status text not null,
  match_confidence numeric,
  normalizer_version text,
  review_rating numeric,
  legacy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint review_dish_mentions_item_position_check check (item_position >= 0),
  constraint review_dish_mentions_raw_name_not_blank check (btrim(raw_name) <> ''),
  constraint review_dish_mentions_normalized_name_not_blank check (btrim(normalized_name) <> ''),
  constraint review_dish_mentions_display_name_not_blank check (btrim(display_name) <> ''),
  constraint review_dish_mentions_source_check check (source in ('server', 'mobile_legacy', 'backfill', 'admin', 'user')),
  constraint review_dish_mentions_match_status_check check (
    match_status in ('exact', 'alias', 'user_selected', 'high_confidence', 'candidate', 'unresolved', 'needs_review', 'legacy')
  ),
  constraint review_dish_mentions_match_confidence_check check (
    match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)
  ),
  constraint review_dish_mentions_review_rating_check check (
    review_rating is null or (review_rating > 0 and review_rating <= 5)
  ),
  constraint review_dish_mentions_legacy_metadata_object_check check (jsonb_typeof(legacy_metadata) = 'object')
);

comment on table public.review_dish_mentions is
  'Durable per-review dish mentions. Current runtime still reads and writes reviews.items; this table is a future projection/source-of-truth foundation.';

create unique index if not exists review_dish_mentions_review_position_active_unique
  on public.review_dish_mentions(review_id, item_position)
  where deleted_at is null;
create index if not exists review_dish_mentions_review_id_idx
  on public.review_dish_mentions(review_id);
create index if not exists review_dish_mentions_place_id_idx
  on public.review_dish_mentions(place_id);
create index if not exists review_dish_mentions_canonical_dish_id_idx
  on public.review_dish_mentions(canonical_dish_id);
create index if not exists review_dish_mentions_candidate_id_idx
  on public.review_dish_mentions(candidate_id);
create index if not exists review_dish_mentions_family_id_idx
  on public.review_dish_mentions(family_id);
create index if not exists review_dish_mentions_user_id_idx
  on public.review_dish_mentions(user_id);
create index if not exists review_dish_mentions_deleted_at_idx
  on public.review_dish_mentions(deleted_at);
create index if not exists review_dish_mentions_match_status_idx
  on public.review_dish_mentions(match_status);

create table if not exists public.dish_merge_history (
  id uuid primary key default gen_random_uuid(),
  from_canonical_dish_id uuid not null references public.canonical_dishes(id) on delete restrict,
  to_canonical_dish_id uuid not null references public.canonical_dishes(id) on delete restrict,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dish_merge_history_not_self check (from_canonical_dish_id <> to_canonical_dish_id)
);

comment on table public.dish_merge_history is
  'Audit trail for future canonical dish redirects and merge decisions.';

create index if not exists dish_merge_history_from_idx
  on public.dish_merge_history(from_canonical_dish_id);
create index if not exists dish_merge_history_to_idx
  on public.dish_merge_history(to_canonical_dish_id);
create index if not exists dish_merge_history_created_by_idx
  on public.dish_merge_history(created_by);

create table if not exists public.place_stats (
  place_id text primary key,
  display_name text,
  normalized_name text,
  area text,
  address text,
  latitude double precision,
  longitude double precision,
  review_count integer not null default 0,
  unique_reviewer_count integer not null default 0,
  dish_count integer not null default 0,
  average_rating numeric,
  first_review_at timestamptz,
  last_review_at timestamptz,
  rebuilt_at timestamptz not null default now(),
  source text not null default 'rebuild',
  constraint place_stats_place_id_not_blank check (btrim(place_id) <> ''),
  constraint place_stats_counts_check check (
    review_count >= 0
    and unique_reviewer_count >= 0
    and dish_count >= 0
  ),
  constraint place_stats_average_rating_check check (average_rating is null or (average_rating > 0 and average_rating <= 5)),
  constraint place_stats_source_check check (source in ('rebuild', 'backfill', 'worker'))
);

comment on table public.place_stats is
  'Rebuildable public-place projection for future Explore. Phase 1 does not read from this table.';

create index if not exists place_stats_review_count_idx
  on public.place_stats(review_count desc);
create index if not exists place_stats_last_review_at_idx
  on public.place_stats(last_review_at desc);

create table if not exists public.place_dish_stats (
  place_id text not null,
  canonical_dish_id uuid not null references public.canonical_dishes(id) on delete cascade,
  family_id uuid references public.dish_families(id) on delete set null,
  mention_count integer not null default 0,
  unique_reviewer_count integer not null default 0,
  average_rating numeric,
  first_review_at timestamptz,
  last_review_at timestamptz,
  rebuilt_at timestamptz not null default now(),
  source text not null default 'rebuild',
  primary key (place_id, canonical_dish_id),
  constraint place_dish_stats_place_id_not_blank check (btrim(place_id) <> ''),
  constraint place_dish_stats_counts_check check (mention_count >= 0 and unique_reviewer_count >= 0),
  constraint place_dish_stats_average_rating_check check (average_rating is null or (average_rating > 0 and average_rating <= 5)),
  constraint place_dish_stats_source_check check (source in ('rebuild', 'backfill', 'worker'))
);

comment on table public.place_dish_stats is
  'Rebuildable place-to-dish projection for future Explore rankings. It is intentionally not wired into app reads in Phase 1.';

create index if not exists place_dish_stats_canonical_dish_id_idx
  on public.place_dish_stats(canonical_dish_id);
create index if not exists place_dish_stats_family_id_idx
  on public.place_dish_stats(family_id);
create index if not exists place_dish_stats_mention_count_idx
  on public.place_dish_stats(mention_count desc);

create table if not exists public.dish_place_stats (
  canonical_dish_id uuid not null references public.canonical_dishes(id) on delete cascade,
  place_id text not null,
  family_id uuid references public.dish_families(id) on delete set null,
  mention_count integer not null default 0,
  unique_reviewer_count integer not null default 0,
  average_rating numeric,
  first_review_at timestamptz,
  last_review_at timestamptz,
  rebuilt_at timestamptz not null default now(),
  source text not null default 'rebuild',
  primary key (canonical_dish_id, place_id),
  constraint dish_place_stats_place_id_not_blank check (btrim(place_id) <> ''),
  constraint dish_place_stats_counts_check check (mention_count >= 0 and unique_reviewer_count >= 0),
  constraint dish_place_stats_average_rating_check check (average_rating is null or (average_rating > 0 and average_rating <= 5)),
  constraint dish_place_stats_source_check check (source in ('rebuild', 'backfill', 'worker'))
);

comment on table public.dish_place_stats is
  'Rebuildable dish-to-place projection for future dish pages. It is intentionally not wired into app reads in Phase 1.';

create index if not exists dish_place_stats_place_id_idx
  on public.dish_place_stats(place_id);
create index if not exists dish_place_stats_family_id_idx
  on public.dish_place_stats(family_id);
create index if not exists dish_place_stats_mention_count_idx
  on public.dish_place_stats(mention_count desc);

alter table public.dish_families enable row level security;
alter table public.canonical_dishes enable row level security;
alter table public.dish_aliases enable row level security;
alter table public.dish_candidates enable row level security;
alter table public.review_dish_mentions enable row level security;
alter table public.dish_merge_history enable row level security;
alter table public.place_stats enable row level security;
alter table public.place_dish_stats enable row level security;
alter table public.dish_place_stats enable row level security;

drop policy if exists "Active dish families are readable" on public.dish_families;
create policy "Active dish families are readable"
  on public.dish_families for select to anon, authenticated
  using (status = 'active');

drop policy if exists "Verified canonical dishes are readable" on public.canonical_dishes;
create policy "Verified canonical dishes are readable"
  on public.canonical_dishes for select to anon, authenticated
  using (status = 'verified' and merged_into_dish_id is null);

drop policy if exists "Active dish aliases are readable" on public.dish_aliases;
create policy "Active dish aliases are readable"
  on public.dish_aliases for select to anon, authenticated
  using (
    status = 'active'
    and exists (
      select 1
      from public.canonical_dishes dish
      where dish.id = dish_aliases.canonical_dish_id
        and dish.status = 'verified'
        and dish.merged_into_dish_id is null
    )
  );

drop policy if exists "Review dish mentions readable with review" on public.review_dish_mentions;
create policy "Review dish mentions readable with review"
  on public.review_dish_mentions for select to anon, authenticated
  using (deleted_at is null and public.can_read_review_id(review_id));

revoke all on table
  public.dish_families,
  public.canonical_dishes,
  public.dish_aliases,
  public.dish_candidates,
  public.review_dish_mentions,
  public.dish_merge_history,
  public.place_stats,
  public.place_dish_stats,
  public.dish_place_stats
from anon, authenticated;

grant select on table
  public.dish_families,
  public.canonical_dishes,
  public.dish_aliases,
  public.review_dish_mentions
to anon, authenticated;

grant all privileges on table
  public.dish_families,
  public.canonical_dishes,
  public.dish_aliases,
  public.dish_candidates,
  public.review_dish_mentions,
  public.dish_merge_history,
  public.place_stats,
  public.place_dish_stats,
  public.dish_place_stats
to service_role;

create or replace function public.backfill_review_dish_mentions(p_batch_size integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'dish_identity_backfill_requires_service_role';
  end if;

  with source_rows as (
    select
      review.id as review_id,
      profile.id as user_id,
      review.restaurant_id as place_id,
      (item.ordinality - 1)::integer as item_position,
      coalesce(
        nullif(btrim(item.value ->> 'rawDishName'), ''),
        nullif(btrim(item.value ->> 'name'), '')
      ) as raw_name,
      coalesce(
        nullif(btrim(item.value ->> 'name'), ''),
        nullif(btrim(item.value ->> 'rawDishName'), '')
      ) as display_name,
      item.value as legacy_item,
      case
        when coalesce(item.value ->> 'rating', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then (item.value ->> 'rating')::numeric
        else null
      end as review_rating
    from public.reviews review
    join public.profiles profile
      on profile.username = review.reviewer_name
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(review.items) = 'array' then review.items
        else '[]'::jsonb
      end
    ) with ordinality as item(value, ordinality)
    where jsonb_typeof(item.value) = 'object'
    order by review.created_at asc, review.id asc, item.ordinality asc
    limit least(greatest(coalesce(p_batch_size, 1000), 1), 10000)
  ),
  prepared_rows as (
    select
      review_id,
      user_id,
      place_id,
      item_position,
      raw_name,
      public.normalize_dish_identity_name(raw_name) as normalized_name,
      display_name,
      review_rating,
      jsonb_strip_nulls(
        jsonb_build_object(
          'legacyCanonicalDishId', legacy_item ->> 'canonicalDishId',
          'legacyCanonicalDishName', legacy_item ->> 'canonicalDishName',
          'legacyCanonicalDishSource', legacy_item ->> 'canonicalDishSource',
          'legacyDishClusterKey', legacy_item ->> 'dishClusterKey',
          'legacyDishFamilyId', legacy_item ->> 'dishFamilyId',
          'legacyDishFamilyName', legacy_item ->> 'dishFamilyName',
          'legacyDishNormalizationConfidence', legacy_item ->> 'dishNormalizationConfidence'
        )
      ) as legacy_metadata
    from source_rows
    where raw_name is not null
      and display_name is not null
  ),
  inserted as (
    insert into public.review_dish_mentions (
      review_id,
      user_id,
      place_id,
      item_position,
      raw_name,
      normalized_name,
      display_name,
      canonical_dish_id,
      candidate_id,
      family_id,
      source,
      match_status,
      match_confidence,
      normalizer_version,
      review_rating,
      legacy_metadata
    )
    select
      review_id,
      user_id,
      place_id,
      item_position,
      raw_name,
      normalized_name,
      display_name,
      null,
      null,
      null,
      'backfill',
      'legacy',
      null,
      'legacy-json-v1',
      review_rating,
      legacy_metadata
    from prepared_rows
    on conflict (review_id, item_position) where deleted_at is null do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;

comment on function public.backfill_review_dish_mentions(integer) is
  'Prepared idempotent backfill for legacy reviews.items JSON. It preserves legacy metadata but does not trust old generated string IDs as canonical UUIDs.';

revoke all on function public.backfill_review_dish_mentions(integer) from public;
grant execute on function public.backfill_review_dish_mentions(integer) to service_role;
