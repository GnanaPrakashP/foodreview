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
mobile/supabase/migrations/202606160001_shared_memory_dish_ratings.sql
mobile/supabase/migrations/202606180001_shared_memory_phase1_security.sql
mobile/supabase/migrations/202606180002_shared_memory_phase1_1_cleanup.sql
mobile/supabase/migrations/202606180003_shared_memory_phase2_media_upload_hardening.sql
mobile/supabase/migrations/202606180004_shared_memory_phase2_1_trust_boundary.sql
mobile/supabase/migrations/202606180005_shared_memory_phase2_2_cleanup_verification.sql
mobile/supabase/migrations/202606180006_shared_memory_phase3_scalability.sql
```

The migrations create the `shared_memory_*` tables, RLS policies, transactional create-room RPC, media typing needed by `mobile/src/services/memories.ts`, pending table invites, the indexed profile-search RPC used by people pickers, and private member-only memory media storage.

`202606140002_settings_account_management.sql` adds the Settings screen's account-management backend: the `notification_settings` and `blocked_users` tables (with RLS), the `notification_category_enabled(user_name, category)` helper used by notification senders to respect a recipient's preferences, and the `delete_current_account()` RPC used by "Delete account". Apply this file with the postgres/admin role (the Supabase SQL editor) — the RPCs are `security definer` (the delete RPC removes the caller's row from `auth.users`, and the preference helper reads another user's settings row), so the owner needs the right privileges.

`202606140003_block_visibility.sql` enforces the block list in both directions via restrictive RLS policies on `reviews`, `comments`, and `likes`, plus `is_blocked_with()` / `not_blocked_from_post()` helpers. After this runs, a blocked user cannot see or interact with the blocker's content from any client (not just the mobile app's own filtering). Requires `blocked_users` from the previous migration.

`202606180001_shared_memory_phase1_security.sql` adds Phase 1 Table Memory hardening:

- `shared_memory_photos.storage_path` is validated on every new insert/update. It must be normalized, must not contain path traversal (`..`), empty path segments, query strings, fragments, backslashes, or unsafe characters, and must follow `memories/{room_id}/{uploader_name}/...`.
- The `room_id` path segment must exactly match `shared_memory_photos.room_id`.
- The `uploader_name` path segment must exactly match `shared_memory_photos.uploader_name`.
- `uploader_name` must be a member of the room.
- When `shared_memory_photos.message_id` is not null, the referenced message must exist in the same room and must have the same author as the uploader.
- Blocked relationships now prevent Table Memory message inserts/updates, media row inserts, and storage uploads into rooms containing both users.
- Text messages remain limited to 1000 characters at the DB layer. The mobile app also exposes `MEMORY_TEXT_MAX_LENGTH = 1000`.

Phase 1 blocked-user scope: writes, uploads, and notifications are blocked. Existing read behavior is not changed here; if two blocked users already share a room, the current room read policies may still expose historical room content until a product decision is made for room removal, read hiding, or read-only behavior.

Storage path compatibility: current paths include mutable usernames. Keep this for now for compatibility. Phase 2 should move storage paths to immutable user ids and migrate existing objects with a service-role job.

`202606180002_shared_memory_phase1_1_cleanup.sql` completes Phase 1 rollout hardening:

- The migration aborts if existing `shared_memory_photos` rows would violate the Phase 1 storage path, uploader, room, message, or `public_url` integrity rules.
- `shared_memory_messages.reply_to_message_id` is validated at the DB layer. A reply can be null, but when present it must point to an existing message in the same room and cannot point to itself.
- `shared_memory_photos.public_url` is no longer required. New app writes omit it. If present for legacy compatibility, it must exactly equal `storage_path`; arbitrary public URLs, signed URLs, query strings, unrelated bucket paths, or external URLs are rejected.
- The mobile app must continue to display private memory media by signing `storage_path`, not by trusting `public_url`.

Phase 1.1 blocked-user read/membership decision: blocked users are prevented from new Table Memory interaction (messages, media rows, storage uploads, and notifications). Existing membership and historical read visibility remain unchanged for compatibility because Table Memory rooms may include more than two members. Do not remove members or hide historical group content without a product decision. Phase 2 should define the exact UX for one-to-one blocked rooms, group-room historical visibility, and signed URL revocation timing.

Run this preflight in staging and production before applying `202606180002_shared_memory_phase1_1_cleanup.sql`. It must return zero rows. Do not silently delete or rewrite rows; inspect each reason and either backfill safely or make a product decision.

```sql
with photo_parts as (
  select
    photo.id,
    photo.room_id,
    photo.uploader_name,
    photo.message_id,
    photo.public_url,
    photo.storage_path,
    string_to_array(coalesce(photo.storage_path, ''), '/') as parts
  from public.shared_memory_photos photo
),
photo_violations as (
  select
    photo.id,
    array_remove(array[
      case
        when nullif(btrim(photo.storage_path), '') is null
          or photo.storage_path <> btrim(photo.storage_path)
        then 'invalid_or_null_storage_path'
      end,
      case
        when photo.storage_path like '/%'
          or photo.storage_path like '%/'
          or photo.storage_path like '%//%'
          or coalesce(array_length(photo.parts, 1), 0) < 4
          or exists (
            select 1
            from unnest(photo.parts) as segment(value)
            where nullif(segment.value, '') is null
              or segment.value in ('.', '..')
          )
        then 'malformed_path_segments'
      end,
      case
        when position('..' in photo.storage_path) > 0
          or position('?' in photo.storage_path) > 0
          or position('#' in photo.storage_path) > 0
          or position(chr(92) in photo.storage_path) > 0
          or photo.storage_path !~ '^[A-Za-z0-9._~/-]+$'
        then 'unsafe_path_traversal_or_characters'
      end,
      case when photo.parts[1] is distinct from 'memories' then 'storage_path_prefix_mismatch' end,
      case when photo.parts[2] is distinct from photo.room_id::text then 'storage_path_room_id_mismatch' end,
      case when photo.parts[3] is distinct from photo.uploader_name then 'storage_path_uploader_mismatch' end,
      case
        when not exists (
          select 1
          from public.shared_memory_members member
          where member.room_id = photo.room_id
            and member.user_name = photo.uploader_name
        )
        then 'uploader_not_room_member'
      end,
      case when photo.message_id is not null and message.id is null then 'message_id_not_found' end,
      case
        when photo.message_id is not null
          and message.id is not null
          and message.room_id <> photo.room_id
        then 'message_id_room_mismatch'
      end,
      case
        when photo.message_id is not null
          and message.id is not null
          and message.author_name <> photo.uploader_name
        then 'message_author_uploader_mismatch'
      end,
      case
        when photo.public_url is not null
          and photo.public_url <> photo.storage_path
        then 'public_url_diverges_from_storage_path'
      end
    ]::text[], null) as reasons
  from photo_parts photo
  left join public.shared_memory_messages message
    on message.id = photo.message_id
),
reply_violations as (
  select
    message.id,
    array_remove(array[
      case when reply.id is null then 'reply_to_message_id_not_found' end,
      case when reply.id is not null and reply.room_id <> message.room_id then 'reply_to_message_id_room_mismatch' end,
      case when reply.id = message.id then 'reply_to_message_id_self_reference' end
    ]::text[], null) as reasons
  from public.shared_memory_messages message
  left join public.shared_memory_messages reply
    on reply.id = message.reply_to_message_id
  where message.reply_to_message_id is not null
)
select 'shared_memory_photos' as table_name, id, reasons
from photo_violations
where cardinality(reasons) > 0
union all
select 'shared_memory_messages' as table_name, id, reasons
from reply_violations
where cardinality(reasons) > 0
order by table_name, id;
```

Safe cleanup guidance before applying Phase 1.1:

- If `public_url_diverges_from_storage_path` is the only reason and `storage_path` is valid/private, either set `public_url = storage_path` before the migration or leave cleanup until after the migration and set `public_url = null`.
- If `storage_path_*`, `malformed_path_segments`, or `unsafe_path_traversal_or_characters` appears, verify the object in storage and either repair the row to the real private object path or remove the row only after a product-approved media deletion decision.
- If `uploader_not_room_member`, `message_id_room_mismatch`, or `message_author_uploader_mismatch` appears, do not guess ownership. Resolve from audit/application data, then update the row or remove the forged/orphaned row with an explicit record of the decision.
- If reply violations appear, set `reply_to_message_id = null` for unsafe references unless product data can prove the correct same-room reply target.

Supabase CLI verification:

```sh
# The CLI is not currently installed by this repo. Install it locally if needed:
brew install supabase/tap/supabase
# or: npm install -g supabase

