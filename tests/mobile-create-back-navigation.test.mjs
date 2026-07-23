import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const share = readFileSync(new URL("../mobile/app/(tabs)/share.tsx", import.meta.url), "utf8");

test("Create hardware back mirrors the visible composer back controls", () => {
  assert.match(share, /import \{[^}]*BackHandler[^}]*\} from "react-native"/);
  assert.match(share, /BackHandler\.addEventListener\("hardwareBackPress", \(\) => \{/);
  assert.match(share, /if \(shareMode === "choice"\) return false/);
  assert.match(share, /if \(shareMode === "solo"\) handleSoloBackAction\(\)[\s\S]*else cancelShareMode\(\)[\s\S]*return true/);
  assert.match(share, /return \(\) => subscription\.remove\(\)/);
});

test("Table Memory close and hardware back both return to the Create choices", () => {
  assert.match(share, /onPress=\{shareMode === "solo" \? handleSoloBackAction : cancelShareMode\}/);
  assert.match(share, /setShareMode\("friends"\)/);
  assert.match(share, /const cancelShareMode = useCallback\(\(\) => \{[\s\S]*setShareMode\("choice"\)/);
});

test("Dining Experience hardware back walks preview, details, review, then Create", () => {
  assert.match(share, /soloStep === "preview"[\s\S]*setSoloStep\("details"\)/);
  assert.match(share, /soloStep === "details"[\s\S]*setSoloStep\("review"\)/);
  assert.match(share, /const handleSoloBackAction = useCallback[\s\S]*cancelShareMode\(\)/);
});
