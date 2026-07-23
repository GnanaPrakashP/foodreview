# Profile Android release check — 2026-07-22

## Outcome

The repeated other-user Profile lifecycle passes the repository's steady-state memory budget on the connected physical Android phone after backporting React Native's Fabric active-touch cleanup.

This approves the tested Profile scrolling/navigation flow on this local non-debuggable release artifact. It is not a substitute for a final EAS/store-signed Android run or physical iOS evidence.

## Test target

- Device: Motorola Edge 70 Fusion (`ZA223JVWG7`), Android API 36, 1272×2772.
- App: `com.circlebites.mobile.dev`, non-debuggable minified release runtime.
- Backend: `https://foodreview-c5irdnk3r-gnana-prakashs-projects-2da6e3af.vercel.app`.
- List: FlashList with the production Profile media pipeline.
- Content: `Media Author B`, nine media-rich posts.
- Flow: two warm full Profile scrolls, then five asserted cycles of ten upward swipes, ten downward swipes, Back to Home, and reopen from the same Home author target. Every Profile and Home transition was verified from the Android accessibility hierarchy.

## Root cause and correction

Before the correction, five cycles grew median PSS by 71.4 MiB, Views from 1,678 to 4,130, and decoded bitmaps from 180 to 548. React post cards unmounted, but the native views stayed registered.

The Android heap path ended at `FabricUIManager -> MountingManager -> SurfaceMountingManager.mTagToViewState`. `mViewsWithActiveTouches` contained 93 tags and `mViewsToDeleteAfterTouchFinishes` contained 89 tags. React Native 0.81.5 marked a touch on `ACTION_DOWN`, but did not sweep it when a native scrolling child intercepted the gesture.

The mobile install now backports the upstream correction from [facebook/react-native#52995](https://github.com/facebook/react-native/pull/52995): sweep the active Fabric tag before clearing the dispatcher target. Android resolves `react-android` and Hermes from the patched React Native composite source build until the app upgrades to a React Native release containing that fix.

The patched diagnostic heap after five cycles showed both Fabric sets at size 0. Decoded bitmap instances fell from 466 in the leaking diagnostic heap to 200.

## Final non-debuggable release result

- Settled baseline median PSS: 283,626 KiB.
- Stable post-GC final median PSS: 308,679 KiB.
- Growth: 25,053 KiB / 24.47 MiB.
- Budget: at most 40 MiB.
- Views: 1,622 while Profile was mounted; 1,315 after the final return to Home.
- Frames: 2,582 total, 35 janky (1.36%).
- Frame latency: p50 13 ms, p90 18 ms, p95 20 ms, p99 32 ms.
- Crashes, ANRs, OOMs, and React Native fatal exceptions: none found.

ART had not collected eligible detached views at the first post-flow sample: it reported 3,227 Views and 348,462 KiB PSS. The first memory inspection initiated normal collection; Views then stabilized at 1,315 and PSS at about 309 MiB. This is reclaimable garbage rather than the prior monotonic Fabric registry leak, as confirmed by the empty active-touch/deferred-delete sets and the stable three-sample result.

## Remaining release evidence

- Repeat on the final EAS/store-signed Android artifact.
- Run the equivalent repeated Profile flow on a signed physical iPhone.
- Remove the React Native source backport when the Expo/React Native upgrade contains the upstream fix.
