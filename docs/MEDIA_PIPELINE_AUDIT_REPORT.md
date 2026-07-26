# Shared Media Pipeline Architecture Audit

**Repository:** FoodReview / CircleBites
**Audit date:** 2026-07-26
**Scope:** Dining Experience posts, Table Memory photos/videos, avatars, mobile upload preparation and recovery, server moderation, processing workers, storage, delivery, and cleanup
**Method:** The original findings came from a static, read-only audit. The
remediation described below was implemented by static code editing only. No
tests, builds, app launches, uploads, migration application, or production-state
queries were performed.

## Remediation status

The shared pipeline has now been hardened without reintroducing
`memoryStorage`. Table Memory remains on the shared Dining Experience media
pipeline, but has its own chat-appropriate policy:

- Table Memory photos and videos are always full-frame. Mobile ignores crop
  metadata for this surface, the server normalizes it to the complete frame,
  and the database rejects new/updated cropped Table Memory intents.
- Images use adaptive preparation toward a 2 MB upload target while the server
  remains the canonical encoder.
- Native mobile uploads stream from a file URI through the platform upload
  task instead of first creating a complete JavaScript `ArrayBuffer`.
- Active native uploads are cancelled during sensitive account cleanup.
- All surfaces now enter the leased worker while moderation is pending; the
  worker performs fail-closed asynchronous moderation before derivatives.
- Missing/malformed moderation responses stay pending rather than becoming
  approved, and Table Memory's accepted video limit is aligned to 20 MB.
- Dining Experience's mute choice is persisted and produces a video without
  an audio stream.
- Worker video output uploads from a file stream, emits explicit compatibility
  settings, strips metadata, and stores Table Memory output dimensions.
- Upload intent creation uses a stable client recovery ID and the server's
  idempotency-claim infrastructure.
- A terminal Table Memory batch cancels its remaining unconsumed assets and
  schedules cleanup.
- Dining Experience review/media attachment is now a service-guarded atomic
  database operation.

Two larger improvements remain:

1. Native file streaming is not byte-offset resumable. A failed transfer still
   restarts that file from byte zero.
2. The recovery journal and staged source files remain in the OS cache
   directory. They survive normal process/app restarts, but storage-pressure
   eviction can remove an unfinished local upload. Already attached media is
   unaffected because the server is authoritative.

The database parts of this remediation are defined in
`202607260002_shared_media_pipeline_hardening.sql` and must be applied before
releasing the corresponding API, worker, and mobile code.

## Executive verdict

The migration has successfully centralized Dining Experience post media and Table Memory photo/video uploads on the same `mediaPipeline`. The old `mobile/src/services/memoryStorage.ts` service is deleted and has no remaining caller. Table Memory voice messages are still handled by a separate legacy audio path.

The shared pipeline has a strong server-side foundation:

- original files and private derivatives use private buckets;
- paths are server-derived and owner-scoped;
- the worker validates signatures, sizes, image dimensions, and video duration;
- image and video output is normalized on the server;
- worker jobs use leases, fencing, retry, dead-letter, and deterministic derivative paths;
- Table Memory attachment is atomic and idempotent;
- Table Memory delivery is actor-scoped and signed;
- sources, abandoned uploads, rejected uploads, and deleted Table Memory items have cleanup flows.

At the time of the original audit it was **not production-ready as a complete
professional upload system**. The original blockers were:

1. Table Memory image moderation approves a successful provider response that omits the expected SafeSearch annotation.
2. Table Memory accepts videos up to 25 MB, but automatic inline moderation refuses anything over 20 MB, leaving those uploads permanently pending.
3. The generic post and avatar pipeline has no active automatic approval path in this repository, while workers only process approved assets.
4. Mobile and worker code load complete media files into memory.
5. Uploads are single-request, non-resumable transfers.
6. Table Memory photos and videos are implicitly center-cropped to 4:5.
7. Dining Experience's `muted` video option is declared but ignored.

### Quality summary

