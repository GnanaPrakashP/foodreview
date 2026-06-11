# Mobile Supabase Migrations

These migrations support mobile-only flows that are not yet in the root Supabase migration set.

Run the SQL files against the same Supabase project used by `mobile/.env.local`.

For the Table Memory / Friends create-room flow, run:

```sql
mobile/supabase/migrations/202606060001_shared_memory_rooms.sql
mobile/supabase/migrations/202606060002_create_shared_memory_room_rpc.sql
mobile/supabase/migrations/202606060003_shared_memory_media_type.sql
mobile/supabase/migrations/202606120001_profile_search.sql
mobile/supabase/migrations/202606120002_shared_memory_invites.sql
```

The migrations create the `shared_memory_*` tables, RLS policies, transactional create-room RPC, media typing needed by `mobile/src/services/memories.ts`, pending table invites, and the indexed profile-search RPC used by people pickers.
