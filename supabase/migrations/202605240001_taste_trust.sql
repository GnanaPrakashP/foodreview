alter table public.profiles
  add column if not exists trust_score numeric not null default 50,
  add column if not exists trust_level text not null default 'New Reviewer',
  add column if not exists confirmed_recommendations_count integer not null default 0,
  add column if not exists positive_confirmations_count integer not null default 0,
  add column if not exists negative_confirmations_count integer not null default 0,
  add column if not exists total_feedback_points numeric not null default 0;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_taste_trust_level_check'
  ) then
    alter table public.profiles
      add constraint profiles_taste_trust_level_check
      check (trust_level in ('New Reviewer', 'Low Trust', 'Mixed Trust', 'Growing Trust', 'Trusted', 'Highly Trusted'));
  end if;
end $$;

do $$ begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_taste_trust_score_check'
  ) then
    alter table public.profiles
      add constraint profiles_taste_trust_score_check
      check (trust_score >= 0 and trust_score <= 100);
  end if;
end $$;

create table if not exists public.recommendation_feedback (
  id                uuid        primary key default gen_random_uuid(),
  post_id           uuid        not null references public.reviews(id) on delete cascade,
  reviewer_user_id  uuid        not null references public.profiles(id) on delete cascade,
  feedback_user_id  uuid        not null references public.profiles(id) on delete cascade,
  place_id          text,
  dish_id           text,
  feedback_label    text        not null,
  feedback_value    numeric     not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint recommendation_feedback_unique_user_post unique (post_id, feedback_user_id),
  constraint recommendation_feedback_not_self check (feedback_user_id <> reviewer_user_id),
  constraint recommendation_feedback_value_check check (feedback_value in (1.0, 0.7, 0.3, -0.5, -1.0)),
  constraint recommendation_feedback_label_check check (feedback_label in ('Totally worth it', 'Mostly yes', 'It was okay', 'Not really', 'Not worth it'))
);

create index if not exists recommendation_feedback_post_id_idx on public.recommendation_feedback(post_id);
create index if not exists recommendation_feedback_reviewer_user_id_idx on public.recommendation_feedback(reviewer_user_id);
create index if not exists recommendation_feedback_feedback_user_id_idx on public.recommendation_feedback(feedback_user_id);
create index if not exists recommendation_feedback_place_id_idx
  on public.recommendation_feedback(place_id)
  where place_id is not null;

alter table public.recommendation_feedback enable row level security;

drop policy if exists "Recommendation feedback readable by owner" on public.recommendation_feedback;
create policy "Recommendation feedback readable by owner"
  on public.recommendation_feedback for select to authenticated
  using (feedback_user_id = auth.uid());

drop policy if exists "Users can insert own recommendation feedback" on public.recommendation_feedback;
create policy "Users can insert own recommendation feedback"
  on public.recommendation_feedback for insert to authenticated
  with check (
    feedback_user_id = auth.uid()
    and feedback_user_id <> reviewer_user_id
    and public.can_read_review_id(post_id)
    and exists (
      select 1
      from public.reviews r
      join public.profiles p on p.username = r.reviewer_name
      where r.id = post_id
        and p.id = reviewer_user_id
        and r.visibility in ('public', 'circle')
        and r.reviewer_name <> public.current_profile_name()
    )
  );

drop policy if exists "Users can update own recommendation feedback" on public.recommendation_feedback;
create policy "Users can update own recommendation feedback"
  on public.recommendation_feedback for update to authenticated
  using (feedback_user_id = auth.uid())
  with check (
    feedback_user_id = auth.uid()
    and feedback_user_id <> reviewer_user_id
    and public.can_read_review_id(post_id)
    and exists (
      select 1
      from public.reviews r
      join public.profiles p on p.username = r.reviewer_name
      where r.id = post_id
        and p.id = reviewer_user_id
        and r.visibility in ('public', 'circle')
        and r.reviewer_name <> public.current_profile_name()
    )
  );

drop policy if exists "Users can delete own recommendation feedback" on public.recommendation_feedback;
create policy "Users can delete own recommendation feedback"
  on public.recommendation_feedback for delete to authenticated
  using (feedback_user_id = auth.uid());

revoke update (
  trust_score,
  trust_level,
  confirmed_recommendations_count,
  positive_confirmations_count,
  negative_confirmations_count,
  total_feedback_points
) on public.profiles from authenticated;

create table if not exists public.user_tried_items (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  place_id        text,
  dish_id         text,
  source_post_id  uuid        references public.reviews(id) on delete set null,
  source_user_id  uuid        references public.profiles(id) on delete set null,
  feedback_id     uuid        references public.recommendation_feedback(id) on delete set null,
  tried_status    text        not null default 'tried',
  visibility      text        not null default 'private',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint user_tried_items_visibility_check check (visibility in ('private', 'circle', 'public')),
  constraint user_tried_items_status_check check (tried_status in ('tried')),
  constraint user_tried_items_not_self check (source_user_id is null or user_id <> source_user_id)
);

create unique index if not exists user_tried_items_user_source_post_unique
  on public.user_tried_items(user_id, source_post_id)
  where source_post_id is not null;
create index if not exists user_tried_items_user_id_idx on public.user_tried_items(user_id);
create index if not exists user_tried_items_place_id_idx
  on public.user_tried_items(place_id)
  where place_id is not null;
create index if not exists user_tried_items_dish_id_idx
  on public.user_tried_items(dish_id)
  where dish_id is not null;
create index if not exists user_tried_items_source_post_id_idx on public.user_tried_items(source_post_id);
create index if not exists user_tried_items_source_user_id_idx on public.user_tried_items(source_user_id);
create index if not exists user_tried_items_feedback_id_idx on public.user_tried_items(feedback_id);
create index if not exists user_tried_items_visibility_idx on public.user_tried_items(visibility);

alter table public.user_tried_items enable row level security;

drop policy if exists "Users can read own tried items" on public.user_tried_items;
create policy "Users can read own tried items"
  on public.user_tried_items for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own tried items" on public.user_tried_items;
create policy "Users can insert own tried items"
  on public.user_tried_items for insert to authenticated
  with check (
    user_id = auth.uid()
    and (source_user_id is null or source_user_id <> auth.uid())
    and visibility in ('private', 'circle', 'public')
    and tried_status = 'tried'
  );

drop policy if exists "Users can update own tried items" on public.user_tried_items;
create policy "Users can update own tried items"
  on public.user_tried_items for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (source_user_id is null or source_user_id <> auth.uid())
    and visibility in ('private', 'circle', 'public')
    and tried_status = 'tried'
  );

drop policy if exists "Users can delete own tried items" on public.user_tried_items;
create policy "Users can delete own tried items"
  on public.user_tried_items for delete to authenticated
  using (user_id = auth.uid());
