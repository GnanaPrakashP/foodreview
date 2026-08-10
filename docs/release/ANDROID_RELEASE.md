# Android release

Canonical application ID is `com.circlebites.mobile`, version is `1.0.0`, and repository versionCode floor is `1`; EAS production auto-increments the remote version. Minimum supported API is 24. Production is portrait-only and makes no tablet-specific claim.

## Permissions and manifest

The release manifest permits Internet/network state, camera, microphone/audio playback, selected/recent images, optional foreground location, notifications, vibration/wake and provider-required notification/badge delivery. Camera, microphone, media and location are requested only at feature use. Overlay, unused biometric and legacy external-storage permissions are blocked. Production cleartext is false, legacy storage mode is absent, and app backup is disabled. Owner-scoped MMKV, SQLite, SecureStore, media cache, drafts and cleanup journals also remain listed in backup/data-extraction exclusions as defence in depth. Debug-only cleartext and overlay behavior stays in debug manifests.

The launcher activity is the only unpermissioned exported component and uses `singleTask`; the remaining exported notification/profile receivers require system permissions. Authentication paths are accepted through the environment-specific custom scheme and revalidated in JavaScript. Final merge inspection removes a dependency crop activity, Compose preview activity and unused image-clipboard provider. Inspect the final merged release manifest because library manifests can add permissions or components.

## Signing and artifacts

Release Gradle never references `signingConfigs.debug`. It accepts a complete `WITOH_RELEASE_*` credential set or Android injected signing properties; a release APK/AAB task otherwise fails. For local validation, use a disposable non-debug keystore outside Git. It proves the build/signature path but is not the production upload key.

The production upload key must be held by the release owner in the protected CI/EAS credential store. Google Play App Signing owns the app-signing key; retain offline recovery/rotation documentation for the upload key. Never commit `.jks`, passwords or certificate exports.

Build commands from `mobile/`:

```sh
./android/gradlew -p android clean assembleRelease bundleRelease
```

Required evidence: signed APK, signed AAB, `mapping.txt`, native debug symbols, merged manifest, dependency report, SHA-256 hashes, `apksigner verify --print-certs`, AAB `jarsigner -verify`, and `node ../scripts/scan-release-artifact.mjs ...`. Upload-key certificates are normally self-signed; production trust is established by Play App Signing and credential ownership, not `jarsigner -strict` PKI validation.

Install the signed APK with `adb install`; upgrade a compatible prior signed build with `adb install -r`. Android refuses upgrade when signing certificates differ. Test clean install, authenticated upgrade, legacy cache, pending upload, offline Memory, logout, switch and deletion on physical devices. Emulator evidence is not physical-device evidence.
