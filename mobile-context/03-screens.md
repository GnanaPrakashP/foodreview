# Mobile V1 Screens

This is a native screen inventory, not a direct route conversion.

## Auth Stack

### Login

- Email/password and any configured Supabase OAuth providers.
- Link to sign up.
- Link to reset password.

### Sign Up

- First name, last name, username, email, password.
- Validate username before profile insert.
- Insert `profiles` row after Supabase Auth user is created.

### Onboarding/Profile Setup

- Confirm display name and username.
- Choose `public` or `private` account type.
- Optional bio.

## Main Tabs

### Circle Feed

Source behavior:

- `app/page.tsx`
- `app/CirclePageClient.tsx`
- `app/api/feed/circle/route.ts`
- `lib/circle-feed.ts`

Screen content:

- Feed list of review cards.
- Empty state when no Circle members.
- Pull-to-refresh with `refresh=1` equivalent.
- Load more using serialized cursor.
- Suggested public posts can be considered later; keep v1 focused on Circle.

Card content:

- Author display name and username.
- Restaurant name and area.
- Media carousel.
- Dish list with ratings.
- Tags and body.
- Like/comment/save buttons.
- Taste Trust and rank badges when available.

### Explore

Source behavior:

- `app/explore/page.tsx`
- `components/people/PeopleTab.tsx`
- `app/api/feed/public/route.ts`
- `lib/explore-categories.ts`

Tabs:

- Restaurants
- Dishes
- People

Core controls:

- Search.
- Location picker.
- Category chips.

Restaurants:

- Use public feed rows and group by `restaurant_id || restaurant_name`.
- Show category, photo, area, top dishes, average rating, reviewer count, distance.

Dishes:

- Use public feed rows and group normalized dish names.
- Show top restaurant, average rating, mention count, best rating, photo.

People:

- Search profiles by username/display name.
- Show Circle relationship button.

### Create

Source behavior:

- `app/reviews/new/page.tsx`
- `components/reviews/ReviewForm.tsx`
- `components/reviews/PhotoUpload.tsx`
- `app/api/reviews/route.ts`
- `app/api/photos/moderate/route.ts`
- `app/api/videos/moderate/route.ts`

Sections:

- Media picker/camera.
- Restaurant autocomplete and selected place details.
- Dish rows with 1-5 rating.
- Tags.
- One-liner/body.
- Visibility selector.
- Submit progress: uploading, checking media, posting.

Native details:

- Use Expo ImagePicker/Camera and Video metadata tools.
- Keep a 4:5 preview/crop for images where feasible.
- Upload to `review-photos/quarantine/*`, call moderation, then create review.

### Hungry

Source behavior:

- `app/hungry/page.tsx`
- `app/hungry/picks/page.tsx`
- `app/api/hungry/must-try/route.ts`
- `app/api/hungry/picks/route.ts`

V1 content:

- Must-try recommendations from public/Circle posts.
- Saved Hungry picks.
- Mark/unmark a post as a Hungry pick.
- Use location when available.

### Profile

Source behavior:

- `app/me/page.tsx`
- `app/api/me/route.ts`
- `components/me/MeClient.tsx`
- `lib/me-page-data.ts`

Sections:

- Header: display name, username, bio, account type.
- Stats: visits, places, dishes.
- Reputation tier and badges.
- Taste Trust summary.
- Review grid/list.
- Places and dishes subviews.
- Settings entry.

## Secondary Screens

### Review Detail

Source behavior:

- `app/reviews/[id]/page.tsx`
- `components/reviews/ReviewDetailClient.tsx`

Content:

- Full media carousel.
- Restaurant and area.
- Dishes/ratings.
- Body/tags.
- Likes, comments, save, share.
- Owner actions: edit visibility/body/items, delete.

### Comments

Source behavior:

- `app/comments/[id]/page.tsx`
- `app/api/comments/route.ts`
- `app/api/comments/[id]/route.ts`

Content:

- Thread for one post.
- Add comment.
- Delete own comments.

### Public/Friend Profile

Source behavior:

- `app/people/[username]/page.tsx`
- `components/people/FriendProfileClient.tsx`
- `lib/profile-reviews.ts`

Content:

- Profile header.
- Circle action/status.
- Visible reviews.
- Common restaurants.
- Hidden Circle content prompt.
- Reputation and Taste Trust.

### Circle Members

Source behavior:

- `app/me/circle/page.tsx`
- `app/people/[username]/circle/page.tsx`

Content:

- Current user's Circle members.
- Another user's public/member count view.
- Remove member action for current user.

### Restaurant Detail

Source behavior:

- `app/restaurants/[placeId]/page.tsx`
- `app/places/[placeId]/page.tsx`
- `components/trending/RestaurantPostsClient.tsx`

Content:

- Header and map link.
- Rating stats.
- Public review feed for `restaurant_id`.

### Dish Detail

Source behavior:

- `app/dishes/[dish]/page.tsx`

Content:

- Dish name.
- Top restaurants for this dish.
- Nearby/public toggle driven by location availability.

### Notifications

Source behavior:

- `app/notifications/page.tsx`
- `app/api/notifications/*`
- `components/reviews/NotificationsClient.tsx`

Content:

- Notification list.
- Unread count.
- Mark one/read all.
- Navigate to post/profile/system target.

### Settings

Source behavior:

- `app/me/settings/*`
- `app/api/delete-account/route.ts`

V1:

- Edit profile.
- Account privacy.
- Saved posts.
- Liked posts.
- Comment history.
- Logout.
- Delete account if required before launch.
