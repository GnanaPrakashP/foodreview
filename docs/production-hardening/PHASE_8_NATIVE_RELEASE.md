# Phase 8 — Native release, store, privacy and accessibility readiness

Date: 2026-07-14

Branch: `hardening/10-native-release`

Source commit: `ac2a2a5b1dd9caae670c616837b5d8dbe5119d67`

Implementation status: **PASS locally**
Release verification status: **BLOCKED**

## Executive result

Phase 8 establishes a fail-closed, reproducible native release path for Witoh without publishing an app or starting Phase 9. The repository now binds development, preview and production builds to separate application identities, custom schemes and EAS environments; rejects unsafe production configuration; produces and inspects Android APK/AAB releases; produces an unsigned generic-iPhone arm64 Release build; declares native permissions and privacy behavior consistently; supplies mandatory release CI, store/legal worksheets and physical-device smoke matrices; and preserves all earlier privacy, account-isolation and operational controls.

The implementation can pass locally because everything possible without external credentials or devices succeeds. It is not approved for production release. Production Google/Apple signing, Play/App Store ownership, real protected EAS variables, APNs/OAuth/provider credentials, hosted staging, physical-device install/upgrade and two-account behavior, real push delivery, live Sentry symbolication, legal approval, store-console declarations/review and Phase 9 capacity evidence remain blocked. Local artifacts must not be submitted.

## Baseline and scope control

The branch contains the required Phase 0–7 history and began clean at Phase 7 commit `ac2a2a5b`. Phase 8 changes only native release/configuration, narrowly required account-safe draft recovery, accessibility semantics, public legal/support surfaces, release CI/tests and release documentation. It does not alter tab order, visually redesign screens, perform broad API/database optimization, publish an OTA/store release or execute load/soak/capacity testing.

Recorded toolchain:

| Component | Local value |
| --- | --- |
| Expo | 54.0.35 |
| React Native | 0.81.5 |
| EAS CLI | 20.1.0 locally exercised |
| Android compile/target SDK | 36 |
| Android min SDK | 24 |
| Android NDK | 27.1.12297006 |
| Kotlin | 2.1.20 |
| Gradle | 8.14.3 |
| Java | OpenJDK 17 |
| Xcode/iPhoneOS SDK | Xcode 26.6 / iPhoneOS 26.5 |
| iOS deployment target | 15.1 |

## Canonical identity

The canonical store identity is:

| Field | Production value |
| --- | --- |
| Product/display name | Witoh |
| Android application ID | `com.circlebites.mobile` |
| iOS bundle identifier | `com.circlebites.mobile` |
| Custom scheme | `witoh` |
| Web origin | `https://www.circlebites.in` |
| API origin | `https://api.circlebites.in` |
| Privacy | `https://www.circlebites.in/privacy` |
| Terms | `https://www.circlebites.in/terms` |
| Support | `https://www.circlebites.in/support` |
| Account deletion | `https://www.circlebites.in/delete-account` |
| Privacy contact | `privacy@circlebites.in` |
| Support contact | `hello@circlebites.in` |

Witoh is emitted as the store and in-app identity. The repository directory and store bundle IDs retain their legacy internal names so existing installs remain upgradeable. `FoodCircle`, old legal contacts and the unresolved `.app` domain were removed from active store/legal surfaces. Local/development and preview use `.dev`/`.preview` package suffixes and `witoh-dev`/`witoh-preview` schemes so they cannot be mistaken for production. Because Android is checked in rather than prebuilt by EAS, Gradle and manifest placeholders independently bind its application ID, label and callback scheme to the selected environment.

## Environment architecture and PH-001

`mobile/app.config.js` validates the production build before native configuration or bundling. A production/EAS build fails when a required public value is absent, a public URL is not HTTPS, an endpoint is localhost/private LAN, a value looks placeholder-like, environment/channel is not production, release/Sentry metadata is absent, development auto-login is set, or a privileged Supabase-looking variable is exposed through `EXPO_PUBLIC_*`.

Environment ownership is documented in `docs/release/ENVIRONMENT.md`:

