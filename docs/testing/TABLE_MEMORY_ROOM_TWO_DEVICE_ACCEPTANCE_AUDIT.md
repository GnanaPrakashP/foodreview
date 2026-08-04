# Table Memory Room two-device acceptance audit

Audit date: 2026-08-02
Repository state at audit start: `release/mvp-candidate`, `2dbd040`
Scope: CircleBites/FoodReview Android Table Memory Room

## 1. Executive summary

The implementation has a strong server-authoritative, local-first foundation: member-scoped PostgreSQL/RLS is authoritative; owner-scoped SQLite is the durable mobile replica; React Query is the render cache; Realtime is an accelerator; and cursor catch-up is the missed-event recovery mechanism. Deterministic tests cover message response/Realtime permutations, rapid sends, duplicate events, cursor recovery beyond 800 changes, interrupted SQLite persistence, monotonic reads, account isolation, and private media.

The audit resumed after Phone B was authenticated as a distinct second account. Two Android 16 Motorola phones were connected to the same development build and used one synthetic room, `TMR AUDIT 0802 2151`. The run physically proved room creation, invite receipt and join, two-member convergence, normal/rapid/simultaneous text, replies in both directions, in-app receiver-state recovery, unread/read behavior, bidirectional images, dish creation, independent rating aggregates and changes, place creation, force-close persistence, and temporary network disconnect/reconnect without manual refresh for the successful supported actions.

The initial join attempt exposed a deployed PostgreSQL ambiguity in `respond_to_shared_memory_invite`: the table-return variable `room_id` conflicted with `ON CONFLICT (room_id, user_name)`. Migration `202608020003_fix_memory_invite_join_conflict.sql` now targets the named membership constraint. The migration was deployed, the focused invitation-lifecycle regression passed 7/7, and the same physical invite/join case passed on retry with live membership convergence.

The resumed physical verdict is still `NO-GO`. Both phones' original video uploads failed to become canonical because hosted processing repeatedly returned `moderation_service_unavailable`; one job reached dead letter and the other remained in retry. After the corrected Render worker was deployed, a new five-second Phone A video reached processed `ready` state but its final room attachment returned HTTP 500. Safe route-stage telemetry and a sanitized database reproduction then identified PostgreSQL error `54000`: the notification trigger passed `chr(0)` through a text expression while creating the push-job dedupe hash. Migration `202608030004_table_memory_notification_null_separator_fix.sql` replaces that forbidden NUL with a safe colon separator. Retrying the same already-processed Phone A video then returned HTTP 200, created the canonical room message/photo, and opened in the physical video viewer. This is a Phone A targeted pass only; Phone B is disconnected, so the required two-phone video and Chat/Media convergence case remains `BLOCKED`. OS notification cases are also `BLOCKED`, not passed: the installed development APK has no Firebase app-option resources, and sanitized device logs report unsuccessful default Firebase initialization, so this build cannot register an Expo/FCM token. Broader grouped variants that were not exercised remain `NOT EXECUTED` or `BLOCKED`; automated evidence is never used to convert them to a physical pass.

One safe defect was fixed after the audit: identical room-creation retries now retain one idempotency key until success, so a server commit followed by a lost client response cannot create a second room on retry. The regression test passes.

Release-significant blockers remain:

- Table Memory activity notification ownership has been moved from the sender client to database triggers. Migration `202608030002_table_memory_notification_outbox.sql` is live and atomically inserts deduplicated in-app notifications plus chat push jobs. The old direct route is now a compatibility no-op and exact active-chat foreground presentation is suppressed by the client. This is code/deployment evidence only; two-phone foreground/background/terminated delivery, provider receipt/retry and dedup remain physically `BLOCKED` until a Firebase-provisioned build exists.
- Chat, Media and Dishes now have separate server-authoritative unread counters through live migration `202608030001_table_memory_activity_unread.sql`, with per-tab badges and monotonic per-surface acknowledgements. The two-phone media/dish unread cases have not yet been physically retested.
- Offline text now persists as `waiting_for_connection`, replays automatically on reconnect with a stable client identity and bounded backoff, preserves compose time separately, and displays the server commit time after acknowledgement. The previous physical `Not sent / Retry` result remains a historical failure until the corrected build is retested on both phones.
- The corrected video worker is live on Render, and migration `202608030004` fixes the database-trigger NUL that rolled back final room attachment. The same ready Phone A video physically passed retry, canonical attachment and playback. A fresh Phone B upload and two-phone Chat/Media convergence remain blocked while Phone B is disconnected.
- Dish and place creation are direct inserts with no stable client mutation key or offline outbox. A retry after an ambiguous timeout can duplicate data. Only text/media have a durable outbox; ratings are server-idempotent through `(dish_id, rated_by)` upsert but are not offline queued.
- Required physical notification, video-processing, metadata-edit/removal, extended offline, and performance/recovery gates remain incomplete. The existing physical performance acceptance reports excessive PSS growth and jank.
- The full repository suite, Playwright smoke suite, and local schema contract are not fully green, although the failures are not in the focused Table Memory correctness tests.

The feature therefore cannot satisfy the stated release conditions in this audit.

### 1.1 Resumed physical two-phone execution (authoritative addendum)

This table is the authoritative result for the resumed cases. `PASS` means the behavior was observed on both physical phones. `FAIL` means a reproducible defect was observed. `BLOCKED` means the product/environment could not execute the acceptance condition; it is not a pass. The broader grouped rows in section 4 remain non-passing where their additional variants were not physically exercised.

| Case | Physical result | Evidence/observation |
| --- | --- | --- |
| A creates room | PASS | Room created once on A; `/private/tmp/tmr-a-room-created.png` |
| B receives invite | PASS | Invite appeared automatically in B Notifications; `/private/tmp/tmr-b-invite-received.png` |
| B joins room | PASS (after targeted fix) | Initial 500 captured on both phones; targeted RPC migration deployed; same case then joined and updated membership live. `/private/tmp/tmr-fail-join-phone-a.png`, `/private/tmp/tmr-fail-join-phone-b.png`, `/private/tmp/tmr-a-member-live.png`, `/private/tmp/tmr-b-join-fixed.png` |
| Room details and two members | PASS | Same title/date/member count on both; later place also converged. `/private/tmp/tmr-a-member-live.png`, `/private/tmp/tmr-b-join-fixed.png` |
| Normal chat, both directions | PASS | `A-NORMAL-01` and `B-NORMAL-01` each appeared once on both phones without refresh |
| Rapid chat, both directions | PASS | Five messages per phone converged without duplicates |
| Simultaneous chat | PASS | Reciprocal burst converged with stable rows and no manual refresh |
| Replies, both directions | PASS | `A-REPLY-TO-B` and `B-REPLY-TO-A` retained the correct original preview |
| Receiver inside exact chat | PASS (in-app/read); BLOCKED (OS push) | `A-EXACT-READ` produced no unread after leaving Chat. Push suppression cannot be certified because B had no push token |
| Receiver on another room tab | PASS (in-app/unread); BLOCKED (OS push) | `A-STATE-TABLE` incremented unread automatically and cleared after Chat was viewed |
| Receiver elsewhere in app | PASS (in-app/catch-up); BLOCKED (OS push) | `A-STATE-ELSEWHERE` appeared automatically; no OS delivery could be evaluated |
| Receiver backgrounded | PASS (foreground catch-up); BLOCKED (OS push) | `A-STATE-BG` appeared automatically on foreground; no OS delivery could be evaluated |
| Receiver app terminated | PASS (launch catch-up); BLOCKED (OS push) | `A-STATE-KILLED` appeared automatically after relaunch; no OS delivery could be evaluated |
| Unread/read state | PASS for executed states | Exact-chat read remained clear; another-tab message incremented and opening Chat cleared it without refresh |
| Image upload from A and B | PASS | Both canonical images appeared on both phones in Chat/Media. `/private/tmp/tmr-two-images-phone-a.png`, `/private/tmp/tmr-two-images-phone-b.png` |
| Video upload from A and B | BLOCKED after targeted fix (original run FAIL) | The original A/B uploads failed. After migration `202608030004`, the same new ready Phone A video attached and played canonically; Phone B is disconnected, so a fresh B upload and peer convergence are untested. `/private/tmp/foodreview-video-linked-after-fix.png` |
| Chat/Media consistency | PASS for images; PASS for targeted Phone A video; BLOCKED for two-phone video | Two canonical images matched across both tabs/phones. The repaired Phone A video is canonical and playable, but Phone B convergence is not physically certified |
| Add dishes from both phones | PASS | `A-DISH-01`, `B-DISH-01`, and focused `A-DISH-LIVE-02` retest converged automatically. `/private/tmp/tmr-dish-live02-phone-a.png`, `/private/tmp/tmr-dish-live02-phone-b.png` |
| Independent ratings and live aggregate changes | PASS | A/B personal ratings remained independent; aggregate progressed 3.0, 3.5, then 4.5 live and persisted. `/private/tmp/tmr-rating-final-phone-a.png`, `/private/tmp/tmr-rating-final-phone-b.png` |
| Add place | PASS | A added canonical `TMR Road`; B's already-open Table tab updated within seven seconds. `/private/tmp/tmr-place-canonical-phone-a.png`, `/private/tmp/tmr-place-canonical-phone-b.png` |
| Update room/place details | BLOCKED | Room actions expose leave only; place rows open Maps. Existing update mutations are not wired to the room UI |
| Force-close and reopen both apps | PASS | Both accounts, room, place, dishes, and distinct personal ratings restored. `/private/tmp/tmr-reopen-memory-phone-a.png`, `/private/tmp/tmr-reopen-memory-phone-b.png`, `/private/tmp/tmr-persisted-room-phone-a.png`, `/private/tmp/tmr-persisted-room-phone-b.png` |
| Temporary network disconnect/reconnect | PASS for text path | B inbound caught up automatically after reconnect. B outbound stayed visibly failed/retryable and Retry produced exactly one row on A |
| No manual refresh | PASS for every successful executed synchronization | Room membership, text, replies, unread, images, dishes, ratings, place, reconnect catch-up, and restart recovery updated automatically. Video and unsupported edit cases remain non-passing for their stated reasons |

Sanitized server inspection showed Phone B had `total=0, active=0` push tokens and activity notification requests completed with `sent=0`. Read-only APK resource inspection found no `google_app_id`, sender ID, or Firebase API configuration in Phone B's installed development APK; sanitized Firebase-only Logcat reported that the default Firebase app had no options and initialization was unsuccessful. The push fix requires a correctly provisioned Android validation build and cannot be completed safely without the environment-owned Firebase configuration.

Server inspection also showed repeated video worker retries with failure class `moderation_service_unavailable`; Phone A's video job reached `dead_letter` after five attempts, while Phone B's was still `retry_wait` when captured. Redacted application Logcat filters were captured on both phones and contained no matching client exception; the video failure evidence is therefore the two phone UI states plus the authoritative server asset/job/event states. No message body, identity, storage path, signed URL, credential, or push token is included in the evidence.

### 1.2 Blocker-remediation continuation (2026-08-03)

The remediation changed only the previously identified blocker paths. It did not repeat the architecture audit or broad suite. Migrations `202608030001` and `202608030002` were applied to the linked hosted database and the remote ledger now matches local migration history. Focused blocker, durable-replica, rapid-send, media-latency and push-worker checks pass 47/47; root and mobile typechecks pass. These results do not convert a physical case to PASS.

At continuation time ADB exposed only Phone A (`ZA223JVWG7`); Phone B was no longer connected. Phone A loaded the latest Metro bundle, restored the existing authenticated account, displayed `TMR AUDIT 0802 2151` with two members, and opened the room successfully. The current development APK again logged missing Firebase default options. A single-phone network-off attempt was intentionally classified `BLOCKED/inconclusive`: Wi-Fi reachability was absent, but the ADB reverse tunnel still provided the local API path, so the resulting acknowledged message cannot prove the offline queue/reconnect contract.

| Remediation retest case | Result | Evidence/observation |
| --- | --- | --- |
| Latest client launches and restores audit room on Phone A | PASS (single-phone smoke only) | Room list and detail loaded from the latest bundle; `/private/tmp/tmr-fix-phone-a-memory-list.png`, `/private/tmp/tmr-fix-phone-a-room2.png` |
| Video preview/stages and canonical A/B video completion | PASS on Phone A; BLOCKED on Phone B | Phone A preview rendered correctly, Render produced the canonical MP4, and after migration `202608030004` Retry attached the same asset with HTTP 200 and opened it in the viewer. Phone B is disconnected. `/private/tmp/foodreview-video-preview.png`, `/private/tmp/foodreview-video-linked-after-fix.png` |
| Automatic offline text send, server-commit timestamp and peer delivery | BLOCKED | Two-phone retest unavailable; the A-only attempt was invalidated by the USB reverse API tunnel and is not counted |
| Media and dish unread/badge/read-state on both phones | BLOCKED | Hosted counter migration is live, but Phone B disconnected before physical validation |
| Durable activity notification, exact-chat suppression and other receiver states | BLOCKED | Phone B disconnected and installed APK remains unprovisioned for Firebase/FCM |
| Two-phone no-refresh/restart/reconnect regression after remediation | BLOCKED | Only Phone A is connected |

The authoritative physical verdict therefore remains `NO-GO`.

### 1.3 Media-pipeline remediation pending physical deployment (2026-08-04)

The subsequent targeted media audit found that Table Memory publication itself was incorrectly waiting for worker readiness. Migration `202608040001_table_memory_media_early_publication.sql` and its paired client/server changes now publish one logical message plus its verified private attachment immediately after source finalize, then update that same attachment in place as the worker moves through `uploaded`, `processing`, `ready`, or a terminal state. The portrait-video worker now calculates crop geometry after display rotation, and deterministic FFmpeg exits no longer consume transient retry attempts.

