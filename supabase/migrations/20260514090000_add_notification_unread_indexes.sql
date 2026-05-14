-- Speed up the unread badge endpoint, which checks modern user-id rows and
-- legacy username rows while ignoring soft-deleted notifications.

alter table public.notifications
  add column if not exists recipient_user_id uuid references auth.users(id) on delete set null,
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists is_read boolean not null default false,
  add column if not exists read boolean not null default false,
  add column if not exists restaurant_name text,
  add column if not exists content text,
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.notifications
set
  is_read = coalesce(is_read, read, false),
  read = coalesce(read, is_read, false),
  metadata = coalesce(metadata, '{}'::jsonb),
  updated_at = coalesce(updated_at, created_at)
where is_read is null
  or read is null
  or metadata is null
  or updated_at is null;

create index if not exists notifications_recipient_user_unread_idx
  on public.notifications(recipient_user_id, is_read, read)
  where deleted_at is null;

create index if not exists notifications_recipient_name_unread_idx
  on public.notifications(recipient_name, is_read, read)
  where deleted_at is null;
