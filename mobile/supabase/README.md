# Mobile Supabase Migrations

These migrations support mobile-only flows that are not yet in the root Supabase migration set.

Run the SQL files against the same Supabase project used by `mobile/.env.local`.

For the Table Memory / Friends create-room flow, run:

```sql
mobile/supabase/migrations/202606060001_shared_memory_rooms.sql
mobile/supabase/migrations/202606060002_create_shared_memory_room_rpc.sql
mobile/supabase/migrations/202606060003_shared_memory_media_type.sql
mobile/supabase/migrations/202606070001_shared_memory_photo_message_groups.sql
mobile/supabase/migrations/202606080001_shared_memory_message_edit_delete.sql
mobile/supabase/migrations/202606080002_shared_memory_realtime.sql
mobile/supabase/migrations/202606090001_shared_memory_media_dimensions.sql
mobile/supabase/migrations/202606090002_shared_memory_reads.sql
mobile/supabase/migrations/202606090003_push_tokens.sql
mobile/supabase/migrations/202606090004_shared_memory_message_replies.sql
mobile/supabase/migrations/202606120001_profile_search.sql
mobile/supabase/migrations/202606120002_shared_memory_invites.sql
mobile/supabase/migrations/202606140001_shared_memory_privacy_hardening.sql
mobile/supabase/migrations/202606140002_settings_account_management.sql
mobile/supabase/migrations/202606140003_block_visibility.sql
```

The migrations create the `shared_memory_*` tables, RLS policies, transactional create-room RPC, media typing needed by `mobile/src/services/memories.ts`, pending table invites, the indexed profile-search RPC used by people pickers, and private member-only memory media storage.

`202606140002_settings_account_management.sql` adds the Settings screen's account-management backend: the `notification_settings` and `blocked_users` tables (with RLS), the `notification_category_enabled(user_name, category)` helper used by notification senders to respect a recipient's preferences, and the `delete_current_account()` RPC used by "Delete account". Apply this file with the postgres/admin role (the Supabase SQL editor) — the RPCs are `security definer` (the delete RPC removes the caller's row from `auth.users`, and the preference helper reads another user's settings row), so the owner needs the right privileges.

`202606140003_block_visibility.sql` enforces the block list in both directions via restrictive RLS policies on `reviews`, `comments`, and `likes`, plus `is_blocked_with()` / `not_blocked_from_post()` helpers. After this runs, a blocked user cannot see or interact with the blocker's content from any client (not just the mobile app's own filtering). Requires `blocked_users` from the previous migration.
