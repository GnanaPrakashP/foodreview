# Table Memory Room media pipeline — targeted audit and remediation

Date: 2026-08-04
Scope: image/video send only; continuation of the two-device acceptance audit
Physical verdict: **FOLLOW-UP FIX IMPLEMENTED LOCALLY, NOT DEPLOYED OR PHYSICALLY RETESTED — NO-GO remains**

This document records the current end-to-end pipeline and the targeted changes made after the physical video/upload failures. Automated and local-database evidence below does not convert any physical two-phone case to PASS.

## Root causes found

1. `addMemoryPhoto()` did not create the room message or attachment until `waitForReadyMedia()` finished. The sender could render a local optimistic tile, but Phone B had no authoritative message/photo row to receive while the worker ran. Video processing time therefore looked like upload time.
2. Phone portrait video was stored as raw landscape pixels plus a 90-degree display matrix. The worker calculated its crop from raw `1920x1080`, while FFmpeg autorotated to `1080x1920` before applying the filter. The resulting crop was outside the rotated frame.
3. Every FFmpeg non-zero exit was labelled a temporary resource failure. A deterministic geometry/transcode failure was retried repeatedly instead of reaching a clear terminal state.
4. A recovered room upload waited for `ready` before attaching and omitted the client timestamp/sequence/order fields required by the media API. A restart between finalize and attach could therefore strand the logical message.
5. A media message and its photo could both contribute to unread state. Media needed one notification/unread owner, with the message retained only as the Chat timeline container.
6. The linked migration attempts exposed historical messages/photos whose authors or uploaders had later left their rooms. The normal membership write guards correctly rejected the classification backfills. The migration now disables only each named guard around its exact historical `activity_kind`/`processing_status` update and immediately reenables it; all runtime writes retain the guards.
7. The deployed Render image uses FFmpeg 5.1. The follow-up worker passed `-autorotate` as a valueless option, syntax accepted by local FFmpeg 8 but rejected by FFmpeg 5 before input decoding. Both newest Phone A videos therefore reached durable message/photo rows and then became terminal `media_video_transcode_failed` assets. The cross-version fix omits the option and relies on FFmpeg's enabled-by-default display-matrix autorotation.
8. The immediate HTTP-result mapper omitted `duration_ms`, so a successfully published video could render as `0 sec` until a later authoritative remap.
9. The bounded Chat and Media RPCs predated the terminal-media policy. They omitted processing metadata from Chat and filtered rejected rows even for the uploader, causing the authoritative failure card to disappear during refetch/reconciliation.
10. The 12-pixel capture-preview timeline thumb used a `-4` pixel top offset from `top: 50%`; it is now centered with `-6`.

## Exact 15-stage timeline after the change

