# CircleBites Mobile

Expo React Native foundation for CircleBites.

This app now has the CircleBites mobile shell, DM Sans typography, email/password auth, Supabase-backed feeds, current profile loading, and post creation wired through the existing service layer.

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
- CircleBites dark theme tokens copied from the web app.
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