- Mobile-public/build-time: intentionally inspectable Supabase URL/publishable key, API/web origins, app environment, release channel/ID, public Sentry DSN and sampling value.
- Protected build-only: EAS token, Sentry upload token/org/project, Android keystore values and Apple certificate/profile material.
- Server-only: Supabase service role, HMAC/rate-limit, observability, provider and moderation secrets.
- Worker-only: media, deletion, cleanup and push-processing credentials.
- Scheduler-only: cron and scheduled-operation credentials.

No secret was printed or committed. PH-001 remains blocked because a credential owner must determine whether the historical removed `EXPO_PUBLIC` Supabase value was privileged and rotate/revoke it if it was. Static containment and clean artifact scans reduce future exposure but cannot prove external rotation.

The production EAS profile resolves correctly and is bound to the named `production` environment. The actual EAS production environment reported no configured plain/sensitive variables during local inspection; therefore protected real public endpoints/provider configuration must be installed by the environment owner before any remote build.

## EAS profiles, versioning and OTA safety

`mobile/eas.json` defines visibly separate development, preview and production profiles. Production uses store distribution, remote credentials, Android AAB, auto-incremented store version and the production EAS environment. Development is a development client with internal distribution; preview is internal and isolated.

The repository release floor is semantic version `1.0.0`, Android versionCode `1` and iOS buildNumber `1`. EAS production auto-increment is the monotonic source for subsequent store builds. Release ID, environment and channel are embedded as public diagnostic metadata and must match the Sentry release.

Expo Updates/EAS Update is disabled. Each installed binary contains its JavaScript; no channel can deliver native-incompatible JavaScript to an older binary, and a development client cannot receive a production update. A bad mobile release is contained at the API/provider boundary and replaced with a compatible store binary. Store rollout stop and rollback/roll-forward are documented; no automatic publish command exists.

## Android manifest and permissions

The final release APK merged manifest—not just source XML—was inspected. It reports package `com.circlebites.mobile`, version `1.0.0`/`1`, min SDK 24 and target SDK 36. `android:usesCleartextTraffic=false`, `android:allowBackup=false`, no `android:debuggable`, no `requestLegacyExternalStorage`, and Expo Updates disabled are present.

App feature permissions are Internet, optional foreground coarse/fine location, camera, microphone, Android 13+ notifications, selected/recent photo access and vibration. Library-required network state, wake, audio playback foreground service/boot, Firebase delivery, Wi-Fi/install referrer and OEM badge permissions are visible in the merged artifact and are documented rather than hidden. Permissions blocked or absent are overlay, read/write legacy external storage, biometric/fingerprint, background/always location and broad video-library access. The app has no `requireAuthentication` SecureStore use that would justify biometrics.

Only `MainActivity` is unpermissioned and exported; it owns launcher and `witoh://` filters and is `singleTask`. The Firebase instance receiver is protected by the Google C2DM send permission; the profile installer receiver is protected by `android.permission.DUMP`. Dependency-only CanHub base crop activity, Compose preview activity and unused Expo image clipboard provider are removed. Every other active component is non-exported.

Backup is disabled at application level. Defence-in-depth XML exclusions also cover SecureStore, account MMKV, account SQLite, private media caches, cleanup journals, persistent Query state and owner-scoped drafts. Debug network behavior remains outside production.

## Android build, signing and artifacts

Gradle release no longer falls back to `signingConfigs.debug`. A release task requires a complete `WITOH_RELEASE_*` set or EAS-injected Android signing values and fails otherwise. R8 minification, resource shrinking and native symbol generation are enabled; dev-client network inspection is disabled.

Local validation used a disposable non-production RSA key stored only under `/private/tmp`, with the pre-rebrand certificate subject recorded in the original evidence. This proves the signing configuration is not debug signing but is not the production upload key. APK Signature Scheme v2 and v3 verification succeeds. The AAB contains a signature and `jarsigner` verifies its entries, while strict trust validation correctly rejects the disposable self-signed certificate and missing timestamp. Google Play App Signing/upload-key trust remains external.

