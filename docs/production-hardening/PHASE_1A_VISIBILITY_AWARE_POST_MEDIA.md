# FoodReview Production Hardening — Phase 1A

## Gate

**Status: BLOCKED pending disposable-staging database, Storage, backfill, and native-client verification.**

The repository implementation is complete and passes its focused local gates. It must not be deployed until the manual checks below prove the migration against the real Supabase Storage/CDN behavior and the production data shape. This document deliberately does not authorize Phase 1B, 1C, or any later hardening work.

## Architecture decision

Phase 1A selects **Model A: private canonical post media with authorized delivery**.

Every mutable post derivative—public, circle, and me/private—is stored in `media-private`. The post visibility becomes an authorization rule, not a bucket-publicity choice. Avatars remain the only `avatar_public` media in `media-public`; Memory remains `memory_private` in `media-private` and its product flow is unchanged.

The canonical classifications are:

| Post/asset state | Access class | Object location | Fresh delivery rule |
| --- | --- | --- | --- |
| public post | `public_post` | `media-private/private-posts/...` | anyone, unless blocked/suppressed |
| circle post | `circle_post` | `media-private/private-posts/...` | owner or current one-way circle member |
| me/private post | `private_post` | `media-private/private-posts/...` | owner only |
| Memory media | `memory_private` | `media-private` | existing Memory authorization path |
| avatar | `avatar_public` | `media-public` | permanent public avatar URL |

Mobile requests authorized media in bounded batches from `POST /api/media/access`. Web review DTOs use stable `/api/media/object/{assetId}/{kind}` endpoints; each request re-evaluates the current review, membership, block, and suppression state and redirects to a signed Storage URL. The signing operation uses the service-role client only on the server.

Signed post URLs live for **300 seconds**. New post derivative object metadata also advertises a 300-second cache lifetime. Feed and Profile queries refresh at four minutes and on foreground. An already downloaded byte stream cannot be recalled from a user's device, and an already issued signed URL can remain usable for at most its five-minute lifetime; this is the explicit revocation window. Fresh requests are denied immediately after visibility change, circle removal, block, suppression, or deletion.

Expected cost is one bounded authorization request per mobile page, one batched database authorization evaluation plus one Supabase batch-sign operation, and web object redirects as images are requested. This adds server and signing cost compared with permanent public URLs, but prevents a public URL from surviving a later public-to-private transition. Circle, Profile, Explore, public feed, and detail consumers all use the same canonical DTO (`mediaAssetId`, `accessClass`, canonical/thumbnail/poster URL, dimensions, placeholder, and expiry); raw paths are not part of the client contract.

## Active runtime path

1. Mobile or web chooses post visibility before creating each media intent.
2. `POST /api/media/upload-intent` validates the visibility, binds owner/surface/access class, and creates an owner-scoped source path.
3. The client uploads only to the returned `media-sources` path.
4. `POST /api/media/finalize-upload` validates the bound source; the existing processor creates derivatives under `media-private/private-posts/{ownerId}/{assetId}/...`.
5. Upload status returns derivative metadata only. It returns no signed URL, public URL, bucket, or storage path.
6. Review creation accepts media asset IDs, verifies owner, ready state, unconsumed state, private derivatives, and exact access-class match, then links `review_photos` with legacy URL columns null.
7. Public/Circle/Profile/Explore/detail consumers retrieve the canonical authorized media DTO in batches or use the web authorization endpoint.
8. Visibility changes execute `set_review_visibility_with_media_access` through the server service-role client. The function validates all linked media and atomically changes review visibility and access classes.
9. Suppression/deletion makes fresh authorization fail. Existing deletion cleanup removes the object; a previously issued URL retains only the bounded five-minute exposure window.

Legacy post categories on `/api/mobile/review-media/*` now return 410. That path remains active for avatars only. Legacy database URL fields remain readable during migration solely so existing records can be inventoried and moved; new generic post creation cannot populate them.

## Authorization rules and transitions

Authorization fails closed when visibility is missing/unknown, media is not `ready`, privacy state is not `stable`, the derivative is not private, access class disagrees with review visibility, or the review is deleted, hidden, reported, or inactive.

| Transition | Atomic database result | Fresh media access after commit |
| --- | --- | --- |
| public → circle | review `circle`, assets `circle_post` | owner/current members only |
| public → me | review `me`, assets `private_post` | owner only |
| circle → public | review `public`, assets `public_post` | eligible public viewers |
| circle → me | review `me`, assets `private_post` | owner only |
| me → public | review `public`, assets `public_post` | eligible public viewers |
| me → circle | review `circle`, assets `circle_post` | owner/current members only |

Circle membership removal, either-direction block, review suppression, deletion, access-class mismatch, and failed/migrating privacy state all deny new signed URLs. A transition is rejected rather than partially applied if any linked media is still legacy/public/unmigrated.

## Database and Storage migration

Both currently configured migration roots contain byte-identical `202607130001_visibility_aware_post_media.sql` files because PH-301 has not yet established a single canonical root. This phase does not rewrite prior migration history.

The migration adds `media_assets.access_class`, a fail-closed `privacy_state`, durable `media_privacy_migration_jobs`, nullable legacy `review_photos.public_url`, linkage uniqueness, derivative/bucket consistency triggers, avatar-only public read policies, and the service-role-only atomic visibility RPC. The RPC uses `SECURITY DEFINER` with an empty `search_path` and is revoked from public, anonymous, and authenticated roles.

