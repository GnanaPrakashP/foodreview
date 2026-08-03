# Table Memory Room place, dish-delete, and rating implementation

Date: 2026-08-03
Scope: place-card edit/delete, Chat dish deletion, and responsive dish ratings
Physical devices required: Motorola edge 70 fusion (Phone A), moto g57 power (Phone B)

## 1. Scoped verdict

The requested implementation and focused automated coverage are complete in the working tree, and database migration `202608030003_table_memory_entity_mutations.sql` is deployed to the linked Supabase project. The scoped release verdict is still **BLOCKED / NO-GO** because neither physical phone was visible when the required retest began: `adb devices -l` returned no devices, `adb mdns services` returned no wireless-debug devices, Xcode listed only the Mac and simulators, and neither Metro server had an established phone connection.

No physical case in this phase is marked PASS from code inspection or automated tests. The earlier physical audit results remain historical evidence only.

## 2. Existing root causes

- Place rows were short-press-only Maps links. The existing place form was create-only, and update/delete hooks invalidated the whole room without a stable optimistic snapshot or idempotent API boundary.
- Dish rows were returned from the Chat renderer before `memoryChatActionTarget` and the common selection wrapper ran, so their parent never exposed the media/message long-press selection contract.
- Rating stars were disabled for the duration of each mutation. Each success invalidated the room and list, so rapid taps serialized behind network responses and caused full-room reconciliation.
- Ratings had no durable local intent. Offline/restart recovery existed for text/media outbox entries, not per-user dish ratings.
- Rating Realtime events scheduled a full room refresh instead of patching the canonical dish/rating projection.

## 3. Place-card long press and edit-mode reuse

`ItineraryStopRow` now exposes an inline action group at the right edge after a long press. It contains exactly **Edit** and **Delete**. While any place action group is open, a normal place-card tap dismisses the group instead of opening Maps. Tapping another card, the dismissal area, scrolling, or changing tabs closes it.

Edit routes back to the existing `mobile/app/memories/[id]/add-place.tsx` screen with `stopId`. The form initializes once from the canonical room stop and prefills name, provider place ID, address/note, and stop type. It keeps the same autocomplete/place-selection validation and changes the top action to `Update`. Back/close with changes uses a discard confirmation and sends no mutation; an in-flight update cannot be dismissed.

## 4. Place update and delete data flow

Update uses one `PATCH /api/mobile/memories/:roomId/entities` request. The hook patches the existing stop ID in place, updates summary place names, and persists both projections to the owner-scoped SQLite replica. The server returns the same canonical stop ID; the hook upserts by ID, preserving display metadata. The room overview-version guard prevents an older in-flight stop read from overwriting the update.

Delete uses the existing destructive confirmation with Cancel/Delete and identifies the place by name. The hook removes the stop and derived place names immediately, persists the deletion, and holds a short-lived identity tombstone so an older query result cannot visually resurrect the card. Failure restores the exact room and summary snapshots once. Repeated server deletion is successful even if the row is already absent.

Both mutations use the authenticated, idempotent entity endpoint. The endpoint derives the actor, verifies current room membership and blocked-relationship policy through `assertMemoryRoomMutationAllowed`, then performs the narrowly scoped service-role write. Client visibility is not the authorization boundary.

## 5. Chat dish long-press deletion

`MemoryActionTarget` now includes a canonical dish target. Both the vendored Chat renderer and the inactive/native candidate route dish rows through the same selection behavior as media. A dish long press selects the dish; a short star tap or details tap remains unchanged. When a dish is selected, message-only actions resolve to null, so the toolbar exposes only Delete.

Deletion uses `DELETE /api/mobile/memories/:roomId/entities` with `kind: "dish"`. The hook removes the canonical dish from the room cache, which simultaneously removes its Chat timeline card, Dishes-tab row, bottom-sheet source, and local dish count. PostgreSQL cascades only the room-dish rating rows associated with that deleted dish; it does not delete unrelated canonical dish identity. A failed request restores the complete dish and ratings snapshot. A successful request performs one authoritative background reconcile while the deletion tombstone prevents flicker or resurrection.

## 6. Previous and new rating architecture

Previously, Chat, Dishes, and the bottom sheet rendered the same room data but disabled every star while `useMutation` was pending. Each tap waited on a direct Supabase upsert and each success invalidated the full room/list.

The new canonical state is the React Query room detail keyed by room ID, with a single latest-intent coordinator keyed by room ID plus dish ID for the authenticated profile. Every star tap synchronously patches that room cache. Therefore every mounted representation receives the new `myRating`, rating rows, count, and average in the same React update.

The optimistic aggregate removes the current user's previous row, inserts/replaces exactly one current-user row, preserves every other user's row, and recomputes the average from the resulting set. Realtime rating INSERT/UPDATE/DELETE events now patch that same set directly. A pending local value is overlaid after the remote patch, so another user's concurrent rating is retained while an older self-echo cannot move the local stars backward.

## 7. Mutation coalescing and server monotonicity

- UI state changes immediately; only persistence is delayed.
- A 140 ms network debounce coalesces a rapid tap cluster.
- Only one request may be in flight for a room-dish-user key.
- A newer tap during an in-flight request replaces the pending intent and triggers one immediate follow-up after the current request finishes.
- Every intent has a stable mutation UUID and a monotonic client sequence.
- The API idempotency record deduplicates transport retry.
- PostgreSQL keeps one row through the existing `(dish_id, rated_by)` uniqueness constraint.
- `set_shared_memory_dish_rating_v2` updates only when the incoming sequence is not older than the stored sequence, so an old request cannot overwrite a newer value.
- Rating success does not invalidate or bootstrap the room.