Final local artifacts:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Release APK | 141,456,001 | `0628147d715c7fb7b9f2955a4078afa6faa3e7b52836da36be13f3d07bcb0224` |
| Release AAB | 92,022,670 | `220e47236e8c351d6424e1176bafedac70044ca4d9ba19953cfcd0c3da72b3b0` |
| R8 mapping | 51,122,835 | `1811c29a41ddf0af64bb9dcbb0b138fabf09ced17ed8dcd3ec421b41d838a3e6` |
| Native debug symbols | 24,929,573 | `dcdfdebe5839c0f0fd25ef26d247e6a67cd64cdbf2b8d9cdb5bb741caf64a82f` |
| Android Hermes/packager map | 28,197,027 | `1a4d926f7a34e39996bd6ad87c73a8c3e0fe9802c63f08e9a436d3e8f2957198` |

APK/AAB scans pass for privileged variable names, auto-login names, service-role/worker/scheduler names, local application/Supabase ports, localhost/private endpoints and known unsafe patterns. The bundle carries arm64-v8a, armeabi-v7a, x86 and x86_64 native libraries. Production release infrastructure must retain hashes, dependency report, merged manifest, mapping, native symbols and Hermes map and upload matching symbol artifacts before rollout.

No physical Android device was available. An emulator install attempt was inconclusive and is not claimed as installation evidence. Clean install, prior-compatible signed upgrade, authenticated/legacy-cache/pending-upload/Memory upgrade, backup transfer and downgrade behavior remain blocked on production-signed physical builds.

## iOS build, privacy and entitlements

The repository intentionally generates iOS through Expo prebuild/EAS; no persistent `mobile/ios` tree is committed. The final production prebuild used 118 dependency declarations resolving to 127 CocoaPods. A code-signing-disabled generic physical-iPhone arm64 Release compile passed with Xcode 26.6/iPhoneOS 26.5.

Generated configuration reports bundle `com.circlebites.mobile`, version/build `1.0.0`/`1`, deployment target 15.1, arm64 device binary, portrait, iPhone-only UIDeviceFamily and no iPad claim. Production Info.plist contains only the canonical app/bundle schemes, forbids arbitrary and local-network ATS access, omits the generated development-client scheme and disables dev-client network inspection.

Usage descriptions match features: camera for user-initiated post/Memory photo or video capture; photo library for user-selected post/Memory media; microphone for Memory voice messages or video sound; when-in-use location for optional nearby discovery. Always/background location, tracking, Bluetooth, Face ID and Photo Library add descriptions are absent. Permissions are requested at feature use; denial paths retain startup and non-dependent flows.

The application privacy manifest declares no tracking and required reasons for file timestamp, UserDefaults, disk-space and system-boot-time APIs. SDK privacy manifests are incorporated by CocoaPods/prebuild. No associated domains or background-location modes are claimed. The local unsigned entitlements show development APNs provenance; the production provisioning profile must provide `aps-environment=production`, and the final signed archive must be inspected rather than inheriting the local compile's entitlement.

Final local iOS artifacts:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| arm64 app binary | 27,025,304 | `0f85895cd125a1978da099ef5e6080fefd65481873c2444ae7036eb191a374e2` |
| Hermes `main.jsbundle` | 6,818,532 | `1df9baa6e5041352ba74f36048bea54daaa36475ebf85b0b82bdb99061849a2d` |
| dSYM DWARF binary | 132,992,955 | `b6686681c7cef85858ba10934eb2d61231ff48744ed490b35f2f3699485b370a` |
| `main.jsbundle.map` | 20,090,118 | `8af35aec92709fc88aedce366b032ee9d3e08d732e0dcbe64af956083bef7d38` |

Bundle, binary, dSYM and source-map scans pass. This is compatibility evidence only: no Apple distribution certificate/profile was available, so no signed archive, IPA, TestFlight install or App Store claim is made.

## Authentication, recovery and deep links

Development, preview and production use separate callback schemes. The API computes the recovery base from the server environment; production cannot emit a development callback. The mobile app accepts only its own configured scheme and approved auth host/path, validates bounded state/nonce and expiry, rejects attacker-controlled redirect parameters and duplicate/replayed callbacks, and preserves logout/switch/deletion cleanup from Phases 1B/1C.

Automated tests cover configuration and callback ownership, but the required killed-app email recovery, Google OAuth, expired/invalid token, frozen/deleting account and two-seeded-account matrix must still run independently on Android and iOS staging builds. No hosted Auth redirect list was mutated.