| Area | Assessment | Release position |
|---|---|---|
| Shared architecture | Strong | Keep |
| Private storage and access control | Strong | Keep |
| Server image derivatives | Good | Improve adaptive client preparation |
| Server video transcoding | Functional | Harden compatibility and memory use |
| Table Memory moderation | Unsafe/incomplete | Blocker |
| Post/avatar moderation | Incomplete | Blocker |
| Mobile memory use | Risky for large files | Must change |
| Worker memory use | Risky under concurrency | Must change |
| Upload recovery | Useful but not fully durable | Must improve |
| Upload resume | Missing | Must add for large videos |
| Table Memory atomic attachment | Strong | Keep |
| Dining Experience attachment | Compensating multi-step flow | Improve |
| Storage cleanup | Strong overall | Keep, add client orphan cleanup |

## 1. Confirmed architecture

### 1.1 Shared mobile path

Dining Experience:

`mobile/src/services/posts.ts`
→ `uploadPostMediaAsset(...)`
→ `uploadPersistentMediaAsset(...)` in `mobile/src/services/mediaPipeline.ts`

Table Memory photos/videos:

`mobile/src/services/memories.ts`
→ `uploadMemoryMediaAsset(...)`
→ `uploadPersistentMediaAsset(...)` in `mobile/src/services/mediaPipeline.ts`

Avatars use the same intent, private-source upload, finalize, worker, and status concepts through `uploadAvatarMediaAsset(...)`.

Table Memory voice messages do **not** use this shared pipeline. `mobile/src/services/memories.ts:2046-2061` diverts audio to `addLegacyMemoryAudio(...)`.

### 1.2 Server path

1. `POST /api/media/upload-intent` creates a `media_assets` row and returns an owner-scoped source path.
2. Mobile uploads the source to the private `media-sources` bucket.
3. `POST /api/media/finalize-upload` verifies that the source exists and, for Table Memory, runs inline moderation.
4. An approved asset is queued for server processing.
5. The media worker validates and generates canonical derivatives.
6. Mobile polls `/api/media/status`.
7. The ready asset is attached to a review or Table Memory message.
8. The worker later removes the original source; terminal and abandoned assets are fully removed.

### 1.3 Server authority

The server is authoritative for:

- upload identity and state in `media_assets`;
- processing state in `media_processing_jobs`;
- derivative identity and metadata in `media_derivatives`;
- Dining Experience attachment in `review_photos`;
- Table Memory attachment in `shared_memory_photos`;
- moderation state;
- permanent processed objects in server storage.

The mobile recovery record is an operational journal, not the authoritative copy of an already attached post or room photo.

## 2. Compression and transformation audit

### 2.1 Mobile image preparation

Current behavior:

- only images with a long edge greater than 2400 pixels are resized;
- resized images are encoded once as JPEG at quality `0.85`;
- images at or below 2400 pixels are uploaded unchanged;
- preparation failure silently falls back to the original;
- there is no iterative target-byte algorithm.

Responsible code:

- `mobile/src/services/mediaPipeline.ts:123-126`
- `mobile/src/services/mediaPipeline.ts:179-208`
- `mobile/src/services/mediaPipeline.ts:664-705`

Assessment:

This is a reasonable bandwidth guard, but not a complete compression strategy. A 2400-pixel image can still be large, and an original below 2400 pixels can remain unnecessarily large. The declared 2 MB Table Memory target is not used by the implementation.

The current Table Memory validator also rejects an original image above 10 MB before the shared pipeline gets an opportunity to compress it:

- `mobile/src/constants/memoryMediaPolicy.ts:10-13`
- `mobile/src/services/memoryMediaValidation.ts:47-49`
- `mobile/src/services/memories.ts:2043`

Recommendation:

- validate type and basic metadata first;
- prepare the image;
- enforce the upload limit against prepared bytes;
- resize and recompress iteratively to a target byte range;
- surface preparation failure instead of silently uploading the large original.

### 2.2 Server image processing

Current outputs:

| Surface | Canonical | Secondary derivatives |
|---|---|---|
| Post | 1080 × 1350 JPEG, quality 85 | 720 × 900 progressive feed JPEG, quality 82; 360 × 450 thumbnail |
| Table Memory | Maximum 1600-pixel edge JPEG, quality 85 | Maximum 360-pixel edge thumbnail, quality 82 |
| Avatar | 512 × 512 JPEG | 128 × 128 thumbnail |