supabase --version

# Local DB workflow, after creating/linking mobile/supabase/config.toml:
cd mobile/supabase
supabase start
supabase db reset

# Staging workflow:
cd mobile/supabase
supabase login
supabase link --project-ref <staging-project-ref>
supabase db push
```

Expected verification results:

- The preflight query returns zero rows before migration.
- `supabase db reset` or `supabase db push` applies `202606180001`, `202606180002`, `202606180003`, `202606180004`, and `202606180005` without errors.
- A cross-room reply insert fails with `shared_memory_message_reply_room_mismatch`.
- A media row with `public_url = 'https://example.com/file.jpg'` fails with `shared_memory_photo_public_url_mismatch` or the `shared_memory_photos_public_url_matches_storage_path` check.
- A media row with `public_url = null`, valid `storage_path`, same-room `message_id`, and matching uploader succeeds.

Rollback for `202606180002_shared_memory_phase1_1_cleanup.sql`:

```sql
alter table public.shared_memory_photos
  drop constraint if exists shared_memory_photos_public_url_matches_storage_path;

-- Only needed if rolling back to older app builds that require public_url.
update public.shared_memory_photos
set public_url = storage_path
where public_url is null;

alter table public.shared_memory_photos
  alter column public_url set not null;

-- Re-apply the validate_shared_memory_message_write() and
-- validate_shared_memory_photo_integrity() definitions from
-- 202606180001_shared_memory_phase1_security.sql if you need to remove the
-- same-room reply and public_url checks. Keep the Phase 1 blocked-user and
-- storage_path protections unless you are fully rolling back Phase 1.
```

Staging-before-production checklist:

- Run the preflight query in staging and production.
- Apply `202606180001`, `202606180002`, `202606180003`, `202606180004`, and `202606180005` to staging.
- Run the manual verification inserts below using staging-only users/rooms.
- Open a memory room on the mobile app and confirm image/video media still loads through signed URLs.
- Confirm blocked-user send/upload/notify attempts fail or no-op.
- Only then apply to production during a low-traffic window.

`202606180003_shared_memory_phase2_media_upload_hardening.sql` adds Phase 2 Table Memory media upload hardening:

- New uploads use a server-created row in `shared_memory_upload_intents`.
- New storage paths use immutable auth user ids:
  `memories/{room_id}/{user_id}/{intent_id}/media.{ext}`.
- Old username paths remain readable for existing media:
  `memories/{room_id}/{uploader_name}/...`.
- Storage upload RLS requires an active, unexpired upload intent owned by `auth.uid()`.
- Storage read RLS checks the media row and hides pending/rejected media from other room members.
- `shared_memory_photos` now stores `uploader_id`, `upload_intent_id`, `moderation_status`, `mime_type`, `file_size_bytes`, and optional duration/metadata.
- The Phase 1 storage-path trigger now accepts either the old username segment or the new immutable `uploader_id` segment, while still validating room, uploader, message, membership, blocking, and `public_url`.

Phase 2 upload flow:

1. Mobile validates the selected asset locally using the shared media limits below.
2. Mobile compresses/re-encodes where practical and reads the final bytes to be uploaded.
3. Mobile calls `POST /api/mobile/memories/upload-intent`.
4. The API validates auth, room membership, blocked relationships, media kind, MIME, extension, size, and declared duration/image-resolution metadata.
5. The API creates `shared_memory_upload_intents` and returns only the approved private Storage path.
6. Mobile uploads to that exact path in the private `memory-media` bucket.
7. Mobile creates the chat message.
8. Mobile calls `POST /api/mobile/memories/finalize-upload` with the intent id and message id.
9. The API validates the intent, object existence, object size, object MIME/content type, path, magic bytes, room/user ownership, and moderation state.
10. The API inserts the `shared_memory_photos` row with `public_url = null`. The app displays media from signed URLs generated from `storage_path`.

Media limits:

- Text/captions: `1000` characters.
- Images: JPG/JPEG, PNG, WebP; max upload size `10 MB`; target compressed size `2 MB` where feasible; max resolution `4096 x 4096`; thumbnail target `512 px`.
- Videos: MP4, MOV, WebM; max upload size `25 MB`; max duration `60 seconds` from mobile-provided metadata.
- Max media items per message: `4`.

Server-side validation:

- MIME and extension are allowlisted in the upload-intent API.
- Finalize downloads the uploaded object and checks actual bytes for JPEG, PNG, WebP, MP4/MOV, or WebM signatures.
- Client-provided MIME remains advisory; object metadata and magic bytes must match the intent.
- Image resolution and video duration are validated from client-supplied asset metadata at intent creation. Server-side image dimension decoding and video duration extraction are not implemented yet; Phase 3 should add byte-level probing with a media worker before treating those as hard production limits.

Moderation and pending visibility:

- Finalize calls provider-backed moderation when Google Vision/Video API keys are configured.
- If moderation passes, media is inserted as `approved`.
- If moderation rejects, the object is removed and no visible media row is created.
- If moderation is unavailable or cannot complete inline, media is inserted as `pending`.
- Pending media is visible only to the uploader; other room members cannot read the DB row or sign/download the Storage object.
- Rejected media is hidden by RLS.
- Notification sending should only happen for approved media.

Cleanup:

- `POST /api/mobile/memories/uploads/cleanup` is an operator endpoint protected by `MEMORY_UPLOAD_CLEANUP_SECRET` in the `x-cleanup-secret` header.
- It calls the service-role-only `cleanup_shared_memory_media()` RPC to transition expired `created` intents and stale pending media into terminal DB states before deleting any Storage object.
- It removes Storage objects only for paths returned by the RPC after the DB transition succeeds.
- It marks expired unfinalized intents `expired`.
- It marks stale pending media rows `rejected` and keeps their finalized upload intents in a trigger-compatible finalized state with matching rejected moderation metadata.
- It is idempotent: rerunning it after objects are already removed leaves rows in terminal states.
- Recommended schedule: every 15-60 minutes in production, using a trusted server/cron runner with service-role credentials.
- Cleanup skips any object path referenced by an approved, finalized, active, visible, or otherwise non-pending/non-rejected `shared_memory_photos` row. If duplicate/pre-existing bad rows share a path and any reference is valid, the object is not deleted.

Deletion expectations:

- Mobile message/photo deletion already deletes the DB row and then removes the matching private Storage object.
- Room deletion cascades DB rows but does not automatically remove Storage objects. Before deleting a room, use the service-role-only `shared_memory_room_media_paths(room_id)` helper to collect DB-backed paths, delete only those private Storage objects, then delete the room data.
- Account deletion deletes username-keyed DB rows but can orphan old Storage objects. Before deleting an account, use the service-role-only `shared_memory_account_media_paths(user_id)` helper to collect DB-backed immutable-user-id paths. Legacy username-only objects without immutable uploader data must be handled through a room-scoped sweep, not by guessing the user's current username.
- Destructive cleanup must validate the room path and DB row before deleting. New paths use immutable user ids; old username paths remain readable but are deleted conservatively only when a DB-backed room path proves ownership.

`202606180004_shared_memory_phase2_1_trust_boundary.sql` closes the final Phase 2 media trust-boundary gaps:

- Normal authenticated clients can no longer insert `shared_memory_photos` rows directly. They can upload only the Storage object approved by an active upload intent; the server `finalize-upload` route is the only path that creates the final media row.
- The migration aborts if existing rows contain duplicate non-null `upload_intent_id` values or duplicate `storage_path` values. Clean those manually before applying the migration.
- A unique partial index enforces one `shared_memory_photos` row per `upload_intent_id`.
- A unique index enforces one active row per `storage_path`; this blocks duplicate rows that could make pending media visible as approved.
- When `upload_intent_id` is present, the DB trigger requires the row to match the finalized intent exactly: room, uploader id/name, storage path, media type, MIME type, file size, moderation status, and moderation reason.
- Pending media cannot become visible through a duplicate insert, `public_url`, or forged `moderation_status`.
- The private `memory-media` bucket is kept at `25 MB` to match the app/server video limit in this repo. Do not raise the app limit unless the Supabase project bucket and plan are verified in staging first.

`202606180005_shared_memory_phase2_2_cleanup_verification.sql` closes the Phase 2.2 cleanup correctness gaps:

- `cleanup_shared_memory_media()` is `SECURITY DEFINER`, uses `set search_path = public`, and is executable only by `service_role`.
- Cleanup state transitions happen in the database before Storage deletion. If the RPC fails, the operator route must not delete Storage.
- Expired created intents are marked `expired` only when no approved/finalized/active/non-pending/non-rejected media row references the same path.
- Stale pending media is marked `rejected` only when every reference to the same path is pending/rejected. Upload intent moderation metadata is updated first and remains trigger-compatible with Phase 2.1.
- `shared_memory_room_media_paths(room_id)` returns DB-backed room-scoped Storage paths for service-role sweeps.
- `shared_memory_account_media_paths(user_id)` returns DB-backed immutable-user-id account paths and intentionally does not rely on mutable usernames.

Manual Phase 2.2 staging verification:

```sh
# Install and link the Supabase CLI if this repo does not already have it.
brew install supabase/tap/supabase
# or: npm install -g supabase