## Push readiness

Phase 7 token ownership, durable ticket/receipt jobs, backoff, `DeviceNotRegistered` disablement and authorization-on-open remain unchanged. Android notification permission and iOS usage/capability generation are present; staging/production credential ownership is documented. Payloads must remain routing-minimal and private targets must be reauthorized on tap.

Production FCM/APNs credentials, real Expo token acquisition, foreground/background/cold taps and deleted/blocked/private target routing were not exercised. They require protected provider configuration and physical Android/iOS devices.

## Private media, upload recovery and PH-603

The Phase 1A visibility model, five-minute signed media, membership/block/suppression checks and account-isolated caches remain enforced. Phase 2 owner-bound upload recovery remains in place. Phase 8 adds the minimum release-blocking draft behavior: Create persistently saves the owner's draft state, restores it only for that owner, bounds age/shape, clears it after successful publication, and includes it in logout/switch/deletion cleanup. It does not redesign Create.

Behavior tests prove owner scoping and cleanup integration. PH-603 remains blocked rather than falsely closed because real process termination during capture/upload/processing, same-owner resume, different-owner denial, network loss, account deletion and temporary-file inspection still require signed physical builds plus disposable hosted Storage/worker staging.

## Account lifecycle and backup

The account transition boundary still withholds authenticated UI while owner cleanup/hydration resolves, preventing prior-account flash and mutation replay. Drafts now participate in that boundary. Android disables backup and retains granular exclusions; iOS owner caches use cache-safe directories and SecureStore is cleared on account-ending transitions.

Static/behavior regressions cover logout, switching and deletion cleanup. Offline logout, token expiry, deletion-process kill, legacy upgrade, device transfer/restore and incompatible downgrade remain in the physical matrix.

## Accessibility

Without redesigning the UI, Phase 8 adds/normalizes button roles and states, card semantics, selected/disabled/busy exposure, live-region error/loading announcements, authentication field/button labels, Profile sub-screen semantics, and a reduced-motion preference used by slide-over transitions. The existing visual hierarchy, wording and tab structure remain intact.

Repository checks can prove semantics are present, not that TalkBack/VoiceOver users can complete flows. Authentication, Circle, Explore, Create, Profile, comments, notifications, all Memory panes, settings and deletion must be tested on the documented physical devices with focus order, modal focus restoration, 200% text, contrast, touch targets, keyboard, state announcement and Reduce Motion. PH-805 remains blocked pending that evidence.

## Device and OS support

Android supports API 24 through target 36; test minimum Android 7, a common Android 14/15 phone and latest Android 16/API 36, including mid-range and lower-memory hardware. iOS supports 15.1+; test minimum, common and latest supported OS on a small-screen and modern notched iPhone. Tablet/iPad support is explicitly disabled because there is no tablet matrix. Portrait is the supported orientation.

Safe areas, keyboard, dark/light mode, media/camera, optional location, notification denial, background/foreground, low-memory/process death and TLS/no-cleartext are required per row. No physical-device result is claimed.

## Dependency and supply-chain review

Root production dependencies were audited after updating Next.js and `eslint-config-next` to the exact patched `15.5.20`; the root `npm audit --omit=dev` reports zero vulnerabilities. Root build/typecheck/lint regressions pass.

The mobile production audit reports 18 moderate advisories, zero high and zero critical. They are an Expo/React Native toolchain chain involving `uuid`/`xcode` and related Expo packages. The registry's suggested fix crosses an incompatible Expo SDK/runtime boundary, so Phase 8 does not force a risky semver-major change. PH-003 remains `in_progress`: the security owner must accept a dated, scoped risk or sponsor a separately tested Expo SDK upgrade across every Phase 1A–8 native gate.

Gradle release dependencies are captured in build metadata/dependency output; the AAB carries dependency and native-symbol metadata. CocoaPods resolution is locked in the generated validation project. The Phase 2 worker remains pinned to Node 20.19.4 Bookworm with ffmpeg and must be scanned again in protected release CI. No registry credential is exposed. A production release must retain npm/Gradle/Pods/container inventories or SBOMs with the candidate.