In the deterministic rapid test, **5 user taps (1, 2, 3, 4, 5) generated exactly 1 rating API call**, and the request carried only rating 5. The physical request/tap count is not available because neither phone was connected; it is not represented as physical evidence.

## 8. Offline persistence and failure behavior

SQLite now owns a `memory_dish_rating_outbox` row per room/dish with latest desired value, last confirmed value, stable mutation UUID, sequence, and timestamp. Repeated offline taps overwrite that one row. On room mount the pending value is restored into the canonical room cache. On reconnect, the latest row is replayed automatically. A force-close/restart simulation proves the durable row rehydrates into a new coordinator and sends only the final value.

Temporary/network errors retain the optimistic latest value and durable row, with at most five bounded automatic attempts per active session and exponential backoff capped at 15 seconds. A later reconnect explicitly restarts recovery. Permanent 400/401/403/404 rejection deletes the pending intent, restores the last confirmed personal rating across the shared room cache, preserves other users' ratings, and exposes the mutation error to existing surface error text.

## 9. Authorization and idempotency

- Place update/delete and dish delete require an authenticated current room member at the API boundary.
- Revoked membership fails the same membership check before a service-role mutation is attempted.
- Blocked room relationships are rejected.
- The rating RPC is `SECURITY DEFINER` with `search_path = ''`, is executable only by `service_role`, verifies room membership and dish-room linkage again, and accepts no client-controlled actor through mobile Supabase.
- The unauthenticated runtime probe against the local endpoint returned HTTP 401 with `authentication_required`.
- Authenticated nonmember/revoked-member runtime probes remain physically BLOCKED because the two device sessions are unavailable. Static route/migration coverage is not counted as a physical pass.

## 10. Files changed for this phase

- `app/api/mobile/memories/[roomId]/entities/route.ts`
- `mobile/app/memories/[id].tsx`
- `mobile/app/memories/[id]/add-place.tsx`
- `mobile/src/hooks/useMemories.ts`
- `mobile/src/services/memories.ts`
- `mobile/src/services/memoryDishRatingCoordinator.ts`
- `mobile/src/services/memoryOfflineStore.ts`
- `supabase/migrations/202608030003_table_memory_entity_mutations.sql`
- `tests/table-memory-entity-mutations.test.mjs`
- `docs/database/migration-history-manifest.json`
- this report and the existing acceptance audit

Unrelated dirty working-tree changes from the earlier audit were preserved.

## 11. Automated and runtime results

| Check | Result |
| --- | --- |
| Root TypeScript | PASS — `npm run typecheck` |
| Mobile TypeScript | PASS — `npm --prefix mobile run typecheck` |
| Focused lint | PASS — 0 errors; pre-existing warnings remain |
| Focused entity/rating tests | PASS — 7/7 |
| Rapid rating request count | PASS — 5 taps, 1 API request, final value 5 |
| In-flight latest-wins | PASS — never more than one request; one final follow-up |
| Temporary retry | PASS — intent remained durable, then succeeded automatically |
| Restart/offline replay simulation | PASS — only final value replayed from durable outbox |
| Permanent rejection | PASS — durable intent removed and confirmed value exposed for rollback |
| Migration manifest | PASS — 96 canonical migrations validated |
| Hosted migration | PASS — local/remote ledger both contain `202608030003` |
| Local unauthenticated endpoint probe | PASS — HTTP 401 |

## 12. Physical two-phone results

| Required case | Result | Evidence |
| --- | --- | --- |
| Place long press, exact actions, outside dismissal | BLOCKED | No physical devices visible to ADB/Xcode/Metro |
| Edit prefill, Cancel, Update, peer convergence | BLOCKED | No physical devices visible |
| Place force-close persistence and delete persistence | BLOCKED | No physical devices visible |
| Dish long press shows only Delete | BLOCKED | No physical devices visible |
| Dish Chat/Dishes/peer/restart convergence | BLOCKED | No physical devices visible |
| Rating slow/rapid/random on every surface | BLOCKED | No physical devices visible |
| Simultaneous A/B rating aggregate | BLOCKED | No physical devices visible |
| Offline/restart/reconnect rating convergence | BLOCKED | No physical devices visible |
| Physical taps versus API requests/renders/latency | BLOCKED | No physical devices visible; automated request count is reported separately |
| Member/nonmember/revoked/repeated direct API matrix | BLOCKED physically | Unauthenticated 401 and deterministic server-contract coverage only |

No phone screenshot or device log can be captured for a device-absence blocker. The environment checks themselves are the evidence; no product failure is inferred from them.

## 13. Remaining risks

- Touch geometry, visual latency, render counts, gesture conflicts, and cross-device convergence still require the named Motorola phones.
- The new API route is present in the running local development server but has not been deployed as a hosted web release in this phase.
- The durable rating coordinator has deterministic restart/reconnect coverage, but Android process-kill timing and simultaneous real-device network transitions remain unproved.
- A very narrow crash window between a successful first rating response and the local confirmed-value outbox update may cause a later permanent denial to use an older stored rollback value; a normal authoritative room refresh corrects it, but this needs physical failure injection.
- Dish/place creation still uses its pre-existing direct-insert contract; this phase hardens edit/delete/rating only.
- The prior audit's video, Firebase push, and performance blockers are unchanged.

## 14. Final scoped verdict

The code, database contract, migration deployment, and focused deterministic tests are ready for the required A/B retest. Completion criteria are not met until both named phones demonstrate place edit/delete, Chat dish delete, rapid/shared/offline ratings, persistence, and no-refresh convergence.

**BLOCKED / NO-GO**
