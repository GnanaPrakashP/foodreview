-- Test-only compatibility schema for the known PH-301 split roots.
-- It supplies mobile-owned tables needed to exercise Phase 1B against the root
-- generic-media chain. Never deploy this file as a migration.

alter table public.review_photos
  add column if not exists owner_id uuid references auth.users(id) on delete set null,
  add column if not exists upload_intent_id uuid,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint;

create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_name text not null,
  blocked_name text not null,
  created_at timestamptz not null default now(),
  unique(blocker_name, blocked_name)
);
create table if not exists public.notification_settings (
  user_name text primary key,
  push_enabled boolean not null default true,
  memory_activity boolean not null default true,
  circle_activity boolean not null default true,
  post_engagement boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  expo_push_token text not null unique,
  platform text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.review_media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  final_bucket_id text not null default 'review-photos',
  quarantine_bucket_id text not null default 'review-media-quarantine',
  storage_path text not null unique,
  quarantine_storage_path text not null unique,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

create table if not exists public.shared_memory_rooms (
  id uuid primary key default gen_random_uuid(),
  title text,
  restaurant_name text not null,
  created_by text not null,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.shared_memory_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  user_name text not null,
  role text not null default 'participant',
  created_at timestamptz not null default now(),
  unique(room_id, user_name)
);
create table if not exists public.shared_memory_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.shared_memory_upload_intents (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  uploader_name text not null,
  storage_path text not null unique,
  status text not null default 'created',
  created_at timestamptz not null default now()
);
create table if not exists public.shared_memory_photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  uploader_id uuid references public.profiles(id) on delete set null,
  uploader_name text not null,
  storage_path text not null,
  public_url text,
  upload_intent_id uuid references public.shared_memory_upload_intents(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.shared_memory_dishes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  added_by text not null,
  dish_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.shared_memory_stops (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  created_by text not null,
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.shared_memory_dish_ratings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  dish_id uuid not null references public.shared_memory_dishes(id) on delete cascade,
  rated_by text not null,
  rating numeric not null,
  created_at timestamptz not null default now()
);
create table if not exists public.shared_memory_reads (
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  user_name text not null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(room_id, user_name)
);
create table if not exists public.shared_memory_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.shared_memory_rooms(id) on delete cascade,
  sender_name text not null,
  receiver_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.blocked_users enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_tokens enable row level security;
alter table public.review_media_upload_intents enable row level security;
alter table public.shared_memory_rooms enable row level security;
alter table public.shared_memory_members enable row level security;
alter table public.shared_memory_messages enable row level security;
alter table public.shared_memory_upload_intents enable row level security;
alter table public.shared_memory_photos enable row level security;
alter table public.shared_memory_dishes enable row level security;
alter table public.shared_memory_stops enable row level security;
alter table public.shared_memory_dish_ratings enable row level security;
alter table public.shared_memory_reads enable row level security;
alter table public.shared_memory_invites enable row level security;

revoke all on table public.blocked_users, public.notification_settings, public.push_tokens,
  public.review_media_upload_intents, public.shared_memory_rooms, public.shared_memory_members,
  public.shared_memory_messages, public.shared_memory_upload_intents, public.shared_memory_photos,
  public.shared_memory_dishes, public.shared_memory_stops, public.shared_memory_dish_ratings,
  public.shared_memory_reads, public.shared_memory_invites from anon, authenticated;
grant all privileges on table public.blocked_users, public.notification_settings, public.push_tokens,
  public.review_media_upload_intents, public.shared_memory_rooms, public.shared_memory_members,
  public.shared_memory_messages, public.shared_memory_upload_intents, public.shared_memory_photos,
  public.shared_memory_dishes, public.shared_memory_stops, public.shared_memory_dish_ratings,
  public.shared_memory_reads, public.shared_memory_invites to service_role;

insert into storage.buckets(id, name, public)
values ('memory-media', 'memory-media', false),
       ('review-media-quarantine', 'review-media-quarantine', false)
on conflict(id) do update set public = excluded.public;
