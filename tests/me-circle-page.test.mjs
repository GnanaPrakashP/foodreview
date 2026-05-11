import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/me/circle/page.tsx", import.meta.url),
  "utf8"
);

test("me/circle page renders a per-member remove button", () => {
  assert.match(source, />\s*\{removingName === name \? "Removing\.\.\." : "Remove"\}\s*<\/button>/);
});

test("me/circle page uses in-app confirmation modal before removing a member", () => {
  assert.match(source, /const \[confirmRemoveName,\s*setConfirmRemoveName\] = useState<string \| null>\(null\)/);
  assert.match(source, /setConfirmRemoveName\(name\)/);
  assert.match(source, /Remove from circle\?/);
  assert.match(source, /Do you want to remove \{confirmRemoveName\} from your circle\?/);
  assert.match(source, />\s*Cancel\s*<\/button>/);
  assert.match(source, />\s*Remove\s*<\/button>/);
  assert.match(source, /await removeFromMyCircle\(target\)/);
});

test("me/circle page calls remove API with otherName", () => {
  assert.match(source, /fetch\("\/api\/circle\/remove",\s*\{/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /"Content-Type":\s*"application\/json"/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*otherName:\s*memberName\s*\}\)/);
});

test("me/circle page optimistically removes the member before the API responds", () => {
  assert.match(source, /setMembers\(\(prev\) => prev\.filter\(\(member\) => member\.name !== memberName\)\)/);
});

test("me/circle page rolls back member list when API returns a non-ok response", () => {
  assert.match(source, /const previousMembers = members/);
  assert.match(source, /if \(!res\.ok\)\s*\{\s*setMembers\(previousMembers\)/s);
});

test("me/circle page rolls back member list when the fetch throws", () => {
  assert.match(source, /catch\s*\{[\s\S]*?setMembers\(previousMembers\)/);
});

test("me/circle page always clears removingName in finally after remove attempt", () => {
  assert.match(source, /finally\s*\{[\s\S]*?setRemovingName\(null\)/);
});

test("me/circle page dismisses modal before calling removeFromMyCircle", () => {
  // setConfirmRemoveName(null) must appear before the removeFromMyCircle call in source order
  const dismissIdx = source.indexOf("setConfirmRemoveName(null)");
  const removeIdx = source.indexOf("await removeFromMyCircle(target)");
  assert.ok(dismissIdx !== -1, "setConfirmRemoveName(null) not found");
  assert.ok(removeIdx !== -1, "await removeFromMyCircle(target) not found");
  assert.ok(dismissIdx < removeIdx, "modal should be dismissed before remove is called");
});

test("me/circle page cancel button dismisses the confirmation modal", () => {
  assert.match(source, /onClick=\{\(\) => setConfirmRemoveName\(null\)\}/);
});

test("me/circle page disables both modal buttons while a removal is in progress", () => {
  assert.match(source, /disabled=\{Boolean\(removingName\)\}/);
});

test("me/circle page shows empty state when no members are present", () => {
  assert.match(source, /Your circle is empty/);
  assert.match(source, /Find friends/);
});

test("me/circle page sets removingName to the member being removed at the start of the operation", () => {
  assert.match(source, /setRemovingName\(memberName\)/);
});

test("me/circle page disables the row-level remove button while that specific member is being removed", () => {
  assert.match(source, /disabled=\{removingName === name\}/);
});

test("me/circle page shows different empty-state copy for public vs private accounts", () => {
  assert.match(source, /accountType === "public" \? "No one has joined your circle yet" : "Add friends to build your circle"/);
});