cd mobile/supabase
supabase --version
supabase login
supabase link --project-ref <staging-project-ref>
supabase db push
```

```sql
-- 1. Cleanup RPC and sweep helpers must be service-role only.
select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'cleanup_shared_memory_media',
    'shared_memory_room_media_paths',
    'shared_memory_account_media_paths'
  );

select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'cleanup_shared_memory_media',
    'shared_memory_room_media_paths',
    'shared_memory_account_media_paths'
  )
order by routine_name, grantee;

-- Expected: service_role has EXECUTE; authenticated and anon do not.

-- 2. Direct authenticated client insert must still fail with RLS.
-- Run as a normal authenticated user, not service role.
insert into public.shared_memory_photos (
  room_id, uploader_name, public_url, storage_path, media_type, upload_intent_id,
  uploader_id, mime_type, file_size_bytes, moderation_status
) values (
  '<room_id>', '<username>', null,
  'memories/<room_id>/<user_id>/<intent_id>/media.jpg',
  'image', '<intent_id>', '<user_id>', 'image/jpeg', 12345, 'approved'
);

-- 3. Duplicate upload_intent_id and duplicate storage_path must fail.
-- Use staging-only service-role test data after creating one valid finalized row.

-- 4. Pending media visibility must be checked with real authenticated users:
-- uploader can read own pending row; another room member cannot read/sign it;
-- a non-member cannot read/sign it.
select id, room_id, uploader_id, moderation_status, storage_path
from public.shared_memory_photos
where moderation_status = 'pending';

