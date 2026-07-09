-- Circle production hardening.
-- Forward-only note: post_impressions is preserved as legacy history for rollback
-- inspection, but runtime Circle reads/writes must use post_views after this migration.

do $$
begin
  if to_regclass('public.post_views') is null then
    raise exception 'circle_hardening_preflight_failed: missing public.post_views';
  end if;
  if to_regclass('public.likes') is null then
    raise exception 'circle_hardening_preflight_failed: missing public.likes';
  end if;
  if to_regclass('public.wishlist') is null then
    raise exception 'circle_hardening_preflight_failed: missing public.wishlist';
  end if;
  if to_regclass('public.recommendation_feedback') is null then
    raise exception 'circle_hardening_preflight_failed: missing public.recommendation_feedback';
  end if;
end $$;

do $$
begin
  if to_regclass('public.post_impressions') is not null then
    execute $backfill$
      insert into public.post_views (user_id, post_id, viewed_at)
      select
        impression.viewer_user_id,
        impression.post_id,
        coalesce(impression.seen_at, impression.updated_at, now())
      from public.post_impressions impression
      where impression.viewer_user_id is not null
        and impression.post_id is not null
      on conflict (user_id, post_id) do update
      set viewed_at = greatest(public.post_views.viewed_at, excluded.viewed_at)
    $backfill$;
  end if;
end $$;

create unique index if not exists post_views_user_post_unique
  on public.post_views(user_id, post_id);

create unique index if not exists likes_post_user_unique
  on public.likes(post_id, user_name);

create unique index if not exists wishlist_user_post_unique
  on public.wishlist(user_name, post_id)
  where post_id is not null;

create unique index if not exists recommendation_feedback_unique_user_post_idx
  on public.recommendation_feedback(post_id, feedback_user_id);

do $$
begin
  if to_regclass('public.post_views_user_post_unique') is null then
    raise exception 'circle_hardening_preflight_failed: missing post_views_user_post_unique';
  end if;
  if to_regclass('public.likes_post_user_unique') is null then
    raise exception 'circle_hardening_preflight_failed: missing likes_post_user_unique';
  end if;
  if to_regclass('public.wishlist_user_post_unique') is null then
    raise exception 'circle_hardening_preflight_failed: missing wishlist_user_post_unique';
  end if;
  if to_regclass('public.recommendation_feedback_unique_user_post_idx') is null then
    raise exception 'circle_hardening_preflight_failed: missing recommendation_feedback_unique_user_post_idx';
  end if;
end $$;

comment on table public.post_views is
  'Canonical Circle seen/view table. Legacy post_impressions may exist only for historical backfill and must not be used by runtime Circle code.';
