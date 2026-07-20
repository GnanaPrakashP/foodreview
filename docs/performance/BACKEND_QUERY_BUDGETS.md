# FoodReview mobile backend budgets

These are Phase 5 guardrails for the React Native/Expo product. The machine-readable authority is `config/backend-performance-budgets.json`; `npm run validate:backend-performance` rejects missing screens, duplicate cache owners, broad feed scanners, more than two screen-owned requests, more than six application-data statements, pages above 50 rows, and payload budgets above 256 KiB.

The database-statement number is an upper bound for application-data statements owned by the endpoint after the Phase 4 actor contract. Supabase Auth token verification is a platform operation and is not counted as an application query. The canonical actor profile lookup is counted where a route needs it. A PostgreSQL RPC counts as one round trip even when PostgreSQL performs several indexed operations internally; query-plan tests bound the important work inside those RPCs.

These are budgets, not production latency or capacity results. Phase 9 must measure the hosted database, pooler, Storage signing, network, cache state, cold starts, contention, and realistic concurrency.

| Screen/read owner | Mobile requests | App DB statements | Row/page bound | Payload bound | Pagination/cache owner |
| --- | ---: | ---: | ---: | ---: | --- |
| Circle | 1 | 6 | 10 | 64 KiB | stable cursor / Circle infinite query |
| Public feed | 1 | 5 | 24 | 192 KiB | bounded first page / public query |
| Explore | 1 | 1 | 24 per section | 256 KiB | bounded sections / Explore query |
| Restaurant feed | 1 | 5 | 24 | 192 KiB | bounded first page / restaurant query |
| Dish feed | 1 | 5 | 24 | 192 KiB | bounded first page / dish query |
| Profile shell | 1 | 4 | 1 shell | 32 KiB | none / profile shell query |
| Profile posts | 1 | 5 | 24 | 192 KiB | stable cursor / profile infinite query |
| Liked posts | 1 | 1 | 24 | 192 KiB | stable cursor / liked infinite query |
| Saved posts | 1 | 1 | 24 | 192 KiB | stable cursor / saved infinite query |
| Post detail | 1 | 5 | 1 post | 64 KiB | none / detail query |
| Comments | 1 | 4 | 30 | 128 KiB | stable cursor / comments infinite query |
| Notifications | 1 | 3 | 30 | 128 KiB | stable cursor / notifications infinite query |
| Memory room list | 1 | 2 | 50 | 128 KiB | bounded window / room-list query |
| Memory bootstrap | 1 | 3 | 50 messages | 256 KiB | bounded bootstrap / room-detail query |
| Memory chat | 1 | 3 | 50 messages | 256 KiB | stable cursor / chat infinite query |
| Memory media | 1 | 3 | 30 media | 256 KiB | stable cursor / media infinite query |

The Memory numbers count canonical actor profile resolution, the RPC, and the optional single batched media-path lookup. Media signing is one bounded Storage call, not a database statement. Room list performs no media lookup.

## Cursor and payload rules

- API cursors are opaque base64url encodings of `(created_at,id)`; clients do not construct database predicates.
- A cursor page orders both columns in the same direction and has a matching composite index.
- A concurrent insert newer than page one cannot appear in page two and cannot duplicate a page-one ID.
- Nested arrays are bounded by the parent page and product constraints. Feed cards never include full comments or raw reaction rows.
- Private post and Memory media responses contain delivery URLs and safe media metadata, never raw Storage object paths.
- Count fields come from aggregates or bounded counter/projection contracts, not downloaded rows.
- Home/Circle returns only its ten card DTOs and one cover-media delivery record per post; its RPC reads an eleventh ordered row only to decide `hasMore`.

## Evidence commands

```sh
npm run validate:backend-performance
npm run test:backend-performance
npm run validate:backend-performance:db
npm run validate:backend-performance:api
npm run report:backend-performance
```

The database validator deterministically seeds 10,000 reviews, 2,000 comments, 5,000 notifications, and 5,000 Memory messages. It checks actual `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans for index use/no large-table sequential scan, verifies stable cursor overlap, and asserts the representative public-feed RPC payload budget. Its database execution time is useful for regression comparison only; it is not API p50/p95.

The API validator builds and starts the production Next server against the same local Supabase environment, creates disposable representative data, warms each flow, records 20 p50/p95 samples and maximum response bytes, and deletes the fixture. It covers Circle, public, Explore, restaurant, dish, Profile shell/posts, post detail, comments, notifications, Memory list/detail/chat, and emits only timing/count/size metadata—never tokens, response bodies, signed URLs, messages, or private paths.

## Review policy

Any change that exceeds a budget must either reduce work or update this file and the JSON authority with measured evidence and a named owner. Raising a number only to make CI green is not acceptable. Phase 6 owns rendering, viewport media, tab lifecycle, and client cache behavior. Phase 7 owns production observability. Phase 9 owns hosted capacity and latency acceptance.