-- 4b. Storage object read/write must be checked with real authenticated users:
-- room member uploader can upload only to the active intent path;
-- another room member cannot upload to that uploader's intent path;
-- a non-member cannot upload, read, or sign any private room media object;
-- approved media can be signed/read by room members only;
-- pending/rejected media cannot be signed/read by other room members.

-- 5. Cleanup safety: this should return no path for an intent or photo whose
-- storage_path is also referenced by approved/finalized media.
select *
from public.cleanup_shared_memory_media(
  array['<expired_intent_id>'::uuid],
  array['<stale_pending_photo_id>'::uuid],
  'pending_review_expired',
  now()
);

-- 6. Room/account media sweep helpers must return only DB-backed private paths.
select * from public.shared_memory_room_media_paths('<room_id>'::uuid);
select * from public.shared_memory_account_media_paths('<user_id>'::uuid);
```

Manual Phase 2.1 preflight:

```sql
-- Must return zero rows before applying 202606180004.
select upload_intent_id, count(*)
from public.shared_memory_photos
where upload_intent_id is not null
group by upload_intent_id
having count(*) > 1;

select storage_path, count(*)
from public.shared_memory_photos
group by storage_path
having count(*) > 1;
```

Manual Phase 2.1 verification:

```sql
-- Client insert policy must not exist after 202606180004.
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'shared_memory_photos'
  and cmd = 'INSERT';