| # | Stage and implementation | Previous state → next state | Durable writes / Realtime | Retry, polling, and blocking | Duplicate/inaccessible risk controls |
| --- | --- | --- | --- | --- | --- |
| 1 | Send press: `MediaPreviewScreen.tsx` calls `addPhoto.mutate()`; `useAddMemoryPhotoMutation()` owns the send | selected → local | None yet | Non-blocking mutation; camera dismisses to Chat | One stable `uploadBatchId` is created before mutation |
| 2 | Optimistic message: `useMemories.ts::onMutate` | local → uploading | QueryClient message/photo; SQLite outbox begins | Sender is not blocked by HTTP | Message uses stable client ID/order key; attachment keys use logical slot, not server photo ID |
| 3 | Local render/staging: `updateOptimisticSource()` and `stageAccountFile()` | picker URI → account-owned file URI | Account-scoped file plus SQLite outbox preview | Local visual remains mounted | Offline sanitizer preserves only owner-scoped `file://` processing previews; no bearer URL is persisted as identity |
| 4 | Upload intent: `mediaPipeline.ts::createMediaUploadIntent()` | prepared → intent_created | `media_assets` created with owner, surface, kind, size, path contract | Network retry is through the persistent recovery record | Idempotency key is the local upload ID; bucket/path are server-issued |
| 5 | Source upload/finalize: `uploadFileUri()` then `/api/media/finalize-upload` | intent_created → source_uploaded → uploaded/processing | Private `media-sources` object; asset upload timestamp; durable processing job from DB trigger | Sender waits for source transfer and finalize only; worker processing no longer blocks room publication | Finalize verifies object existence/size and exact asset/path ownership before publication |
| 6 | Message commit: room media API calls `attach_shared_memory_media_assets_v3` | no server message → media container message | `shared_memory_messages.activity_kind='media'` | One database transaction; no worker polling | Unique room/author/client identity makes repeat requests idempotent |
| 7 | Attachment commit: same v3 transaction | no attachment → uploaded/processing/ready attachment | `shared_memory_photos` row(s), same transaction as #6 | No additional sender wait beyond transaction | Only verified private asset IDs owned by the active member are accepted; no raw/signed location is stored in the row |
| 8 | Initial Realtime publication: transaction commits | peer absent → peer processing item | Message INSERT and photo INSERT events | Realtime is immediate path; cursor refresh is recovery | Peer never receives a pointer before message+attachment+authorized source exist; photo owns Media unread/notification, message does not double-count Chat unread |
| 9 | Worker discovery/start: finalize trigger plus `runMediaProcessingBatch()` | uploaded → processing | One durable job; lease/heartbeat/event writes | Direct durable enqueue; worker claim is independent of sender | Fenced claim token/generation prevents concurrent authoritative completion |
| 10 | Image work: `processImageAsset()` | processing → derivatives staged | Private canonical and thumbnail metadata/objects | Secondary work is asynchronous | While pending, only a bounded signed JPEG/PNG/WebP source is returned to an already-authorized room reader; ready swaps to canonical in place |
| 11 | Video work: `ffprobe()`, `videoDisplayGeometry()`, `processVideoAsset()` | processing → canonical/poster staged | Private canonical MP4 and poster | Probe, transcode, poster and upload have independent timings/timeouts | Crop uses display-oriented geometry after 0/90/180/270 rotation; FFmpeg default autorotation is cross-version compatible; malformed/unsupported geometry is permanent, timeout/signal remains transient |
| 12 | Final asset update: `complete_media_processing_job` plus `sync_shared_memory_photo_from_asset_v1` | processing → ready, or terminal | Asset status; the existing photo row is UPDATEd with canonical metadata/status | No client action required | Same photo ID/message ID; ready transition requires the complete private derivative set; terminal failure is visible only to uploader |
| 13 | Sender final state: room photo Realtime handler + signed refresh | processing overlay/local visual → ready canonical, or clear failure | QueryClient, media/chat pages and SQLite update | Realtime completion triggers refresh; polling is foreground/restart recovery only | Local visual is retained until remote visual is usable; stable slot key avoids disappear/reappear/remount |
| 14 | Peer visibility: initial photo INSERT then ready UPDATE | image source or video placeholder → canonical image/video+poster | Media badge/notification on insert; signed delivery on authorized read | No manual refresh; debounced signed refresh follows Realtime | Pending videos expose no raw source; failed metadata is hidden from peers; no signed URL/storage path enters Realtime or logs |
| 15 | Persistence/reconciliation: SQLite save, cursor sync, `reconcilePendingMediaUploads()` | acknowledged processing → ready/terminal | Owner-scoped SQLite/outbox/recovery records | Restart resumes intent/upload/finalize/attach; status fetch is bounded recovery | Recovered attach includes original client metadata; `serverAttachedAt` avoids repeated attaches; recovery files are deleted after ready/terminal |

## State model

| State | Meaning | Sender | Peer |
| --- | --- | --- | --- |
| `local` | Optimistic file exists only on device | Local preview | Nothing |
| `uploading` | Intent/source transfer active | Preview + byte progress | Nothing |
| `uploaded` | Private source verified; job durable | Preview + processing overlay | Authoritative image or processing placeholder after attach |
| `processing` | Worker owns/awaits job | Same stable tile | Same stable tile; video waits for poster/canonical |
| `ready` | Required derivative set authoritative | Canonical replaces local visual in place | Canonical/playable media |
| `failed` / `rejected` / `cancelled` | Terminal worker outcome | Clear permanent failure state; no false completion | Rejected metadata/source remains fail-closed |

