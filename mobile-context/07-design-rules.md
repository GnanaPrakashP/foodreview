# Mobile Design Rules

These rules translate the existing CircleBites web visual system into a native mobile app. Do not copy CSS or web layout directly.

## Visual Identity

Existing tokens from `app/globals.css`:

Dark:

- `bg`: `#0E0B08`
- `surface`: `#1A1410`
- `card`: `#211C17`
- `border`: `#2E2720`
- `orange`: `#F06030`
- `gold`: `#E8A830`
- `cream`: `#F5EDD8`
- `muted`: `#7A6E65`
- `green`: `#3DD68C`

Light:

- `bg`: `#F7F5F0`
- `surface`: `#EEF0E9`
- `card`: `#FFFFFF`
- `border`: `#D8D2C7`
- `orange`: `#C84A1C`
- `gold`: `#A96F04`
- `cream`: `#19140E`
- `muted`: `#665F57`
- `green`: `#0F7F52`

Mobile v1 can start dark-first and add system theme support later. Keep contrast strong for food photos.

## Typography

The web uses `DM Sans`. For Expo:

- Use bundled `DM Sans` if practical.
- Fallback to platform sans if font loading delays hurt startup.
- Keep tab labels and metadata small but readable.
- Avoid web-style dense inline text on mobile cards.

## Layout

- Use a native bottom tab bar with five tabs: Circle, Explore, Create, Hungry, Profile.
- Make Create visually prominent in the center, matching the web elevated orange plus button.
- Respect safe areas on iOS and Android.
- Use full-width scrolling screens, not desktop-style constrained columns.
- Keep repeated post cards at 8-14 px radius; avoid nested cards.
- Media should be the hero of a review card.

## Review Card Rules

Every feed card should show:

- Author.
- Restaurant and area.
- Media carousel, 4:5 default aspect.
- Dish ratings.
- Tags if present.
- Body if present.
- Like/comment/save actions.

Keep action state instantly visible:

- Liked: filled/active icon.
- Saved/Hungry: filled/active icon.
- Comment count visible.

## Create Review Rules

- Native media picker should feel like the first step, not an attachment afterthought.
- Show selected media as a stable 4:5 grid/carousel.
- Restaurant field must force selection from suggestions for new reviews.
- Dish rows should be quick to add/remove.
- Rating should be tappable stars or segmented icons, not a dropdown.
- Visibility should be a segmented control:
  - Public
  - Circle
  - Only me
- Submit state must show exactly what is happening:
  - Uploading
  - Checking
  - Posting

## Explore Rules

- Location is part of the Explore header.
- Category chips use image assets where useful, but keep them compact.
- Restaurant cards should answer: "Should I go here?"
- Dish cards should answer: "Where should I eat this?"
- People search should support Circle actions inline.

## Profile Rules

- Lead with identity and stats.
- Reputation tier should be visible without dominating the screen.
- Badges should be horizontal/compact.
- Reviews should be easy to scan by restaurant/media.
- Use separate subviews for places/dishes if the main profile gets crowded.

## Native Interaction Rules

- Pull to refresh on feeds/profile lists.
- Infinite scroll with visible loading footer.
- Optimistic like/save/comment where safe.
- Haptics for successful create, like, save, Circle accept.
- Use native share sheet for post sharing.
- Use native maps linking for restaurant addresses.

## Accessibility

- Every icon button needs an accessibility label.
- Food photos need fallback labels based on restaurant/dish.
- Hit targets should be at least 44x44 points.
- Do not rely on color alone for visibility/account states.
- Support dynamic type where possible, but protect feed card layout from breaking.

## Asset Rules

- Copy category and badge PNGs into Expo assets.
- Use optimized image rendering and caching.
- Use responsive image sizes from Supabase URLs if an image transformation layer exists; otherwise cache originals carefully.
- Videos should show a clear play indicator and not autoplay with sound.

## What Not To Copy From Web

- Do not copy inline style objects.
- Do not copy browser localStorage/sessionStorage helpers directly.
- Do not reproduce desktop/browser loading behavior.
- Do not use Next.js routes as navigation architecture.
- Do not use web-only APIs such as `document`, `window`, `File`, `HTMLCanvasElement`, or browser geolocation in mobile code.