## Privacy, legal and store declarations

Mobile and web privacy/terms now describe the same Witoh behavior and link to canonical support/deletion surfaces. The inventory covers email/auth; profile/name; posts/dishes/restaurants/photo/video; optional foreground location; private Memories/participants/messages/media/voice; Circle/block/report/moderation data; push token/install ID; owner drafts/pending uploads; privacy-filtered crash/performance diagnostics; operational jobs; processors; offline cache; deletion/retention limits; child minimum age; and copyright/safety contact.

The documents are implementation-consistent worksheets, not legal conclusions. External counsel/release owner must approve controller/company identity, jurisdiction, exact retention, processor agreements/regions, child handling, copyright/takedown process, Play Data safety, App Privacy labels, age rating, export compliance and moderation/reviewer notes. Store reviewers must use disposable staging accounts with synthetic data. No legal approval, console submission or store approval is claimed.

## Release telemetry and symbols

Android mapping/native symbols/Hermes map and iOS dSYM/Hermes map are produced. Release environment, release ID, build number and commit are required metadata, with staging/production separated. Artifact scans pass without printing possible values.

Local builds intentionally set Sentry upload disabled because no protected org/project/token was available. Production CI must fail or hold the candidate when required symbol upload fails, then execute controlled non-user JS/native crash evidence and verify readable symbolication in the matching production project before rollout. This hosted Phase 7/8 gate remains blocked.

## Release CI and smoke tests

`.github/workflows/native-release.yml` is manual, protected, retains artifacts and hashes, and has no publish/store-submit command. It covers clean install, issue/release inventory, lint/typecheck, Phase 1A–8 tests, Memory/full suite, database reset/lint/pgTAP/policies/upgrades/drift, Next build, production native exports, dependency audits, bundle budgets, Android signed artifacts/manifest/signature/scans/symbols and an iOS archive path when credentials exist. Missing signing credentials are reported as external credential failures rather than silently skipped.

`config/release-smoke-matrix.json` and `docs/release/DEVICE_TEST_MATRIX.md` define deterministic release-build tests for launch, signup/login/recovery, Circle/Explore/Profile, post image/video, comments/reaction/bookmark, notifications, Memory room/message/media/dishes/chat, logout/switch and deletion. They require two disposable accounts, no production data, safe evidence and Android/iOS execution.

## PH-902 oversized modules

Memory, Explore, Profile and related hooks remain oversized. Phase 8 found no native release-only failure requiring a risky broad split, so it preserves runtime ownership and existing design and leaves PH-902 `in_progress`. Bundle budgets and release build evidence remain enforced. Refactoring belongs to a separately behavior-protected post-release task, not this phase.

## Validation evidence

The final evidence set includes:

- Native release inventory validator: 72/72 checks passing; release smoke matrix validator: 17/17 cases structurally complete and explicitly pending signed physical-device execution.
- Phase 8 focused tests: 18/18 passing.
- Phase 1A–8 focused static regressions: 102/102 passing.
- Canonical database: 67 migrations/85 manifest entries/two recorded historical conflicts; two clean resets; SQL lint; 88/88 pgTAP; 10/10 real Auth/RLS/Storage policy checks; upgrades 7/7; zero local drift.
- Sequential real-database release matrix: Phase 1A private-media 13/13, Phase 1B deletion 9/9, Phase 2 media worker 14/14 plus processing 10/10, Phase 4 API security 9/9, Phase 5 indexed 10,000-review/2,000-comment/5,000-notification/5,000-message fixture passing, and Phase 7 operations 9/9. The Phase 5 Circle plan returned 24 rows/18,254 bytes in 19.859 ms, used an indexed path and performed no large-table sequential scan; all cursor and payload checks passed.
- Root/mobile TypeScript: passing.
- Root/mobile lint: zero errors (95 root warnings and 44 mobile warnings); warnings remain non-blocking registered source/dependency hygiene.
- Memory hardening: 72/72 passing.
- Next.js 15.5.20 production build: passing, 92 generated routes/pages.
- Android release: APK and AAB build successfully with R8, shrinking, mapping, native symbols and Hermes map; package/manifest/signature/scans pass subject to the expressly non-production certificate.
- iOS release compatibility: generated arm64 generic-iPhone Release build, privacy/Info.plist/binary/map/dSYM scans pass; distribution signing/IPA is blocked externally.
- Native Expo Android/iOS exports: passing. A combined `--platform all` export attempts web and fails on an existing missing `expo-sqlite` web WASM asset; web is not the Phase 8 production target and Android/iOS exports are independently green.
- Native export/bundle budget: passing. Final current-source distributable exports total 28,409,943 bytes (Android 14,206,339; iOS 14,203,604), with source maps retained separately at 39,827,062 bytes. Android/iOS Hermes bytecode is 6,821,912/6,818,180 bytes, fonts are 2,101,500 bytes per platform, and the 141,456,001-byte APK remains within the checked release ceilings. The Android HBC/map hashes are `2de902740c913c701bcca57c162ca8def0d9438c8735797b21e18c964fb3d176`/`16e84039fc12faa25ff7bbe3badd68acc1b5e73d6de32b14c053da3a875946c3`; iOS is `c8e580e734797e352143f6fb534b8a5bfdd58201981fee07fb5ccc443e50537e`/`663fb317addf931e51eefb782ec4688f6e22c0a13bd34010767f9af22fbbd8c4`.
- Dependency audit: root 0; mobile 18 moderate, 0 high/critical, retained under PH-003.
- `git diff --check`: passing.

