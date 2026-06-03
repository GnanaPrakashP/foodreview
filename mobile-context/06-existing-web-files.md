# Existing Web Files Reference

Use this as the map from product feature to current source files.

## App Routes

Primary pages:

- `app/page.tsx`: Circle landing/root.
- `app/explore/page.tsx`: Explore shell.
- `app/share/page.tsx`: Share/create entry.
- `app/reviews/new/page.tsx`: Create review page.
- `app/hungry/page.tsx`: Hungry page.
- `app/hungry/picks/page.tsx`: Hungry picks.
- `app/me/page.tsx`: Current user profile.
- `app/people/page.tsx`: People/Explore page.
- `app/notifications/page.tsx`: Notifications.

Detail pages:

- `app/reviews/[id]/page.tsx`: Review detail.
- `app/comments/[id]/page.tsx`: Comments for a post.
- `app/people/[username]/page.tsx`: Public/friend profile.
- `app/people/[username]/places/page.tsx`: Profile places.
- `app/people/[username]/circle/page.tsx`: Profile Circle.
- `app/people/[username]/[restaurant]/page.tsx`: Person + restaurant.
- `app/me/places/page.tsx`: My places.
- `app/me/circle/page.tsx`: My Circle.
- `app/restaurants/[placeId]/page.tsx`: Restaurant detail by Google place ID.
- `app/places/[placeId]/page.tsx`: Re-export of restaurant detail.
- `app/trending/[restaurant]/page.tsx`: Legacy restaurant name route.
- `app/dishes/page.tsx`: Dishes index/search.
- `app/dishes/[dish]/page.tsx`: Dish detail.
- `app/join/[username]/page.tsx`: Join/profile invite.

Auth/settings/legal:

- `app/login/page.tsx`
- `app/onboarding/page.tsx`
- `app/auth/callback/route.ts`
- `app/auth/reset-password/page.tsx`
- `app/me/settings/page.tsx`
- `app/me/settings/edit/page.tsx`
- `app/me/settings/saved/page.tsx`
- `app/me/settings/comments/page.tsx`
- `app/me/settings/liked/page.tsx`
- `app/privacy/page.tsx`
- `app/terms/page.tsx`

Defer from mobile v1:

- `app/stories/new/page.tsx`
- `app/memory-room/[id]/page.tsx`
- `app/qa/page.tsx`

## API Routes

Review/post:

- `app/api/reviews/route.ts`: create review.
- `app/api/reviews/[id]/route.ts`: patch/delete own review.
- `app/api/photos/moderate/route.ts`: image validation, re-encode, SafeSearch, move to public.
- `app/api/videos/moderate/route.ts`: explicit-content check, move to public.
- `app/api/post-views/route.ts`: seen posts.
- `app/api/posts/[postId]/share-image/route.tsx`: generated share image.

Feed:

- `app/api/feed/circle/route.ts`: Circle feed.
- `app/api/feed/public/route.ts`: public/explore/restaurant feed.

Engagement:

- `app/api/likes/route.ts`
- `app/api/comments/route.ts`
- `app/api/comments/[id]/route.ts`
- `app/api/wishlist/route.ts`
- `app/api/hungry/must-try/route.ts`
- `app/api/hungry/picks/route.ts`

Profile/me:

- `app/api/me/route.ts`
- `app/api/me/saved/route.ts`
- `app/api/me/comments/route.ts`
- `app/api/me/liked/route.ts`
- `app/api/users/[targetUserId]/reviews/route.ts`
- `app/api/users/[targetUserId]/common-restaurants/route.ts`
- `app/api/people/route.ts`

Circle:

- `app/api/circle/request/route.ts`
- `app/api/circle/respond/route.ts`
- `app/api/circle/status/route.ts`
- `app/api/circle/cancel/route.ts`
- `app/api/circle/remove/route.ts`
- `app/api/circle-requests/[requestId]/accept/route.ts`
- `app/api/circle-requests/[requestId]/reject/route.ts`

Notifications:

- `app/api/notifications/route.ts`
- `app/api/notifications/unread-count/route.ts`
- `app/api/notifications/read-all/route.ts`
- `app/api/notifications/events/route.ts`
- `app/api/notifications/[notificationId]/route.ts`
- `app/api/notifications/[notificationId]/read/route.ts`
- `app/api/notifications/_utils.ts`

Places:

- `app/api/places/autocomplete/route.ts`
- `app/api/places/details/route.ts`
- `app/api/places/reverse-geocode/route.ts`

Trust:

- `app/api/taste-trust/[username]/route.ts`
- `app/api/taste-trust/feedback/route.ts`
- `app/api/recommendation-feedback/route.ts`

Account:

- `app/api/delete-account/route.ts`

## Components

Review/media:

- `components/reviews/ReviewForm.tsx`
- `components/reviews/PhotoUpload.tsx`
- `components/reviews/ReviewDetailClient.tsx`
- `components/reviews/CircleFeedCard.tsx`
- `components/reviews/NotificationBell.tsx`
- `components/reviews/NotificationsClient.tsx`

Feed/explore/profile:

- `app/CirclePageClient.tsx`
- `components/circle/CircleFeedClient.tsx`
- `components/people/PeopleTab.tsx`
- `components/people/FriendProfileClient.tsx`
- `components/people/RestaurantDetailClient.tsx`
- `components/trending/RestaurantPostsClient.tsx`
- `components/me/MeClient.tsx`
- `app/me/MePageClient.tsx`

Hungry:

- `components/mylist/HungryPageClient.tsx`
- `components/mylist/HungryPicksPageClient.tsx`
- `components/mylist/MustTryChecklist.tsx`
- `components/mylist/SwipeStack.tsx`

Reputation:

- `components/reputation/ProfileReputationSection.tsx`
- `components/reputation/TierProgressCard.tsx`
- `components/reputation/BadgePill.tsx`
- `components/reputation/BadgeProgressPill.tsx`
- `components/reputation/TemporaryBadgePill.tsx`

Navigation/layout:

- `components/layout/BottomNav.tsx`
- `components/navigation/ScrollRestoration.tsx`

## Libraries

Data and Supabase:

- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `lib/supabase/admin.ts`
- `lib/server/route-supabase.ts`
- `lib/selects.ts`
- `lib/types.ts`
- `lib/server/normalize-review.ts`

Feed/profile:

- `lib/circle-feed.ts`
- `lib/feed-ranking.ts`
- `lib/feed-config.ts`
- `lib/me-page-data.ts`
- `lib/profile-reviews.ts`
- `lib/people-page-data.ts`
- `lib/people-circle-state.ts`
- `lib/profile-display.ts`
- `lib/profile-names.ts`

Circle/privacy:

- `lib/circle.ts`
- `lib/circle-db.ts`
- `lib/circle-auth.ts`
- `lib/visibility.ts`
- `lib/common-restaurants.ts`

Review/product helpers:

- `lib/dish-normalizer.ts`
- `lib/dishes.ts`
- `lib/profile-dishes.ts`
- `lib/explore-categories.ts`
- `lib/location.ts`
- `lib/restaurant-id.ts`
- `lib/review-media.ts`
- `lib/visits.ts`
- `lib/trending-location.ts`

Reputation/trust:

- `lib/reputation.ts`
- `lib/server/reputation.ts`
- `lib/taste-trust.ts`
- `lib/server/taste-trust.ts`

Notifications:

- `lib/notifications.ts`

Caching:

- `lib/browser-api-cache.ts`
- `lib/browser-feed-state.ts`
- `lib/browser-post-views.ts`
- `lib/browser-circle-status.ts`
- `lib/private-cache.ts`
- `lib/server/cache-invalidation.ts`

Validation/access:

- `lib/server/review-validation.ts`
- `lib/server/review-access.ts`
- `lib/server/engagement-list.ts`
- `lib/server/post-views.ts`

## Assets

Category images:

- `public/categories/places/*`
- `public/categories/dishes/*`

Badges:

- `public/badges/tiers-transparent-ui/*`
- `public/badges/achievements-transparent-ui/*`

For mobile, copy or re-export these assets into the Expo app asset pipeline rather than linking web public paths directly.
