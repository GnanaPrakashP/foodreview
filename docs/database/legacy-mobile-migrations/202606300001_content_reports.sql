-- FoodReview-native content reporting and moderation queue.

create table if not exists public.content_reports (
  id              uuid        primary key default gen_random_uuid(),
  reporter_id     uuid        not null references public.profiles(id) on delete cascade,
  reporter_name   text        not null,
  target_type     text        not null,
  target_id       text        not null,
  reason          text        not null,
  details         text,
  status          text        not null default 'open',
  moderator_id    uuid        references public.profiles(id) on delete set null,
  moderator_name  text,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint content_reports_target_type_check check (target_type in ('review', 'comment', 'profile', 'media')),
  constraint content_reports_reason_check check (reason in ('spam', 'harassment', 'unsafe', 'off_topic', 'copyright', 'other')),
  constraint content_reports_status_check check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  constraint content_reports_details_length_check check (details is null or char_length(details) <= 1000),
  constraint content_reports_unique_open_report unique (reporter_id, target_type, target_id, reason)
);

create index if not exists content_reports_status_created_idx
  on public.content_reports(status, created_at desc);
create index if not exists content_reports_target_idx
  on public.content_reports(target_type, target_id);
create index if not exists content_reports_reporter_idx
  on public.content_reports(reporter_id, created_at desc);

alter table public.content_reports enable row level security;

drop policy if exists "Users can read own content reports" on public.content_reports;
create policy "Users can read own content reports"
  on public.content_reports for select to authenticated
  using (reporter_id = auth.uid());

drop policy if exists "Users can create own content reports" on public.content_reports;
create policy "Users can create own content reports"
  on public.content_reports for insert to authenticated
  with check (reporter_id = auth.uid() and reporter_name = public.current_profile_name());

grant select, insert on table public.content_reports to authenticated;
grant all privileges on table public.content_reports to service_role;