This work has passed a clean local migration replay, a local Supabase state/idempotency/unread/RLS fixture (11.6 ms local attachment transaction), a real rotated-portrait FFmpeg fixture, 57/57 focused tests, root/mobile type checks, migration-manifest validation, diff validation, and the production Next build. Linked migration `202608040001` is now applied and verified in the remote ledger; the user reports the API/worker deployment and app reinstall are also complete. It has **not** been physically retested on Phone A/Phone B in this continuation. The final ADB check exposed only Phone A (`ZA223JVWG7`), not Phone B. Therefore no row in the physical matrix is upgraded to PASS. In particular, F-01 through F-04, J-01, K-04, and the two-phone portions of the section 1.1 media rows remain `BLOCKED`/`NOT EXECUTED` until exercised on the deployed build.

The exact 15-stage pipeline, root cause, state model, code paths, and required after-timing/evidence are recorded in `docs/testing/TABLE_MEMORY_ROOM_MEDIA_PIPELINE_2026-08-04.md`.

The first linked applications of migration `202608040001` stopped before ledger insertion because historical message/photo classification encountered authors/uploaders who had left their rooms; the normal membership write guards raised `shared_memory_message_author_not_room_member` and then `shared_memory_photo_uploader_not_room_member`. The targeted correction disables only the named message/photo guards around their exact data-only backfills and reenables them immediately; runtime guards remain unchanged. A final clean replay verified both guards enabled, and the corrected migration then applied successfully to the linked database.

The authoritative physical verdict remains `NO-GO`.

## 2. Architecture and data-flow map

### 2.1 Runtime flow

```text
Screen mutation
  -> hook optimistic/query update
  -> SQLite outbox (text/media only)
  -> authenticated API or member-scoped Supabase write
  -> PostgreSQL/RPC + RLS (authority)
  -> HTTP response and/or Realtime echo
  -> identity-based merge into React Query + SQLite
  -> cursor catch-up on subscribe/reconnect/resume
```

Realtime is not treated as guaranteed delivery. `shared_memory_room_sync_v2` is the authoritative delta path, and sync pages plus cursors are committed transactionally to SQLite.

### 2.2 Screens, components, hooks, and services

| Concern | Implementation | Source of truth | Local/render representation |
| --- | --- | --- | --- |
| Create room | `mobile/app/(tabs)/share.tsx:641`, `useCreateMemoryRoomMutation` at `mobile/src/hooks/useMemories.ts:2276`, `createMemoryRoom` at `mobile/src/services/memories.ts:921`, `POST /api/mobile/memories` | `create_shared_memory_room_with_invites` RPC and PostgreSQL | Complete empty-room QueryClient snapshot and SQLite snapshot/summary after server response |
| Memories list | `mobile/app/(tabs)/profile.tsx:264`, `useMemoryRoomsQuery` at `mobile/src/hooks/useMemories.ts:1407` | `shared_memory_room_summaries_v3` | `memory_room_summaries`; query key `["memories"]` |
| Room UI | `mobile/app/memories/[id].tsx:5185`; Table, Chat, Media, Dishes, member/actions header | Room bootstrap/sync RPCs and member-scoped tables | `memory_room_snapshots`, entity tables, detail/chat/media query keys |
| Invite and join | `mobile/app/notifications.tsx:262`, invite response API, `useRespondToMemoryInviteMutation` at `mobile/src/hooks/useMemories.ts:2431` | `shared_memory_invites`, `respond_to_shared_memory_invite` with row lock/unique membership | Warmed SQLite room and QueryClient on normal success; warm failure is caught and navigation can continue |
| Background ownership | `mobile/src/providers/MemoryRoomSyncBootstrap.tsx:14` | Summary RPC plus per-room cursor sync | Restores summaries; one app-level Realtime owner; bounded sync on foreground/reconnect |
| Push/deep links | `mobile/src/providers/PushNotificationBootstrap.tsx:35`, `mobile/src/services/notifications.ts` | Expo response plus notification tables for durable social/invite notifications | Recipient-bound navigation state; room deep link, but no message anchor |
| API reads | `app/api/mobile/memories/read/route.ts` | `shared_memory_room_summaries_v3`, bootstrap v2, sync v2, chat v2, media v1 | Normalized models committed into SQLite/QueryClient |
| Text | `useAddMemoryMessageMutation` at `mobile/src/hooks/useMemories.ts:2486`; message API | `shared_memory_messages`, unique author/client identity | Optimistic row plus `memory_message_outbox`, then canonical server/client IDs |
| Media | camera/preview routes, media API, media pipeline | private storage, upload intents, media assets/jobs, atomic attach RPC | Optimistic message/media, stable media metadata; signed URLs renewed separately |
| Dishes/ratings/places | `addMemoryDish`, `setMemoryDishRating`, `createMemoryStop` in `mobile/src/services/memories.ts:2120-2215` | direct member-scoped table writes | Room detail cache plus Realtime/catch-up; no dish/place outbox |
| Reads | visibility tracking in room screen; `markMemoryRoomRead` at `mobile/src/services/memories.ts:1855` | `mark_shared_memory_read_v1` | Summary/detail unread fields and durable snapshot |
| Leave/access loss | `leaveMemoryRoom` at `mobile/src/services/memories.ts:1924`, `useLeaveMemoryRoomMutation` at `mobile/src/hooks/useMemories.ts:2475` | membership delete/RLS | Atomic deletion from all local room tables after authoritative access loss |

### 2.3 Server data, RPCs, storage, and policy boundary

Primary tables are `shared_memory_rooms`, `shared_memory_members`, `shared_memory_messages`, `shared_memory_photos`, `shared_memory_dishes`, `shared_memory_dish_ratings`, `shared_memory_stops`, `shared_memory_reads`, `shared_memory_invites`, `shared_memory_upload_intents`, and `shared_memory_chat_changes`. The base schema is in `supabase/migrations/202606060001_shared_memory_rooms.sql:4`; reads, invites, ratings, stops, upload intents, and change-log additions are in their later migrations.

Key RPCs are:

- `create_shared_memory_room_with_invites` (`202607220001_table_memory_invitation_lifecycle.sql:8`)
- `respond_to_shared_memory_invite` (`202607220001_table_memory_invitation_lifecycle.sql:226`)
- `shared_memory_room_summaries_v3` (`202607210007_profile_memory_timeline_pagination.sql:11`)
- `shared_memory_room_bootstrap_v2` and `shared_memory_room_sync_v2` (`202607270001_shared_memory_client_ordering.sql:137,167`)
- `shared_memory_chat_page_v2` (`202607270001_shared_memory_client_ordering.sql:110`)
- `shared_memory_media_page_v1` (`202607130009_backend_feed_performance.sql:725`)
- `attach_shared_memory_media_assets_v2` (`202607270001_shared_memory_client_ordering.sql:202`)
- `mark_shared_memory_read_v1` (`202607290001_shared_memory_monotonic_reads.sql:5`)

The private `memory-media` bucket is protected by room membership and uploader policies (`202606140001_shared_memory_privacy_hardening.sql:86`; `202606180001_shared_memory_phase1_security.sql:233`). Processed media also uses the general private media pipeline and service-only workers.

RLS is enabled on all primary room tables. Room, entity, invite, read, rating, block, media-integrity, and membership policies are exercised by focused static/pgTAP tests. Client access does not rely on knowing a room UUID.

### 2.4 Realtime channels, query keys, and local tables

- Global channel: `shared-memory-rooms` (`mobile/src/hooks/useMemories.ts:1595`), covering rooms, members, messages, photos, dishes, ratings, and stops.
- Active room channel: `shared-memory-room:${roomId}` (`mobile/src/hooks/useMemories.ts:2197`) over the same entity set with room filters.
- Subscription success schedules cursor reconciliation (`mobile/src/hooks/useMemories.ts:192,1643,2242`). Delayed invalidation is fallback, not primary correctness.
- Query keys (`mobile/src/hooks/useMemories.ts:103`): `["memories"]`, `["memories", roomId]`, `["memories", roomId, "chat"]`, `["memories", roomId, "media"]`, and unread anchor.
- SQLite (`mobile/src/services/memoryOfflineStore.ts:204-266`): `memory_room_summaries`, `memory_room_snapshots`, `memory_messages`, `memory_photos`, `memory_room_sync_state`, and `memory_message_outbox`; entity and outbox client/server IDs are uniquely indexed.
- The SQLite file lives under an authenticated-owner directory. Account generation checks prevent a late result from one account populating another account's cache.

### 2.5 Mutation/reconciliation details

Text messages carry `clientId`, `clientCreatedAt`, `clientSequence`, and `clientOrderKey`. The message API uses the client ID as the idempotency key; HTTP response, Realtime echo, restore, and retry merge by stable identity. Realtime-before-response, response-before-Realtime, duplicate, and out-of-order permutations are deterministic tests.

Media uses a stable upload batch/client identity, private upload intent, sequential source upload, server validation/finalization, processed-media job, and atomic attach. Metadata persists without treating a signed URL as identity.

Ratings use an upsert on the database unique key `(dish_id, rated_by)`. Dish and stop creation do not have comparable request identities. The room-creation fix in this audit retains a request key by normalized payload until success.

## 3. Two-device test environment

| Item | Phone A | Phone B |
| --- | --- | --- |
| Serial/model | `ZA223JVWG7`, Motorola edge 70 fusion | `ZN52266GVH`, moto g57 power |
| OS | Android 16 | Android 16 |
| App during resumed audit | `com.circlebites.mobile.dev`, Metro 8081 | `com.circlebites.mobile.dev`, Metro 8082 |
| Account state | Authenticated as User A | Authenticated as distinct User B |
| Data clearing | None | None after authentication |
| Physical result | Owner/create/send/upload/dish/rating/place/offline/restart actions | Invite/join/send/upload/dish/rating/offline/restart actions |

Both phones were USB-connected, visible to ADB, and used one shared synthetic room on the same home LAN. A different-network Wi-Fi-to-mobile-data run was not executed.

Evidence is retained locally under `/private/tmp/tmr-*.png` and is not committed because screenshots can contain account content. The specific failure evidence is indexed in section 1.1. Sanitized API/server inspection was limited to status, counts, job state, and failure class. The earlier cold Android activity launch reported `LaunchState: COLD`, `TotalTime: 1239 ms`; this is activity launch time, not a cross-device convergence measurement.

## 4. Complete test matrix

`NOT EXECUTED` means that specific variant was not physically run. `BLOCKED` means it could not be certified because of a product/environment prerequisite. Grouped rows enumerate every requested case; a grouped row must not be treated as passed unless all listed variants pass. Section 1.1 records the narrower physical cases that were executed even where a broader grouped row remains non-passing.

### A. Room creation and joining

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| A-01 | Creation/snapshot | A owner; B distinct account | Create one room; observe before/after confirmation | Invitation only, no room access before join | Immediate stable local snapshot; metadata unchanged across confirmation | No for A's first frame; yes for later summaries | Reopen and see same room once | Retry after lost response | PASS (executed create/reopen; response-loss variant not run) | `/private/tmp/tmr-a-room-created.png`; restart evidence in section 1.1 | Fixed earlier: creation retry key previously changed per attempt |
| A-02 | Invite/join | Pending invite | Invite B; B joins from B | Snapshot exists before entry; room appears in Memories | Member/list update without refresh | Yes plus catch-up | Both reopen successfully | Failed join leaves no false local room; retry succeeds | PASS (after targeted fix) | Initial failure on both phones, deployed named-constraint fix, then physical join/member convergence | Fixed deployed RPC `room_id` ambiguity |
| A-03 | Metadata equality | Joined room | Compare title, place, date, occasion, owner, members | Exact match | Exact match | Yes | Exact match after restart | Reconnect converges | PASS (supported displayed fields) | Member, place, and restart screenshots in section 1.1 | Unsupported edit fields remain I-01 |
| A-04 | Join idempotency | Same pending/accepted invite | Reopen invite; issue join twice and simultaneously | One membership and one room card | One member entry | Yes | Still one after restart | Repeat after timeout | NOT EXECUTED | RPC locking/unique static tests | Physical concurrency unproved |
| A-05 | Join failure | Inject denied/temporary failure | Cause join failure, then retry | No false snapshot; successful retry warms room | No phantom member before success | Catch-up after success | Restart contains only authoritative state | Failure/reconnect retry | PASS for reproduced server failure/retry | Initial 500 left no joined room; fixed retry joined once and later restored | Root cause fixed by `202608020003_fix_memory_invite_join_conflict.sql` |

### B. Live text chat

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| B-01 | Message variants | Both in room | In both directions send one, multiple, rapid, extreme repeated-send, simultaneous, identical text, long, emoji-only, multiline, and URL messages | Every logical message once, correct sender/time/order | Input clears; each optimistic row appears immediately | Yes | All variants persist | Repeat representative variants offline/reconnect | BLOCKED (partial variants PASS) | Normal, five-per-phone rapid, and simultaneous reciprocal messages passed; exotic/long/extreme variants not run | Remaining grouped variants lack physical evidence |
| B-02 | Receiver location | B cycles states | A sends while B is in Chat, Table, Media, Dishes, Memories, elsewhere, backgrounded, terminated, and offline | Live update or automatic catch-up appropriate to state | Stable confirmation | Yes except terminated/offline catch-up | Terminated case appears after launch | Offline case appears automatically | BLOCKED (core states PASS) | Exact Chat, Table, elsewhere, background, terminated, and offline/reconnect passed; every listed tab/another-room variant not run | OS push separately blocked by absent B token |
| B-03 | Optimistic UX | Both active | Send each representative message | No duplicate, removal/reinsert, jump, jiggle, disappearance, merge, or reorder | Input clears; new typing never merges; optimistic identity remains | Echo may precede response | Reopen/restart preserves | Failed row remains clear and retryable | PASS for executed messages | Normal/rapid/simultaneous rows remained single; offline outbound exposed `Not sent / Retry` and retry sent once | Frame-by-frame jank metric not captured |
| B-04 | Canonical identity | Network shaping available | Force response-before-echo, echo-before-response, duplicate echo, out-of-order echo, timeout/retry | One canonical row; same order and sender/time | Local/server IDs reconcile; retry creates one server row | Yes | SQLite has one canonical record after restart | Queue survives restart and retry | NOT EXECUTED | 120 permutations, reverse confirmations, duplicate tests pass | No physical/network-shaped proof |

