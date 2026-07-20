-- Keep the Home badge existence check index-backed as notification history
-- grows. Both legacy recipient forms remain supported during convergence.

create index if not exists notifications_unseen_recipient_user_created_idx
  on public.notifications(recipient_user_id, created_at desc)
  where deleted_at is null and is_read = false and read = false;

create index if not exists notifications_unseen_recipient_name_created_idx
  on public.notifications(recipient_name, created_at desc)
  where deleted_at is null and is_read = false and read = false;
