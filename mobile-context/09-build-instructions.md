# Build Instructions For Mobile App

Do not build the app in this repository step yet unless explicitly requested. These are instructions for the future implementation.

## Phase 1: Scaffold

1. Create a new Expo app, ideally in `/mobile` or a separate repo.
2. Use TypeScript.
3. Add Expo Router.
4. Add Supabase JS.
5. Add TanStack Query.
6. Add SecureStore auth storage adapter.
7. Add media/location packages:
   - `expo-image-picker`
   - `expo-camera` if direct camera capture is needed.
   - `expo-location`
   - `expo-image-manipulator`
   - `expo-file-system`
   - video metadata/helper package as needed.

## Phase 2: Shared Product Logic

Copy/adapt pure logic from the web app:

- `lib/types.ts`
- `lib/selects.ts`
- `lib/visibility.ts`
- `lib/feed-ranking.ts`
- `lib/dish-normalizer.ts`
- `lib/explore-categories.ts`
- `lib/review-media.ts`
- `lib/server/review-validation.ts`
- `lib/reputation.ts` for display math only.

Do not copy:

- Next.js route code into components.
- browser cache helpers.
- components with inline DOM/CSS assumptions.
- service-role admin client.

## Phase 3: API Layer

Create mobile API modules:

- `reviews.ts`
- `feeds.ts`
- `profiles.ts`
- `circle.ts`
- `engagement.ts`
- `places.ts`
- `media.ts`
- `notifications.ts`
- `hungry.ts`

Each module should return normalized app models, not raw Supabase rows.

Use existing Next.js endpoints at first for:

- `/api/reviews`
- `/api/reviews/:id`
- `/api/feed/circle`
- `/api/feed/public`
- `/api/places/autocomplete`
- `/api/places/details`
- `/api/places/reverse-geocode`
- `/api/photos/moderate`
- `/api/videos/moderate`
- `/api/circle/*`
- `/api/notifications/*`

When calling Next.js API from mobile, make sure Supabase auth cookies/session are handled. If cookie-based auth is awkward, create mobile-friendly bearer-token routes or Supabase Edge Functions.

## Phase 4: Navigation

Create:

- Auth stack.
- Main tab layout.
- Detail stacks for reviews, people, restaurants, dishes.
- Modal/sheet patterns for comments, location picker, media source picker.

Deep link targets:

- `circlebites://reviews/:id`
- `circlebites://people/:username`
- `circlebites://restaurants/:placeId`
- `circlebites://dishes/:dish`

## Phase 5: Screens In Build Order

Recommended order:

1. Auth/session/profile bootstrap.
2. Profile tab with `/api/me`.
3. Circle feed read-only.
4. Review detail.
5. Like/save/comment mutations.
6. Create review with photos.
7. Create review with videos.
8. Explore restaurants/dishes/people.
9. Restaurant detail.
10. Dish detail.
11. Circle requests/actions.
12. Hungry.
13. Notifications.
14. Settings/edit profile.

This order gets the app usable early and exercises the hardest data contracts before polishing secondary flows.

## Phase 6: Media Production Hardening

Before store submission:

- Verify images upload on iOS and Android.
- Verify videos <= 10 seconds upload and moderate.
- Verify oversized files are blocked before upload.
- Verify failed moderation deletes quarantine files.
- Verify app recovers from upload interruption.
- Verify media URLs render from `review_photos`, `photo_urls`, and legacy `photo_url`.

## Phase 7: Store Readiness

App Store / Play Store basics:

- Privacy policy and terms available in app.
- Account deletion path if users can create accounts.
- Explain camera/photo/location permissions with native purpose strings.
- No service-role or Google server keys in app bundle.
- Handle blocked/denied permissions gracefully.
- Avoid showing unsafe user-generated media before moderation.

## Environment Checklist

Mobile app public config:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_API_BASE_URL`

Backend/server config remains server-only:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_API_KEY`
- Optional legacy per-service fallbacks: `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_VISION_API_KEY`, `GOOGLE_VIDEO_INTELLIGENCE_API_KEY`

## Validation Checklist

Review creation:

- Restaurant selected from Google suggestions.
- At least one dish.
- Every dish has rating 1-5.
- At least one media item.
- Max 4 media items.
- Body empty or >= 5 chars.
- Tags max 5, max length 28.
- Video <= 10 seconds.
- Visibility one of `public`, `circle`, `me`.

Feed/profile:

- Suppressed posts do not show.
- `me` posts only show on own profile.
- `circle` posts show only to Circle members and owner.
- Public posts show in public Explore.
- Cursor pagination does not duplicate posts.

Engagement:

- Duplicate like/save is harmless.
- Unlike/unsave updates UI.
- Comment max length enforced.
- Cache invalidates after mutation.

## Notes For Future Backend Refactor

The current Next.js API can support a mobile app, but long term it may be cleaner to move mobile-facing privileged logic into:

- Supabase Edge Functions for review create, media finalize, circle actions.
- Database RPCs for feed pages and restaurant/dish aggregations.
- A push notification worker for mobile device tokens.

Keep the first mobile version pragmatic: reuse the working backend contract, but isolate it behind mobile API modules so backend migration is not painful later.