Existing post assets default to `needs_backfill`; ambiguous/unlinked records default to private rather than public. Public object policies no longer grant post derivatives after migration. This database policy change does not delete old objects from a bucket configured as public, so migration plus verified backfill are one release gate.

## Backfill and inventory

The backfill is operator-controlled and never runs automatically:

```bash
npm run media:visibility-report
npm run media:visibility-report -- --after=<last-review-photo-id> --limit=500
npm run media:visibility-backfill -- --apply --after=<last-review-photo-id> --limit=500
```

Required environment names are `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`. Never paste those values into logs or reports.

Dry-run output contains counts by visibility, source bucket, generic/legacy shape, ambiguity, failure, and pagination cursor; it does not print object paths or credentials. Apply mode creates a durable job first, copies to the private object, downloads and byte-count verifies the replacement, updates derivative/photo metadata, deletes the obsolete public object, and only then marks the asset stable and job complete. Legacy rows use their review-photo UUID as a deterministic asset ID, so retries resume the same asset/job. Failed or interrupted rows remain `failed`/`migrating`, deny delivery, retain retry metadata, and must be rerun.

Production completion criteria:

- dry-run pages cover the full dataset and `ambiguous=0`, `failed=0`;
- every post derivative is in `media-private`, has `public_url IS NULL`, and has `privacy_state='stable'`;
- every durable job is `complete`;
- no old post object is retrievable anonymously from `media-public` or `review-photos`;
- review legacy `photo_url`, `photo_urls`, and linked `review_photos.public_url` are null;
- a second full apply is idempotent and reports no new migrations.

## Mandatory disposable-staging verification

Run this before production and retain sanitized command output:

1. Back up the database and Storage inventory. Apply the migration to a disposable production-like project.
2. Run the complete dry-run report, adjudicate every ambiguous row, then run apply pages until complete. Rerun once to prove idempotency.
3. Create users Owner, Member, Stranger, and Blocked. Create image and video posts in public, circle, and me visibility.
4. For every class, test database-row visibility separately from object retrieval. Copy the private path and confirm anonymous and authenticated direct Storage requests fail.
5. Confirm public media is obtainable anonymously only through the authorization endpoint, while circle/me enforce the current actor.
6. Exercise all six visibility transitions. Reuse an old signed URL until it expires; confirm it fails after 300 seconds and no fresh URL is issued to a newly unauthorized actor.
7. Remove Member from the circle, block in each direction, suppress/report/hide a review, and delete a review. Confirm each prevents a fresh URL and direct object reads remain denied.
8. Interrupt the backfill after copy, after metadata update, and after public deletion. Rerun and confirm one asset/job, verified private bytes, eventual public deletion, and terminal `complete` state.
9. Test Circle, public, Profile, Explore, detail, notification, and share surfaces with image/video/empty media. Confirm no response or log contains a storage path or privileged credential.
10. Run native Android and iOS release builds: cold start, foreground refresh after four minutes, visibility change while cached, membership removal, block, logout/login, and signed-URL expiry.

The gate remains BLOCKED until this matrix is executed. Local mocks prove policy behavior but do not prove the hosted Storage/CDN or existing production data.

## Credential containment preflight

Tracked mobile code uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. No tracked source, example, EAS configuration, or generated reference uses a privileged Supabase public variable. The local ignored `mobile/.env.local` contains the forbidden variable name `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`; its value was not read, printed, decoded, or placed in this report, and repository/bundle exposure was not proven.

`mobile/app.config.js` now rejects that exact name, other public service-role/secret names, and privileged names placed in Expo `extra`, without reading or printing values. Production is blocked until the credential owner removes the local variable, determines whether its value was privileged, rotates it if necessary, and verifies a release export/bundle contains neither the variable name nor a privileged JWT.

## Roll-forward and rollback

Roll forward in this order: credential containment → backup/inventory → migration → backfill to zero ambiguous/failed → staging authorization matrix → server/web deployment → native clients. Keep the old read columns during the monitored rollout, but do not restore legacy post writes.

Application rollback is safe only to code that does not write post media publicly. Do **not** roll back to a build that assumes permanent `public_url` values after public policies have been narrowed. Database rollback must not drop access/privacy/job metadata or make `media-private` public. If the release is unhealthy, stop post mutations/uploads, keep private policies and fail-closed authorization, repair/roll forward, and restore only from the pre-migration backup in an isolated project if necessary. Old public objects may be deleted only after the verified private replacement exists; restoration must never make a circle/private object public.

## Local evidence and remaining risks

Focused policy, transition, route, upload, processor, DTO, consumer, Expo containment, and migration/backfill source tests pass. A clean local Supabase reset applied the full root chain through the Phase 1A migration. Database lint completed with pre-existing `extensions`/pgTAP findings and no Phase 1A `public`-schema finding; the project still has zero pgTAP files. Root/mobile typecheck and zero-error lint pass. The full test/build/export result is recorded in the branch handoff.

Remaining risks are hosted Storage/CDN behavior, production data ambiguity, the unresolved dual migration histories (PH-301), absence of real database/Storage policy tests (PH-302), the unremoved ignored environment name (PH-001), the five-minute unavoidable lifetime of already issued URLs, device image caches retaining already downloaded bytes, and later-phase account deletion/cache isolation/worker availability work. None of those is represented as completed by Phase 1A.
