import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ownProfileSource = readFileSync("mobile/app/(tabs)/profile.tsx", "utf8");
const publicProfileSource = readFileSync("mobile/app/people/[username].tsx", "utf8");

test("public profile header exposes joined date like own profile", () => {
  assert.match(ownProfileSource, /const joinedAt = joinedLabel\(profile\.createdAt\)/);
  assert.match(publicProfileSource, /import \{[^}]*CalendarDays[^}]*\} from "lucide-react-native"/);
  assert.match(publicProfileSource, /function joinedLabel\(value: string\)/);
  assert.match(publicProfileSource, /const joinedAt = shell\.data \? joinedLabel\(shell\.data\.profile\.createdAt\) : ""/);
  assert.match(publicProfileSource, /@{displayedUsername}<\/Text>[\s\S]*\{shell\.data && joinedAt \? \(/);
  assert.match(publicProfileSource, /<Text style=\{styles\.joinedText\}>\{joinedAt\}<\/Text>/);
});

test("public profile bio matches the own-profile full-width alignment", () => {
  assert.match(publicProfileSource, /<View style=\{styles\.heroIdentityRow\}>[\s\S]*<View style=\{styles\.identity\}>[\s\S]*<\/View>\s*<\/View>\s*\{shell\.data\?\.profile\.bio \? \(/);
  assert.match(publicProfileSource, /<Text style=\{styles\.bio\}>\{shell\.data\.profile\.bio\}<\/Text>/);
  assert.match(publicProfileSource, /bio:\s*\{[\s\S]*fontSize: typography\.body,[\s\S]*lineHeight: 20,[\s\S]*marginLeft: 4,[\s\S]*marginTop: spacing\.md/);
  assert.doesNotMatch(publicProfileSource, /bio:\s*\{[\s\S]{0,220}opacity:/);
});

test("public profile keeps a compact eight-dp header-to-avatar gap", () => {
  assert.match(publicProfileSource, /<View style=\{styles\.profileHeaderLead\}>\s*\{topBar\}[\s\S]*<View style=\{styles\.hero\}>/);
  assert.match(publicProfileSource, /profileHeaderLead:\s*\{\s*gap: spacing\.sm\s*\}/);
  assert.match(publicProfileSource, /stack:\s*\{[\s\S]*gap: screenLayout\.headerContentGap/);
});
