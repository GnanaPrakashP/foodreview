import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("circle feed cards use next/image in a stable responsive media box", () => {
  const source = readFileSync(new URL("../components/reviews/CircleFeedCard.tsx", import.meta.url), "utf8");

  assert.match(source, /import Image from "next\/image"/);
  assert.match(source, /aspectRatio: "4\/5"/);
  assert.match(source, /set\("height",\s*"1200"\)/);
  assert.match(source, /function FeedReviewImage/);
  assert.match(source, /<Image[\s\S]*fill/);
  assert.match(source, /sizes="\(max-width: 512px\) 100vw, 512px"/);
  assert.match(source, /loading=\{priority \? undefined : "lazy"\}/);
  assert.match(source, /<FeedReviewImage[\s\S]*priority=\{priorityImage && i === 0\}/);
  assert.doesNotMatch(source, /<img\s/);
});

test("next image config allows Supabase originals and transformed thumbnails", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

  assert.match(source, /\/storage\/v1\/object\/public\/\*\*/);
  assert.match(source, /\/storage\/v1\/render\/image\/public\/\*\*/);
});

test("public explore feed selects legacy photo_urls for card covers", () => {
  const source = readFileSync(new URL("../app/api/feed/public/route.ts", import.meta.url), "utf8");

  assert.match(source, /"photo_url"/);
  assert.match(source, /"photo_urls"/);
  assert.match(source, /"review_photos\(media_asset_id, public_url, media_type, position\)"/);
});

test("explore and hungry hide synthetic E2E fixture posts", () => {
  const explore = readFileSync(new URL("../components/people/PeopleTab.tsx", import.meta.url), "utf8");
  const hungry = readFileSync(new URL("../components/mylist/HungryPageClient.tsx", import.meta.url), "utf8");

  assert.match(explore, /excludeSynthetic:\s*"1"/);
  assert.match(hungry, /excludeSynthetic:\s*"1"/);
});
