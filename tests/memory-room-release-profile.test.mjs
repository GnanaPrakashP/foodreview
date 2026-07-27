import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function source(path) {
  return readFileSync(path, "utf8");
}

function loadScrollState() {
  const { outputText } = ts.transpileModule(
    source("mobile/src/features/memories/room/memoryRoomScrollState.ts"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  );
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports, require) {${outputText}\n})`, {
    module
  })(module, module.exports, () => {
    throw new Error("scroll state has no runtime imports");
  });
  return module.exports;
}

const roomScreen = source("mobile/app/memories/[id].tsx");
const releaseProfile = source("mobile/src/performance/memoryRoomReleaseProfile.ts");
const offlineStore = source("mobile/src/services/memoryOfflineStore.ts");
const profileScreen = source("mobile/app/(tabs)/profile.tsx");
const cameraScreen = source("mobile/src/components/memories/camera/CameraScreen.tsx");

test("room-session scroll state is bounded and isolated by room", () => {
  const {
    captureMemoryRoomScrollOffset,
    createMemoryRoomScrollSession,
    readMemoryRoomScrollOffset
  } = loadScrollState();
  const roomA = createMemoryRoomScrollSession("room-a");
  const roomB = createMemoryRoomScrollSession("room-b");

  captureMemoryRoomScrollOffset(roomA, "overview", 480);
  captureMemoryRoomScrollOffset(roomA, "media", 920);
  captureMemoryRoomScrollOffset(roomA, "dishes", Number.POSITIVE_INFINITY);
  captureMemoryRoomScrollOffset(roomA, "chat", -25);

  assert.equal(readMemoryRoomScrollOffset(roomA, "overview"), 480);
  assert.equal(readMemoryRoomScrollOffset(roomA, "media"), 920);
  assert.equal(readMemoryRoomScrollOffset(roomA, "dishes"), 0);
  assert.equal(readMemoryRoomScrollOffset(roomA, "chat"), 0);
  assert.deepEqual(Object.values(roomB.offsets), [0, 0, 0, 0]);
  assert.notEqual(roomA.offsets, roomB.offsets);
});

test("all four active-only panes restore a bounded initial offset without retaining native trees", () => {
  const pane = roomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.match(pane, /if \(!active\) return null/);
  assert.equal((roomScreen.match(/initialScrollOffset=\{readMemoryRoomScrollOffset/g) ?? []).length, 4);
  assert.equal((roomScreen.match(/contentOffset=\{\{ x: 0, y: initialScrollOffset \}\}/g) ?? []).length, 3);
  assert.match(roomScreen, /contentOffset: \{ x: 0, y: initialScrollOffset \}/);
  assert.equal((roomScreen.match(/scrollEventThrottle=\{32\}/g) ?? []).length, 3);
  assert.match(roomScreen, /captureMemoryRoomScrollOffset\(scrollSessionRef\.current, "chat", offset\)/);
});

test("release-profile tracing enumerates every directed tab pair and contains no content fields", () => {
  const tabs = ["overview", "chat", "media", "dishes"];
  const pairs = tabs.flatMap((from) => tabs.filter((to) => to !== from).map((to) => `${from}_to_${to}`));
  assert.equal(pairs.length, 12);
  assert.equal(new Set(pairs).size, 12);
  assert.match(releaseProfile, /MemoryRoomTabTransition_\$\{from\}_to_\$\{to\}/);
  for (const marker of [
    "MemoryRoomEntry",
    "MemoryRoomLocalSnapshot",
    "MemoryRoomServerReconcile",
    "MemoryRoomChatMount",
    "MemoryRoomMediaMount",
    "MemoryRoomDishesMount",
    "MemoryRoomTableMount",
    "MemoryRoomViewerOpen",
    "MemoryRoomViewerClose",
    "MemoryRoomExit"
  ]) {
    assert.match(`${releaseProfile}\n${roomScreen}`, new RegExp(marker));
  }
  assert.doesNotMatch(
    releaseProfile,
    /roomName|messageBody|participant|publicUrl|signedUrl|storagePath|accessToken|refreshToken/
  );
  assert.match(profileScreen, /beginMemoryRoomEntry\("overview"\)/);
});

test("SQLite profile counters cover actual reads and serialized writes without payload logging", () => {
  for (const operation of [
    "local_snapshot_read",
    "message_page_read",
    "media_page_read",
    "summary_read",
    "sync_cursor_read"
  ]) {
    assert.match(offlineStore, new RegExp(`beginMemoryRoomSqliteOperation\\("${operation}", "read"\\)`));
  }
  assert.match(offlineStore, /offlineWriteQueueDepth \+= 1/);
  assert.match(offlineStore, /finishProfile\(offlineWriteQueueDepth\)/);
  assert.match(releaseProfile, /MemoryRoomSQLiteQueueDepth/);
  assert.match(releaseProfile, /MemoryRoomSQLiteSlowOperations/);
  assert.doesNotMatch(releaseProfile, /console\.(?:debug|info|log|warn|error)/);
});

test("release trace counters balance room-owned players, Realtime, and recorders", () => {
  const hooks = source("mobile/src/hooks/useMemories.ts");
  for (const counter of [
    "MemoryRoomActivePlayers",
    "MemoryRoomActiveRealtimeChannels",
    "MemoryRoomActiveRecorders"
  ]) {
    assert.match(`${releaseProfile}\n${hooks}\n${roomScreen}`, new RegExp(counter));
  }
  assert.equal(
    (roomScreen.match(/adjustMemoryRoomResourceCounter\(\s*"MemoryRoomActivePlayers"/g) ?? []).length,
    3
  );
  assert.match(hooks, /releaseRealtimeCounter\(\);[\s\S]*removeChannel\(channel\)/);
  assert.match(roomScreen, /VoiceRecorderHost[\s\S]*MemoryRoomActiveRecorders/);
});

test("profile hooks preserve one-press-one-transition and end at the target usable frame", () => {
  assert.match(roomScreen, /if \(nextMode === mode\) return/);
  assert.match(roomScreen, /beginMemoryRoomTabTransition\(mode, nextMode\)/);
  assert.match(roomScreen, /markMemoryRoomSurfaceUsable\(tab\)/);
  assert.match(roomScreen, /onPressIn=\{activateOnPressIn\}/);
  assert.match(roomScreen, /pointerReleasePendingRef/);
});

test("physical accessibility fixes distinguish rooms, size tabs, and preserve gallery access", () => {
  assert.match(
    profileScreen,
    /accessibilityLabel=\{`Open \$\{memory\.title \|\| "memory"\} room/
  );
  assert.doesNotMatch(profileScreen, /accessibilityLabel="Open memory room"/);
  assert.match(roomScreen, /ROOM_HEADER_EXPANDED_HEIGHT\s*=\s*190/);
  assert.match(roomScreen, /modeButton:\s*\{[\s\S]*?minHeight:\s*52/);

  const deniedState = cameraScreen.match(
    /if \(cameraPermission\.denied\) \{[\s\S]*?\n  \}\n\n  return \(/
  )?.[0] ?? "";
  assert.match(deniedState, /Camera access needed/);
  assert.match(deniedState, /accessibilityLabel="Choose from gallery"/);
  assert.match(deniedState, /onPress=\{\(\) => void openGallery\(\)\}/);
  assert.match(
    roomScreen,
    /Microphone access needed[\s\S]*?style: "cancel", text: "Not now"[\s\S]*?Linking\.openSettings\(\), text: "Open settings"/
  );
});