The server:

- applies EXIF orientation;
- validates decoded dimensions;
- limits input pixels;
- flattens transparency before JPEG encoding;
- uses MozJPEG;
- generates deterministic derivatives.

Responsible code:

- `lib/server/media-pipeline.ts:623-733`
- `lib/media-image-processing.cjs:8-18`
- `lib/media-image-processing.cjs:20-29`
- `lib/media-image-processing.cjs:71-107`

Assessment:

This part is professionally structured and should remain the canonical transformation layer.

### 2.3 Video processing

Current behavior:

- there is no client-side video compression;
- the server probes the source with `ffprobe`;
- duration and pixel count are validated;
- `ffmpeg` outputs H.264 using `libx264`, `veryfast`, CRF 23;
- audio is encoded as AAC at 128 kbps;
- `+faststart` is enabled;
- a JPEG poster is generated.

Responsible code:

- `lib/server/media-pipeline.ts:736-843`
- `lib/server/media-pipeline.ts:857-897`

Assessment:

Central server transcoding is the right consistency model. The encoding settings are sensible defaults, but the contract should explicitly set:

- `-pix_fmt yuv420p`;
- explicit video/audio stream mapping;
- metadata removal;
- rotation/HDR handling;
- an optional frame-rate cap;
- a defined profile and level where older-device compatibility matters.

The system should not depend on client compression for canonical quality. Optional client-side precompression can reduce upload bandwidth, but the server must continue transcoding.

## 3. Memory and storage behavior

### 3.1 Mobile memory

Every prepared source is read into a complete JavaScript `ArrayBuffer`:

- `mobile/src/services/mediaPipeline.ts:167-171`
- `mobile/src/services/mediaPipeline.ts:443-451`
- `mobile/src/services/mediaPipeline.ts:669-735`

That buffer is then passed to a single XHR request:

- `mobile/src/services/mediaPipeline.ts:540-621`

Uploads are sequential across a multi-media post or Table Memory batch:

- `mobile/src/services/posts.ts:171-184`
- `mobile/src/services/memories.ts:2064-2087`

Sequential processing is good because it avoids holding several upload buffers simultaneously. It does not remove the risk of one large post video occupying roughly its full file size in JavaScript/native bridge memory, with additional copies potentially created by the runtime and XHR.

Recommendation:

- use a native file-stream or URI upload API that does not materialize the complete file in JavaScript;
- use resumable upload sessions for videos;
- retain sequential item processing unless measured concurrency proves safe.

### 3.2 Worker memory

The worker:

- downloads the complete Storage blob;
- converts it to a complete Node `Buffer`;
- retains that buffer while processing;
- for video, writes it to disk and later reads the complete output and poster back into memory;
- uploads derivative buffers from memory.

Responsible code:

- `lib/server/media-pipeline.ts:582-620`
- `lib/server/media-pipeline.ts:736-843`
- `lib/server/media-pipeline.ts:949-968`

This can create simultaneous memory pressure from:

- source `Buffer`;
- decoded Sharp image memory;
- canonical, feed, and thumbnail buffers;
- video output buffer;
- poster buffer;
- ffmpeg process memory.

The configured temporary-byte limit protects disk capacity, not process RSS. With worker concurrency greater than one, a pair of large assets can exceed a modest container memory limit.

Recommendation:

- stream video sources directly to a temporary file;
- upload video output from a file/stream;
- release the source buffer before loading output;
- calculate a concurrency budget from source size, pixel count, and container memory;
- monitor RSS, heap, per-job source/output bytes, and OOM restarts;
- consider lower input image byte and pixel limits.

### 3.3 Mobile recovery durability

Prepared sources are staged under the OS cache directory:

- `mobile/src/services/accountFileStore.ts:9-12`
- `mobile/src/services/accountFileStore.ts:20-25`
- `mobile/src/services/accountFileStore.ts:72-90`

The MMKV recovery journal is also placed in the OS cache directory:

- `mobile/src/security/localMMKV.ts:5-19`
- `mobile/src/services/mediaUploadRecovery.ts:56-68`

The journal retains at most 20 records and prunes records after seven days:

- `mobile/src/services/mediaUploadRecovery.ts:56-59`
- `mobile/src/services/mediaUploadRecovery.ts:249-260`

This means recovery survives normal process death and app restart only while the OS preserves cache files. Storage-pressure cleanup can remove both the staged file and the journal.

Recommendation:

- put the small structured recovery journal in durable, non-backed-up app data;
- keep large staged binaries in an evictable directory if desired;
- model `source_evicted` explicitly and either resume from a server-uploaded source or show a user-visible retry requirement;
- never describe the current journal as guaranteed durable.

## 4. Upload reliability and lifecycle

### Strengths

- owner-scoped recovery records;
- account-generation checks;
- sequential uploads;
- bounded polling;
- upload progress;
- timeouts;
- duplicate Storage object handling;
- deterministic source and derivative paths;
- worker retry, fencing, and dead-letter support;
- automatic source and terminal cleanup.

### Missing resumable upload

The source upload is a single XHR `POST`. A timeout or connection failure restarts from byte zero.

Responsible code:

- `mobile/src/services/mediaPipeline.ts:540-621`

This is acceptable for small photos, but not professional for permitted 60-100 MB server-side video sources on unstable mobile connections.

Recommendation:

- use Supabase resumable/TUS uploads or a chunked signed-upload protocol;
- persist upload session ID and confirmed offset in the recovery journal;
- resume without creating a second asset;
- allow explicit cancellation.

### Upload cancellation

The code tracks and aborts status-poll controllers on account cleanup, but it does not register or abort active XHR uploads:

- `mobile/src/services/mediaPipeline.ts:131-136`
- `mobile/src/services/mediaPipeline.ts:568-621`

Recommendation:

- maintain an active-upload registry;
- abort XHR/native upload sessions on logout, account switch, user cancellation, and app teardown where supported.

### Intent idempotency

`/api/media/upload-intent` requires an idempotency header but does not claim or store it. Every accepted request inserts a newly generated asset:

- `app/api/media/upload-intent/route.ts:22-28`
- `app/api/media/upload-intent/route.ts:50-105`
- `mobile/src/api/client.ts:29-38`

If the server inserts the row but the response is lost, retrying creates another asset. Cleanup eventually removes the orphan, but this is not true request idempotency.

Recommendation:

- use the existing idempotency-claim infrastructure;
- key the claim to a stable `localUploadId`;
- replay the original asset and source path on retry.

### Multi-item Table Memory recovery

Recovery attaches a batch only when all expected records still exist and all are ready:

- `mobile/src/services/mediaPipeline.ts:488-533`

A terminal asset record is immediately removed:

- `mobile/src/services/mediaPipeline.ts:315-333`

If one item in a multi-item batch becomes terminal, the other ready records can no longer satisfy `records.length === assetCount`. The intended room message is never attached, and the ready assets remain abandoned until server cleanup.

Recommendation:

- persist a batch-level recovery record;
- transition the complete batch to failed, retryable, cancelled, or attached;
- cancel and clean the other assets when the batch is permanently failed;
- show a user-visible failure instead of silently stranding it.

### Picked-file lifecycle

Gallery assets are copied into the account cache immediately:

- `mobile/src/services/mediaPicker.ts:9-13`

Normal draft cancellation or removal does not consistently delete every staged file. Completed recovery records are cleaned, but files never entered into recovery can accumulate until account cleanup or OS eviction.

Recommendation:

- add reference-counted draft/recovery ownership;
- delete a staged file when removed from the composer;
- periodically sweep unreferenced account-cache files.

## 5. Moderation audit

### Blocker M1 — Table Memory image moderation can fail open

Current behavior:

The Google Vision request returns `pending` on transport failure or a non-2xx response. However, when the response is successful but lacks `safeSearchAnnotation`, the function returns `approved`.

Responsible code:

- `lib/server/memory-media.ts:329-360`, especially line 357
- `app/api/media/finalize-upload/route.ts:134-160`

Why this is unsafe:

A malformed provider response, partial response, provider-side per-image error, or unexpected schema should not become approval.

Required change:

- treat a missing annotation or provider response error as `pending`;
- parse JSON inside an error boundary;
- use an explicit request deadline;
- record a safe reason code without logging media or provider secrets.

