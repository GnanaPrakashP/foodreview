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

function loadChatLifecycle(environment = {}) {
  const { outputText } = ts.transpileModule(
    source("mobile/src/performance/memoryRoomChatLifecycle.ts"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  );
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports, require, process) {${outputText}\n})`, {
    module
  })(
    module,
    module.exports,
    () => {
      throw new Error("chat lifecycle has no runtime imports");
    },
    { env: environment }
  );
  return module.exports;
}

const roomScreen = source("mobile/app/memories/[id].tsx");
const releaseProfile = source("mobile/src/performance/memoryRoomReleaseProfile.ts");
const jankHarness = source("tests/mobile-memory-room-jank-memory-validation.mjs");
const chatLifecycle = source("mobile/src/performance/memoryRoomChatLifecycle.ts");
const nativeChatInput = source("mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/NativeChatInputView.kt");
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

test("pane ownership remains explicit, inaccessible and non-interactive while hidden", () => {
  const pane = roomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.match(pane, /if \(!mounted\) return null/);
  assert.match(pane, /pointerEvents=\{interactive \? "auto" : "none"\}/);
  assert.match(pane, /accessibilityElementsHidden=\{!interactive\}/);
  assert.match(pane, /importantForAccessibility=\{interactive \? "auto" : "no-hide-descendants"\}/);
  assert.equal((roomScreen.match(/initialScrollOffset=\{readMemoryRoomScrollOffset/g) ?? []).length, 4);
  assert.equal((roomScreen.match(/contentOffset=\{\{ x: 0, y: initialScrollOffset \}\}/g) ?? []).length, 3);
  assert.match(roomScreen, /contentOffset: \{ x: 0, y: initialScrollOffset \}/);
  assert.equal((roomScreen.match(/scrollEventThrottle=\{32\}/g) ?? []).length, 3);
  assert.match(roomScreen, /captureMemoryRoomScrollOffset\(scrollSessionRef\.current, "chat", offset\)/);
});

test("profile-only lifecycle selector preserves cold production default", () => {
  assert.deepEqual(
    [...loadChatLifecycle().MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATES],
    ["cold", "retained-shell", "warm-bounded", "precreate"]
  );
  assert.equal(
    loadChatLifecycle({
      EXPO_PUBLIC_MEMORY_ROOM_CHAT_LIFECYCLE: "warm-bounded"
    }).MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE,
    "cold"
  );
  assert.equal(
    loadChatLifecycle({
      EXPO_PUBLIC_MEMORY_ROOM_CHAT_LIFECYCLE: "warm-bounded",
      EXPO_PUBLIC_PERFORMANCE_PROFILE: "1"
    }).MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE,
    "warm-bounded"
  );
  assert.match(chatLifecycle, /: "cold";/);
});

test("precreate coordinator supersedes stale work and never exposes two interactive panes", () => {
  const lifecycle = loadChatLifecycle();
  let state = lifecycle.createMemoryRoomPaneTransitionState("overview");
  state = lifecycle.prepareMemoryRoomPaneTransition(state, "chat");
  const staleGeneration = state.generation;
  assert.equal(state.interactive, null);
  assert.deepEqual([...state.mounted], ["overview", "chat"]);

  state = lifecycle.prepareMemoryRoomPaneTransition(state, "dishes");
  const finalGeneration = state.generation;
  assert.ok(finalGeneration > staleGeneration);
  assert.equal(
    lifecycle.commitPreparedMemoryRoomPaneTransition(state, staleGeneration),
    state
  );

  state = lifecycle.commitPreparedMemoryRoomPaneTransition(state, finalGeneration);
  assert.equal(state.visible, "dishes");
  assert.equal(state.interactive, "dishes");
  assert.equal(
    [state.interactive].filter((tab) => state.mounted.includes(tab)).length,
    1
  );
  assert.equal(lifecycle.settleMemoryRoomPaneTransition(state, staleGeneration), state);
  state = lifecycle.settleMemoryRoomPaneTransition(state, finalGeneration);
  assert.deepEqual([...state.mounted], ["dishes"]);
});

test("transition exit and background reset leave one consistent ownership state", () => {
  const lifecycle = loadChatLifecycle();
  const preparing = lifecycle.prepareMemoryRoomPaneTransition(
    lifecycle.createMemoryRoomPaneTransitionState("chat"),
    "media"
  );
  const exited = lifecycle.exitMemoryRoomPaneTransition(preparing);
  assert.equal(exited.phase, "exited");
  assert.equal(exited.interactive, null);
  assert.deepEqual([...exited.mounted], []);
  assert.equal(
    lifecycle.commitPreparedMemoryRoomPaneTransition(exited, preparing.generation),
    exited
  );

  const reset = lifecycle.resetMemoryRoomPaneTransition(preparing, "overview");
  assert.equal(reset.interactive, "overview");
  assert.equal(reset.visible, "overview");
  assert.deepEqual([...reset.mounted], ["overview"]);
});

test("bounded warm Chat has one host, releases focus and owns no inactive player", () => {
  assert.match(roomScreen, /MemoryRoomMountedChatHosts/);
  assert.match(roomScreen, /MemoryRoomMountedChatInputs/);
  assert.match(roomScreen, /MemoryRoomMountedChatShells/);
  assert.match(roomScreen, /active\s*\?\s*<ChatMainAudioMessage[\s\S]*?: null/);
  assert.match(roomScreen, /editable=\{active\}/);
  assert.match(roomScreen, /messageInputRef\.current\?\.blur\(\)/);
  assert.match(nativeChatInput, /fun blurInput\(\)/);
  assert.match(nativeChatInput, /editText\.clearFocus\(\)/);
  assert.match(nativeChatInput, /hideSoftInputFromWindow/);
  assert.match(roomScreen, /setReplyingToMessage\(null\)/);
  assert.match(roomScreen, /setSelectedItemKeys\(\[\]\)/);
});

test("Dishes mounts a bounded virtualized window instead of every rating card", () => {
  const dishesPanel = roomScreen.match(
    /function DishesPanel\([\s\S]*?\n\}\n\n\/\/ Shared dish detail/
  )?.[0] ?? "";
  assert.match(roomScreen, /const DishesPanelRow = memo\(function DishesPanelRow/);
  assert.match(dishesPanel, /<FlatList/);
  assert.match(dishesPanel, /initialNumToRender=\{DISHES_INITIAL_RENDER_COUNT\}/);
  assert.match(dishesPanel, /maxToRenderPerBatch=\{DISHES_MAX_RENDER_BATCH\}/);
  assert.match(dishesPanel, /windowSize=\{DISHES_WINDOW_SIZE\}/);
  assert.match(dishesPanel, /removeClippedSubviews=\{Platform\.OS === "android"\}/);
  assert.doesNotMatch(dishesPanel, /dishes\.map\(/);
  assert.equal(
    Number(roomScreen.match(/const DISHES_INITIAL_RENDER_COUNT = (\d+);/)?.[1]),
    4
  );
});

test("Chat projection and unread anchor belong to the room lifetime, not each tab mount", () => {
  const chatSurface = roomScreen.match(
    /function MemoryChatMainSurface\([\s\S]*?\nfunction MemoryChatTimeline/
  )?.[0] ?? "";
  assert.match(roomScreen, /const roomUnreadAnchorRef = useRef/);
  assert.match(roomScreen, /const projectedChatMessages = useMemo/);
  assert.match(roomScreen, /chatMessages=\{chatMessagesForHost\}/);
  assert.doesNotMatch(chatSurface, /buildMemoryChatMainMessages\(/);
  assert.doesNotMatch(chatSurface, /firstUnreadMemoryMessageId\(/);
  assert.equal(
    Number(roomScreen.match(/const CHAT_MAIN_INITIAL_RENDER_COUNT = (\d+);/)?.[1]),
    8
  );
  assert.equal(
    Number(roomScreen.match(/const CHAT_MAIN_MAX_RENDER_BATCH = (\d+);/)?.[1]),
    6
  );
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

test("release profile exposes bounded row and cache cardinalities without content", () => {
  for (const counter of [
    "MemoryRoomMountedChatRows",
    "MemoryRoomMountedDishRows",
    "MemoryRoomMountedMediaTiles",
    "MemoryRoomQueryCount",
    "MemoryRoomQueryObserverCount",
    "MemoryRoomInactiveQueryCount",
    "MemoryRoomQueryMutationCount",
    "MemoryRoomCurrentRoomQueryCount",
    "MemoryRoomChatEntityCount",
    "MemoryRoomDishEntityCount",
    "MemoryRoomMediaEntityCount"
  ]) {
    assert.match(`${releaseProfile}\n${roomScreen}`, new RegExp(counter));
  }
  assert.match(roomScreen, /queries\.filter\(\(query\) => !query\.isActive\(\)\)\.length/);
  assert.match(roomScreen, /query\.getObserversCount\(\)/);
  assert.doesNotMatch(releaseProfile, /queryKey|roomId|username|messageBody/);
});

test("profile hooks preserve one-press-one-transition and end at the target usable frame", () => {
  assert.doesNotMatch(roomScreen, /if \(nextMode === mode\) return/);
  assert.match(roomScreen, /const requestedMode = requestedRoomModeRef\.current/);
  assert.match(roomScreen, /requestedRoomModeRef\.current = nextMode/);
  assert.match(roomScreen, /beginMemoryRoomTabTransition\(fromMode, nextMode\)/);
  assert.match(roomScreen, /markMemoryRoomSurfaceUsable\(tab\)/);
  assert.match(roomScreen, /onPressIn=\{activateOnPressIn\}/);
  assert.match(roomScreen, /pointerReleasePendingRef/);
  assert.match(roomScreen, /\(onPrepare \?\? onPress\)\(\)/);
  assert.match(jankHarness, /MEMORY_RELEASE_CAPTURE_EXIT/);
  assert.match(jankHarness, /traceDurations\(trace, "MemoryRoomExit"\)/);
  assert.match(jankHarness, /room_exit_plus_10s/);
  assert.match(jankHarness, /room_exit_plus_30s/);
  assert.match(jankHarness, /room_exit_plus_60s/);
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
