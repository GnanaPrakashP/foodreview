import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/reviews/NotificationsClient.tsx", import.meta.url),
  "utf8"
);

test("notifications client: comment notifications do not fall back to username when stored display message exists", () => {
  assert.match(source, /const storedMessage = typeof notification\.message === "string"/);
  assert.match(source, /if \(storedMessage && username && !profileMap\[username\]\) return storedMessage;/);

  const storedMessageIndex = source.indexOf("if (storedMessage && username && !profileMap[username]) return storedMessage;");
  const commentMessageIndex = source.indexOf("if (notification.type === \"POST_COMMENTED\"");
  assert.ok(storedMessageIndex >= 0);
  assert.ok(commentMessageIndex >= 0);
  assert.ok(
    storedMessageIndex < commentMessageIndex,
    "stored display message should be used before reconstructing a comment notification from actor_name"
  );
});

