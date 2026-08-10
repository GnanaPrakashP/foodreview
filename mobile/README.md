# Witoh Mobile

Expo React Native foundation for Witoh.

This app now has the Witoh mobile shell, DM Sans typography, email/password auth, Supabase-backed feeds, current profile loading, and post creation wired through the existing service layer.

## Source Of Truth

- `../mobile-context/01-product-summary.md`
- `../mobile-context/02-mobile-v1-scope.md`
- `../mobile-context/07-design-rules.md`
- `../mobile-context/08-app-architecture.md`
- `../mobile-context/09-build-instructions.md`

## Current Main Tabs

- Circle
- Explore
- Share
- Hungry
- Profile

Shared memory screens remain secondary routes under `app/memories/*`. They are not part of the main tab bar.

## Current Foundation

- Expo Router app shell.
- TypeScript with strict mode.
- Safe-area-aware layout.
- Witoh dark theme tokens copied from the web app.
- Shared UI primitives in `src/components/ui`.
- Circle, Explore, Hungry, and Profile render Supabase-backed data or honest empty states.
- Share creates real posts by uploading an image and inserting a review row.
- Auth bootstrapping restores the Supabase session on app reload.

## Environment

Create `mobile/.env` from `.env.example`:

```sh
cp .env.example .env
```

Required before any Supabase-backed route or service is used:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

Do not put a Supabase service role key in this app. Expo/mobile environment values are client-side.

## Setup

```sh
npm install
npm run typecheck
npm run start
```

For a clean local run:

```sh
npx expo start -c
```

## Dedicated physical-device environment

The normal hosted `.env` and `.env.local` files remain unchanged. These root
commands read the running local Supabase CLI credentials at runtime and never
print or persist them.

For an Android phone connected over USB, uninstall once if an older APK has a
different signing key, then use the dedicated command:

```sh
/opt/homebrew/share/android-commandlinetools/platform-tools/adb -s ZA223JVWG7 uninstall com.circlebites.mobile.dev
npm run mobile:reinstall:phone:local -- --device ZA223JVWG7
```

The installer reverses Metro, the dedicated local API, and Supabase ports
(`8081`, `3035`, and `54321`). The ordinary `mobile:reinstall:phone` command is
not changed and may still use the normal hosted environment.

An iPhone cannot use `adb reverse`. Keep the Mac and iPhone on the same Wi-Fi,
find the Mac's private Wi-Fi IPv4 address, and run:

```sh
npm run mobile:ios:device:local -- --host 192.168.1.25
```

Optionally pass `--device "My iPhone"`. The command binds the local API and
Metro to the LAN, builds the `.dev` iOS identity, and configures the app to use
the Mac LAN address for both API and Supabase media URLs. Accept the iOS Local
Network prompt. Xcode signing and device trust must already be configured.

## Android Profile Validation Login

For local Android Profile validation, use the root automation script instead of typing credentials into the emulator:

```sh
ANDROID_LOGIN_EMAIL='local-test-user@example.test' npm run validate:android-profile
```

The installed-app script requests an email OTP, reads the local Mailpit message, signs in through the real passwordless UI, and writes screenshots/logs to `/private/tmp/profile-android-validation`.

Keep the validation email in your local shell or gitignored `mobile/.env`; do not commit personal test identities.

## Home media profile diagnostics

For a local development or non-production profile build, set the single local
flag below before starting Metro:

```env
EXPO_PUBLIC_HOME_MEDIA_PROFILE=1
```

The opt-in output contains only bounded event counts, cache-type enums, page
positions, and elapsed timing. It never includes account, post, media, URL,
path, or token values, and it remains disabled in production release logging.

## Home list-engine validation

The optimized internal preview profile compiles the production Home path with
FlashList enabled:

```env
EXPO_PUBLIC_HOME_LIST_ENGINE=flashlist
```

Allowed values are `flatlist` and `flashlist`; mobile configuration rejects any
other value. This selector is safe to use in optimized preview/profile builds
and contains no secret. Development-only scroll tracing and visual overlays use
the separate `EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC` family and remain disabled in
release builds. The store-production profile continues to default to FlatList
until the physical-device acceptance matrix passes.