## Timing evidence

Before this change, the captured Phone A source was 19.49 MiB and its asset moved from created at approximately 21:27:06 to uploaded at 21:27:15.425 (about 9.4 seconds). The 17.51-second clip then remained absent from the room while worker processing retried. The product therefore exposed `source upload + worker queue + probe + transcode + poster + derivative upload + attach` as one apparent send wait.

After this change, the architectural publication boundary is `source upload + finalize + one v3 transaction`; worker time is no longer on the room-publication critical path. On the final clean local replay, that v3 transaction completed in 11.6 ms. This is isolated local server/database timing, not a phone/network measurement. A physical after-timing for Phone A and Phone B remains required after deployment; it must report at least send-to-local, source-upload, source-to-peer-placeholder/image, worker-ready, and peer-playable timings.

### Follow-up failure evidence

The two newest reported uploads had durable media messages and attachment rows with real durations of 7,443 ms and 59,606 ms. Both worker jobs were claimed once and rejected about 2.7–3.3 seconds later with `media_video_transcode_failed`; neither produced a derivative. The exact private sources transcode successfully with local FFmpeg 8. In the existing FoodReview worker image (Debian/FFmpeg 5.1, network disabled, one CPU and 512 MiB), the deployed valueless `-autorotate` form fails immediately at option parsing, while the same rotated Motorola source succeeds when the explicit option is removed. This isolates the defect to FFmpeg-version syntax, not duration, rotation metadata, codec, file size or upload integrity.

### Structured segment timing

The deployed retest can report segments independently through these privacy-safe events; elapsed times must not be collapsed into one upload number:

| Segment | Event/evidence |
| --- | --- |
| Local preparation | Mobile span `media.local_preparation` |
| Upload-intent request | Mobile span `media.upload_intent` |
| Private source transfer | Mobile span `media.direct_storage_upload`, including bytes and calculated throughput |
| Finalize/job durability acknowledgement | Mobile span `media.upload_completion_ack` |
| Message + attachment transaction | Server event `memory_media_attach_committed` with `duration_ms` and request correlation ID |
| Queue pickup | Worker `job_queued` → `job_started`, correlated only by a one-way asset hash |
| Download, validation, moderation | Worker `source_download_completed`, `source_validation_completed`, `moderation_completed` |
| Video probe/transcode/poster | Worker `video_probe_completed`, `video_transcode_completed`, `video_poster_completed` |
| Derivative upload/finalization | Worker `derivative_upload_completed` and `job_succeeded` (`derivativeGenerationDurationMs`, `finalizationDurationMs`, total worker duration) |
| Realtime receipt | Mobile span `memory.media_realtime_delivery`, separated by INSERT/UPDATE, status, media kind and sender/recipient role |
| First usable and final render | Mobile spans `memory.media_usable_render` and `memory.media_final_render`, separated by Chat/Media surface and sender/recipient role |
| Full send-to-transaction boundary | Mobile span `memory.media_publication`; detailed spans above remain authoritative for diagnosis |

Client events emit no room, account, asset, URL, storage-path or message identifiers. Phone A/Phone B values for these events remain unavailable until the user-reported API/worker/mobile deployment is physically exercised.

## Implemented files

Runtime and schema:

