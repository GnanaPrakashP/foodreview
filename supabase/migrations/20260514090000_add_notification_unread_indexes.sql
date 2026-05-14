-- Speed up the unread badge endpoint, which checks modern user-id rows and
-- legacy username rows while ignoring soft-deleted notifications.

create index if not exists notifications_recipient_user_unread_idx
  on public.notifications(recipient_user_id, is_read, read)
  where deleted_at is null;

create index if not exists notifications_recipient_name_unread_idx
  on public.notifications(recipient_name, is_read, read)
  where deleted_at is null;