The full-suite baseline requires transparent reconciliation. The current checkout executes 1,120/1,140 with 20 failures: the 19 registered PH-002 implementation/source assertions plus one PH-002 test-loader failure for already-absent `mobile/src/navigation/MainTabPagerContext.tsx`. Phase 7 documented 1,103/1,122 (19 failures), but adding 18 Phase 8 tests to that baseline would be 1,121/1,140; the missing-file assertion is already present and broken at the clean Phase 7 source commit, so it is not a Phase 8 runtime regression. No Phase 8 or changed active-path test fails. PH-002 remains a P0 release decision and must be adjudicated rather than hidden or weakened.

## External blockers and issue disposition

| Issue/gate | Status | Required owner action |
| --- | --- | --- |
| PH-001 historical credential | Blocked | Identify owner/privilege and rotate/revoke if required |
| PH-002 baseline suite | Open/P0 | Adjudicate 19 stale assertions plus missing-file test loader with behavior-level coverage |
| PH-003 mobile advisories | In progress/P0 | Dated risk acceptance or separately tested Expo SDK upgrade |
| PH-603 process-safe upload/draft | Blocked | Execute process-kill/network/account matrix on signed physical staging builds |
| PH-801 Android release | Blocked | Production upload key/Play ownership and physical clean-install/upgrade evidence |
| PH-802 iOS release | Blocked | Apple distribution/APNs/App Store access, signed archive/IPA/TestFlight/device evidence |
| PH-803 legal/store consistency | Blocked | Independent legal and store-console declaration approval |
| PH-804 hosted environments | Blocked | Install/verify protected EAS production values and real provider ownership |
| PH-805 accessibility/devices | Blocked | Physical TalkBack/VoiceOver, large-text, contrast, targets and reduced-motion evidence |
| Phase 7 hosted operations | Blocked | Live symbolication/alerts/push/restore/canary/rollback drills |
| Phase 9 | Local harness complete; hosted proof blocked | Run the checked-in load, soak, failure, restore and physical-device capacity matrix on disposable production-like staging |

## Reviewed manual release order

1. Resolve credential ownership and rotate if required.
2. Deploy all canonical migrations to disposable staging.
3. Deploy API, worker, scheduler and telemetry.
4. Configure staging recovery/OAuth/push/provider credentials.
5. Build signed staging Android and iOS releases.
6. Run the full two-account device matrix.
7. Run the private-media and account-deletion matrix.
8. Run the push and deep-link matrix.
9. Run the accessibility/device matrix.
10. Run restore and rollback drills.
11. Run Phase 9 load and failure testing.
12. Review privacy/store declarations.
13. Build the production release candidate.
14. Run final smoke tests.
15. Submit manually only after all release gates pass.

## Phase gate

Implementation status: **PASS locally**

Release verification status: **BLOCKED**

PASS locally
