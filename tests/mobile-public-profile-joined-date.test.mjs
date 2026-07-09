import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ownProfileSource = readFileSync("mobile/app/(tabs)/profile.tsx", "utf8");
const publicProfileSource = readFileSync("mobile/app/people/[username].tsx", "utf8");

test("public profile header exposes joined date like own profile", () => {
  assert.match(ownProfileSource, /const joinedAt = joinedLabel\(profile\.createdAt\)/);
  assert.match(publicProfileSource, /import \{ CalendarDays \} from "lucide-react-native"/);
  assert.match(publicProfileSource, /function joinedLabel\(value: string\)/);
  assert.match(publicProfileSource, /const joinedAt = page\.data \? joinedLabel\(page\.data\.profile\.createdAt\) : ""/);
  assert.match(publicProfileSource, /@{page\.data\.profile\.username}<\/Text>[\s\S]*\{joinedAt \? \(/);
  assert.match(publicProfileSource, /<Text style=\{styles\.joinedText\}>\{joinedAt\}<\/Text>/);
});
