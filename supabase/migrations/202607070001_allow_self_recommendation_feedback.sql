-- Allow users to react to their own posts with the same Must Try / Not Worth It controls.
-- The app writes through the API, but keep RLS aligned for direct authenticated clients.

alter table public.recommendation_feedback
  drop constraint if exists recommendation_feedback_not_self;

drop policy if exists "Users can insert own recommendation feedback" on public.recommendation_feedback;
create policy "Users can insert own recommendation feedback"
  on public.recommendation_feedback for insert to authenticated
  with check (
    feedback_user_id = auth.uid()
    and public.can_read_review_id(post_id)
    and exists (
      select 1
      from public.reviews r
      join public.profiles p on p.username = r.reviewer_name
      where r.id = post_id
        and p.id = reviewer_user_id
        and r.visibility in ('public', 'circle')
    )
  );

drop policy if exists "Users can update own recommendation feedback" on public.recommendation_feedback;
create policy "Users can update own recommendation feedback"
  on public.recommendation_feedback for update to authenticated
  using (feedback_user_id = auth.uid())
  with check (
    feedback_user_id = auth.uid()
    and public.can_read_review_id(post_id)
    and exists (
      select 1
      from public.reviews r
      join public.profiles p on p.username = r.reviewer_name
      where r.id = post_id
        and p.id = reviewer_user_id
        and r.visibility in ('public', 'circle')
    )
  );
