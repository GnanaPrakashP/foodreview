-- Give Home refreshes a server-owned revision for post metadata and media-link
-- changes that are not fully represented by the cover-only feed response.

alter table public.reviews
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_review_visible_content_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists touch_review_visible_content_updated_at_trigger on public.reviews;
create trigger touch_review_visible_content_updated_at_trigger
before update on public.reviews
for each row execute function public.touch_review_visible_content_updated_at();

revoke all on function public.touch_review_visible_content_updated_at() from public, anon, authenticated;
grant execute on function public.touch_review_visible_content_updated_at() to service_role;

comment on column public.reviews.updated_at is
  'Server-owned revision used to detect refreshed visible post metadata changes.';