-- These indexes must exist.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'shared_memory_photos'
  and indexname in (
    'shared_memory_photos_upload_intent_unique_idx',
    'shared_memory_photos_storage_path_unique_idx'
  );

-- Direct authenticated client insert should fail with RLS after Phase 2.1.
-- Run as a normal authenticated user, not service role.
insert into public.shared_memory_photos (
  room_id, uploader_name, public_url, storage_path, media_type, upload_intent_id,
  uploader_id, mime_type, file_size_bytes, moderation_status
) values (
  '<room_id>', '<username>', null,
  'memories/<room_id>/<user_id>/<intent_id>/media.jpg',
  'image', '<intent_id>', '<user_id>', 'image/jpeg', 12345, 'approved'
);

-- Duplicate upload_intent_id and duplicate storage_path inserts should fail,
-- even with service-role test data, because of the unique indexes.

-- Pending media should be visible only to the uploader through RLS.
select id, room_id, uploader_name, moderation_status, storage_path
from public.shared_memory_photos
where moderation_status = 'pending';
```

Manual Phase 2 verification examples:

```sql
-- Intent table exists and is RLS protected.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'shared_memory_upload_intents';

-- New upload intent paths must use immutable uploader_id.
select id, room_id, uploader_id, uploader_name, storage_path
from public.shared_memory_upload_intents
order by created_at desc
limit 5;

