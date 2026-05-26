alter table public.reviews
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists reviews_tags_gin_idx
  on public.reviews using gin(tags);
