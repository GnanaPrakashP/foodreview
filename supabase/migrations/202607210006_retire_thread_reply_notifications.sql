-- Retire discussion-thread notifications. A new comment now notifies only the
-- post owner; prior commenters receive neither an inbox row nor a phone push.

update public.notifications
set deleted_at = coalesce(deleted_at, clock_timestamp()),
    is_read = true,
    read = true,
    updated_at = clock_timestamp()
where type in ('THREAD_REPLY', 'also_commented')
  and deleted_at is null;

update public.push_delivery_jobs
set status = 'permanent_failure',
    completed_at = clock_timestamp(),
    last_error_code = 'notification_type_retired',
    locked_by = null,
    lock_expires_at = null,
    claim_token = null,
    updated_at = clock_timestamp()
where notification_type = 'THREAD_REPLY'
  and status in ('queued', 'retry_wait');

create or replace function public.notification_inbox_has_unseen()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text;
  v_last_seen_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select profile.username
  into v_username
  from public.profiles profile
  where profile.id = v_user_id
    and coalesce(profile.account_status, 'active') = 'active'
    and profile.deletion_started_at is null;

  if v_username is null then
    raise exception 'active_profile_required' using errcode = '42501';
  end if;

  select state.last_seen_at
  into v_last_seen_at
  from public.notification_inbox_state state
  where state.user_id = v_user_id;

  return exists (
    select 1
    from public.notifications notification
    where notification.deleted_at is null
      and notification.is_read = false
      and notification.read = false
      and notification.type not in ('THREAD_REPLY', 'also_commented')
      and notification.created_at > coalesce(v_last_seen_at, '-infinity'::timestamptz)
      and (
        notification.recipient_user_id = v_user_id
        or notification.recipient_name = v_username
      )
  );
end;
$$;

revoke all on function public.notification_inbox_has_unseen() from public, anon;
grant execute on function public.notification_inbox_has_unseen() to authenticated, service_role;

comment on function public.notification_inbox_has_unseen() is
  'Returns whether the authenticated active profile has a newer supported unread notification than its inbox-seen timestamp.';