-- Pending media should be hidden from non-uploader members by RLS.
select id, room_id, uploader_name, moderation_status, storage_path
from public.shared_memory_photos
where moderation_status = 'pending';
```

Manual API checks:

```sh
# Create intent: should fail for non-member/blocked/unsupported MIME/oversize.
curl -X POST "$API_BASE_URL/api/mobile/memories/upload-intent" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"ROOM_UUID","mediaKind":"image","fileName":"photo.jpg","mimeType":"image/jpeg","fileSizeBytes":12345,"width":1200,"height":900}'

# Finalize: should fail before the object exists.
curl -X POST "$API_BASE_URL/api/mobile/memories/finalize-upload" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"ROOM_UUID","messageId":"MESSAGE_UUID","intentId":"INTENT_UUID"}'

# Cleanup: must require the operator secret.
curl -X POST "$API_BASE_URL/api/mobile/memories/uploads/cleanup" \
  -H "x-cleanup-secret: $MEMORY_UPLOAD_CLEANUP_SECRET"
```

Rollback for `202606180003_shared_memory_phase2_media_upload_hardening.sql`:

```sql
drop policy if exists "Upload intents finalize memory photos" on public.shared_memory_photos;
drop policy if exists "Users can read own memory upload intents" on public.shared_memory_upload_intents;
drop policy if exists "Memory members can view memory media" on storage.objects;
drop policy if exists "Memory members can upload own memory media" on storage.objects;
drop policy if exists "Memory members can delete own memory media" on storage.objects;

drop function if exists public.can_read_memory_media_object(text);
drop function if exists public.memory_upload_intent_allows_object(text);

-- Recreate the Phase 1 storage policies and validate_shared_memory_photo_integrity()
-- from 202606180001/202606180002 before allowing old clients to upload again.

drop table if exists public.shared_memory_upload_intents;

alter table public.shared_memory_photos
  drop column if exists uploader_id,
  drop column if exists upload_intent_id,
  drop column if exists moderation_status,
  drop column if exists moderation_reason,
  drop column if exists moderated_at,
  drop column if exists file_size_bytes,
  drop column if exists mime_type,
  drop column if exists duration_ms;
```

Rollback for `202606180004_shared_memory_phase2_1_trust_boundary.sql`:

```sql
drop index if exists public.shared_memory_photos_upload_intent_unique_idx;
drop index if exists public.shared_memory_photos_storage_path_unique_idx;

