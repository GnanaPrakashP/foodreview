-- Phase 3 canonical role-grant reconciliation.
-- Historical mobile-only tables were created after the root baseline's grant
-- block. Grant only the commands that already have explicit RLS policies.

grant select on table public.stories to anon, authenticated;
grant insert, update, delete on table public.stories to authenticated;

grant select, insert, delete on table public.hungry_picks to authenticated;
grant select, insert, update, delete on table public.post_views to authenticated;

grant select, insert on table public.shared_memory_rooms to authenticated;
grant select, insert, delete on table public.shared_memory_members to authenticated;
grant select, insert, update, delete on table public.shared_memory_messages to authenticated;
grant select, delete on table public.shared_memory_photos to authenticated;
grant select, insert on table public.shared_memory_dishes to authenticated;
grant select, insert, update, delete on table public.shared_memory_reads to authenticated;
grant select, insert, update on table public.shared_memory_invites to authenticated;
grant select, insert, update on table public.shared_memory_dish_ratings to authenticated;
grant select on table public.shared_memory_upload_intents to authenticated;
grant select, insert, update, delete on table public.shared_memory_stops to authenticated;

grant select, insert, update on table public.notification_settings to authenticated;
grant select, insert, delete on table public.blocked_users to authenticated;
grant select, insert, update, delete on table public.push_tokens to authenticated;

grant all privileges on table
  public.stories,
  public.hungry_picks,
  public.post_views,
  public.shared_memory_rooms,
  public.shared_memory_members,
  public.shared_memory_messages,
  public.shared_memory_photos,
  public.shared_memory_dishes,
  public.shared_memory_reads,
  public.shared_memory_invites,
  public.shared_memory_dish_ratings,
  public.shared_memory_upload_intents,
  public.shared_memory_stops,
  public.notification_settings,
  public.blocked_users,
  public.push_tokens
to service_role;

-- Memory photo rows remain server-finalized: authenticated intentionally has
-- no INSERT or UPDATE table grant after the Phase 2.1 policy removal.
revoke insert, update on table public.shared_memory_photos from authenticated;

-- Upload intents are created/finalized by trusted routes. Clients may inspect
-- only their own intent through RLS.
revoke insert, update, delete on table public.shared_memory_upload_intents from authenticated;
