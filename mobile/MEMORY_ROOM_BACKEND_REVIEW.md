# Memory Room — Backend / Data Architecture Review

_Scope: data loading, caching, pagination, realtime, media handling, and scalability of the
"table memory room" (Table / Chat / Media / Dishes tabs). UI/UX intentionally out of scope.
Benchmarked against Mattermost mobile (`mattermost-mobile-main`)._

---

## Implementation status — updated 2026-07-05

Tracked against §6 (recommendations) below and the offline-store audit (findings F1–F6).

**Done**
- ✅ **Phase 1a** — killed the 8s room-detail poll; realtime + AppState foreground/reconnect refetch replace it; removed the wasted per-message chat-page invalidation. (`useMemories.ts`, `providers/AppProviders.tsx`)
- ✅ **Phase 2** — single `shared_memory_chat_page` RPC per chat page, collapsing the 5–6 sequential round-trips. (`services/memories.ts`, migration `202607050001_shared_memory_chat_page_rpc.sql`)
- ✅ **Phase 3** — MMKV `PersistQueryClientProvider`, scoped to `memories` queries, 7-day TTL. (`providers/AppProviders.tsx`, `providers/queryPersistence.ts`)
- ✅ **Phase 5** — offline-first `expo-sqlite` store with read fallbacks. (`services/memoryOfflineStore.ts`) — audited: cursor/ordering/pagination parity with the online path confirmed correct.
- ✅ **F1** (offline store unbounded growth) — 7-day `updated_at` prune on DB open; bounded, LRU-by-recency.
- ✅ **F2** (stale media URLs) — signed-URL TTL 1h → 8d in `constants/memoryMediaPolicy.ts` **and** the backend `lib/memory-media-policy.ts` (kept in sync), so cached/persisted URLs outlive the 7-day caches. ⚠️ Security trade-off accepted: a leaked signed URL is now valid 8 days, not 1 hour.
- ✅ **Phase 4** — media polish: prefetch (`prefetchMemoryMedia` + `Image.prefetch`), `cachePolicy="memory-disk"`, and `recyclingKey` on the photo images were already in place; closed the last gap — added `recyclingKey` to the two video-thumbnail images in `NativeVideoThumbnailLayer`.

**Remaining**
- ⬜ **Phase 1b** — true per-message `setQueryData` delta (insert one message instead of refetching the whole room per event); needs on-device validation.
- ⬜ **F3** (concurrent-transaction write drop — low, self-healing), **F4** (empty page → `null` — low), **F5** (dead `latest_activity_at` column — nit).

---

## 1. Executive summary

The room **works** and has several genuinely good patterns (cursor pagination, optimistic
updates, a server-side summary RPC). But the data layer is **network-bound and refetch-heavy**.
That is the root cause of the "why isn't it fast?" feel, and it is what will not scale as rooms
grow in size and activity.

The four things holding it back, in order of impact:

1. **Realtime invalidates-and-refetches** instead of applying deltas.
2. **An 8-second full-room poll** that re-downloads the entire room.
3. **Multi-round-trip page loads** (5–6 sequential network calls per chat page).
4. **No persistent/offline cache** — every cold start hits the network.

Mattermost avoids all four by being **offline-first on a local SQLite database (WatermelonDB)**
with websocket events applying granular record-level changes. That single architectural choice
is the biggest difference between "our room" and "a professional chat room."

---

## 2. What is already done well (keep these)

| Area | What we do | File |
| --- | --- | --- |
| Chat pagination | Cursor-based, page size 50 | `src/services/memories.ts:36` |
| Media pagination | Cursor-based, page size 30 | `src/services/memories.ts:37` |
| Optimistic writes | `setQueryData` + rollback on send/edit/delete | `src/hooks/useMemories.ts:540` |
| Room list | Server-side summary via `shared_memory_room_summaries` RPC, paginated | `src/services/memories.ts:443` |
| Media caching | `expo-image` (memory + disk cache) — same lib Mattermost uses | `src/components/memories/PhotosSection.tsx` |
| Realtime scoping | Per-room channel with `room_id` filters | `src/hooks/useMemories.ts:480` |
| Schema tolerance | Select fallbacks for migrating columns | `src/services/memories.ts:610` |