For B-01 through B-04, the required per-message assertions are: immediate input clear and optimistic display; no merge/disappearance/reinsert/jump/jiggle/duplicate; stable A/B ordering; correct sender/timestamp; live receiver visibility; reopen/restart persistence; one local canonical record; safe client/server ID reconciliation; harmless mutation/Realtime echo; idempotent retry; clear failed state; and no multi-record retry.

### C. Replies

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| C-01 | Reply targets | Existing newest, older, cached, paged, and media messages | A replies to B; B replies to A; reply to newest/older/cached/paginated/media message | Correct original sender/content preview | Same correct preview | Yes | Reference survives and bootstrap/pagination resolves it | Cached reply target remains correct | BLOCKED (two-way newest target PASS) | `A-REPLY-TO-B` and `B-REPLY-TO-A` had correct previews; older/paged/media variants not run | Remaining grouped variants lack physical evidence |
| C-02 | Reply races/failures | Network controls | Reply offline, during reconnect, rapidly from both users; delete referenced message if supported | No wrong target, crash, or blank container | Temporary IDs reconcile safely | Yes plus catch-up | Missing/deleted reference degrades gracefully | Queue/reconnect retains reply | NOT EXECUTED | Reply security/static tests only | Reply-to-optimistic physical reconciliation not executed |
| C-03 | Reply invariants | Cases C-01/02 | Inspect both phones | Preview, original sender/content, and reference are identical | No temporary ID leak | Yes | Reference in restored bootstrap and older pages | Missing target safe | PASS for executed two-way replies | Both phones displayed matching original preview/reference | Missing/deleted/paginated target variants not run |

### D. Notifications

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| D-01 | Action coverage | Push granted on B | Trigger text, reply, media, dish, intended rating, invite, membership, and intended room-detail updates | Appropriate single notification | Sender receives none | Not sufficient; durable delivery needed | Terminated tap restores target | Queue/delivery retries after outage | BLOCKED | B permission granted, but its APK lacks Firebase options; safe server query found zero registered tokens and activity route reported `sent=0` | Validation build is not FCM-provisioned; P1 direct non-durable activity push also remains |
| D-02 | Receiver states | Same action repeated with unique IDs | B views exact chat, another room tab, another room, Memories, elsewhere, background, terminated | Suppress exact-chat push; show one elsewhere as designed | No self-notification | In-app update plus push must dedupe | Terminated delivery/tap works | Provider outage recovers | BLOCKED | In-app/catch-up states passed, but no state could receive OS push without a token | P1 no active-exact-chat suppression contract |
| D-03 | Content/dedup | Valid room and sender | Perform one action, inject duplicate trigger | One notification with correct room/sender; no duplicate visible activity | No duplicate request | Yes | Notification remains single | Denied permission does not break in-app unread | BLOCKED | No deliverable push recipient; cannot inspect content/visible dedupe | Activity route creates no in-app notification row and bypasses durable jobs |
| D-04 | Deep links | Valid, old, and invalid payloads | Tap room/message notification | Correct room; reveal/scroll to relevant message where supported; old/invalid fails safely | — | No | Cold-start routing safe | — | NOT EXECUTED | Recipient-bound handler static audit | Message ID/anchor is absent; only room opens |

### E. Unread and read state

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| E-01 | Scenarios | Both joined | Generate one/multiple unread, both directions; B opens room, Chat, stays Overview, backgrounds while reading; receive in Chat/other tab; open via push/card | Correct room/global counts and indicators | Own sends never unread | Yes | State survives | Reconnect recomputes | BLOCKED (executed core states PASS) | Exact-chat message stayed read; Table-tab message incremented and cleared on Chat open; background/terminated/offline messages recovered | Push/card and every grouped count variant not run |
| E-02 | Visibility semantics | B has unread rows | Open Overview only, then Chat; receive while visible | Overview does not mark chat unless designed; Chat marks only rendered/appropriate messages | Correct summary | Yes | No badge flicker after restart | Offline read later reconciles | PASS for executed exact-chat/Table cases | Controlled `A-EXACT-READ` and `A-STATE-TABLE` observations | Extended visible-row boundaries not run |
| E-03 | Monotonic/dedup | Two events/devices for same user if possible | Send older/newer read acknowledgements; duplicate message events | Read position never moves backward; counts nonnegative and no double increment | Sender count unchanged | Yes | Latest read remains | Concurrent device reconnect safe | NOT EXECUTED | pgTAP monotonic-read test passes | Same-user second-session case unavailable |

### F. Media

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| F-01 | Formats | Camera/gallery permissions | From both phones upload one/multiple, portrait, landscape, very large image; one video, near-limit video; with/without caption | Metadata/thumb/full item once; video poster/playback | Stable progress/optimistic state | Yes | Media remains | Cached media works as intended | BLOCKED (targeted Phone A video PASS) | One synthetic image from each phone passed. After the worker and migration `202608030004` fixes, the same ready Phone A video attached and played; Phone B and grouped format variants remain untested | Original worker and trigger defects fixed; grouped physical matrix incomplete |
| F-02 | Concurrency/location | Both joined | Rapid and simultaneous uploads; receiver in Chat, Media, or outside room | Chat/Media canonical item and counts update live | No replacement flicker | Yes | Counts/items stable | Reconnect catches metadata | BLOCKED (bidirectional images PASS) | Both images updated Chat/Media across phones automatically; rapid/simultaneous batches not run | Video failure prevents full cross-surface certification |
| F-03 | Lifecycle failure | Network/app controls | Background, temporary loss, cancel, fail, retry, kill during upload, reopen incomplete upload | Failed/incomplete never shown complete; no ghost | Clear state; retry idempotent; temp cleanup | Yes after completion | Recovery/cleanup safe | Queue/source recovery where supported | BLOCKED (same-asset retry PASS on Phone A) | The repaired retry reused the ready asset without retransmitting it and produced one canonical attachment. Background/cancel/kill cleanup and Phone B recovery remain untested | Required physical lifecycle matrix incomplete |
| F-04 | Security/URLs/delete | Member and nonmember sessions | Expire/renew URL; open thumbnail/full/video; delete or fail item | Exactly one item removed/updated from Chat, Media, counts | Stable metadata identity | Yes | Signed URL renews and item persists/deletes | Cached usability follows policy | NOT EXECUTED | 40 exact media/security gates; pgTAP memory media pass | Old-URL/removal physical proof missing |

Required F assertions include correct progress; failed uploads never complete; idempotent retry; live metadata; exactly-once representation; shared Chat/Media identity; count updates; valid thumbnails/full/video; safe signed-URL expiry/renewal; intended cache usability; unauthorized storage denial; restart persistence; deletion from all tabs; and temporary-record cleanup.

### G. Dishes

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| G-01 | Creation variants | Both joined | From both users add one, multiple, rapid dishes; simultaneously add different and same dishes; try spelling/case variants | Live intended duplicate contract; one representation per server dish | Counts/preview update | Yes | Same list after restart | BLOCKED (bidirectional single-create PASS) | A and B each added a dish; focused `A-DISH-LIVE-02` appeared on both within seven seconds and persisted | Rapid/same-name/spelling/concurrent variants not run; duplicate semantic contract undefined |
| G-02 | Retry/offline | Network controls | Add offline; retry after failure/ambiguous timeout | Pending/failure then one dish after recovery | No duplicate | Catch-up on reconnect | Queue survives if supported | Offline retry once | NOT EXECUTED | Direct insert inspected | P1 no dish outbox or stable idempotency key; ambiguous retry can duplicate |
| G-03 | Edit/delete/permissions | Existing dish | Edit/delete if supported; test allowed and unauthorized users | Live update/removal or explicitly unsupported UI | Rollback on failure | Yes | Bootstrap/local cache match | Reconnect converges | NOT EXECUTED | RLS static coverage | Complete edit/delete product contract not exposed/proved |
| G-04 | Cross-surface/transaction | Existing room | Add while all tabs observed; issue concurrent creation | Detail, Dishes, Overview, list/counts agree; no manual refresh | Same | Yes | Same after restart | Retry no duplicate | BLOCKED (live Dishes sync PASS) | Focused dish retest converged without manual refresh and persisted | Concurrent/ambiguous retry not run; direct insert lacks operation idempotency |

### H. Dish ratings

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| H-01 | Per-user ratings | Existing dishes | A rates, B different; each changes rating; both simultaneous | Correct aggregate and distinct personal rating | A cannot overwrite B | Yes | Same database/local values | — | BLOCKED (independent/change flow PASS) | A=5 and B=4 remained distinct; aggregate 4.5 live on both and persisted after restart | Simultaneous rating tap not run |
| H-02 | Rapid/retry/offline | Several dishes | Rate several rapidly; fail/retry; rate offline; remove if supported | One rating/user/dish; no double aggregate | Idempotent server update | Yes | Ratings persist | Offline action retries if supported | NOT EXECUTED | Rating payload and RLS tests pass | No rating outbox; remove-rating flow not proven |
| H-03 | Authorization | Nonmember/removed B | Attempt rating by known dish/room ID | Server denial; no aggregate change | Owner unchanged | No | Still denied | Old cache cannot authorize | NOT EXECUTED | RLS policy/static tests | Physical adversarial case missing |

### I. Place and room details

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| I-01 | Metadata coverage | Editable room | Change title, place, location, date, occasion, description/notes, cover if supported, and every other editable field | Header/Overview/Memories update live | Stable optimistic/confirmed value | Yes | Old value never reappears | Reconnect applies update | BLOCKED | Adding `TMR Road` passed live; room actions expose leave only and place rows open Maps, so requested edits cannot be initiated | Update mutations are not wired to this room UI |
| I-02 | Conflict/rollback | Two editors | Concurrent edits and forced failure | Defined conflict result; unauthorized restriction enforced | Failed optimistic edit rolls back | Yes | Winner persists | Reconnect uses authority | NOT EXECUTED | Server/RLS static audit | No explicit cross-field conflict/version contract |
| I-03 | Echo dedup | Realtime active | Update one supported field | One compatible update on list/header/overview | No duplicate transition | Yes | Same after restart | Catch-up safe | NOT EXECUTED | Query patch/invalidation paths | Physical stale-cache proof missing |

### J. Cross-tab consistency

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| J-01 | Media surfaces | Tabs observed | Send chat image/media | Chat and Media share canonical item; Overview media count updates | Same | Yes | Same after restart | Reconnect catches all surfaces | BLOCKED (images and targeted Phone A video PASS) | Images were canonical on both. The repaired Phone A video became canonical and playable; Phone B video/peer convergence remains untested | Two-phone video surface proof incomplete |
| J-02 | Dish/rating surfaces | Tabs observed | Add dish/rating | Dishes, Overview preview, aggregate/count agree | Same | Yes | Same after restart | Catch-up updates each | PASS for executed flow | Bidirectional dishes and rating aggregates converged live and restored after force-close | Offline/ambiguous dish retry remains unproved |
| J-03 | Room/list surfaces | Tabs/list observed | Change title/place; add message; change member | Header/Memories/place/last-message/last-activity/unread/member count all update | Same | Yes | No stale values | Catch-up automatic | BLOCKED (member/message/place-add PASS) | Join membership, messages, and new place updated live and persisted; edits/removal unavailable | Full metadata edit/removal surfaces incomplete |
| J-04 | Cache ownership | Switch every tab after each mutation | Do not pull-to-refresh | No tab requires manual refresh; separate detail/chat/media keys remain compatible | Same | Yes plus cursor sync | Restart consistent | Reconnect consistent | BLOCKED (successful executed actions PASS) | All successful executed sync occurred without pull-to-refresh; video never completed and edit actions are unavailable | Full all-entity grouped case cannot pass |

### K. Offline and reconnect

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| K-01 | Missed remote events | B offline | A performs text, reply, media, dish, rating, detail, membership update | On reconnect all missing events apply once in deterministic order without refresh | Authoritative state unchanged | Realtime reconnect plus cursor catch-up | Restart after reconnect stable | Core case | BLOCKED (remote text PASS) | `A-OFFLINE-IN` appeared on B automatically after reconnect | Remaining mutation types not exercised offline |
| K-02 | Local offline actions | B offline | B performs each supported offline action | Pending states survive; authorized actions retry once | A receives only after commit | Yes after commit | Restart while offline keeps queue | Required | BLOCKED (local text PASS) | `B-OFFLINE-OUT` stayed `Not sent / Retry`; after reconnect Retry sent exactly once to A | P1 dishes/ratings/stops/details are not offline queued |
| K-03 | Transition/races | Both devices | Wi-Fi-to-mobile-data; both reconnect simultaneously | No gaps/duplicates/reorder; temporary IDs reconcile | Same | Yes plus catch-up | Restart midway retains queues | Required | NOT EXECUTED | App-level reconnect sync exists | No physical transition evidence |
| K-04 | Failure visibility | Inject failures | Retry pending actions and provider/API timeouts | Clear failure state; idempotent recovery | No duplicate requests/data | Catch-up | App restart loses no pending message/upload | Required | BLOCKED (offline text PASS; video FAIL) | Text showed clear failure/retry and recovered once; video remained misleadingly in-progress while backend failed/retried | Non-outbox entity failure states incomplete |