-- Recreate "Upload intents finalize memory photos" only if intentionally
-- rolling back to client-side finalization. That weakens Phase 2.1 and should
-- not be used for production.

-- Recreate validate_shared_memory_photo_integrity() from 202606180003 if you
-- need to roll back exact intent metadata enforcement.
```

Rollback for `202606180005_shared_memory_phase2_2_cleanup_verification.sql`:

```sql
drop function if exists public.cleanup_shared_memory_media(uuid[], uuid[], text, timestamptz);
drop function if exists public.shared_memory_room_media_paths(uuid);
drop function if exists public.shared_memory_account_media_paths(uuid);

-- After rollback, disable the operator cleanup endpoint until an equivalent
-- DB-first cleanup transition exists. Do not return to storage-first deletion
-- in production.
```

`202606180006_shared_memory_phase3_scalability.sql` adds Phase 3 Table Memory database scalability support:

- Adds indexes for room message pagination, reply lookup, message attachment lookup, visible media lookup, member room lookup, room ordering, and read-state lookup.
- Adds `shared_memory_room_summaries()`, a bounded room summaries RPC used by the mobile memory list.
- Authenticated callers can request only their own `current_profile_name()` summaries. `service_role` can pass `p_user_name` for administrative verification.
- The RPC returns participant count, visible photo count, message count, unread count, latest message preview, and latest activity timestamp without requiring the mobile app to fetch every message/photo row for every room.
- The mobile app keeps a legacy fallback for databases that have not applied this migration yet.

Phase 3 scalability verification:

```sql
-- Function should exist, be SECURITY DEFINER, and be executable by authenticated/service_role only.
select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'shared_memory_room_summaries';

select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'shared_memory_room_summaries'
order by grantee;

-- Common query indexes should exist.
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'shared_memory_messages_room_created_id_desc_idx',
    'shared_memory_messages_room_reply_idx',
    'shared_memory_photos_room_message_position_idx',
    'shared_memory_photos_room_visible_created_idx',
    'shared_memory_members_user_room_idx',
    'shared_memory_rooms_created_id_desc_idx',
    'shared_memory_reads_user_room_idx'
  )
order by indexname;

-- Run as a normal authenticated user. Should return only rooms for that user.
select *
from public.shared_memory_room_summaries(null, 25, null, null);

-- Run as a normal authenticated user. Passing a different user should fail.
select *
from public.shared_memory_room_summaries('<other_username>', 25, null, null);
```

Rollback for `202606180006_shared_memory_phase3_scalability.sql`:

```sql
drop function if exists public.shared_memory_room_summaries(text, integer, timestamptz, uuid);
drop index if exists public.shared_memory_messages_room_created_id_desc_idx;
drop index if exists public.shared_memory_messages_room_reply_idx;
drop index if exists public.shared_memory_photos_room_message_position_idx;
drop index if exists public.shared_memory_photos_room_visible_created_idx;
drop index if exists public.shared_memory_members_user_room_idx;
drop index if exists public.shared_memory_rooms_created_id_desc_idx;
drop index if exists public.shared_memory_reads_user_room_idx;
```

## Phase 5 monitoring and operations

The server memory media routes now emit sanitized operation logs through
`recordMemoryOperation()`:

- `upload_intent.create`
- `upload_intent.finalize`
- `upload_cleanup.run`
- `memory_notification.send`

Allowed log fields are count/status fields only, such as `status`,
`statusCode`, `mediaKind`, `moderationStatus`, `durationMs`, `sent`,
`expiredIntents`, `rejectedPendingMedia`, `removedObjects`, skipped counts,
and `errorKind`.

Never add room IDs, user IDs, usernames, message text, captions, signed URLs,
media URLs, storage paths, filenames, push tokens, notification previews, or
raw error objects to these logs.

Recommended production metrics and alerts:

- Upload intent create rate and error rate.
- Finalize success, rejection, idempotent replay, and error rate.
- Finalize latency p50/p95/p99.
- Cleanup expired intent count, rejected pending media count, removed object
  count, skipped count, and storage deletion failure count.
- Memory notification sent count and error rate.
- Alert if upload finalize errors exceed 5 percent over 10 minutes.
- Alert if cleanup storage deletion failures are non-zero.
- Alert if pending media cleanup rejects a sudden spike of media.
- Alert if notification send errors exceed 5 percent over 10 minutes.

Staging smoke for operations:

1. Create a valid upload intent and confirm the server logs
   `upload_intent.create` with `status=success`.
2. Finalize a valid upload and confirm `upload_intent.finalize` logs success
   with `mediaKind`, `moderationStatus`, and duration only.
3. Run the cleanup endpoint with `x-cleanup-secret` and confirm
   `upload_cleanup.run` logs counts only.
4. Trigger a memory notification and confirm `memory_notification.send` logs a
   sent count only.
5. Inspect application logs and confirm there are no storage paths, signed
   URLs, media URLs, message bodies, captions, push tokens, room names, or
   notification previews.

Manual verification examples for `202606180001_shared_memory_phase1_security.sql`:

```sql
-- Setup: replace these with existing valid values in a staging project.
-- :room_id       = a shared_memory_rooms.id
-- :other_room_id = another shared_memory_rooms.id
-- :alice         = a member username in :room_id
-- :bob           = another member username in :room_id
-- :alice_msg_id  = a shared_memory_messages.id in :room_id authored by :alice
-- :other_msg_id  = a shared_memory_messages.id in :other_room_id

