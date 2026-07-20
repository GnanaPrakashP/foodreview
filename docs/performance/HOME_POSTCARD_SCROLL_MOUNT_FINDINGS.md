# Home PostCard Scroll-Mount Findings

## Executive summary

The Home feed's perceptible upward bump is most strongly associated with mounting a complete incoming `PostCard` native tree while a vertical scroll is active.

The problem is not explained by the scroll offset, base `FlatList` geometry, media loading alone, SVG icons alone, or relative-timestamp calculation alone. Those elements can contribute frame cost, but the successful ten-row premount experiment shows that the decisive difference is whether the complete row already exists natively before it approaches the viewport.

No production fix has been approved or implemented yet.

## Current production-path problem

The normal Home feed uses React Native `FlatList` virtualization. Only an initial subset of the ten fetched posts is mounted. As the user scrolls, an incoming row is created close to the viewport.

Creating that row requires Fabric to mount and lay out the complete PostCard hierarchy, including:

- header, avatar, author metadata and menu;
- place, caption, dishes and tags;
- media and carousel structure;
- like, comment, share and bookmark controls;
- Helpful/Disagree feedback controls;
- text, Pressables, accessibility nodes and SVG icons;
- component effects and state synchronization.

This aggregate work can exceed the available frame budget. The visible result is a small bump even when the native scroll offset itself remains continuous.

The latest normal-`FlatList` timestamp-stability confirmation still reproduced the bump:

| Measurement | Result |
| --- | ---: |
| Perceptible bump | Present |
| Valid frames | 648 |
| Deadline-janky frames | 11 (1.70%) |
| p95 | 17 ms |
| p99 | 65 ms |

This rejects relative-timestamp derivation as the primary cause.

## Why the ten-row premount test was smooth

The successful diagnostic mounted all ten complete initial-page PostCards before the manual scroll began and retained those native trees.

Media bytes did not all need to be downloaded. The important part was that the native row structure—text, controls, wrappers, SVG surfaces and media containers—had already completed its initial Fabric mounting and layout.

During the test scroll, crossing into the next post therefore required mostly moving and drawing existing native views. It did not require creating another complete PostCard hierarchy inside an active gesture. The perceptible bump was absent.

Premount did not remove the expensive work. It moved that work from scroll time to the pre-scroll startup period.

## Why premount is not the production solution as tested

The diagnostic deliberately removed normal resource constraints to prove causality. Shipping it unchanged would create several risks:

1. **Startup latency:** mounting all ten complex cards before the feed is ready front-loads Fabric, text and component work.
2. **Memory growth:** every retained PostCard keeps native views, React state, event handlers, accessibility nodes and some media state alive.
3. **Pagination:** retaining only the first ten posts does not solve row mounting for later API pages.
4. **Unbounded retention:** retaining every subsequently loaded page would eventually become unsafe, especially on low-memory Android devices.
5. **Media and video pressure:** fully retained cards can hold carousel, image and video-related resources even when they are far from the viewport unless those resources have a separate lifecycle.
6. **Reverse scrolling:** evicting older rows incorrectly can recreate the same bump when the user scrolls upward.
7. **Readiness trade-off:** blocking interaction until all ten cards mount may make the feed feel slower even though scrolling later feels smoother.

The earlier bounded warm-window attempt is not evidence against the premount finding. That implementation produced large blank gaps and still bumped, meaning its list geometry and retention behavior were not equivalent to the successful premount control.

## What the other experiments established

- Static fixed-height rows were smooth, excluding the route shell, safe area, header and base list geometry as primary causes.
- SVG placeholders reduced frame cost, but the bump remained. SVG uploads are contributors, not the primary cause.
- FlashList recycling did not remove the perceptible bump. Recycling the outer cell did not eliminate the work of rebinding or mounting the complex inner PostCard hierarchy.
- Stable relative timestamps on the full real PostCard did not remove the bump.
- Pixelfed's web feed is not a directly comparable native implementation. It appends posts early, retains their DOM trees and lazy-loads media; it does not pay React Native Fabric row-mount cost at each viewport boundary.

## Production direction to validate

The evidence supports a bounded, idle-time warm-mount strategy on the existing production `FlatList`, not unconditional premounting and not an immediate FlashList migration.

A production candidate should:

- fetch upcoming posts early;
- mount real upcoming PostCard shells only while dragging and momentum are idle;
- retain a strictly bounded window around the viewport;
- keep one canonical list and preserve exact item geometry—no spacer replacement;
- avoid evicting or rebinding rows during an active gesture;
- manage image, carousel and video resources separately from retaining the row shell;
- validate forward scrolling, reverse scrolling, fast flings, pagination and low-memory Android behavior.

It should be accepted only if physical-device evidence shows:

- no perceptible bump;
- no PostCard mounts during dragging or momentum for warmed rows;
- no blank gaps or scroll-position correction;
- bounded memory after multiple pages;
- acceptable initial-content and readiness latency;
- stable media and video ownership.

## Conclusion

The confirmed issue is not one bad timestamp or one SVG. It is the combined native mounting cost of a full PostCard arriving during active scrolling. Premount succeeds because it pays that cost before the gesture, but its diagnostic form trades scrolling smoothness for startup work and retained memory. The production task is therefore to schedule and bound that work safely, not simply mount every post forever.

## Follow-up: recycling-aware migration

The failed FlashList result above describes an outer-cell-only A/B. A later development-only migration now makes the inner `PostCard` explicitly safe for logical-item reassignment, adds stable mapped child identity, separates incompatible recycling pools, retains one cover surface per bounded cell, and isolates media-owner updates to affected post IDs. This follow-up does not invalidate the earlier device result; it tests a materially different architecture.

See `HOME_FLASHLIST_RECYCLING_MIGRATION.md` for the implementation boundary and physical-device acceptance gates. No production list migration is approved until that run passes.