Conclusion: the implementation does not treat Realtime as guaranteed. The catch-up mechanism exists and is authoritative. The release gap is physical proof and incomplete offline/idempotency coverage for non-message entities.

### L. App restart and local persistence

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| L-01 | Force close/reopen | Both phones have synchronized room | Force-stop both, cold launch, revisit room | Session, room, place, dishes, and B personal rating restore | Same, including A personal rating | Catch-up after launch | Executed on both | Earlier reconnect case executed | PASS | `/private/tmp/tmr-reopen-memory-phone-a.png`, `/private/tmp/tmr-reopen-memory-phone-b.png`, `/private/tmp/tmr-persisted-room-phone-a.png`, `/private/tmp/tmr-persisted-room-phone-b.png` | — |
| L-02 | Device restart/offline open | Both synchronized | Restart each device; open immediately and offline | Cached room opens promptly with prior data | Same | On later reconnect | Required | Required | NOT EXECUTED | Durable SQLite tests pass | Physical device restart/offline open missing |
| L-03 | Account boundary | Two accounts | Sign out/in, switch A/B; clear temporary cache | Only current account's rooms | No other-account flash/leak | Re-subscribe as new owner | Correct after every switch | Previously cached current-owner room only | NOT EXECUTED | Account isolation tests pass | Physical account switch unavailable |
| L-04 | Recovery variants | Pending work/history | Restart during send/upload/history; refresh signed URLs; reinstall if in scope | Server/cached state reconciles | Queue/history/migrations remain valid | Yes | Required | Partial-history offline remains usable | NOT EXECUTED | Offline queue/migration tests pass | Physical kill/reinstall evidence missing |

L-01 also confirmed that app relaunch returns to the feed rather than restoring the exact open room route; revisiting the room restored data. The acceptance requirement is data restoration, not necessarily route restoration.

### M. Membership, leaving and removal

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| M-01 | Self-leave | B member | B leaves | Room access revoked; local projection removed per policy | Member count updates | Yes | B cannot reopen | Offline cached use denied on reconnect | NOT EXECUTED | Self-leave and local deletion code | Physical revocation missing |
| M-02 | Owner removal | A owner; B member | A removes B while B open, then while B offline | Active access stops; no new events/notifications | Owner remains with correct member count | Yes | B remains denied | Removal catches up | NOT EXECUTED | No mobile owner-removal mutation found | P1 required control is absent |
| M-03 | Reinvite | B removed | A reinvites; B joins | Fresh membership without stale local role/state | One member | Yes | One room after restart | Reconnect safe | NOT EXECUTED | Invite RPC idempotency static tests | Physical lifecycle missing |
| M-04 | Old entry points | B removed | B opens old notification/deep link/cached room | Safe not-found/access-denied; no private inference | Unaffected | No new room events | Still denied | Cached UI follows retention/removal policy | NOT EXECUTED | RLS/access-loss cleanup tests | Active notification/deep-link proof missing |
| M-05 | Adversarial reads/writes | B removed; known room/media IDs | B calls reads; sends/uploads/adds dishes/rates; opens old media URL | Every protected new read/write denied; storage renewal denied | Owner unaffected | No | Denial persists | Old signed URL expires; no renewal | NOT EXECUTED | Focused RLS/media tests pass | Runtime post-removal matrix not run |

### N. Pagination and history

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| N-01 | Long history | More than 50/configured page size messages, older replies/media | Page older history multiple times | No gaps/duplicates; stable order; replies resolve | Stable scroll on prepend | New live messages coexist | Restart midway resumes safely | Partial cached history opens and exposes older cursor | NOT EXECUTED | Cursor/page deterministic tests pass | Physical scroll/placement proof missing |
| N-02 | Live while paging | Active pagination | Other phone sends while page request in flight | New rows do not corrupt older cursor/order | Same | Yes | Merged SQLite pages remain idempotent | Reconnect fills missing pages | NOT EXECUTED | Client ID/tie-breaker cursors and merge tests | Cross-device race not executed |

### O. Performance and UX

| ID | Area | Preconditions | Phone A action | Phone B expected result | Phone A expected result | Realtime required | Restart verification | Offline verification | Result | Evidence | Defect |
| -- | ---- | ------------- | -------------- | ----------------------- | ----------------------- | ----------------- | -------------------- | -------------------- | ------ | -------- | ------ |
| O-01 | Open latency | Cached and uncached rooms | Measure cached/uncached open | Same budget | Stable first useful frame | No for cached | Cold/revisit measured | Cached offline open measured | PARTIAL (A activity only) | Cold activity launch 1239 ms; no room-frame timing | No uncached/two-phone metric |
| O-02 | Cross-device latency | Both accounts and clock/video | A/B send text/media/dish/rating/detail | Measure action-to-visible latency | Immediate optimistic response | Yes | Repeat after restart | Repeat after reconnect | BLOCKED (functional convergence observed) | Dish retest and place appeared within seven seconds; precise synchronized p50/p95 timing not captured | Core release latency metric remains missing |
| O-03 | Network/subscription cost | Instrumented build | Open room/switch tabs repeatedly | No duplicate subscription or full refetch waterfall | One global + one active-room channel; bounded reads | Yes | No leaked channels after reopen | Catch-up bounded | STATIC/PARTIAL | Source has app-level global and room channel; request logs show summary/cursor reads | Runtime subscription-count proof incomplete |
| O-04 | Render/storage cost | Long text/media room | Rapid send, scroll, switch tabs, upload | No jank/whole-list rerender | Bounded list and SQLite queries | Yes | No memory growth after cycles | Local reads stay bounded | FAIL (prior evidence) | `MEMORY_ROOM_RELEASE_ACCEPTANCE_2026-07-28.md` reports +91 MiB PSS without plateau and 34.57% jank | Existing performance release blocker |
| O-05 | Risk inspection | Full source | Inspect waterfalls, repeat bootstrap/refetch, per-tab channels, leaks, unbounded reads, main-thread work, URL regeneration, item replacement, races | None present or bounded | Same | N/A | N/A | N/A | STATIC COMPLETE | Bounded pages/catch-up; separate query keys patched consistently; media URL renewal flights | Physical profiling still required |

O-05 found no one-subscription-per-tab design and no reliance on full-room refetch after every message. Risks remain from the very large room screen/hook/service files, dual global/room event delivery (reducers must remain idempotent), and the documented native memory/jank behavior.

## 5. Automated test results

| Exact command | Result | Counts/output | Meaningful two-device coverage |
| --- | --- | --- | --- |
| `npm run test:memory-hardening` | PASS | 116 passed, 0 failed | Strong deterministic security, media, scalability, local-first, performance-contract, and operations coverage; not physical |
| `node --test tests/shared-memory-phase1-security.test.mjs tests/shared-memory-phase2-media-security.test.mjs` | PASS | 40 passed, 0 failed | RLS/media adversarial contracts; not physical |
| `node --test tests/table-memory-durable-replica.test.mjs ... tests/push-delivery-phase7.test.mjs` (focused list recorded in audit log) | PASS | 153 passed, 0 failed before the fix | Response/Realtime permutations, rapid send, SQLite/account isolation, notifications/worker contracts; simulated only |
| `node --test tests/table-memory-durable-replica.test.mjs` after fix | PASS | 12 passed, 0 failed | Includes new lost-response creation-retry test; simulated only |
| `node --test tests/table-memory-invitation-lifecycle.test.mjs` after deployed join fix | PASS | 7 passed, 0 failed | Focused regression for the named membership conflict target; physical retry also passed |
| `npm test` after fix | FAIL | 1,849 passed, 10 failed, 1,859 total | Broad repository confidence; no physical devices |
| `npm run typecheck` | PASS | Root TypeScript, 0 errors | Static only |
| `cd mobile && npm run typecheck` | PASS | Mobile TypeScript, 0 errors | Static only |
| `npm run lint` | PASS WITH WARNINGS | 0 errors, 85 warnings | Static only |
| `npm run build` | PASS | Next 15.5.20 Turbopack production build completed | Web/API compilation only |
| `npm run db:manifest` | PASS | 92 canonical migrations, 110 historical entries, 2 preserved conflicts | Migration inventory only |
| `npm run db:contract` | FAIL | 232/233 pgTAP assertions passed; canonical contract test 9 reported one unvalidated public constraint. Memory local-first sync, client ordering, and monotonic reads files passed. | Local Supabase policy/SQL runtime; no phones |
| `npm run test:e2e` | FAIL | 4 passed, 2 failed, 50 skipped | Browser smoke only; both failures expect the removed password-login UI, not Table Memory |
| `git diff --check` | PASS | No whitespace errors | Change hygiene only |

The ten broad-suite failures are source-contract assertions in account deletion/review media, media crop/pipeline, Explore animation, Profile error/safe-area/layout, and mobile post flow. The exact failing names are retained in `/private/tmp/table-memory-npm-test-after.log`. They were present before the targeted fix and are outside Table Memory, but a release cannot describe the repository as fully green.

The broad repository, Playwright, build, and schema suites were not rerun for the resumed physical pass, per the audit instruction. No new failure implicated those surfaces. Only the focused invitation lifecycle regression was rerun after the targeted SQL fix.

The Playwright failures are `login page supports email sign-in flow` in desktop Chromium and mobile emulation. The test still expects a password field and `Sign In →`, while current production auth is Google plus email OTP. Fifty credential-dependent tests were skipped.

The local pgTAP failure is `no public constraint is unvalidated`. All three Table Memory pgTAP files in that run passed: `0009_shared_memory_local_first_sync.sql`, `0010_shared_memory_client_ordering.sql`, and `0011_shared_memory_monotonic_reads.sql`.

An initial `node scripts/run-supabase.mjs status -o json` invocation produced no output and was interrupted. This is not reported as a pass. Local stack availability was subsequently proven through healthy Supabase containers and the executing pgTAP suite.

## 6. Manual two-phone test instructions

Use this exact procedure to complete the `NOT EXECUTED` rows. Do not use existing personal room content; create synthetic audit content and delete it only after evidence is complete.

1. Install the same signed build/release ID on both phones. Record app version, commit/release ID, OS, model, serial alias, time zone, network type, and notification permission.
2. Authenticate Phone A and Phone B as two distinct disposable accounts. Record only pseudonyms (`User A`, `User B`) in artifacts. Confirm both accounts are complete and neither blocks the other.
3. Start synchronized screen recordings showing device clocks. Capture sanitized Logcat/telemetry containing request IDs, client IDs, server IDs, cursor values, counts, status, and timing, but never message bodies, signed URLs, tokens, emails, or usernames.
4. Create one uniquely named room on A. Execute A-01 through A-05 before adding other data. After each step, query the server with a service-side sanitized script for counts and stable IDs: one room, one membership per user, one invite lifecycle row, and matching metadata.
5. Execute B and C using unique synthetic message labels. For rapid/simultaneous cases, use a countdown and both recordings. Capture the optimistic client ID and final server ID on each phone. Repeat the key response/echo cases through a proxy or deterministic debug network harness, never arbitrary sleeps.
6. Execute D in every receiver state. Capture the in-app notification row/job/ticket/receipt IDs where applicable, OS notification shade, tap destination, and exact-chat suppression. Deny permission once and verify in-app unread independently.
7. Execute E after clearing prior unread state. Record room summary unread, global unread, visible row boundary, RPC acknowledged timestamp, and both phones after each action. Add a second session for User B if available.
8. Execute F with synthetic image/video fixtures whose byte size, dimensions, orientation, duration, and checksum are recorded. Capture upload intent, asset/job state, canonical photo/message IDs, progress, failure/retry, worker completion, URL renewal, and unauthorized nonmember attempts.
9. Execute G through J with sanitized server snapshots after every concurrency/retry case. Counts alone are insufficient for duplicate checks; compare primary keys plus logical client operation IDs and per-user rating rows.
10. For K, use ADB/network controls to take B offline, perform the listed A actions, force-stop B while still offline, relaunch, and reconnect. Record last committed local cursor before disconnect and every catch-up page/cursor after reconnect. Repeat with Wi-Fi/mobile-data transitions and simultaneous reconnect.
11. For L through N, collect SQLite row counts and hashed owner-scope path (not the raw account identifier), cold/warm room timing, membership-denial HTTP/RPC status, subscription teardown, old-link behavior, and page cursors/visible range before and after prepend/restart.
12. For O, run the checked-in performance profile on a release/profile build, not a development bundle. Report p50/p95 cached/uncached open, action-to-visible latency, first optimistic layout, request/subscription counts, frame jank, PSS baseline/plateau, SQLite query time, and 30-cycle leak/soak results on both devices.

Minimum evidence for every matrix row is: both screen recordings or screenshots, action and observation timestamps, sanitized client/server entity IDs, authoritative server count/state, relevant local SQLite count/state, Realtime/catch-up cursor, notification/job identifiers where applicable, network/app lifecycle state, and explicit PASS/FAIL/NOT EXECUTED. A screen-only observation is insufficient for exactly-once/data-loss claims.

## 7. Findings ranked by severity

