# iOS release

The repository uses Expo prebuild/EAS as the reproducible iOS path; no persistent `mobile/ios` project is committed. Canonical bundle identifier is `com.circlebites.mobile`, version is `1.0.0`, repository build floor is `1`, minimum iOS is 15.1, orientation is portrait, and iPad support is disabled until a tablet matrix exists.

The configuration declares camera, selected photo-library, voice/video microphone and when-in-use location purposes. Always-location, background location, Photo Library add, tracking and Face ID descriptions are disabled because active features do not use them. Production ATS forbids arbitrary and local-network loads, the dev-client network inspector is disabled, and the generated development-client URL scheme is omitted. Notification entitlement comes from the production provisioning profile/Expo Notifications capability. No associated domains are claimed; authentication uses the environment-specific custom scheme.

`ios.privacyManifests` declares no tracking and the required-reason file timestamp, UserDefaults, disk-space and system-boot-time APIs used by the application/runtime. SDK manifests are merged during prebuild. Validate the generated app privacy manifest and every embedded SDK manifest before archive.

Production certificates, provisioning profiles, APNs credentials, App Store Connect role and Expo/EAS access belong to the release owner. Store them in Apple/EAS protected infrastructure, never Git. A code-signing-disabled arm64 Release compile proves source/native compatibility but is not a signed archive or IPA.

Production build:

```sh
eas build --platform ios --profile production
```

For protected CI, the manual workflow uses pinned EAS CLI local build and retains the IPA. Verify bundle ID, version/build, entitlements, embedded provisioning, `aps-environment=production`, architectures, privacy manifest, dSYM and Hermes source map. Install through TestFlight/internal distribution and execute the physical-device matrix. Missing Apple credentials or devices is a release blocker, not a code failure.