### Blocker M2 — 20-25 MB Table Memory video dead zone

Current behavior:

- mobile accepts Table Memory videos up to 25 MB;
- inline moderation refuses video buffers above 20 MB and returns `pending`;
- finalize returns HTTP 423;
- there is no generic asynchronous `media_assets` moderation worker in this repository to later approve that asset.

Responsible code:

- `mobile/src/constants/memoryMediaPolicy.ts:15-18`
- `mobile/src/services/memoryMediaValidation.ts:47-55`
- `lib/server/memory-media.ts:50-53`
- `lib/server/memory-media.ts:275-297`
- `app/api/media/finalize-upload/route.ts:134-145`

Result:

A valid 20-25 MB Table Memory video can upload successfully but never reach processing.

Required change:

- preferred: move video moderation to an asynchronous job that can inspect the private source without base64 embedding the full video;
- interim: make the accepted limit no greater than the actual moderation limit;
- centralize the limit so mobile validation, intent creation, moderation, and worker validation cannot drift.

### Blocker M3 — Posts and avatars lack an automatic approval path

Current behavior:

- new `media_assets` rows default to `moderation_status = 'pending'`;
- workers claim only approved assets;
- the shared finalize route automatically moderates only `surface === 'memory'`;
- the other approval caller is an internal/manual moderation route.

Responsible code:

- `supabase/migrations/202607130008_mobile_api_security.sql:273-293`
- `supabase/migrations/202607130008_mobile_api_security.sql:376-428`
- `app/api/media/finalize-upload/route.ts:134-162`
- `app/api/internal/moderation/reports/route.ts`

Result:

Within the audited repository, a new Dining Experience post asset or avatar cannot automatically progress from pending moderation into the processing worker. A separately deployed operator/provider could fill this gap, but no such active generic service is implemented here.

Required change:

- implement a durable moderation queue for all surfaces;
- explicitly define image and video providers and fail-closed behavior;
- approve/reject via the existing audited moderation RPC;
- expose queue age, pending count, uncertain count, provider failure rate, and manual-review backlog.

### Inline moderation resource cost

Table Memory finalize downloads the complete source into server memory and then base64-encodes it for Google:

- `app/api/media/finalize-upload/route.ts:134-142`
- `lib/server/memory-media.ts:329-370`

This amplifies request memory and keeps a user-facing HTTP request open while the provider responds.

Recommendation:

- finalize should verify and enqueue;
- moderation should run asynchronously under a lease;
- the client should poll/subcribe to state;
- provider calls need hard deadlines and retry classification.

## 6. Correctness defects introduced or exposed by the shared pipeline

### C1 — Table Memory defaults to a 4:5 crop

Current behavior:

The default crop sets `targetAspect` to 4:5 for any image or video that is not an avatar. Table Memory does not supply an override, so room photos and videos are center-cropped.

Responsible code:

- `mobile/src/services/mediaPipeline.ts:285-292`
- `mobile/src/services/mediaPipeline.ts:664-705`
- `mobile/src/services/mediaPipeline.ts:773-787`
- `lib/media-image-processing.cjs:44-68`

Required change:

- post media may keep its intentional 4:5 crop;
- Table Memory should default to the full source rect with `targetAspect: null`;
- an explicit user crop should remain supported when intentionally provided.

### C2 — Dining Experience `muted` video is ignored

Current behavior:

`CreatePostMediaInput.muted` promises that the audio track is stripped, and the UI passes the flag. `uploadOneWithProgress` does not pass it into the shared pipeline, the intent does not store it, and ffmpeg always encodes audio.

Responsible code:

- `mobile/src/services/posts.ts:10-21`
- `mobile/src/services/posts.ts:140-157`
- `mobile/app/(tabs)/share.tsx:590-604`
- `lib/server/media-pipeline.ts:763-781`

Required change:

- persist an explicit audio policy in the media intent;
- use `-an` for muted videos;
- include the policy in idempotency normalization and server validation.

This is a correctness and privacy issue, not merely an optimization.

### C3 — Table Memory video dimensions remain null

Current behavior:

The server records fixed dimensions for post and avatar videos but returns null width/height for Table Memory:

