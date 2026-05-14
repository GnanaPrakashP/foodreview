import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("circle feed cards use next/image in a stable responsive media box", () => {
  const source = readFileSync(new URL("../components/reviews/CircleFeedCard.tsx", import.meta.url), "utf8");

  assert.match(source, /import Image from "next\/image"/);
  assert.match(source, /aspectRatio: "4\/5"/);
  assert.match(source, /set\("height", "1200"\)/);
  assert.match(source, /<Image[\s\S]*fill/);
  assert.match(source, /sizes="\(max-width: 512px\) 100vw, 512px"/);
  assert.match(source, /loading=\{priorityImage && i === 0 \? undefined : "lazy"\}/);
  assert.doesNotMatch(source, /<img\s/);
});

test("next image config allows Supabase originals and transformed thumbnails", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

  assert.match(source, /\/storage\/v1\/object\/public\/\*\*/);
  assert.match(source, /\/storage\/v1\/render\/image\/public\/\*\*/);
});
