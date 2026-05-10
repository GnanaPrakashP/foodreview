-- Make circle_memberships the only source of truth for Circle access.
-- Keep circle_requests for pending/rejected workflow and request history.

insert into public.circle_memberships (user_name, member_name)
select sender_name, receiver_name
from public.circle_requests
where status = 'accepted'
on conflict (user_name, member_name) do nothing;

insert into public.circle_memberships (user_name, member_name)
select receiver_name, sender_name
from public.circle_requests
where status = 'accepted'
on conflict (user_name, member_name) do nothing;

create or replace function public.can_read_review_row(
  review_owner_name text,
  review_visibility text,
  review_deleted_at timestamptz,
  review_hidden_at timestamptz,
  review_reported_at timestamptz,
  review_status text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    select public.current_profile_name() as name
  )
  select public.review_is_unsuppressed(
      review_deleted_at,
      review_hidden_at,
      review_reported_at,
      review_status
    )
    and (
      coalesce(review_visibility, 'public') = 'public'
      or exists (
        select 1
        from viewer v
        where v.name is not null
          and v.name = review_owner_name
      )
      or (
        coalesce(review_visibility, 'public') = 'circle'
        and exists (
          select 1
          from viewer v
          where v.name is not null
            and exists (
              select 1
              from public.circle_memberships cm
              where cm.user_name = review_owner_name
                and cm.member_name = v.name
            )
        )
      )
    )
$$;