- `lib/server/media-pipeline.ts:814-841`
- `lib/server/media-pipeline.ts:857-867`

Those null values propagate into room photo metadata and delivery:

- `supabase/migrations/202607260001_shared_memory_media_pipeline.sql:369-407`
- `lib/server/memory-media-delivery.ts:180-198`

Required change:

- compute scaled output dimensions from the probed/cropped dimensions, or probe the final MP4;
- store canonical width and height for stable layout placeholders.

## 7. Dining Experience versus Table Memory

| Concern | Dining Experience | Table Memory |
|---|---|---|
| Shared mobile upload core | Yes | Yes |
| Private original | Yes | Yes |
| Private processed derivative | Yes | Yes |
| Server image/video normalization | Yes | Yes |
| Automatic moderation in audited code | No | Yes, but currently unsafe/incomplete |
| Final attachment transaction | Multi-step with compensation | Atomic service-guarded RPC |
| Stable attachment idempotency | Not complete | Yes, batch/client ID |
| Recovery metadata | Per asset | Per asset plus room batch metadata |
| Default aspect | 4:5, expected for feed | 4:5, incorrect for general room media |
| Video audio policy | `muted` ignored | Always preserves/encodes audio |
| Canonical video dimensions | Stored | Null |

### Dining Experience attachment

The review flow creates a draft review, inserts media rows, marks assets consumed, and activates the review in separate database operations with compensating deletion:

- `app/api/reviews/route.ts:210-315`

This is thoughtfully compensated, but a transaction/RPC would provide stronger atomicity and simpler recovery from a lost response.

Recommendation:

- create a service-guarded atomic review/media attachment RPC;
- use a stable client post ID;
- return the existing post on duplicate delivery.

### Table Memory attachment

The Table Memory route claims idempotency and calls an atomic RPC:

- `app/api/mobile/memories/[roomId]/media/route.ts:49-117`
- `supabase/migrations/202607260001_shared_memory_media_pipeline.sql:224-435`

It verifies owner, surface, access class, room membership, moderation, readiness, and unconsumed state before atomically creating the message/photos and consuming assets.

Assessment:

This is the stronger pattern and should be reused for Dining Experience.

## 8. Security and privacy

### Strong controls

- source bucket is private;
- post and Table Memory derivatives use `media-private`;
- only avatars use `media-public`;
- upload RLS binds bucket/path to an unexpired owner asset;
- storage paths are server-generated and validated;
- clients do not receive a service-role credential;
- worker paths are deterministic;
- MIME and signature are independently checked;
- Table Memory delivery validates asset state, owner, room-linked photo, private bucket, path prefix, moderation, and consumption before signing;
- `SECURITY DEFINER` functions inspected in this path set an empty `search_path` and are service-role guarded.

Responsible code:

- `supabase/migrations/202607100001_media_pipeline.sql:7-162`
- `supabase/migrations/202607100001_media_pipeline.sql:190-254`
- `lib/server/media-pipeline.ts:582-620`
- `lib/server/memory-media-delivery.ts:57-200`
- `supabase/migrations/202607260001_shared_memory_media_pipeline.sql`

### Important qualification

Private storage is strong, but moderation fail-open behavior still makes the overall Table Memory media security posture unacceptable until corrected.

## 9. Cleanup and deletion

### Server cleanup

The worker cleanup policy is:

- consumed ready asset: delete original source when due, retain permanent derivative;
- unconsumed ready asset older than seven days: delete source and derivatives, then delete asset;
- failed, rejected, expired, abandoned, or cancelled asset: delete source and derivatives when due;
- retry cleanup failures under a lease.

Responsible code:

- `supabase/migrations/202607130003_media_worker_reliability.sql:818-960`
- `lib/server/media-pipeline.ts:1217-1294`

### Table Memory item deletion

Deleting an attached Table Memory photo or authored media message:

- deletes the room rows;
- resets `consumed_at`;
- marks the asset cancelled;
- schedules source cleanup;
- allows the generic cleanup worker to remove derivatives and the asset.

Responsible code:

- `app/api/mobile/memories/[roomId]/media/route.ts:120-200`
- `supabase/migrations/202607260001_shared_memory_media_pipeline.sql:455-540`

Assessment:

This lifecycle is correctly connected.

## 10. Complete prioritized findings

| ID | Severity | Finding | Must change? |
|---|---|---|---|
| M1 | Critical | Missing image moderation annotation is approved | Yes, before release |
| M2 | Critical | Table Memory accepts 25 MB video but moderation stops at 20 MB | Yes, before release |
| M3 | Critical | Post/avatar assets have no automatic approval path in audited code | Yes, before release |
| C1 | High | Table Memory media is implicitly cropped to 4:5 | Yes |
| C2 | High | Dining Experience muted video keeps audio | Yes |
| R1 | High | Mobile reads the entire source into JS memory | Yes |
| R2 | High | Worker holds full source and output buffers | Yes |
| R3 | High | Large uploads are not resumable | Yes |
| R4 | High | Recovery journal is stored in OS cache | Yes |
| R5 | High | One terminal batch item can strand the rest of a Table Memory batch | Yes |
| R6 | Medium | Upload-intent idempotency header is not actually claimed | Yes |
| R7 | Medium | Dining Experience attachment is not atomic | Recommended |
| R8 | Medium | Mobile, generic server, and moderation limits drift | Yes |
| R9 | Medium | Original Table Memory image is rejected before compression | Yes |
| R10 | Medium | Active source upload is not aborted on account cleanup | Yes |
| R11 | Medium | Cancelled/removed picked files can remain staged | Yes |
| C3 | Medium | Table Memory canonical video dimensions are null | Yes |
| V1 | Medium | ffmpeg output compatibility contract is implicit | Recommended |
| V2 | Low | BlurHash is a one-color, six-character placeholder | Optional |

### Current status of those findings

| Status | Finding IDs |
|---|---|
| Fixed in code/migration, pending deployment verification | M1, M2, M3, C1, C2, R1, R5, R6, R7, R8, R9, R10, C3, V1 |
| Partially fixed | R2 — canonical video output is streamed, but provider moderation still requires the source buffer |
| Still open | R3 — true byte-offset resumable upload; R4 — recovery journal outside evictable cache; R11 — complete draft-file reference counting/sweeping |
| Optional, unchanged | V2 |

## 11. Recommended implementation order

### Phase 0 — Release blockers

1. Make Table Memory moderation fail closed.
2. Add deadlines, schema validation, and safe retry classification to provider calls.
3. Replace inline video moderation with a durable async moderation job.
4. Implement the same automatic moderation lifecycle for posts and avatars.
5. Align all mobile, intent, moderation, and worker limits.
6. Stop default 4:5 cropping for Table Memory.
7. Honor the Dining Experience mute flag.

### Phase 1 — Memory and reliability

1. Replace JavaScript `ArrayBuffer` source uploads with native streaming/resumable upload.
2. Persist upload-session ID and offset.
3. Stream worker video input/output and introduce RSS-aware concurrency.
4. Move the recovery journal out of OS cache.
5. Add group-level Table Memory batch recovery.
6. Make upload-intent creation genuinely idempotent.
7. Add upload cancellation and staged-file lifecycle cleanup.

### Phase 2 — Data consistency and media polish

1. Make Dining Experience review/media attachment atomic.
2. Implement adaptive image target-size preparation.
3. Store Table Memory video dimensions.
4. Add explicit video compatibility flags and metadata stripping.
5. Replace the single-color BlurHash with a useful multi-component placeholder if visual quality justifies it.

## Final conclusion

The decision to remove the old Table Memory photo/video storage path and use the Dining Experience media pipeline was architecturally correct. The result is substantially better than maintaining two independent implementations, especially for private storage, derivative consistency, validation, worker reliability, and cleanup.

The migration does not yet make the pipeline fully professional. The shared core has exposed several cross-surface contract problems—especially moderation, memory use, resumability, crop policy, and audio policy. Correcting those contracts in the shared pipeline is preferable to introducing another Table Memory-specific uploader.

**Recommended status:** keep the unified pipeline and do not reintroduce
`memoryStorage`. Apply the hardening migration before deploying the worker/API
changes. Treat resumable uploads and durable unfinished-upload recovery as the
remaining reliability work; neither changes the server authority or full-frame
Table Memory policy.
