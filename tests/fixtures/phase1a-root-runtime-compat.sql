-- Test-only compatibility fixture for the known PH-301 split migration roots.
-- The root chain owns the generic media migrations; the mobile chain owns the
-- earlier Profile/block schema used by active routes. Production already needs
-- both. Do not deploy this fixture as a migration or treat it as PH-301 repair.

do $fixture$
begin
  execute 'alter table public.review_photos
    add column if not exists owner_id uuid references auth.users(id) on delete cascade,
    add column if not exists mime_type text,
    add column if not exists file_size_bytes bigint,
    add column if not exists upload_intent_id uuid';
  execute 'create table if not exists public.blocked_users (
    id uuid primary key default gen_random_uuid(),
    blocker_name text not null,
    blocked_name text not null,
    created_at timestamptz not null default now(),
    unique (blocker_name, blocked_name),
    check (blocker_name <> blocked_name)
  )';
  execute 'alter table public.blocked_users enable row level security';
  execute 'revoke all on table public.blocked_users from anon, authenticated';
  execute 'grant all privileges on table public.blocked_users to service_role';
end
$fixture$;
