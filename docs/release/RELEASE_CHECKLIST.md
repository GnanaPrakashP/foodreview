# Native release checklist

## Before release candidate

- [ ] PH-001 credential owner adjudicates and rotates/revokes any privileged historical key.
- [ ] PH-002 full-suite failures are closed or release owner documents a reviewed blocking decision.
- [ ] PH-003 root advisories are fixed and mobile moderate advisories receive dated security-owner disposition.
- [ ] Production Supabase/API/worker/scheduler/Sentry environments and canonical migrations are deployed to disposable staging.
- [ ] Production, preview and development OAuth/recovery/push credentials and schemes are isolated.
- [ ] Apple/Google/EAS/Sentry credentials are present only in protected release infrastructure.
- [ ] Legal counsel approves policy, terms, controller identity, retention, age/copyright and store declarations.

## Build and inspect

- [ ] Invoke `Native release candidate` manually with environment approval; never add store-submit commands.
- [ ] Issue/release inventory, lint, typecheck, Phase 1A-8, Memory, full suite, database, drift and Next build pass.
- [ ] Android APK/AAB are production-signed, not debug; certificate owner, package, version, ABI, manifest and permissions pass.
- [ ] iOS signed archive/IPA has production profile, bundle/version, minimal entitlements, privacy manifest and architectures.
- [ ] Hermes maps, Android mapping/native symbols and iOS dSYM exist and upload to the matching Sentry release/environment.
- [ ] Artifact secret/local-endpoint scans and SHA-256 reports pass; SBOM/dependency reports are retained.
- [ ] Bundle budgets pass.

## Staging smoke and device evidence

- [ ] Clean install and compatible authenticated upgrade pass on required physical Android/iOS devices.
- [ ] Signup/login, recovery, OAuth, Circle, Explore, Profile, post image/video, comments/reaction/bookmark and notifications pass.
- [ ] Memory room/message/media/dish/chat and voice permission paths pass.
- [ ] Two-account isolation, private media, upload recovery, logout/switch/deletion and backup/device-transfer attempts pass.
- [ ] Push foreground/background/cold routing and invalid-token receipts pass.
- [ ] TalkBack/VoiceOver, large text, contrast, focus, targets and reduced motion pass.
- [ ] Controlled Sentry JS/native crash and ANR/app-hang symbolicate without private data.
- [ ] API/worker/scheduler canary, restore and rollback/roll-forward drills pass.
- [ ] Phase 9 result is `PASS — CAPACITY PROVEN`; a local harness-only pass cannot authorize release.
- [ ] The exact 1,000 registered/200 DAU/100 peak/30-room/20-upload launch tier, 2× stress and four-hour soak evidence share the release candidate and migration head.
- [ ] Hosted Realtime, real private Storage/media workers, all failure cases, isolated restore, reconciliation and signed Android/iOS under-load evidence pass.
- [ ] Database/pool, API/worker topology, regions, provider limits, bottleneck and scaling triggers are recorded with the retained capacity report.

## Store consoles

- [ ] App name, descriptions, categories, screenshots, support/privacy/terms/deletion URLs and reviewer notes are final.
- [ ] Disposable demo account contains no production data.
- [ ] Camera/location/microphone/push/moderation/account-deletion review notes are accurate.
- [ ] Play Data safety, App Privacy, age rating, content policy, export compliance and copyright/contact declarations match the approved inventory.
- [ ] Production candidate receives final smoke approval before manual submission.