- `app/api/mobile/memories/[roomId]/media/route.ts`
- `app/api/mobile/memories/read/route.ts`
- `lib/server/media-pipeline.ts`
- `lib/server/memory-media-delivery.ts`
- `mobile/app/memories/[id].tsx`
- `mobile/src/components/memories/camera/MediaPreviewScreen.tsx`
- `mobile/src/hooks/useMemories.ts`
- `mobile/src/security/offlineMemorySecurity.ts`
- `mobile/src/services/mediaPipeline.ts`
- `mobile/src/services/mediaUploadRecovery.ts`
- `mobile/src/services/memories.ts`
- `mobile/src/services/memoryMapper.ts`
- `mobile/src/services/memoryShared.ts`
- `mobile/src/types/models.ts`
- `supabase/migrations/202608040001_table_memory_media_early_publication.sql`
- `supabase/migrations/202608040002_table_memory_media_terminal_visibility.sql`

Regression coverage:

- `tests/media-worker-phase2.test.mjs`
- `tests/shared-memory-phase2-media-security.test.mjs`
- `tests/shared-memory-phase4-mobile-performance.test.mjs`
- `tests/supabase-table-memory-media-early-publication-runtime-validation.mjs`
- `tests/table-memory-media-early-publication.test.mjs`

Migration-head/operations references:

- `docs/database/migration-history-manifest.json`
- `docs/operations/BACKUP_RESTORE.md`
- `docs/operations/MEDIA_WORKER_DEPLOYMENT.md`
- `docs/operations/runbooks/migration-failure.md`
- `lib/observability/config.ts`
- `render.yaml`
- `scripts/local-backup-restore-drill.mjs`
- `scripts/operations-health-report.mjs`
- `scripts/release-metadata-report.mjs`
- `tests/load-capacity-phase9.test.mjs`
- `tests/observability-operations-phase7.test.mjs`
- `tests/supabase-observability-phase7-runtime-validation.mjs`

Audit/status evidence:

- `docs/security/CHAT_PRODUCTION_STATUS.md`
- `docs/testing/TABLE_MEMORY_ROOM_TWO_DEVICE_ACCEPTANCE_AUDIT.md`
- `docs/testing/TABLE_MEMORY_ROOM_MEDIA_PIPELINE_2026-08-04.md`

## Verification completed without claiming physical PASS

- Local migration apply reached head `202608040002`; the manifest validates 100 canonical migrations and 118 historical entries.
- Local Supabase runtime fixture passed uploaded → processing → ready on one photo ID; idempotent repeat returned the same message/photo; peer had Media unread 1 and Chat unread 0; terminal failure was visible only to the uploader through direct RLS and both bounded Chat/Media RPCs, with its 5,984 ms duration intact.
- Real FFmpeg tests passed raw-landscape/90-degree portrait video through full-frame Table Memory crop, canonical MP4 and poster generation on local FFmpeg 8; the reported Motorola clip also passed inside the network-disabled Render-equivalent FFmpeg 5.1 worker image.
- Focused worker/media/read-contract tests pass 24/24; root and mobile type checks, migration-manifest validation, diff validation and the production build pass. A physical phone test remains required after deployment.

## Physical cases still required

Linked migration `202608040002` is applied and the API reports that head. A fresh Phone A upload on the redeployed build durably published a 5.76 MiB portrait video, but the Render job repeatedly lost its entire five-minute lease without a heartbeat or classified failure. The exact 1920x1080/rotation-minus-90 source completes in the FFmpeg 5.1 image, isolating the remaining defect to worker resource pressure rather than media validity. The targeted follow-up pins decoder/filter/encoder threads to one and worker concurrency to one; on the exact source under 512 MiB/0.5 CPU, FFmpeg peak RSS fell from 241,496 KiB to 174,296 KiB and elapsed time fell from 20.8 s to 8.8 s. This follow-up is locally validated but **not yet deployed or physically passed**. Requeue the stuck job only after the bounded worker is live, then exercise both authenticated phones: one image each direction, one portrait video each direction, rapid image/video batches, simultaneous mixed batches, Chat/Media consistency, real duration, no flicker/duplicate/reposition, background/terminated receiver behavior, temporary disconnect/restart recovery, signed-URL expiry, cancellation, permanent failure presentation, membership removal, and before/after timings. Capture both phones and sanitized server/worker events for every failure.

Final verdict remains **NO-GO** until those core two-phone cases pass with no open P0/P1.
