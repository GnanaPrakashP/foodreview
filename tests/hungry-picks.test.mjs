import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hungrySource = readFileSync(
  new URL("../components/mylist/HungryPageClient.tsx", import.meta.url),
  "utf8"
);
const swipeStackSource = readFileSync(
  new URL("../components/mylist/SwipeStack.tsx", import.meta.url),
  "utf8"
);
const picksClientSource = readFileSync(
  new URL("../components/mylist/HungryPicksPageClient.tsx", import.meta.url),
  "utf8"
);
const picksRouteSource = readFileSync(
  new URL("../app/api/hungry/picks/route.ts", import.meta.url),
  "utf8"
);
const engagementSource = readFileSync(
  new URL("../lib/server/engagement-list.ts", import.meta.url),
  "utf8"
);
const schemaSource = readFileSync(
  new URL("../supabase/schema.sql", import.meta.url),
  "utf8"
);

test("hungry lunch box opens a dedicated right-swiped picks page", () => {
  assert.match(hungrySource, /href="\/hungry\/picks"/);
  assert.match(hungrySource, /aria-label="Right-swiped picks"/);
  assert.match(picksClientSource, /fetch\("\/api\/hungry\/picks", \{ cache: "no-store" \}\)/);
  assert.match(picksClientSource, /Right-swiped picks/);
});

test("hungry picks render compact 4:5 cards with place-style details", () => {
  assert.match(picksClientSource, /reviewMediaItems\(review\)/);
  assert.match(picksClientSource, /gridTemplateColumns: `\$\{PICK_CARD_IMAGE_WIDTH\}px 1fr`/);
  assert.match(picksClientSource, /minHeight: PICK_CARD_IMAGE_HEIGHT/);
  assert.match(picksClientSource, /const location = review\.area \|\| review\.restaurant_address \|\| ""/);
  assert.match(picksClientSource, /const caption = review\.body\?\.trim\(\) \?\? ""/);
  assert.match(picksClientSource, /WebkitLineClamp: 2/);
  assert.match(picksClientSource, /href=\{`\/reviews\/\$\{encodeURIComponent\(review\.id\)\}`\}/);
  assert.match(picksClientSource, /event\.preventDefault\(\)/);
  assert.match(picksClientSource, /event\.stopPropagation\(\)/);
  assert.match(picksClientSource, /Tried it/);
  assert.match(picksClientSource, /Remove/);
  assert.doesNotMatch(picksClientSource, /View post/);
  assert.doesNotMatch(picksClientSource, /Picked from/);
  assert.doesNotMatch(picksClientSource, /<CircleFeedCard/);
});

test("right swipes are stored as hungry picks, not wishlist saves", () => {
  assert.match(swipeStackSource, /onPickPost: \(post: Review\) => void/);
  assert.match(swipeStackSource, /if \(dir === "right"\) onPickPost\(current\)/);
  assert.match(swipeStackSource, /const isDraggingRef = useRef\(false\)/);
  assert.match(swipeStackSource, /const pointerUpDragX = e\.clientX - startXRef\.current/);
  assert.match(swipeStackSource, /const finalDragX = Math\.abs\(dragXRef\.current\) > Math\.abs\(pointerUpDragX\)/);
  assert.match(hungrySource, /fetch\("\/api\/hungry\/picks"/);
  assert.match(hungrySource, /body: JSON\.stringify\(\{ postId: post\.id \}\)/);
  assert.doesNotMatch(hungrySource, /fetch\("\/api\/wishlist"/);
});

test("hungry picks are server-backed and owner-scoped", () => {
  assert.match(picksRouteSource, /getRouteActor\(\)/);
  assert.match(picksRouteSource, /\.from\("hungry_picks"\)/);
  assert.match(picksRouteSource, /canActorReadPost\(db, postId\.trim\(\), actor\.actorName\)/);
  assert.match(picksRouteSource, /hungryPicksForActor\(db, actor\.actorName\)/);
  assert.match(picksClientSource, /method: "DELETE"/);
  assert.match(engagementSource, /hungryPicksForActor/);
  assert.match(schemaSource, /create table if not exists public\.hungry_picks/);
  assert.match(schemaSource, /create unique index if not exists hungry_picks_user_post_unique/);
  assert.match(schemaSource, /user_name = public\.current_profile_name\(\)/);
  assert.doesNotMatch(picksClientSource, /localStorage|sessionStorage|readHungryPicks|removeHungryPick/);
});
