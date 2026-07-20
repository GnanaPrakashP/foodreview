# Home initial-load contract

After authentication and account validation, Home owns two independent reads:

1. `GET /api/feed/circle?limit=10`
2. `GET /api/notifications/has-unread`

The notification list is not a Home dependency. The Circle response root is limited to `posts`, `nextCursor`, and `viewerName`; each post carries direct card engagement plus one `coverMedia` delivery record and the total `mediaCount`.

The active Circle RPC orders by `created_at DESC, id DESC`, reads 11 candidates, returns at most 10, and exposes a cursor only when the sentinel row exists. Mobile requests another ten when the highest 65%-visible-for-900-ms item reaches `loadedPosts.length - 3`; the cursor is claimed once and flattened posts retain the first occurrence of each ID in server order. Five pages remain in memory and only the first page is persisted.

Home cover authorization batches at most one asset per post through one service-only SQL authorization statement and one batched signing call. Images sign the 720×900 feed derivative when present and fall back to the 1080×1350 canonical derivative. Videos sign only the poster initially; canonical playback is authorized and signed only after explicit Play. Media items 2–N receive no initial delivery URLs. The active card does not implement a carousel, so second-media preloading is intentionally not applicable to this phase.

Signed URLs are transport credentials, not cache identities. Home uses `mediaAssetId:feed`, `mediaAssetId:poster`, and `mediaAssetId:playback`. Prefetch is an abortable account-scoped download and the rendered Expo Image source uses the same stable key. A renewed URL does not change identity. Persisted modern Home media retains asset ID, type, dimensions, and placeholder but clears delivery URLs and expiry.

Legacy public rows keep a versioned cache identity, fixed 4:5 display area, early decode resizing, no automatic prefetch, and no video loading before Play. `npm run media:home-normalize` sends legacy images through the existing resumable visibility/privacy backfill and then generates any missing 720×900 feed derivatives. The command intentionally skips legacy videos so it cannot turn a still-usable historical video into a modern asset without the required poster; those remain on the controlled explicit-Play fallback until a poster-safe video migration is available.

## Measured evidence

The repository's recorded pre-change representative 24-row Circle RPC payload was 18,254 bytes. The final local 10,000-review, ten-cover database fixture measured 10 rows, a 9,391-byte Circle projection, an 8,926-byte authorization projection, and a 6.710 ms Circle query plan. The local production Next API validator then measured the exact `/api/feed/circle?limit=10` response across 20 samples: maximum 14,725 bytes, p50 68.109 ms, and p95 87.576 ms. The route stayed within its six-statement application budget; Home media accounted for exactly one batched authorization statement and one storage-signing operation. These are local runtime measurements, not physical-device network timings.

Three repository food-art fixtures measured the unchanged MozJPEG pipeline at averages of 26,346 bytes for 360×450 quality 82, 89,315 bytes for progressive 720×900 quality 82, and 186,285 bytes for 1080×1350 quality 85. Their source PNGs averaged 1,796,968 bytes. These are compression measurements, not a physical-device visual-quality claim.
