# React Native + Expo App Architecture

This architecture assumes a new mobile app separate from the existing Next.js app.

## Recommended Stack

- Expo.
- React Native.
- TypeScript.
- Expo Router for file-based navigation.
- Supabase JS client.
- TanStack Query for server state and cache invalidation.
- Zustand or small React context for session/profile UI state only.
- Expo SecureStore for auth token persistence.
- Expo ImagePicker and/or Camera for media.
- Expo Location for location.
- Expo FileSystem/ImageManipulator for compression/crop where needed.
- NativeWind or a small token-based StyleSheet system. Do not port Tailwind classes blindly.

## Suggested Folder Shape

```txt
mobile/
  app/
    (auth)/
      login.tsx
      signup.tsx
      reset-password.tsx
    (tabs)/
      index.tsx              # Circle
      explore.tsx
      create.tsx
      hungry.tsx
      profile.tsx
    reviews/
      [id].tsx
    comments/
      [id].tsx
    people/
      [username].tsx
    restaurants/
      [placeId].tsx
    dishes/
      [dish].tsx
    settings/
      index.tsx
      edit.tsx
      saved.tsx
      liked.tsx
  src/
    api/
      supabase.ts
      routes.ts
      reviews.ts
      feeds.ts
      profiles.ts
      circle.ts
      engagement.ts
      places.ts
      notifications.ts
    components/
      feed/
      media/
      create/
      profile/
      explore/
      ui/
    constants/
      colors.ts
      spacing.ts
      categories.ts
    hooks/
      useActorProfile.ts
      useLocationPreference.ts
    lib/
      visibility.ts
      feedRanking.ts
      dishNormalizer.ts
      exploreCategories.ts
      reviewValidation.ts
      reviewMedia.ts
      reputation.ts
    types/
      database.ts
      models.ts
    assets/
      badges/
      categories/
```

## Data Access Strategy

Use a hybrid approach.

Direct Supabase client is good for:

- Reading profile rows.
- Reading visible reviews when RLS fully covers the query.
- Likes/comments/wishlist/hungry inserts/deletes where RLS covers ownership and visibility.
- Reading notifications owned by user.
- Reading badges/reputation.

Backend route or Edge Function is required for:

- Google Places autocomplete/details/reverse geocode.
- Photo/video moderation.
- Review creation if reputation refresh and notification fanout should remain server-controlled.
- Circle request/respond/remove, unless equivalent secure Supabase functions are created.
- Delete account.
- Any operation requiring service role.

For mobile v1, the fastest safe route is to keep using the existing Next.js API routes as the backend while building a native client. Later, move shared backend logic to Supabase Edge Functions or a dedicated API.

## Auth Architecture

Mobile app:

1. Initializes Supabase client with anon key only.
2. Stores session in SecureStore-compatible adapter.
3. On startup, loads `auth.getSession()`.
4. If authenticated, fetches `profiles` by `id`.
5. Stores lightweight actor:
   - `userId`
   - `username`
   - `displayName`
   - `accountType`

Never store service-role keys in mobile.

## Query Keys

Use stable query keys:

- `['actorProfile']`
- `['circleFeed', { cursor, excludeSeen }]`
- `['publicFeed', { location, cursor, filters }]`
- `['review', reviewId]`
- `['comments', reviewId]`
- `['profile', username]`
- `['me']`
- `['restaurant', placeId]`
- `['dish', dishName, location]`
- `['notifications']`
- `['unreadNotifications']`
- `['circleStatus', username]`
- `['hungryPicks']`

Mutation invalidation:

- Create review: invalidate Circle feed, public feed, me/profile, restaurant, dish, notifications.
- Like/unlike: update card optimistically; invalidate feed/profile/detail.
- Comment add/delete: update comments and comment count; invalidate feed/profile/detail.
- Save/unsave: update saved state; invalidate saved list.
- Circle action: invalidate Circle feed, people, profile, circle status.
- Notification read: invalidate notifications and unread count.

## Pagination

Existing cursor pattern:

```ts
type Cursor = {
  createdAt: string;
  id: string;
};
```

Query order:

- `created_at desc`
- `id desc`

Next page filter:

- `created_at < cursor.createdAt`
- or same `created_at` and `id < cursor.id`.

Use the backend route's `nextCursor` where available.

## Model Normalization

Copy behavior from:

- `lib/server/normalize-review.ts`
- `lib/review-media.ts`
- `lib/selects.ts`

Mobile review model should normalize:

- `items` as `FoodItem[]`.
- `tags` as `string[]`.
- media from `review_photos` first.
- fallback to `photo_urls`.
- fallback to `photo_url`.
- `visibility` default to `public`.
- `status` default to `active`.

## Feed Ranking

Copy `lib/feed-ranking.ts` logic into mobile shared lib if backend does not return ranked rows.

Circle score:

- Freshness: `100 * exp(-ageHours / 72)`.
- Likes: `log1p(likes) * 6`.
- Comments: `log1p(comments) * 10`.
- Rating boost: average rating * 3.

Seen-state ordering:

- Unseen before seen.
- Seen sorted by oldest seen time first.
- Preserve original order as fallback.

## Visibility

Copy `lib/visibility.ts` exactly in spirit:

- Suppressed posts are never shown.
- Owner can see own posts.
- Public is visible.
- Circle visible only if viewer is in owner's Circle.
- `me` visible only to owner.

Remember that Supabase RLS also enforces this, but client filtering prevents accidental UI leaks from cached/mixed data.

## Media Upload Architecture

Native create-review flow:

1. Pick/capture media.
2. Validate size, type, duration.
3. Compress/crop image when needed.
4. Upload to Supabase Storage quarantine.
5. Call backend moderation.
6. Receive public media objects:
   - `publicUrl`
   - `storagePath`
   - `width`
   - `height`
   - `sizeBytes`
   - `mediaType`
7. Submit review.

Do not use browser `File`/`Canvas` assumptions in mobile. Use URI/blob helpers compatible with Expo and Supabase Storage.

## Environment Config

Mobile public env:

- Supabase URL.
- Supabase anon key.
- API base URL for existing Next.js backend.

Server-only env:

- Supabase service role.
- Google Places key.
- Google Vision key.
- Google Video Intelligence key.

## Testing Strategy

Unit-test copied pure logic:

- visibility.
- review validation.
- dish normalization.
- explore categories.
- feed ranking.
- reputation formatting.

Integration-test data services with mocked Supabase responses.

Manual QA on devices:

- auth session restore.
- create photo post.
- create video post <= 10 seconds.
- restaurant autocomplete near current location.
- Circle visibility.
- offline/poor network retry.
- push/deep link handling once implemented.
