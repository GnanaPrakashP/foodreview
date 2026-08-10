# Witoh Product Summary

Witoh is a social food review app centered on real posts from people the user trusts. The current web app is a Next.js App Router product backed by Supabase, Google Places, Supabase Storage, and a small set of server routes for moderation, notifications, and cache-aware data loading.

Do not port the web UI directly. Treat the web app as the source of product behavior, data contracts, validation rules, and ranking logic. Build the mobile app as a native React Native + Expo experience.

## Core Product Idea

Users share restaurant visits as media-first posts:

- A post must include at least one photo or video.
- A post belongs to one restaurant, preferably selected from Google Places.
- A post contains one or more dishes, each with a 1-5 star rating.
- A post can include an optional short body and up to 5 tags.
- Visibility is `public`, `circle`, or `me`.

The app then turns these posts into:

- A Circle feed from people the user follows through Circle relationships.
- Public discovery for restaurants, dishes, and people.
- Profile pages with review history, places, dishes, reputation, badges, and trust signals.
- Restaurant and dish pages generated from review data.
- Social engagement: likes, comments, saves/wishlist, Hungry picks, Circle requests, notifications.

## Existing Navigation Model

The web bottom nav has five primary tabs:

- `Circle`: root route `/`, implemented by `app/CirclePageClient.tsx`.
- `Explore`: `/explore`, heavily powered by `components/people/PeopleTab.tsx`.
- `Share`: `/share` and `/reviews/new`, create-review entry.
- `Hungry`: `/hungry`, plus `/hungry/picks`.
- `Me`: `/me`, profile and settings.

For mobile v1, keep the same product areas but make them native:

- `Circle`
- `Explore`
- `Create`
- `Hungry`
- `Profile`

## Audience And Tone

Witoh feels like a tight food circle, not a generic restaurant directory. The feed should feel personal, fast, image-led, and snackable. Discovery should answer practical questions:

- What should I eat nearby?
- Which friends have been there?
- Which dish is worth ordering?
- Who has reliable taste?

## Source Of Truth Files

Important product behavior is in:

- `app/api/reviews/route.ts`: create review.
- `app/api/feed/circle/route.ts` and `lib/circle-feed.ts`: Circle feed.
- `app/api/feed/public/route.ts`: public feed and restaurant filtered feed.
- `app/api/me/route.ts` and `lib/me-page-data.ts`: current-user profile payload.
- `app/people/[username]/page.tsx`: public/friend profile payload.
- `app/restaurants/[placeId]/page.tsx`: restaurant page behavior.
- `app/dishes/[dish]/page.tsx`: dish page behavior.
- `lib/reputation.ts` and `lib/server/reputation.ts`: reputation and badges.
- `lib/visibility.ts`: visibility filtering.
- `lib/browser-api-cache.ts`, `lib/private-cache.ts`: existing cache intent.
- `supabase/schema.sql`: canonical schema plus RLS.

## Mobile Product Principles

- Keep media and food details first. A review without media is not valid in current product behavior.
- Keep Circle and privacy semantics exact. `circle` content is only visible to accepted Circle members; `me` is only visible to the author.
- Keep place identity through Google Places `placeId` where possible. Fall back to restaurant name only for old data.
- Prefer direct Supabase client reads where RLS already protects data, but keep server routes for privileged operations, media moderation, Google Places, and notification fanout.
- Use native mobile strengths: camera, image picker, location permissions, haptics, pull-to-refresh, optimistic actions, offline-tolerant caching.