| Severity | Finding | Status |
| --- | --- | --- |
| P1 | Activity push was client-triggered after commit and direct-to-Expo, bypassing durable jobs and exact-chat suppression. Database migration `202608030002` now owns deduplicated notification/job creation atomically; the legacy mobile route is a compatibility no-op and exact-chat foreground presentation is suppressed. | Fixed in source/database; physical push retest BLOCKED |
| P1 | Media and dish activity had no unread contract. Migration `202608030001` adds per-surface monotonic read positions and server-authoritative counters; the mobile UI exposes and clears only the active tab's counter. | Fixed in source/database; physical two-phone retest BLOCKED |
| P1 | Offline outbound text physically required `Retry` after reconnect. The durable state machine now queues automatically, retries on reconnect with stable identity/bounded backoff and adopts server commit time after acknowledgement. | Fixed in source; physical two-phone retest BLOCKED |
| P1 | Dish and stop creation are direct inserts without stable client operation IDs/outbox. Ambiguous timeout/retry can duplicate; offline/restart retry is unsupported (`mobile/src/services/memories.ts:2050,2120`). | Confirmed, open |
| P1 | Owner removal of another member is absent from the mobile mutation surface; only self-leave exists (`mobile/src/services/memories.ts:1924`). | Deferred from this remediation run |
| P1 | OS push could not be certified: Phone B's installed development APK lacks Firebase app options, Firebase initialization fails, no token is registered, and activity notification requests consequently send to zero recipients. | Validation-build/environment acceptance blocker, open |
| P1 | Hosted video processing returned `moderation_service_unavailable`, then final attachment rolled back because the activity-notification trigger used forbidden `chr(0)` text while hashing push-job dedupe input. The worker was deployed; migration `202608030004` uses a safe separator. The same ready Phone A asset then attached and played once. | Fixed and physically passed on Phone A; Phone B/two-phone retest BLOCKED |
| P2 | Join normally warms SQLite before navigation, but a local warm failure is caught and the accepted mutation resolves; the pre-entry snapshot guarantee is therefore conditional (`mobile/src/hooks/useMemories.ts:2444-2463`). | Confirmed, open |
| P2 | Activity push opens the room but carries no message ID/anchor; relevant-message reveal is unsupported (`mobile/src/providers/PushNotificationBootstrap.tsx:100-116`). | Confirmed, open |
| P2 | Place creation called the activity notifier with `kind: "dish"`. All client activity-notifier calls were removed when notification ownership moved to the database. | Fixed in source/database |
| P2 | Local schema contract has one unvalidated public constraint and the broad/Playwright suites are not fully green. | Confirmed repository risk, open |
| P3 | Prior release performance evidence reports non-plateauing +91 MiB PSS and 34.57% jank; cached/open cross-device timing was not re-proven in this audit. | Confirmed existing blocker, open |
| P3 | Memory code remains concentrated in very large screen/hook/service files; lint reports Memory-specific unused/dependency/accessibility warnings. | Maintainability risk, open |

No P0 cross-account leak, authorization bypass, or permanent data-loss path was found in the audited code or executed tests.

### 7.1 Critical correctness guarantees

| # | Guarantee | Status | Evidence and reasoning |
| --- | --- | --- | --- |
| 1 | Every client-generated mutation has an idempotency key. | Partially guaranteed | Room create now `memories.ts:962-972`; text `:1947-1974`; media batch has stable IDs. Dish, stop, rating/edit/leave direct writes do not all carry a client operation key. |
| 2 | Optimistic IDs can be mapped to server IDs. | Guaranteed for optimistic text/media | Reconciler keys by client/server identity (`memoryMessageReconciliation.mjs:30,77-99,165`); SQLite indexes client/server IDs (`memoryOfflineStore.ts:298-305`). |
| 3 | Mutation response and Realtime echo are deduplicated. | Guaranteed for text/media | Identity merge plus 120 order permutations and duplicate HTTP/Realtime tests pass. Other entities use server primary IDs and upsert patches. |
| 4 | Realtime can arrive before mutation response. | Guaranteed | Reverse-confirmation permutations pass; merge accepts either order. |
| 5 | Realtime events can arrive out of order. | Guaranteed | Stable client order keys and `sortMemoryMessages` (`memoryMessageReconciliation.mjs:45`) plus permutation tests. |
| 6 | Duplicate Realtime events are harmless. | Guaranteed | Upsert/merge by identity and focused duplicate-event tests pass. |
| 7 | Missing Realtime events are recovered through catch-up. | Guaranteed | `shared_memory_room_sync_v2`, transactional cursor pages, subscription/reconnect reconciliation (`useMemories.ts:192,2242`; `MemoryRoomSyncBootstrap.tsx:48-56`). |
| 8 | Read positions never move backward. | Guaranteed | RPC uses `greatest(existing, excluded)` and clamps future timestamps (`202607290001_shared_memory_monotonic_reads.sql:5-45`); pgTAP passes. |
| 9 | One rating per user per dish. | Guaranteed | Database unique `(dish_id, rated_by)` (`202606160001_shared_memory_dish_ratings.sql:11`) and upsert. |
| 10 | Membership checks are server-side. | Guaranteed | RLS/member-scoped RPCs on reads and writes; Phase 1/2 security tests and memory pgTAP pass. |
| 11 | Storage authorization is not based only on possessing a room ID. | Guaranteed | Private bucket issuance/read is membership-scoped, integrity guards bind room/uploader/message, URLs expire; 40 focused gates pass. |
| 12 | Local data is isolated by authenticated user. | Guaranteed | Owner directory (`accountFileStore.ts:24,57`), generation guards, deletion boundary, and account-switch tests. |
| 13 | Membership removal invalidates active access. | Partially guaranteed | Server RLS revokes authority and access-loss paths delete all local tables (`useMemories.ts:182`; `memoryOfflineStore.ts:1124`). Owner removal UI and physical active-channel teardown are unproved. |
| 14 | Pagination and Realtime coexist safely. | Guaranteed by deterministic tests | ID tie-breaker cursors, merge by identity, cursor >800 and live/paging tests. Physical scroll stability remains unexecuted. |
| 15 | All room tabs derive from compatible canonical state. | Partially guaranteed | Detail/chat/media are separate keys but Realtime patches each and cursor sync persists the full room. Physical no-stale-tab proof is missing. |
| 16 | Rapid sends do not share stale input. | Guaranteed by deterministic/UI source tests | New client identity per send, screen overlay, and rapid-send suite pass; physical extreme presses remain unexecuted. |
| 17 | Retry after timeout cannot duplicate data. | Partially guaranteed | Fixed for room create; guaranteed for message/media identities and rating upsert. Dish/stop direct inserts remain unsafe after ambiguous timeout. |
| 18 | Restart cannot lose an acknowledged mutation. | Partially guaranteed | Server authority plus cursor catch-up recovers committed rows; text/media outbox is durable. Non-outbox offline actions and all physical kill windows were not proven. |
| 19 | Local snapshots are created at room creation and join. | Partially guaranteed | Create seeds complete snapshot before navigation after response (`useMemories.ts:2289-2315`). Join normally warms before navigation, but local warm failure is swallowed. Neither snapshot exists before the initial create server confirmation. |
| 20 | Background sync covers rooms not currently open. | Guaranteed while authenticated app runtime is active | App-level global channel and summary owner plus bounded loaded-room cursor sync (`MemoryRoomSyncBootstrap.tsx:14-61`); terminated/offline recovery begins at next launch/reconnect. |

## 8. Confirmed defects

### P1: Table Memory activity delivery is not durable or mutation-owned

Root cause: text/media/dish code commits the primary operation, then starts a fire-and-forget `notifyMemoryRoomActivity` request from the sender's mobile process (`mobile/src/services/memories.ts:451,1979,2182,2307`). The notification route fetches Expo directly with a five-second deadline (`app/api/mobile/memories/notify/route.ts:25,53`) and completes request idempotency only after the provider accepts the send. It does not insert a `notifications` record, enqueue `push_delivery_jobs`, store Expo tickets/receipts, or retry provider failure. It also has no recipient presence/exact-chat signal.

Impact: a sender crash/network loss after the room mutation commits can lose the activity push; provider/transient failure has no durable recovery; exact-chat recipients receive unnecessary push; and in-app activity versus push cannot share a single durable dedupe identity. This conflicts with the repository's Phase 7 durable push architecture (`lib/server/push-delivery.ts:111-151`).

Required fix: create a server-owned Table Memory activity event with a deterministic operation identity inside, or transactionally adjacent to, each authoritative mutation. Insert recipient notification/event rows and durable delivery jobs, add exact-chat/presence suppression as policy, and carry an optional message ID/anchor. The change needs migration-level uniqueness and worker tests; simply replacing the final `fetch` in the current client-triggered route would not close the post-commit crash window.

### P1: Dish/place retry and offline semantics are not idempotent

Root cause: `addMemoryDish` and `createMemoryStop` call `.insert(...)` directly after a client-side membership assertion. They do not carry a stable client ID, do not use the API idempotency ledger, and do not write a durable outbox before attempting the network. The dish table also has no operation-identity uniqueness; same-name semantic behavior is intentionally unconstrained.

Impact: when the server commits but the client times out, retry can create a second dish/place. Offline creation fails rather than remaining as a durable pending action. Concurrent same-dish behavior has no explicit product contract.

Required fix: define operation identity separately from dish-name semantics, add server uniqueness for that identity, route creation through idempotent server operations, and add owner-scoped outbox/restart recovery if offline creation is intended.

### P1: Owner member removal is missing

Root cause: the service exposes self-leave and participant invite, but no owner-scoped removal mutation or UI control. Existing member-delete RLS is specifically self-leave (`202606140001_shared_memory_privacy_hardening.sql:31-37`).

Impact: M-02 and removal-during-active-room acceptance cannot be completed. Server-side revocation behavior can be tested only through fixtures/admin mutation, not the product flow.

Required fix: an owner-only, block-aware removal RPC/API with transactional membership/read/invite consequences, notification cancellation, active access revocation, local purge convergence, and reinvite semantics.

### P2: Join snapshot guarantee is conditional

The join RPC can succeed while `warmMemoryRoomOfflineFirst` fails. The hook logs/captures the warm error and resolves, so the notification screen can navigate to a cold room. This avoids falsely reporting a server join failure, but it does not satisfy the stronger requirement that SQLite is definitely ready before entry. A safe improvement would return an explicit `joined-but-local-warm-failed` state and keep the room on a retryable loading shell until a server read or durable write succeeds.

### P2: Notification deep link lacks message anchoring

Push routing validates the recipient and opens `/memories/{roomId}`, but activity payloads contain no message ID. Message notifications cannot reveal/scroll to the relevant message. Old/invalid target safety exists at the protected route layer, but the requested message-target experience is unsupported.

### P2: Place activity is mislabeled as dish

`createMemoryStop` calls `notifyMemoryRoomActivity({ kind: "dish", ... })` at `mobile/src/services/memories.ts:2094`. Current copy is generic, so users may not see wrong text, but telemetry/idempotency classification is wrong and would become visible once copy or notification preferences are action-specific.

## 9. Suspected risks

- The global and active-room channels can both observe the same event. Current reducers are idempotent, but future entity handlers must preserve identity-based patching.
- Separate detail/chat/media QueryClient caches are kept compatible by a large set of manual patches. A missed future patch could create a stale tab until cursor reconciliation.
- Creation idempotency retained by the new coordinator is process-memory state. A normal same-process retry is protected; a process death between server commit and response can lose the retained key and still needs a durable pending-create record.
- The join warm catch may leave an accepted room without its expected first-frame snapshot when local storage is full/corrupt/unavailable.
- Direct rating upsert is database-idempotent, but an offline UI has no durable pending state; users may believe a tap was accepted when it was not unless the error surface remains clear.
- Existing room metadata editing is narrower than the requested matrix. Unsupported fields should be declared explicitly so clients do not imply editability.
- Push token/provider behavior, notification permission denial, old signed media URLs, and active subscription teardown after removal were not physically exercised.
- `mobile/app/memories/[id].tsx`, `mobile/src/hooks/useMemories.ts`, and `mobile/src/services/memories.ts` are unusually large, increasing regression risk even though current focused tests are strong.

## 10. Fixes implemented

### Stable room-creation retry identity

Root cause: `authorizedApiHeaders` generates a new `Idempotency-Key` for every POST invocation. The room-create UI retry called `createMemoryRoom` again with the same logical request but a different key, so the server idempotency ledger could not return the prior committed response.

Files changed:

- `mobile/src/services/memoryRoomCreateIdempotency.ts`
- `mobile/src/services/memories.ts`
- `tests/table-memory-durable-replica.test.mjs`

Why the fix is correct: normalized room-create payloads are fingerprinted in memory. An identical pending payload reuses its first generated request key. The key is sent explicitly, overriding the generic per-POST key. The coordinator removes the entry only after a successful response, so a timeout/failure followed by an ordinary same-process retry reaches the same server idempotency record. After success, an intentional identical second room gets a new key. The pending map is bounded to 32 fingerprints.

The fix does not change UI or server/RLS behavior. It does not claim durable retry across process death; that remaining risk is documented above.

Manual verification still required: proxy a successful create response into a client timeout, tap retry without killing the process, and prove one server room/owner membership plus the same returned room ID. Then repeat with a process kill to characterize the documented remaining gap.

No notification, dish, place, owner-removal, RLS, storage, media-worker, or UI redesign was implemented because those require explicit server contracts and broader migration/runtime proof.

### Invite/join named-conflict fix

The initial physical join returned a generic 500. Sanitized server inspection isolated PostgreSQL ambiguity inside the deployed `respond_to_shared_memory_invite` function: because the RPC returns a column named `room_id`, the unqualified `ON CONFLICT (room_id, user_name)` could refer to either the PL/pgSQL output variable or membership columns.

Files changed:

- `supabase/migrations/202608020003_fix_memory_invite_join_conflict.sql`
- `tests/table-memory-invitation-lifecycle.test.mjs`

