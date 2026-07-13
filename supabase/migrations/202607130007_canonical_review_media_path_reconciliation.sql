-- Phase 3 canonical review-media path reconciliation.
-- The Profile history predates generic private post derivatives. Its legacy
-- ownership guard must recognize the server-derived Phase 1A path shape so
-- backfill and account-deletion inventory can converge on the merged schema.

create or replace function public.review_media_path_is_owned_by(p_path text, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_owner_id is not null
    and p_path is not null
    and (
      p_path like ('posts/' || p_owner_id::text || '/%')
      or p_path like ('private-posts/' || p_owner_id::text || '/%')
      or p_path like ('avatars/' || p_owner_id::text || '/%')
      or p_path like ('public/mobile/' || p_owner_id::text || '/%')
      or p_path like ('public/avatars/' || p_owner_id::text || '/%')
    )
$$;

revoke all on function public.review_media_path_is_owned_by(text, uuid) from public, anon;
grant execute on function public.review_media_path_is_owned_by(text, uuid) to authenticated, service_role;

comment on function public.review_media_path_is_owned_by(text, uuid) is
  'Recognizes server-derived legacy/Profile and Phase 1A private review-media paths for one owner.';