-- Valid row should work.
insert into public.shared_memory_photos (
  room_id, uploader_name, storage_path, media_type, message_id
) values (
  ':room_id'::uuid,
  ':alice',
  'memories/:room_id/:alice/ok.jpg',
  'image',
  ':alice_msg_id'::uuid
);

-- Forged room in storage_path should fail with shared_memory_storage_path_room_mismatch.
insert into public.shared_memory_photos (
  room_id, uploader_name, storage_path, media_type, message_id
) values (
  ':room_id'::uuid,
  ':alice',
  'memories/:other_room_id/:alice/bad.jpg',
  'image',
  ':alice_msg_id'::uuid
);

-- Forged uploader in storage_path should fail with shared_memory_storage_path_uploader_mismatch.
insert into public.shared_memory_photos (
  room_id, uploader_name, storage_path, media_type, message_id
) values (
  ':room_id'::uuid,
  ':alice',
  'memories/:room_id/:bob/bad.jpg',
  'image',
  ':alice_msg_id'::uuid
);

-- Cross-room message attachment should fail with shared_memory_photo_message_room_mismatch.
insert into public.shared_memory_photos (
  room_id, uploader_name, storage_path, media_type, message_id
) values (
  ':room_id'::uuid,
  ':alice',
  'memories/:room_id/:alice/bad-message.jpg',
  'image',
  ':other_msg_id'::uuid
);

-- Blocked-room writes should fail with shared_memory_blocked_relationship.
insert into public.blocked_users (blocker_name, blocked_name)
values (':alice', ':bob')
on conflict (blocker_name, blocked_name) do nothing;

insert into public.shared_memory_messages (room_id, author_name, body)
values (':room_id'::uuid, ':bob', 'blocked write');
```

Rollback for `202606180001_shared_memory_phase1_security.sql`:

```sql
drop trigger if exists shared_memory_messages_security_guard on public.shared_memory_messages;
drop trigger if exists shared_memory_photos_security_guard on public.shared_memory_photos;
drop function if exists public.validate_shared_memory_message_write();
drop function if exists public.validate_shared_memory_photo_integrity();
drop function if exists public.shared_memory_room_has_blocked_relationship(uuid, text);
drop policy if exists "Block relationships prevent memory message inserts" on public.shared_memory_messages;
drop policy if exists "Block relationships prevent memory message updates" on public.shared_memory_messages;
drop policy if exists "Block relationships prevent memory photo inserts" on public.shared_memory_photos;

drop policy if exists "Memory members can upload own memory media" on storage.objects;
create policy "Memory members can upload own memory media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'memory-media'
    and coalesce((storage.foldername(name))[1], '') = 'memories'
    and (storage.foldername(name))[3] = public.current_profile_name()
    and public.can_read_shared_memory(public.memory_media_room_id(name))
  );
```