The migration changes only the conflict target to the existing named membership constraint, preserving the RPC's locking, identity, RLS, and idempotency behavior. It was deployed with the linked Supabase migration workflow. The focused regression passed 7/7, and the same invite was retried on Phone B: the room opened once, A's member list updated live, and both phones later restored the two-member room after force-close.

## 11. Regression tests added

`room creation retries keep one idempotency key until the request succeeds` in `tests/table-memory-durable-replica.test.mjs:58` deterministically proves:

- identical payload retry after an ambiguous failure reuses the key;
- key generation occurs once while pending;
- success clears the pending identity;
- an intentional later identical room gets a new key;
- different payloads get different keys;
- bounded capacity evicts the oldest pending fingerprint.

Executed result: `node --test tests/table-memory-durable-replica.test.mjs` — 12 passed, 0 failed. The post-change `npm run test:memory-hardening`, root/mobile typechecks, lint, and `git diff --check` also pass under the results described in section 5.

The resumed join fix is covered by the focused invitation-lifecycle contract test, including use of the named constraint rather than an ambiguous column-list conflict target. Executed result: `node --test tests/table-memory-invitation-lifecycle.test.mjs` — 7 passed, 0 failed.

Existing deterministic coverage already supplements, but does not replace, physical testing for mutation-response/Realtime order, duplicate and out-of-order events, rapid and simultaneous messages, optimistic reconciliation, interrupted cursor persistence, offline message outbox restart, monotonic reads, account-switch isolation, long cursor catch-up, media state/retry, and durable generic push jobs. Clear missing deterministic areas are Table Memory activity notification ownership/dedup, dish operation identity/concurrency, owner removal during subscription, reply-to-optimistic reconciliation as a standalone behavioral harness, and rating offline concurrency.

## 12. Security and RLS findings

- Primary room/entity tables have RLS enabled and member-scoped read/write policies. UUID knowledge does not grant room access.
- Message guards derive/validate author membership, length, block relationships, and same-room reply references.
- Private media guards bind the storage path to room/uploader, bind media to a same-room message, require a valid upload intent/finalization path, and restrict signing/renewal to members.
- Dish ratings require room membership, correct dish-room linkage, current-user ownership, and one row per user/dish.
- Read acknowledgements require membership and are monotonic.
- Invite response derives the actor, locks/idempotently transitions the invite, and relies on unique membership.
- Account-scoped local storage and generation guards prevent a stale asynchronous result from populating a new user's cache.
- Authoritative room access loss removes summary, snapshot, messages, photos, outbox, and sync cursor from local SQLite (`memoryOfflineStore.ts:1124-1133`).
- Exact Phase 1/2 security/media tests passed 40/40. The local Table Memory pgTAP sync/order/read files passed. The broader local schema contract still reports one unrelated unvalidated public constraint and must be corrected before whole-system release.

No P0 issue was reproduced or proven. Because post-removal adversarial runtime cases were not executed, security acceptance remains evidence-incomplete even though the policy design is strong.

## 13. Offline and reconnect findings

The correctness design is appropriate for missed Realtime delivery:

- SQLite provides durable summaries, snapshots, messages, photos, cursors, and text/media outbox state.
- Bootstrap uses the server snapshot when no cursor exists and `shared_memory_room_sync_v2` afterward.
- Each delta page and next cursor are committed together. An interrupted page does not advance the durable cursor.
- Global and active-room subscription success, app resume, and network reconnect schedule authoritative reconciliation.
- Cursor pages are bounded; a checked-in harness converges through more than 800 changes and resumes from the last committed page.

Coverage is incomplete by mutation type. Text/media have durable pending identities and retry state. Dish, place, rating, room-detail, membership, and notification activity operations do not share a generic offline mutation log. Rating server retry is idempotent but not locally durable; dish/place retry is neither locally durable nor operation-idempotent.

A physical temporary network disconnect/reconnect was completed on Phone B for text. While offline, B's outbound row remained visibly `Not sent / Retry`, A's inbound message was absent, and no false success was shown. Re-enabling connectivity caused A's inbound message to appear automatically without refresh. B's explicit Retry then produced exactly one row on A and reconciled locally. This passes the executed text path, but force-stop-while-offline, device reboot offline, Wi-Fi-to-mobile transition, simultaneous reconnect, and the non-text mutation matrix remain blocked.

## 14. Notification findings

Invitation and added-to-room notifications use the general notification model, preference category, recipient binding, in-app inbox, and durable push infrastructure. The push bootstrap rejects payloads for a different account, deduplicates handled taps within the running process, opens invite requests in the requests inbox, and opens Table Memory entities in the correct room.

General Table Memory activity is a separate older path. It uses generic privacy-preserving copy and excludes the sender, respects memory/push settings, block relationships, and request-level idempotency. Those are positive controls, but it still sends directly to Expo and has no durable event/job/receipt. Request idempotency is keyed only by `{kind, roomId}` plus the caller key; message uses its stable ID, while dish/place/media callers do not all supply a durable operation identity.

Phone B had Android notification permission, but its installed development APK was not Firebase-provisioned. Read-only APK inspection found none of the standard Firebase app-option resources, and sanitized Firebase-only Logcat reported unsuccessful default initialization because no options were found. The safe server query consequently showed zero total and zero active push tokens, and activity sends returned zero recipients sent. In-app and catch-up behavior passed for exact Chat, Table, elsewhere, background, and terminated states, but no OS push/suppression/content/tap/provider-retry case can be marked passed without a correctly provisioned validation build and deliverable token. There is still no active-exact-chat suppression contract or message anchor. These are release blockers, not optional polish.

## 15. Local persistence findings

The local model is an owner-scoped durable replica, not a TTL cache. It does not age-prune room history. Summaries allow fast list restoration; snapshots hold complete room structure; messages/photos are normalized for paging/dedup; sync cursor records server progress; and the outbox separates pending message identity from the server row.

Both authenticated phones provided physical persistence confirmation. After force-stop and cold launch, each restored its own authenticated feed. Navigating to Memories restored the same room, two-member state, `TMR Road`, both dishes, shared aggregate, and distinct personal ratings (A=5, B=4) without clearing data or pulling to refresh. This proves two-account session/data survival for the executed state. It does not prove immediate cached-room timing, device reboot/offline open, account switching, reinstall, kill-during-pending-send/upload, signed-URL renewal, or migration behavior on physical devices.

The join path's caught warm failure and process-memory-only create retry identity are the two main persistence caveats found in this audit.

## 16. Performance findings

Static/runtime design positives:

- bounded summary/chat/media/sync pages and ID tie-breaker cursors;
- one app-level global subscription plus one active-room subscription rather than a subscription per tab;
- inactive Media/Dishes panes unmount while cached data remains;
- SQLite-first room/chat/media reads;
- sequential media processing/upload work to cap pressure;
- signed URL renew flights and stable media IDs;
- incremental message merge and bounded virtualized lists.

Observed in this audit: Phone A cold Android activity start was 1.239 seconds and server summary/cursor reads returned HTTP 200. This is not a cached-room useful-frame metric and must not be compared with the release budgets.

Existing repository evidence remains failing: `docs/performance/MEMORY_ROOM_RELEASE_ACCEPTANCE_2026-07-28.md` reports +91 MiB PSS without a plateau and 34.57% jank on one physical device, with missing shaped-network/media-kill/two-device evidence. Later native-renderer work improved relative performance but still missed unchanged frame and memory-growth budgets, as recorded in `docs/security/CHAT_PRODUCTION_STATUS.md`.

Required closure: two-device release/profile measurements, cached and uncached room opens, 30-cycle subscription/memory plateau, long-history scroll/prepend, simultaneous text/media activity, worker completion, network transitions, and request/subscription/write counts.

## 17. Remaining blockers

1. Deploy the current branch so `/api/health` reports migration/build head `202608030004`, then upload a fresh video from Phone B and verify canonical Chat/Media convergence and playback on both phones. The corrected Render worker and database migration are already live, and the same Phone A video passed.
2. Provide the environment-owned Android Firebase configuration through `GOOGLE_SERVICES_JSON` or `EXPO_ANDROID_GOOGLE_SERVICES_FILE`, build/install the validation APK, register a deliverable token, then repeat exact-chat, other-tab, elsewhere, background, terminated, denied-permission, dedupe and cold-tap cases.
3. Reconnect Phone B and physically retest automatic offline text replay/timestamp semantics, media/dish unread acknowledgements, durable notification creation/dedup, restart/reconnect and no-refresh behavior. The live migrations and focused tests do not substitute for this.
4. Add client operation identity and, if product-supported, durable offline outboxes for dish/place and other non-message mutations.
5. Run remaining in-scope grouped variants after the three blockers above close. Room/place editing and owner removal/reinvite are explicitly deferred from this remediation run.
6. Pass release performance budgets on both devices with a plateau/soak result and resolve or formally disposition the pre-existing broader repository gates before release.

## 18. Final recommendation

Do not release Table Memory Room as two-device production-ready yet. Two distinct authenticated phones previously passed the core room/join, chat/reply, in-app chat unread/catch-up, image, dish, independent rating, place-add, no-refresh and force-close persistence flows. The invite/join 500 was fixed narrowly, deployed and passed its two-phone retest.

The blocker-remediation code now provides the shared local video poster/stages and timing, automatic durable offline text replay with commit-time ordering, per-tab media/dish unread state, server-owned durable activity notifications, exact-chat foreground suppression, worker configuration readiness and environment-owned Firebase build wiring. The worker and migrations are live, focused checks pass, and the corrected Phone A video attachment/playback path has a physical pass. The verdict cannot be upgraded because the Firebase-provisioned validation build is unavailable, Phone B is disconnected, and the corrected video/offline/unread/push paths have not completed their required two-phone retest. Existing performance and non-text offline/idempotency gates also remain.

NO-GO

## 19. Focused place/dish-delete/rating continuation (2026-08-03)

This addendum supersedes the earlier statements that place editing/deletion, Chat dish deletion, and a durable rating outbox were not implemented. It does not supersede any physical PASS/FAIL result from the earlier run and does not convert automated evidence into a physical PASS.

Implemented in the focused continuation:

- Place-card long press now reveals exactly Edit/Delete at the right side of the card. Edit reuses the canonical add-place screen in `Update` mode with current values; update/delete are optimistic, rollback-safe, idempotent, member-authorized, persisted to SQLite, and protected against stale refresh resurrection.
- Chat dish cards now participate in the existing selection state. A dish selection exposes only Delete. Canonical deletion optimistically updates Chat, Dishes, the open detail source, summaries, and SQLite, with exact rollback and server-side current-member authorization.
- Ratings now patch one canonical room cache immediately across Chat, Dishes, and the detail sheet. A latest-intent coordinator uses a 140 ms persistence debounce, one in-flight request per room/dish/user key, stable mutation identity, monotonic sequence protection, direct Realtime rating-set merge, deterministic aggregate recomputation, bounded retry, permanent-failure rollback, and a durable one-row-per-dish SQLite outbox.
- Migration `202608030003_table_memory_entity_mutations.sql` was applied to the linked hosted database. The migration ledger shows matching local and remote `202608030003` entries.
- Focused tests pass 7/7; root and mobile typechecks pass; focused lint has zero errors; migration-manifest validation passes. The deterministic rapid test issued exactly **1 API request for 5 taps** and persisted only rating 5.
- A local unauthenticated direct endpoint probe returned HTTP 401. Authenticated nonmember, revoked-member, and allowed-member runtime probes still require the unavailable A/B sessions and remain BLOCKED.

Current physical environment:

- `adb devices -l`: zero devices
- `adb mdns services`: zero wireless-debug devices
- `xcrun xctrace list devices`: Mac and simulators only; no physical iPhone/Android devices
- Metro ports 8081 and 8082: listening, with no established phone connection at inspection time

| Focused physical case | Result | Reason |
| --- | --- | --- |
| Place long press, exact actions, dismissal | BLOCKED | Neither named Motorola phone is connected |
| Edit prefill, Cancel without mutation, Update without duplicate | BLOCKED | Neither phone is connected |
| Place peer convergence, force-close persistence, delete persistence | BLOCKED | Two-phone execution unavailable |
| Chat dish long press shows only Delete | BLOCKED | Neither phone is connected |
| Dish Chat/Dishes/peer/restart convergence and repeat delete | BLOCKED | Two-phone execution unavailable |
| Slow/rapid/random ratings on Chat, Dishes, and detail sheet | BLOCKED | Physical input/visual latency cannot be observed |
| Simultaneous A/B rating and aggregate | BLOCKED | Two-phone execution unavailable |
| Offline change, pending restart, reconnect, no-refresh convergence | BLOCKED | Two-phone execution unavailable |
| Physical taps/API request count/render count | BLOCKED | Automated result is 5:1; no physical trace exists |

The focused report is `docs/testing/TABLE_MEMORY_ROOM_ENTITY_MUTATION_AND_RATING_IMPLEMENTATION_2026-08-03.md`.

The final audit verdict remains **NO-GO**. A GO verdict remains prohibited until both named physical phones converge on every core synchronization, notification, persistence, offline recovery, media, dish, rating, membership, and newly added entity-mutation case with no remaining P0/P1 issue.

## 20. Post-Render Phone A video retest (2026-08-03)

The Render Blueprint was manually deployed and reported Live. Phone A remained authenticated and connected with the Metro and local-API reverse tunnels present.

Exact reproduction:

1. Open `TMR AUDIT 0802 2151` on Phone A and choose a five-second gallery video.
2. Confirm the full-screen preview, then tap `Post to Room`.
3. Observe the local poster and `Processing` state.
4. Wait for hosted processing and retry the failed row.
5. Observe that the row remains `Not sent` with `Retry` and `Cancel`.