---

## 3. Problems, ranked by impact

### P0 — Realtime "invalidate → refetch everything"
`src/hooks/useMemories.ts:486`, `:494`, `:475`

On every incoming message/photo, the handler calls
`invalidateQueries({ queryKey: memoryKeys.chat(roomId) })` **and** invalidates room detail **and**
the room list. Result: a single new message triggers a **full refetch of the chat pages + the
whole-room detail + the list**.

- Cost is **O(pages loaded)** per event, and it compounds with multiple active senders.
- In a busy room this is a refetch storm.
- **Mattermost**: the websocket `posted` event inserts **one** post record into the local DB —
  O(1), no refetch. (`app/actions/websocket/`)

### P0 — 8-second full-room polling
`src/hooks/useMemories.ts:435` (`refetchInterval: 8_000`) → `getMemoryRoom` `src/services/memories.ts:1002`

`getMemoryRoom` fetches the **entire room**: all members, stops, dishes, dish ratings, **all
messages**, reply messages, **all photos**, then a profile-name lookup — **every 8 seconds**, for
every open room.

- The cost grows **unbounded** with room size. A 500-message / 100-photo room re-downloads all of
  it every 8 s.
- It is **redundant** with realtime (both mechanisms fire).
- It overlaps the chat/media infinite queries (same messages/photos fetched twice — see P1).
- This is a prime suspect for the general "laggy / slow to move" feel: the network and JS thread
  are busy on a timer regardless of what the user is doing.

### P1 — Multi-round-trip page loads (latency stacking)
`src/services/memories.ts:1033` (`getMemoryMessagesPage`)

One chat page performs ~5–6 **sequential** awaits:
`myUsername()` → `assertMemoryRoomMember()` → messages → photos → sign URLs → reply rows →
display names. At ~80 ms each that is **~500 ms per page** before render.

- `assertMemoryRoomMember()` runs on **every** page/media/room fetch and every mutation
  (`:1004`, `:1038`, `:1071`) — an extra round-trip each time, even though Postgres RLS already
  enforces membership server-side.
- **Mattermost**: one batched request + server-side joins; authorization is server-enforced, not
  re-checked per call from the client.

### P1 — No offline / persistent cache
`src/providers/AppProviders.tsx:12` (`gcTime 30m`, `staleTime 5m`, `refetchOnReconnect/Focus: false`)

React Query is **in-memory only** — no `persistQueryClient`, no MMKV/AsyncStorage, no SQLite. Every
cold start re-downloads rooms, chat, and media. No instant paint, no offline.

- **Mattermost**: WatermelonDB (SQLite) is the source of truth. UI reads reactively from the local
  DB → **instant paint**, background sync fills/updates it. Models: `post`, `posts_in_channel`
  (tracks loaded ranges/gaps), `channel`, `file`, `user`, `reaction`, `draft`, `thread`, …

### P1 — Two sources of truth for the same data
`getMemoryRoom` returns messages + photos, **and** the chat/media infinite queries fetch them
again. This forces band-aids like `structuralSharing: preserveRecentMediaAttachments`
(`src/hooks/useMemories.ts:437`) to stop the room-detail refetch from clobbering paginated media.
Two writers, one screen → extra fetching and consistency hazards.

### P2 — All four tabs are mounted at once
`app/memories/[id].tsx:3697`–`3764`, `RoomPane` at `:4182`

Table / Chat / Media / Dishes are all mounted simultaneously (opacity-animated via `RoomPane`).
The heavy chat `FlatList`, the media gallery, and the dishes list all render together on room open.
This adds to initial cost and the "slow to move across" feel. Consider lazy-mounting a tab on first
activation.

