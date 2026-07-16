import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const matrix = JSON.parse(await readFile(new URL("../config/release-smoke-matrix.json", import.meta.url), "utf8"));
const required = [
  "launch", "signup-login", "email-otp", "oauth", "circle-load", "explore-load", "profile-load",
  "post-image-video", "comments-reaction-bookmark", "notifications", "memory-room-message-media",
  "logout-account-switch", "account-deletion", "private-media-matrix", "upload-process-recovery",
  "install-upgrade", "accessibility"
];
assert.equal(matrix.accounts.minimum, 2);
assert.deepEqual(matrix.platforms, ["android-physical", "ios-physical"]);
assert.deepEqual(matrix.cases.map((item) => item.id), required);
for (const item of matrix.cases) {
  assert.match(item.owner, /^[a-z-]+$/);
  assert.ok(item.evidence.length >= 20);
}
console.log(JSON.stringify({ cases: matrix.cases.length, status: "validated", execution: "physical staging pending" }, null, 2));