Result: **FAIL**. The preview is a physical **PASS**. The source upload and Render processing are also successful: the owner-scoped recovery record reached `ready` with a canonical MP4. The subsequent `POST /api/mobile/memories/[roomId]/media` returned HTTP 500, so the processed asset was not attached to the canonical room message. Retrying reused the ready upload rather than retransmitting the video, but the same attachment request failed.

Initial deployment hypothesis: the public health response from one known hosted Vercel API reported an older migration/build head. A later Preview deployment still reproduced the failure and disproved release skew as the attachment root cause. Section 21 records the safe telemetry, exact database fault, targeted migration and successful physical retest.

Evidence: `/private/tmp/foodreview-video-preview.png` and `/private/tmp/foodreview-video-upload-state.png`. Sanitized client diagnostics recorded HTTP 500 `temporary_failure`; no credential, signed URL, storage path, message body, or private account identifier is included.

## 21. Phone A final video-attachment root cause and retest (2026-08-03)

The final room-media API failure was reproduced against a current Preview after the worker had already produced a ready canonical MP4. Safe stage telemetry classified the HTTP 500 as PostgreSQL code `54000` during `attach_shared_memory_media_assets_v2`. A temporary sanitized database reproduction returned `null character not permitted` without exposing a credential, identity, room ID, asset ID, storage path or message body.

Root cause: `enqueue_table_memory_activity_v1()` in migration `202608030002_table_memory_notification_outbox.sql` constructed push-job dedupe input with `notification_id || chr(0) || token_id`. PostgreSQL text cannot contain NUL. For a room member with an active push token, the trigger exception rolled back the message insert; media attachment failed because it creates the canonical room message before linking the photo. The same trigger could also roll back normal Table Memory chat writes under that recipient-token condition.

Targeted fix: migration `202608030004_table_memory_notification_null_separator_fix.sql` recreates only that trigger function and uses `notification_id || ':' || token_id` before hashing. The linked migration push applied only `202608030004`. Focused verification passed 41 tests, including 8 Table Memory blocker regressions, migration-manifest validation for 97 canonical migrations/115 historical entries, and `npm run verify:deploy-preview`.

Physical retest on Phone A:

1. Keep the already-processed failed video row; do not upload the source again.
2. Apply migration `202608030004` to the linked database.
3. Tap `Retry` on the failed row.
4. Observe `POST /api/mobile/memories/[roomId]/media` return HTTP 200.
5. Verify the asset is consumed and linked to one approved canonical room photo/message with complete client-order metadata.
6. Open the resulting 9:00 pm video row and observe the canonical video render in the room media viewer.

Result: **PASS on Phone A** for preview, hosted processing, idempotent same-asset retry, final canonical attachment and playback. Evidence: `/private/tmp/foodreview-video-linked-after-fix.png`. The full two-device video/Chat/Media case remains **BLOCKED**, because ADB currently exposes only Phone A (`ZA223JVWG7`) and no Phone B result was observed after the fix.

The final audit verdict remains **NO-GO**.

## 22. Phone A dish-rating identity fix and physical retest (2026-08-03)

Phone A was reconnected and authenticated in `TMR AUDIT 0802 2151`. Phone B was not exposed by ADB, so simultaneous and peer-convergence cases remain blocked.

Initial reproduction on `B-DISH-01`:

1. Open Dishes and tap a star on the previously unrated dish.
2. Observe the optimistic personal rating and two-rater aggregate.
3. Wait for the API response.
4. Observe `Invalid dish rating`, rollback to no personal rating/one rater, and the old Chat card aggregate.

Root cause: `memoryDishRatingCoordinator.ts` used `createRequestId()` for `clientMutationId`. That helper intentionally returns a 64-character hexadecimal request nonce, while the entity route validates a UUID and the database RPC accepts a UUID. The request therefore failed HTTP 400 before the RPC. The focused test mock had incorrectly returned a UUID from its `createRequestId` stub and masked this runtime contract mismatch.

Targeted fix: export the existing secure UUID-v4 generator from `installIdentity.ts`, use `createUuid()` only for dish-rating mutation identity, and make the regression mock expose only `createUuid`. The rapid-tap test now asserts that the transmitted `clientMutationId` is UUID-v4 shaped. No rating API, schema or unrelated UI behavior was changed.

Verification:

- Focused Table Memory/entity tests: **15/15 PASS**.
- Mobile TypeScript check: **PASS**.
- Phone A slow change: `B-DISH-01` persisted at 2/5 without rollback.
- Phone A rapid input: 1→2→3→4→5 settled at the latest 5/5 value.
- Dishes showed Gnana Prakash + Phantom, two ratings and personal 5/5.
- Chat showed the same dish at aggregate 4.0 by two users without refresh.
- After force-close, development-server reconnect and room reopen, Dishes still showed personal 5/5 and two ratings.

Failure evidence: `/private/tmp/tmr-rating-chat-stale-phone-a.png` and `/private/tmp/tmr-rating-dishes-5-phone-a.png`. Successful retest evidence: `/private/tmp/tmr-rating-fixed-chat-phone-a.png` and `/private/tmp/tmr-rating-fixed-reopen-phone-a.png`.

Result: **PASS on Phone A** for slow rating, rapid latest-intent behavior, Dishes/Chat consistency, no-refresh convergence and force-close persistence. **BLOCKED on Phone B** for the corrected build, including simultaneous A/B rating and live peer aggregate verification. The final audit verdict remains **NO-GO**.

## 23. Dish ownership, reply and immediate-rating continuation (2026-08-03)

Four focused interaction defects were addressed without changing unrelated Table Memory Room behavior:

1. Dish deletion is now creator-only in both layers. Long-press selection exposes Delete only when the authenticated username matches the dish `added_by` value, and the entity DELETE route independently returns HTTP 403 when another member attempts deletion.
2. A sent dish card can now be selected as a reply target. The composer reuses the existing reply flow with a `Dish: <dish name>` preview. The message API and database write guard accept only a message or dish UUID belonging to the same room, and reply references are cleared if their target is later deleted.
3. Tapping the currently selected star now clears the user's rating. A null database rating is retained as a monotonic tombstone so an older delayed request cannot resurrect the cleared value; read mapping excludes tombstones from the aggregate and personal rating.
4. Star selection is rendered from component-local state immediately on Chat, Dishes and the detail sheet. Persistence is debounced for 300 ms and the latest intent replaces earlier queued intent, so rapid 5→1→3 interaction renders immediately and coalesces database traffic instead of making the UI wait for each response.

Migration `202608030005_table_memory_dish_interactions.sql` was applied to the linked database. The new Vercel Preview reached READY at `https://foodreview-apyzhv26k-gnana-prakashs-projects-2da6e3af.vercel.app`, and `/api/health` returned `ok: true` with `databaseMigrationHead: 202608030005`.

Focused verification completed before the physical attempt:

- Entity-mutation and Table Memory blocker tests: **16/16 PASS**.
- Root TypeScript check: **PASS**.
- Mobile TypeScript check: **PASS**.
- Preview-deployment verification and migration-manifest validation: **PASS**.
- Deterministic rapid-rating regression: multiple rapid intents produce one latest persistence call; the clear-rating regression sends null and removes only the current user's aggregate contribution.

These checks are regression evidence only and are not physical acceptance PASS results.

| Focused physical case | Result | Reason |
| --- | --- | --- |
| Other member's dish long press offers Reply but no Delete | BLOCKED | Phone A disconnected from the USB bus before the new Preview bundle launched |
| Own dish long press offers Reply and Delete | BLOCKED | Phone A disconnected from the USB bus before the new Preview bundle launched |
| Reply to another member's dish, persist and reopen | BLOCKED | Phone A disconnected; Phone B is also unavailable |
| Tap selected star again to clear, aggregate updates and persists | BLOCKED | Phone A disconnected before physical execution |
| Rapid 5→1→3 star input feels immediate and settles at latest value | BLOCKED | Phone A disconnected before physical input/latency observation |
| Peer no-refresh convergence for reply/rating/clear | BLOCKED | Phone B is not exposed by ADB |

Connection evidence at the attempt: Phone A `ZA223JVWG7` appeared once in `adb devices -l`, then disappeared. The device runner waited 45 seconds and reported it absent. A subsequent ADB inspection reported zero connected devices.

The final audit verdict remains **NO-GO**. The four cases above must be rerun on the deployed build after Phone A reconnects, followed by Phone B peer-convergence verification; automated evidence cannot upgrade them to PASS.

## 24. Phone A dish-interaction physical retest (2026-08-04)

This retest supersedes the Phone A BLOCKED rows in section 23. Phone A `ZA223JVWG7` was reconnected, the debug application was rebuilt/reinstalled from commit `66721e9`, and Metro was launched with `EXPO_PUBLIC_API_BASE_URL=https://foodreview-apyzhv26k-gnana-prakashs-projects-2da6e3af.vercel.app`. The Preview remained healthy at migration head `202608030005`. ADB exposed only Phone A throughout this run; Phone B peer verification remains blocked.

Executed results in `TMR AUDIT 0802 2151`:

| Focused physical case | Result | Observation |
| --- | --- | --- |
| Other member's dish long press offers Reply but no Delete | PASS | Selecting Phantom's `B-DISH-01` showed `1 selected` and `Reply to selected message`; `Delete selected items` was absent |
| Own dish long press offers Reply and Delete | PASS | Temporary `A-DISH-ACTION-0804-0125` showed both actions; confirmed Delete removed it immediately without refresh or an error |
| Reply to another member's dish | PASS | Composer showed `Phantom` and `Dish: B-DISH-01`; `A-REPLY-DISH-0804-0115` sent successfully with the same preview |
| Dish reply force-close persistence | PASS | After force-stop/cold launch and room reopen, the reply row and dish preview were restored without refresh |
| Tap selected star again to clear | PASS | `B-DISH-01` changed from personal 4/5 and aggregate 3.5/two ratings to no personal rating and Phantom-only 3.0/one rating |
| Rapid 5→1→3 star input | PASS | Two rapid physical taps completed in approximately 0.25 seconds; the UI settled at personal 3/5 and aggregate 3.0/two ratings with no visible rollback |
| Latest rating force-close persistence | PASS | After force-stop/cold launch and room reopen, `B-DISH-01` still showed personal 3/5 and two ratings |
| Peer no-refresh convergence for reply/rating/clear | BLOCKED | Phone B was not exposed by ADB; no two-device observation was possible |

Physical evidence:

- `/private/tmp/tmr-dish-rating-before-clear.png`
- `/private/tmp/tmr-dish-rating-cleared.png`
- `/private/tmp/tmr-dish-rating-rapid-one-three.png`
- `/private/tmp/tmr-dish-rating-rapid-restarted.png`
- `/private/tmp/tmr-other-dish-reply-only.png`
- `/private/tmp/tmr-dish-reply-sent.png`
- `/private/tmp/tmr-own-dish-reply-delete.png`
- UI hierarchies with the exact accessibility states and action controls are stored under `/private/tmp/tmr-*.xml`.

No dish-action or rating error was displayed during the executed cases. A final Metro-log scan contained older media warnings and known development-client/KeyboardInset diagnostics, but no error correlated with the new reply, rating-clear, rapid-rating or creator-delete operations. These unrelated existing diagnostics did not interrupt this run and were not changed.

Phone A is **PASS** for the four reported interaction defects and restart persistence. The full audit verdict remains **NO-GO**, because Phone B synchronization and the other previously documented two-device notification/offline/release blockers remain unresolved.

## 25. Phone A processing-video cancellation fix and physical retest (2026-08-04)

The reported defect was reproduced in `TMR AUDIT 0802 2151`: long-pressing a processing video exposed `Discard unsent message`, but tapping it left the selection toolbar and video row visible. The initial result was **FAIL**.

The targeted investigation found multiple cancellation races in the local optimistic state. Cancel did not close selection, removed only the Chat projection, and an in-flight upload/source update or room refresh could write a stale processing row back to the outbox or SQLite cache. The fix now closes selection immediately, tombstones the cancelled client/message identity for the process lifetime, removes both Chat and Media projections, rejects late upload-source writes, deletes the offline row and applies the tombstone again immediately before refreshed room state is persisted.

Focused verification completed before the physical retest:

- Table Memory blocker and media-processing tests: **14/14 PASS**.
- Mobile TypeScript check: **PASS**.
- Diff whitespace validation: **PASS**.

These automated checks are regression evidence only. The acceptance result below is based on the physical Phone A run.

| Focused physical case | Result | Observation |
| --- | --- | --- |
| Long-press a pending/processing video and expose Cancel | PASS | Phone A displayed `1 selected` and `Discard unsent message` |
| Tap Cancel and close selection immediately | PASS | The selection toolbar closed without another tap or refresh |
| Remove the cancelled row from Chat | PASS | The processing video disappeared immediately |
| Remove the corresponding projection from Media | PASS | The newly cancelled video was absent on the Media tab |
| Fence server processing after upload registration | PASS | The matching job and asset became `cancelled`, with `owner_cancelled`; neither was processed or consumed |
| Survive room reconciliation without resurrection | PASS | The cancelled row remained absent after the room refreshed and settled |
| Survive force-close and cold reopen | PASS | No `Preparing` or `Processing` row returned after force-stop and room reopen |
| Remove persistent offline state | PASS | The final Phone A SQLite query returned zero unsent `memory_messages` rows |
| Confirm the same behavior on Phone B | BLOCKED | Phone B was not exposed by ADB during this focused retest |

Failure evidence:

- `/private/tmp/tmr-cancel-before.png`
- `/private/tmp/tmr-cancel-toolbar.png`
- `/private/tmp/tmr-cancel-after-tap.png`

Successful retest evidence:

- `/private/tmp/tmr-cancel-patched-after.png`
- `/private/tmp/tmr-cancel-patched-media-tab.png`
- `/private/tmp/tmr-final-cold-pass.png`
- `/private/tmp/tmr-final-cold-pass.xml`
- `/private/tmp/circlebites-memory-final-cold.db`

Phone A is **PASS** for processing-video cancellation, including Chat/Media consistency, server cancellation fencing and cold-restart persistence. The underlying video-processing latency/FFmpeg investigation was deliberately deferred as requested and is not resolved by this cancellation fix. The full audit verdict remains **NO-GO** because Phone B confirmation and the other outstanding two-device cases are still required.

## 26. Phone A video-preview controls and upload-thumbnail continuity (2026-08-04)

Two focused video UX changes were implemented:

1. The optimistic local video thumbnail now remains mounted beneath the signed server poster during confirmation, and the poster is prefetched before the cache swap. This prevents confirmation from removing the already visible local frame while the remote poster is still loading.
2. The capture preview now updates playback state immediately, emits timeline updates every 100 ms, and provides a draggable timeline plus explicit −10-second and +10-second controls above `Post to Room`.

Focused regression evidence:

- Video-processing/settlement tests: **17/17 PASS**.
- Targeted upload-identity and preview-control tests: **4/4 PASS**.
- Mobile TypeScript check: **PASS**.
- Targeted ESLint: **PASS with no errors**; the reported warnings are pre-existing warnings in the large room screen.
- Diff whitespace validation: **PASS**.

Physical Phone A results:

| Focused physical case | Result | Observation |
| --- | --- | --- |
| Tap the captured video to pause | PASS | The accessibility state changed immediately to `Play preview video` and the paused frame remained visible |
| Tap again to resume | PASS | Playback resumed, advanced the elapsed time and paused again on the next tap |
| Seek forward 10 seconds | PASS | The displayed position changed from 0:07 to 0:17 |
| Seek backward 10 seconds | PASS | The displayed position changed from 0:17 to 0:07 |
| Drag the preview timeline | PASS | A physical drag moved the displayed position continuously to 0:20 of 0:25 |
| Keep the local video tile visible during upload and processing | PASS | A 161-second screen recording showed the same local thumbnail continuously from preview through upload and the `Processing` state; no blank or removed row occurred |
| Keep the tile visible across the final local-thumbnail → server-poster confirmation | BLOCKED | The 19.49 MiB, 17.51-second test asset uploaded successfully, but the server job remained `running` on attempt 2 and never reached `ready` during the observation window |
| Confirm the same behavior on Phone B | BLOCKED | Phone B was not exposed by ADB during this focused retest |

Evidence:

- `/private/tmp/tmr-video-preview-controls.png`
- `/private/tmp/video-preview-controls.xml`
- `/private/tmp/video-preview-forward.xml`
- `/private/tmp/video-preview-rewind.xml`
- `/private/tmp/video-preview-scrub.xml`
- `/private/tmp/video-preview-toggle.xml`
- `/private/tmp/tmr-video-short-progress-10s.png`
- `/private/tmp/tmr-video-short-progress-30s.png`
- `/private/tmp/tmr-video-short-progress-55s.png`
- `/private/tmp/tmr-video-upload-continuity-short.mp4`
- `/private/tmp/tmr-video-upload-continuity-contact-sheet.png`

The preview-control defect is **PASS on Phone A**. Upload/processing thumbnail continuity is **PASS up to the worker boundary**, but final confirmation remains **BLOCKED** by the separately deferred processing failure. This section does not claim that the video-processing latency/root cause is resolved. The full audit verdict remains **NO-GO**.

## 27. Phone A video terminal-state and duration follow-up (2026-08-04)

The user reported that the capture-preview timeline thumb was vertically low, completed uploads disappeared from Chat, and Media showed `0 sec`. This follow-up is recorded as **FAIL on the deployed build**; no case is upgraded from code inspection or local tests.

Authoritative hosted rows show that both newest videos did publish one `activity_kind='media'` message and one attachment before processing. Their stored durations are 7,443 ms and 59,606 ms, but both first-attempt jobs ended `rejected/media_video_transcode_failed` with no derivatives. The exact sources transcode locally, and the rotated Motorola source reproduced the server failure in the existing Debian FFmpeg 5.1 worker image: the deployed valueless `-autorotate` option is rejected during option parsing. Removing the redundant option succeeds in the same network-disabled, one-CPU/512-MiB container and also passes the existing FFmpeg 8 tests.

Three additional targeted defects were corrected locally:

1. The upload-result mapper now preserves `duration_ms`, preventing the immediate `0 sec` fallback.
2. Migration `202608040002_table_memory_media_terminal_visibility.sql` adds media asset/processing fields to bounded Chat reads and retains rejected rows for their uploader in both Chat and Media while keeping them hidden from peers.
3. The 12-pixel preview scrubber thumb now uses a `-6` pixel vertical offset from `top: 50%`.

Focused evidence is **23/23 PASS**, both TypeScript checks and the production build pass, the migration manifest validates 100 migrations, the local migration applies, and the local two-account runtime fixture proves uploader-visible/peer-hidden terminal rows through direct RLS plus both bounded RPCs with a nonzero duration. The fix is **NOT DEPLOYED and NOT PHYSICALLY RETESTED**. Existing rejected jobs also require a post-worker-deploy operator requeue or a fresh upload; they will not recover merely from reinstalling the app.

The final audit verdict remains **NO-GO**. Phone A must retest preview alignment, upload → Chat continuity, Media duration and playback after the worker/API/database/mobile deployment; Phone B must then verify peer synchronization and the remaining two-device matrix.

## 28. Phone A production-size video worker resource failure (2026-08-04)

After migration `202608040002`, commit `46c7973`, the Vercel preview, Render manual deployment and a fresh Phone A dev build were reported deployed, a new 5.76 MiB video was sent from Phone A. The API stored the room message, attachment and 6,449 ms advisory duration, and the worker claimed the job. The asset then remained `processing`; attempts 1, 2 and 3 each lost the complete five-minute lease with no heartbeat, success, retry or classified FFmpeg failure. The next worker instance reclaimed the expired job immediately each time. This proves publication and queue recovery work but the deployed processing case is still **FAIL**.

The exact private source was downloaded to a mode-0600 temporary diagnostic file and probed as H.264 High, 1920x1080, 30 fps with a -90-degree display matrix and 4.903-second authoritative duration. It successfully produced the expected 900x1600 canonical video in the same Debian/FFmpeg 5.1 image under 512 MiB and 0.5 CPU, so it is not corrupt or unsupported. The deployed FFmpeg command peaked at 241,496 KiB by itself. Pinning decoder, filter and encoder threads to one reduced peak RSS to 174,296 KiB and reduced elapsed processing from 20.8 seconds to 8.8 seconds on the exact source. The repeated whole-process lease loss, combined with that memory reduction and the resident Next.js process, identifies worker resource exhaustion as the root cause.

The targeted local fix sets `MEDIA_WORKER_FFMPEG_THREADS=1`, applies the bound to input decoding, filters, x264 and poster extraction, and sets `MEDIA_WORKER_CONCURRENCY=1` for the single Starter worker. Focused tests are **24/24 PASS**, root TypeScript is **PASS**, the production build is **PASS**, and the exact-source constrained replay is **PASS**. This is **NOT DEPLOYED and NOT PHYSICALLY RETESTED**. Do not requeue the stuck production job until the new worker is live; otherwise it will consume the remaining attempts on the known-bad worker.

The final audit verdict remains **NO-GO**.

## 29. Phone A stable video geometry and capture-state retest (2026-08-04)

The reported video-size jump and misleading post-stop recording state were reproduced and traced to two client transitions. Unguided Table Memory camera videos did not probe their dimensions, and upload confirmation/realtime/offline-recovery mappings could replace local dimensions with null server fields. Separately, the camera retained its red `recording` state until thumbnail probing and owner-scoped file staging completed after native recording had already stopped.

The targeted client fix now probes every captured video's first frame, carries its dimensions and duration through optimistic publication, HTTP confirmation, Realtime and offline recovery, and models capture as `idle → starting → recording → finalizing`. The stop tap moves to `finalizing` before calling native `stopRecording`, removes the red recording clock immediately and shows `Preparing preview…` until the preview is ready.

Focused physical Phone A results in the existing two-member `Test` room:

| Focused physical case | Result | Observation |
| --- | --- | --- |
| Start room-camera recording | PASS on Phone A | At the first post-tap capture the red timer and stop control were already visible at `0:00` |
| Stop room-camera recording | PASS on Phone A | The first post-tap capture no longer showed recording; it showed `Preparing preview…` while the file was probed and staged |
| Open the captured preview | PASS on Phone A | The 4-second portrait clip opened with playback and timeline controls |
| Preserve tile geometry during publication | PASS on Phone A | The first Chat frame used the full portrait tile during `Preparing`, retained the identical footprint during `Processing`, and retained it when the final play control appeared |
| Reach canonical ready state | PASS on Phone A | The local room cache recorded one ready attachment (`dc13140f-afe5-4374-ae82-ec75493b9b64`) at 900×1600 with duration 4,414 ms |
| Confirm on Phone B | BLOCKED | ADB exposed only Phone A (`ZA223JVWG7`), so peer geometry/playback and two-phone Chat/Media convergence were not observed |

Evidence:

- `/private/tmp/tmr-video-recording-immediate.png`
- `/private/tmp/tmr-video-finalizing-immediate.png`
- `/private/tmp/tmr-video-preview-open.png`
- `/private/tmp/tmr-video-upload-initial.png`
- `/private/tmp/tmr-video-upload-seven-seconds.png`
- `/private/tmp/tmr-video-upload-after-27s.png`
- `/private/tmp/phone-a-memory-after-video.db`

Focused validation is **13/13 PASS**, mobile TypeScript is **PASS**, targeted ESLint reports zero errors, and diff whitespace validation is **PASS**. The broader selected static test run still contains one unrelated stale assertion for the older post/avatar-only `defaultCropRect` source shape; it is not caused by this patch.

The sparse screenshots used for this first pass appeared to show uninterrupted confirmation. Continuous recordings in section 30 later disproved that conclusion: the geometry stayed stable, but the newest row still disappeared for several seconds during the processing-to-ready handoff. The capture-state and stable-geometry rows above remain valid; final-confirmation continuity does not. It does not upgrade the two-device media rows because Phone B was unavailable. The final audit verdict remains **NO-GO**.

## 30. Phone A continuous video-handoff reproduction and targeted projection fixes (2026-08-04)

Continuous Phone A screen recording superseded the sparse-screenshot conclusion in section 29. A short room-camera clip was visible at the live edge while preparing/processing, the entire newest media row then vanished and older rows moved into its place, and the ready row returned several seconds later without manual refresh.

Physical observations:

| Attempt | Result | Observation |
| --- | --- | --- |
| Baseline continuous capture (`10:48 pm`) | FAIL | The new row was absent in full-resolution frames at approximately 45.8–46.8 seconds and returned by 53.5 seconds |
| Atomic optimistic→real attachment replacement (`11:01 pm`) | FAIL | The processing row remained visible initially, was absent around the 40-second frame, and returned ready around the 45-second frame |
| Attachment-bearing SQLite confirmation after forced app reload (`11:12 pm`) | FAIL | The newest row was visible processing at 25–30 seconds, older `10:48/11:01` rows replaced it at 35 seconds, and the ready `11:12` row returned by 40 seconds |
| Final incremental-delta retention patch | BLOCKED | Phone A disconnected from ADB immediately after the last reproduction, before another upload could be recorded |

Evidence:

- `/private/tmp/tmr-handoff-fixed.mp4`
- `/private/tmp/handoff-45_8.png`
- `/private/tmp/handoff-46_8.png`
- `/private/tmp/handoff-53_5.png`
- `/private/tmp/tmr-atomic-handoff.mp4`
- `/private/tmp/tmr-atomic-40.png`
- `/private/tmp/tmr-atomic-45.png`
- `/private/tmp/tmr-atomic-handoff-final.mp4`
- `/private/tmp/tmr-final-30.png`
- `/private/tmp/tmr-final-35.png`
- `/private/tmp/tmr-final-40.png`

Three projection defects were isolated and fixed without unrelated refactoring:

1. `settleMemoryRoomMedia` removed a superseded optimistic attachment before inserting its real replacement. A body-less media message therefore became empty and was filtered from Chat. The transition now replaces the attachment atomically and de-duplicates the real row.
2. Realtime attachment matching used only `message.id`, although a confirmed optimistic message can retain its local React identity while exposing the real ID through `serverId`. Realtime now matches both identities in the room and paginated Chat caches. Early publication also persists the attachment-bearing confirmed message instead of an empty `actualMessage` projection.
3. `mergeMemoryRoomDelta` treated each incremental change page like a complete photo snapshot and assigned `attachments: []` when that page omitted the media row. It now retains existing, non-tombstoned attachments and merges refreshed server rows over them; explicit photo/message tombstones still remove data.

Focused validation after the final patch is **27/27 PASS**, mobile TypeScript is **PASS**, targeted ESLint reports zero errors, and diff whitespace validation is **PASS**. The broader phase-4 source-assertion file still has two pre-existing stale assertions for current runtime-sync formatting/subscriptions; they are unrelated to this targeted change and were not used to pass a physical case.

The deployed/physically observed case remains **FAIL** until a fresh Phone A continuous recording proves no gap, followed by Phone B synchronization confirmation. The final audit verdict remains **NO-GO**.
