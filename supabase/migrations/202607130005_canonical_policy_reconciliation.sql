-- Phase 3 additive policy reconciliation.
-- Keep public review reads compatible with profile RLS while preserving the
-- immediate account-deletion suppression introduced by Phase 1B.

create or replace function public.review_owner_account_is_active(p_owner_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles profile
      where profile.username = p_owner_name
        and profile.account_status = 'active'
        and profile.deletion_started_at is null
    ),
    false
  )
$$;

revoke all on function public.review_owner_account_is_active(text) from public;
grant execute on function public.review_owner_account_is_active(text) to anon, authenticated, service_role;

drop policy if exists "Deleting review owners are suppressed" on public.reviews;
create policy "Deleting review owners are suppressed"
  on public.reviews as restrictive for select
  to anon, authenticated
  using (public.review_owner_account_is_active(reviewer_name));

comment on function public.review_owner_account_is_active(text) is
  'RLS-safe active-owner predicate used to suppress reviews immediately during account deletion.';
