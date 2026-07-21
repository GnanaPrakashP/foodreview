# Home Android release check — 2026-07-21

## Verdict

- Home UI and functional behavior: **PASS** on the connected physical Android device.
- Home public-handoff gate: **NO-GO** until the repeated-flow PSS result is at or below the repository's 40 MiB budget and equivalent signed Android/iOS artifacts pass.

This check covers only the Home client. It is not an API capacity, media-worker, scheduler, backup, or whole-application launch approval.

## Artifact and environment

- Source: `release/mvp-candidate`, worktree based on `a9370dc`
- Device: Motorola edge 70 fusion, Android 16 / API 36
- App: native Release/Hermes build of `com.circlebites.mobile.dev`
- List engine: FlashList
- Backend: production-like staging Vercel API
- Signing: disposable Android debug certificate for local measurement; not an EAS/store signature

## Passed checks

- Cold Home launch completed and rendered real staged content.
- The first page remained visible during refresh; unchanged refresh showed `You're up to date` only after the request completed.
- Pagination reached `TEST 20 — End of feed` and the caught-up state rendered.
- Forward/reverse vertical scrolling and a horizontal carousel forward/back gesture completed without blank cells.
- Like, Save, and Helpful updated against staging and were restored. A second Save tap during the pending mutation was ignored, then succeeded after settlement, matching the duplicate-intent guard.
- No peach-plus-spinner media placeholder appeared in the reviewed recording. BlurHash is neutralized toward near-black. A media spinner is reserved for an active page with no preview. The observed dark spinner was the pagination footer, not a media placeholder.
- No matching app crash, ANR, out-of-memory, React Native exception, or network-failure log was found.
- The production FlashList path now gives every recycled post, interaction, avatar and media subtree its real post/media identity. Release builds no longer depend on a development-only diagnostic flag to reset recycled state.
- Latest native frame result after two confirmed full down/up cycles: 2,991 frames, 11 janky frames (0.37%), p50 12 ms, p90 17 ms, p95 17 ms, p99 18 ms, and zero missed vsync events.
- APK size: 141,539,197 bytes, below the 178,257,920-byte budget.

## Automated gates

- Home-focused tests: 399/399 passed.
- Mobile performance tests: 12/12 passed.
- TypeScript: passed.
- Changed-file ESLint: passed.
- Mobile performance inventory: passed.
- Mobile bundle budget: passed.
- `git diff --check`: passed.

The performance inventory validator was corrected to recognize the release-capable FlashList branch and its 1,200 px render-ahead setting instead of requiring the FlatList-only prop shape.

## Native ownership evidence

A 90-second Perfetto native/ART heap capture was taken from a temporarily profileable copy of the same release bundle, with snapshots at 30, 60 and 90 seconds during the representative Home scroll. The temporary profileability manifest was removed before rebuilding the final candidate.

- Final-versus-first native `Unreleased malloc size` growth: 50.12 MiB.
- `android.graphics.Bitmap.createBitmap` through Glide's `Downsampler`, `DecodeJob` and `LruBitmapPool`: 29.27 MiB, or 58.39% of that native growth.
- React Native and Hermes were materially smaller contributors in the same diff: 6.59 MiB and 5.68 MiB respectively.
- The final live native heap contained 91.59 MiB, with 49.82 MiB cumulative through Android bitmap creation.

This identifies decoded feed media as the dominant native owner. It does not support reducing FlashList render-ahead, removing BlurHash indiscriminately, or clearing the entire image cache, all of which performed worse when measured.

## Remaining blocker and repeatability

The best recorded idle-settled PSS measurement was:

- Baseline after cold launch and 20-second settlement: 219,998 KiB
- After two complete down/up Home cycles and 20-second settlement: 263,618 KiB
- Growth: 43,620 KiB / 42.60 MiB
- Budget: at most 40 MiB
- Miss: 2.60 MiB
- Native heap: 54,436 KiB to 78,056 KiB
- Decoded bitmaps: 88 / 21,629 KiB to 121 / 40,822 KiB
- Views: 692 to 977

Native evidence shows that decoded image ownership and retained recycled-cell views dominate the remaining increase. The release-state recycling correction improved the previous best result by 1,080 KiB and is retained. The following alternatives were measured and rejected before finalizing the worktree because each increased retained memory and/or decode churn:

- Disk-only full-cover caching increased decode churn and memory growth.
- Capping FlashList's off-screen recycle pool at four cells also increased memory growth.
- Unmounting the hidden preview immediately after the full cover loaded grew PSS by 83.69 MiB.
- Glide `MemoryCategory.LOW` grew PSS by about 64.85 MiB.
- Removing inactive-page BlurHash surfaces grew PSS by 56.93 MiB.
- Clearing Expo Image's memory cache after an idle window grew PSS by about 84 MiB; retained cells still owned the decoded surfaces.
- Collapsing single- and multi-media card pools grew PSS by 87.23 MiB because image reassignment/decode churn outweighed the lower initial cell count.
- Retaining covers only for the settled/predictive vertical window grew PSS by 104.25 MiB. Removing distant native image surfaces forced costly decode/remount churn even though its frame result remained good (0.31% jank, p95 17 ms).

All rejected experiments were reverted, and the best verified release build was rebuilt and reinstalled on the connected phone.

A subsequent confirmation run of that restored build produced:

- Cold 20-second baseline: 207,890 KiB PSS; 52,048 KiB native heap; 64,148 KiB graphics; 692 views.
- After pagination to all 20 posts, two confirmed down/up cycles and 20-second settlement: 273,636 KiB PSS; 81,456 KiB native heap; 71,236 KiB graphics; 977 views.
- Cold-to-representative-flow growth: 65,746 KiB / 64.21 MiB, still above the 40 MiB gate.
- After a third complete cycle with no new posts: 263,473 KiB PSS, a decrease of 10,163 KiB / 9.92 MiB from the preceding settled sample.

The third-cycle decrease is useful: this flow does not show monotonic memory leakage after the 20-post cache is populated. It does not, however, turn the strict cold-to-representative-flow budget into a pass. The large variance between the 42.60 MiB best run and 64.21 MiB confirmation run also means a single favorable sample must not be used as approval evidence.

No app-process crash, ANR, out-of-memory, React Native exception, TLS/DNS failure or recorded low-memory process exit matched the final run.

## Required recheck for Home approval

1. Establish five cold and five warmed samples on the store/EAS-signed Android candidate, separating expected first-time 20-post cache population from additional-cycle growth.
2. If the cold 40 MiB policy remains mandatory, reduce decoded feed-media ownership without unmount/remount churn, then repeat the same confirmed two-cycle measurement.
3. Run the same Home flow on a physical iPhone using a signed release candidate.
4. Run the final Android flow on the EAS/store-signed candidate, because this local artifact uses a disposable test certificate.
