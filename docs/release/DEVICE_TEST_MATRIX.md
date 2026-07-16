# Device and release test matrix

Repository date: 2026-07-14. No physical Android or iOS device was available during the local implementation pass. Emulator/simulator/build evidence must be labelled separately.

## Required devices

| Platform | Minimum | Common | Latest | Form-factor/constraint |
| --- | --- | --- | --- | --- |
| Android | API 24 / Android 7 | Android 14 or 15 | Android 16/API 36 | mid-range physical phone plus a lower-memory device |
| iOS | iOS 15.1 | iOS 18 | latest supported by Xcode 26 | small-screen iPhone plus a modern notched iPhone |

iPad/tablet support is disabled. Orientation is portrait. On every row verify safe areas, keyboard, dark/light mode, large text, camera/gallery/video/audio, optional location, notification denial, background/foreground, low-memory/process death, TLS/no cleartext and app-killed links.

## Two-account matrix

Use synthetic Owner and Other accounts in disposable staging. Run existing-user and new-user email OTP, Google OAuth, invalid/expired code, resend cooldown, logout online/offline, account switch, invalid token, frozen/deleting account and deletion acceptance. Confirm complete profiles enter Circle, incomplete profiles enter profile creation, and there is no prior-account flash, mutation replay, signed-URL reuse or restored cache.

Run public/Circle/Just me media, visibility transitions, membership removal, two-way blocking, suppression, deletion and signed-URL expiry separately on Android and iOS. Run image/video capture, limited gallery, crop, four media, background/process kill/network loss, same-owner recovery, different-owner denial and deletion during processing.

Run push permission allow/deny, token registration, switch/logout, invalid-token removal, ticket/receipt, foreground/background/cold tap, deleted content and unauthorized private target. Payload evidence must not include private previews.

## Accessibility matrix

On authentication, Circle, Explore, Create, Profile, comments, notifications, Memory panes, settings and deletion, test TalkBack/VoiceOver focus order and labels, selected/disabled/busy state, 200% text, contrast, 44-point targets, modal containment, live errors/loading and Reduce Motion. Record OS/device, build hash, tester, result and safe screenshot/video reference. Static semantics and simulators do not close the physical assistive-technology gate.