### P2 — Signed-URL churn on media
`signMemoryPhotoRows` re-signs storage URLs on every fetch. Short-TTL signed URLs change the image
URL, and `expo-image` keys its cache by URL → **cache misses / re-downloads**. Prefer longer-TTL or
CDN-backed stable URLs, add `recyclingKey` to gallery images, and prefetch the next media page.

### P2 — Legacy fallback fetches unbounded messages
`src/services/memories.ts:399` (`listMemoryRoomsLegacy`) selects **all** messages for **all** rooms
(no `.limit()`) to build summaries. It is only a fallback for a missing RPC, but it is an
unbounded-query landmine.

---

## 4. Direct answer: "why isn't it fast?"

Three things are usually happening at once when you tap around:

1. **A background 8 s timer** is refetching the entire room.
2. **Realtime events** are invalidating and refetching chat + detail + list.
3. **Opening/switching** pays for sequential multi-round-trip loads and the mount cost of all four
   tabs — with **nothing served from a local store**.

None of these are UI problems; they are all data-layer problems.

---

## 5. Scalability verdict

- **Room size** (messages/photos): poor — full-room poll + room-detail refetch are unbounded.
- **Room activity** (senders/sec): poor — invalidate-on-event causes refetch storms.
- **Cold start / offline**: poor — no persistence.
- **Small, quiet rooms**: fine today; the problems only surface as data and activity grow.

---

## 6. Recommendations (for later implementation, prioritized)

1. **[P0] Remove the 8 s poll; make realtime apply deltas.** Replace `invalidateQueries` with
   `setQueryData` that inserts/updates the exact record from the realtime payload; delete
   `refetchInterval`. This is the single biggest win. → Mattermost websocket-delta model.
2. **[P0] Stop refetching the whole room per event.** Split "room metadata" (members/stops/dishes)
   from the message/media streams (already paginated) and update each granularly.
3. **[P1] Collapse per-page round-trips into one server-side RPC** (messages + photos + reply
   snippets + display names in a single call) and **drop per-call `assertMemoryRoomMember`** (rely
   on RLS).
4. **[P1] Add persistence.** Quick win: `persistQueryClient` + MMKV for instant cold-start paint.
   Long-term: an offline SQLite store (WatermelonDB or `expo-sqlite`) for true offline + reactive
   UI, matching Mattermost.
5. **[P1] One source of truth** — stop double-fetching messages/photos in both room-detail and the
   infinite queries.
6. **[P2] Lazy-mount tabs** (mount Chat/Media/Dishes on first activation).
7. **[P2] Media**: longer-TTL/CDN URLs, `recyclingKey`, prefetch next page.

### Suggested phasing
- **Phase 1** (biggest win, least risk): remove 8 s poll + convert realtime to `setQueryData` deltas.
- **Phase 2**: single RPC per chat page; drop redundant membership asserts.
- **Phase 3**: persistence (`persistQueryClient` + MMKV).
- **Phase 4**: lazy tabs + media polish.
- **Phase 5** (optional, large): offline SQLite store for full Mattermost-style offline-first.

---

## 7. CircleBites vs Mattermost — one-glance table

| Dimension | CircleBites (today) | Mattermost mobile |
| --- | --- | --- |
| Source of truth | React Query in-memory cache | WatermelonDB (SQLite), offline-first |
| Realtime | Invalidate → refetch pages/detail/list | Websocket → insert/update one record |
| Freshness | 8 s full-room poll **+** realtime | Websocket deltas only |
| Page load | 5–6 sequential client round-trips | Batched fetch + server joins |
| Authorization | Client re-checks membership per call | Server-enforced |
| Cold start | Full network re-download | Instant paint from local DB |
| Offline | None | Full offline |
| Pagination | Cursor (good) | Cursor + gap-tracking in DB |
