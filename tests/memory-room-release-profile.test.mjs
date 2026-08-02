import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

function loadChatRenderer(environment = {}) {
  const { outputText } = ts.transpileModule(
    source("mobile/src/performance/memoryRoomChatRenderer.ts"),
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
      throw new Error("chat renderer has no runtime imports");
    },
    { env: environment }
  );
  return module.exports;
}

function loadChatRowModel() {
  const { outputText } = ts.transpileModule(
    source("mobile/src/features/memories/chat/memoryChatRowModel.ts"),
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
  })(
    module,
    module.exports,
    (id) => {
      if (id === "@/services/memoryChatRowKeys") {
        return {
          memoryChatRowKey: (message) =>
            message.clientId ? `client:${message.clientId}` : `message:${message.id}`
        };
      }
      if (id === "@/services/memoryMessageReconciliation.mjs") {
        return {
          compareMemoryMessages: (left, right) =>
            left.clientCreatedAt.localeCompare(right.clientCreatedAt) ||
            left.id.localeCompare(right.id)
        };
      }
      if (id === "@/utils/datetime") {
        return {
          formatDisplayDate: (value) => `date:${value.slice(0, 10)}`,
          formatDisplayTime: (value) => `time:${value.slice(11, 16)}`
        };
      }
      throw new Error(`unexpected chat row model import: ${id}`);
    }
  );
  return module.exports;
}

const roomScreen = source("mobile/app/memories/[id].tsx");
const releaseProfile = source("mobile/src/performance/memoryRoomReleaseProfile.ts");
const jankHarness = source("tests/mobile-memory-room-jank-memory-validation.mjs");
const releaseFixture = source("tests/mobile-memory-room-release-fixture.mjs");
const chatRenderer = source("mobile/src/performance/memoryRoomChatRenderer.ts");
const chatRowModel = source("mobile/src/features/memories/chat/memoryChatRowModel.ts");
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
  assert.equal(
    (
      roomScreen.match(
        /contentOffset=\{\{ x: 0, y: initialScrollOffset \}\}/g
      ) ?? []
    ).length,
    5
  );
  assert.match(roomScreen, /contentOffset: \{ x: 0, y: initialScrollOffset \}/);
  assert.equal((roomScreen.match(/scrollEventThrottle=\{32\}/g) ?? []).length, 3);
  assert.match(roomScreen, /captureMemoryRoomScrollOffset\(scrollSessionRef\.current, "chat", offset\)/);
});

test("Chat is retained for the room visit and every other pane is not", () => {
  // One lifecycle, not a selector. Chat is the only pane worth carrying: it
  // rebuilt ~291 native views per switch, where Table/Media/Dishes are small
  // enough that their cold mount is imperceptible.
  assert.match(
    roomScreen,
    /const paneMounted = \(tab: RoomTabMode\) => \(\s*\n\s*tab === "chat"\s*\n\s*\? chatWarmReady \|\| paneTabMode === "chat"\s*\n\s*: paneTabMode === tab/
  );
  // Warmed late so the room's opening frames stay clear of it.
  assert.match(
    roomScreen,
    /if \(chatWarmReady \|\| !room\.data\) return undefined;[\s\S]*?InteractionManager\.runAfterInteractions\([\s\S]*?MEMORY_ROOM_CHAT_WARM_DELAY_MS/
  );
  // The room id is the ownership boundary: a retained host must not cross it.
  assert.match(roomScreen, /setChatWarmReady\(paneTabMode === "chat"\);/);
});

test("an inactive pane is removed from layout, not just made transparent", () => {
  // A pane hidden with opacity:0 still takes part in layout and drawing, so
  // every tab switch re-composited the whole retained Chat subtree on the UI
  // thread. Measured on device across four Table<->Chat round trips: 37.8%
  // janky frames with ~29 rows mounted, 5.4% with the chat content removed
  // entirely, 18.8% with display:none. The pane stays MOUNTED either way, so
  // retention and scroll position are unaffected.
  assert.match(
    roomScreen,
    /roomPagerPageInactive: \{[\s\S]*?display: "none",[\s\S]*?opacity: 0,/
  );
  assert.match(roomScreen, /roomPagerPageActive: \{\s*opacity: 1,/);
  // Still mounted: hiding must never be implemented by dropping children.
  assert.match(roomScreen, /if \(!mounted\) return null;/);
});

test("a retained but inactive Chat pane holds no interactive ownership", () => {
  // Retention makes this mandatory rather than optional: a mounted pane that
  // is not the active tab must not keep IME focus, a reply target, a selection
  // or an open reaction picker.
  assert.match(
    roomScreen,
    /if \(mode === "chat"\) return;\s*\n\s*void messageInputRef\.current\?\.blur\(\)/
  );
  // Read position may only advance from the ACTIVE pane's viewport, or a
  // retained pane laid out behind another tab would mark messages read.
  assert.match(
    roomScreen,
    /const handleChatMainViewableItems = useStableHandler\([\s\S]*?if \(!active\) return;/
  );
});

test("Chat ships the FlatList engine and keeps FlashList one env var away", () => {
  assert.deepEqual(
    [...loadChatRenderer().MEMORY_ROOM_CHAT_RENDERER_CANDIDATES],
    ["vendor", "vendor-flashlist", "lite-flatlist", "lite-flashlist", "native-recycler"]
  );
  // FlatList ships: FlashList closes the fling gaps but doubles the tab-switch
  // frame tail (90th 61ms -> 125ms on device), and transition smoothness is the
  // higher priority.
  const shipped = loadChatRenderer();
  assert.equal(shipped.MEMORY_ROOM_CHAT_RENDERER, "vendor");
  assert.equal(shipped.MEMORY_ROOM_CHAT_VENDOR_FLASHLIST, false);
  assert.equal(shipped.MEMORY_ROOM_CHAT_LITE_RENDERER, false);
  assert.equal(shipped.MEMORY_ROOM_CHAT_NATIVE_RENDERER, false);
  // FlashList stays reachable and fully wired for the day the synchronous
  // tab-switch render is fixed. It is an engine swap, not a different chat, so
  // it must never switch on the lite prototype rows.
  const flashList = loadChatRenderer({
    EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER: "vendor-flashlist",
    EXPO_PUBLIC_PERFORMANCE_PROFILE: "1"
  });
  assert.equal(flashList.MEMORY_ROOM_CHAT_VENDOR_FLASHLIST, true);
  assert.equal(flashList.MEMORY_ROOM_CHAT_LITE_RENDERER, false);
  assert.equal(flashList.MEMORY_ROOM_CHAT_NATIVE_RENDERER, false);
  // The prototype renderers stay profile-gated.
  assert.equal(
    loadChatRenderer({
      EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER: "lite-flatlist"
    }).MEMORY_ROOM_CHAT_RENDERER,
    "vendor"
  );
  assert.equal(
    loadChatRenderer({
      EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER: "native-recycler",
      EXPO_PUBLIC_PERFORMANCE_PROFILE: "1"
    }).MEMORY_ROOM_CHAT_NATIVE_RENDERER,
    true
  );
  assert.equal(
    loadChatRenderer({
      EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER: "lite-flashlist",
      EXPO_PUBLIC_PERFORMANCE_PROFILE: "1"
    }).MEMORY_ROOM_CHAT_RENDERER,
    "lite-flashlist"
  );
  assert.match(chatRenderer, /: "vendor";/);
  assert.match(roomScreen, /MEMORY_ROOM_CHAT_LITE_RENDERER/);
});

test("plain-text renderer fixture isolates exactly 50 cached text messages", () => {
  assert.match(
    releaseFixture,
    /MEMORY_RELEASE_FIXTURE_PROFILE[\s\S]*"mixed", "plain-text"/
  );
  assert.match(
    releaseFixture,
    /fixtureProfile === "plain-text"[\s\S]*seedMessages\(admin, roomA, users, 50/
  );
  assert.match(releaseFixture, /multiline: false,[\s\S]*replies: false/);
  assert.match(
    releaseFixture,
    /audio: 0,[\s\S]*dishes: 0,[\s\S]*images: 0,[\s\S]*messages: 50/
  );
});

function fixtureMessage({
  author = "owner",
  body,
  clientId,
  createdAt,
  deliveryStatus = "sent",
  id,
  replyToMessage = null
}) {
  return {
    attachments: [],
    authorDisplayName: author,
    authorName: author,
    body,
    clientCreatedAt: createdAt,
    clientId,
    clientOrderKey: clientId ?? id,
    clientSequence: null,
    createdAt,
    deliveryStatus,
    editedAt: null,
    id,
    replyToMessage,
    replyToMessageId: replyToMessage?.id ?? null,
    roomId: "room-a",
    serverCreatedAt: deliveryStatus === "sent" ? createdAt : null,
    serverId: deliveryStatus === "sent" ? id : null
  };
}

function fixtureRoom(messages) {
  return {
    area: null,
    createdAt: "2026-07-28T09:00:00.000Z",
    createdBy: "owner",
    dishes: [],
    id: "room-a",
    lastReadAt: null,
    messages,
    occasionConfidence: 1,
    occasionConfirmedByUser: true,
    occasionType: "friends_hangout",
    participants: [],
    photos: [],
    restaurantId: null,
    restaurantName: "Fixture",
    sourcePostId: null,
    status: "published",
    stops: [],
    themeKey: "friends_hangout",
    title: "Renderer fixture",
    visitDate: null
  };
}

test("lightweight row store preserves unchanged identity and updates one delivery row", () => {
  const { MemoryChatRowModelStore } = loadChatRowModel();
  const store = new MemoryChatRowModelStore();
  const first = fixtureMessage({
    body: "first",
    clientId: "a",
    createdAt: "2026-07-28T09:00:00.000Z",
    id: "optimistic-a",
    deliveryStatus: "pending"
  });
  const second = fixtureMessage({
    author: "guest",
    body: "second",
    clientId: "b",
    createdAt: "2026-07-28T09:01:00.000Z",
    id: "server-b"
  });
  const before = store.project(fixtureRoom([first, second]), "owner");
  const confirmed = {
    ...first,
    deliveryStatus: "sent",
    id: "server-a",
    serverCreatedAt: "2026-07-28T09:00:01.000Z",
    serverId: "server-a"
  };
  const after = store.project(fixtureRoom([confirmed, second]), "owner");
  const beforeByKey = new Map(before.map((row) => [row.key, row]));
  const afterByKey = new Map(after.map((row) => [row.key, row]));

  assert.notEqual(afterByKey.get("client:a"), beforeByKey.get("client:a"));
  assert.equal(afterByKey.get("client:b"), beforeByKey.get("client:b"));
  assert.equal(afterByKey.get("client:a").deliveryState, "sent");
  assert.equal(afterByKey.get("client:a").logicalMessageId, "client:a");
});

test("incoming insertion keeps existing row objects and explicit stable item types", () => {
  const { MemoryChatRowModelStore } = loadChatRowModel();
  const store = new MemoryChatRowModelStore();
  const rows = [
    fixtureMessage({
      author: "guest-a",
      body: "older",
      clientId: "older",
      createdAt: "2026-07-28T09:00:00.000Z",
      id: "older"
    }),
    fixtureMessage({
      author: "guest-b",
      body: "newer",
      clientId: "newer",
      createdAt: "2026-07-28T09:01:00.000Z",
      id: "newer"
    })
  ];
  const before = store.project(fixtureRoom(rows), "owner");
  const incoming = fixtureMessage({
    author: "guest-c",
    body: "incoming",
    clientId: "incoming",
    createdAt: "2026-07-28T09:02:00.000Z",
    id: "incoming"
  });
  const after = store.project(fixtureRoom([...rows, incoming]), "owner");
  const afterByKey = new Map(after.map((row) => [row.key, row]));

  for (const row of before) {
    assert.equal(afterByKey.get(row.key), row);
  }
  assert.equal(afterByKey.get("client:incoming").itemType, "incoming-text");
  assert.doesNotMatch(chatRowModel, /placementIndex:/);
});

test("reply row model is bounded and contains no complete domain message", () => {
  const { MemoryChatRowModelStore } = loadChatRowModel();
  const store = new MemoryChatRowModelStore();
  const reply = fixtureMessage({
    body: "bounded reply",
    clientId: "reply",
    createdAt: "2026-07-28T09:03:00.000Z",
    id: "reply",
    replyToMessage: {
      authorDisplayName: "Guest",
      body: "referenced body",
      id: "referenced-id",
      ignoredPrivateField: "must-not-survive"
    }
  });
  const [row] = store.project(fixtureRoom([reply]), "owner");
  assert.equal(row.itemType, "outgoing-reply-text");
  assert.deepEqual(
    { ...row.replyPreview },
    {
      authorLabel: "Guest",
      body: "referenced body",
      logicalMessageId: "referenced-id"
    }
  );
  assert.equal("memoryMessage" in row, false);
  assert.equal("room" in row, false);
  assert.equal("attachments" in row, false);
  assert.equal(JSON.stringify(row).includes("ignoredPrivateField"), false);
});

test("lite list path is viewport bounded and selects straight from a long press", () => {
  assert.match(roomScreen, /<FlatList<ChatRowViewModel>/);
  assert.match(roomScreen, /<FlashList<ChatRowViewModel>/);
  assert.match(roomScreen, /initialNumToRender=\{10\}/);
  assert.match(roomScreen, /maxToRenderPerBatch=\{6\}/);
  assert.match(roomScreen, /windowSize=\{3\}/);
  assert.match(roomScreen, /getItemType=\{liteListItemType\}/);
  assert.match(roomScreen, /keyExtractor=\{liteListKeyExtractor\}/);
  assert.match(roomScreen, /const LiteChatTextRow = memo/);
  // A long press selects outright on every renderer. The anchored action menu
  // it replaced is gone entirely — no store, no host, no per-row publisher — so
  // there is no second definition of what holding a message means.
  assert.match(roomScreen, /const selectLiteMessage = useCallback/);
  assert.match(roomScreen, /onSelect=\{selectLiteMessage\}/);
  assert.doesNotMatch(roomScreen, /MemoryChatMenuHost|MemoryChatMessageMenu|setMemoryChatMenuRequest/);
  assert.match(roomScreen, /row\.deliveryState === "failed"/);
});

test("no pane-transition coordinator survives to reintroduce a second path", () => {
  // The precreate coordinator and the retained-shell placeholder were both
  // rejected experiments. They are gone rather than dormant, so nothing can
  // mount two panes as interactive or select a lifecycle at runtime.
  assert.doesNotMatch(roomScreen, /precreate|MemoryChatRetainedShell|profilePaneTransition/);
  assert.doesNotMatch(roomScreen, /MEMORY_ROOM_CHAT_LIFECYCLE/);
  assert.equal(existsSync("mobile/src/performance/memoryRoomChatLifecycle.ts"), false);
});

test("the retained Chat host is one host, releases focus and owns no inactive player", () => {
  assert.match(roomScreen, /MemoryRoomMountedChatHosts/);
  assert.match(roomScreen, /MemoryRoomMountedChatInputs/);
  // No shell counter: the content-free placeholder was a rejected candidate
  // and the retained pane keeps its real content instead.
  assert.doesNotMatch(roomScreen, /MemoryRoomMountedChatShells/);
  // An inactive Chat pane still owns no audio player — but activation now
  // reaches the audio row through CONTEXT rather than through the render
  // callback's dependency list. The vendored Item memo compares render
  // callbacks by identity, so `active` sitting in renderMessageAudio's deps
  // re-rendered EVERY mounted row on every tab switch (~58 row renders per
  // switch against ~29 mounted rows; 695 -> 101 across 12 switches after this).
  assert.match(roomScreen, /const ChatSurfaceActiveContext = createContext\(true\)/);
  assert.match(
    roomScreen,
    /function ChatMainAudioMessageGate\([\s\S]*?const active = useContext\(ChatSurfaceActiveContext\);\s*if \(!active\) return null;/
  );
  assert.match(roomScreen, /<ChatSurfaceActiveContext\.Provider value=\{active\}>/);
  // The callback must NOT take `active` back as a dependency.
  const audioRenderer = roomScreen.match(
    /const renderMessageAudio = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/
  )?.[0] ?? "";
  assert.ok(audioRenderer);
  assert.doesNotMatch(audioRenderer, /\bactive\b/);
  // Same reason for the swipe config: the row memo compares reply.swipe
  // BY VALUE, so a flipping isEnabled invalidated every row too.
  assert.match(roomScreen, /direction: "right" as const,[\s\S]{0,700}?isEnabled: true,/);
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
  // One viewport, not half of one. 8 was set on the assumption that a phone
  // viewport holds ~8 compact rows; the vendored list settling at 29 mounted
  // rows with windowSize 3, the FlashList candidate filling its viewport with
  // 12 rows and the native recycler reporting 15 visible rows all contradict
  // it, and the shortfall is what made the first frame arrive incomplete and
  // fill in visible batches afterwards.
  const initialRenderCount = Number(
    roomScreen.match(/const CHAT_MAIN_INITIAL_RENDER_COUNT = (\d+);/)?.[1]
  );
  assert.equal(initialRenderCount, 14);
  assert.ok(
    initialRenderCount >= 12,
    "initial render count must cover a measured viewport"
  );
  // Fill rate, deliberately tunable: too small and a fast fling outruns the
  // renderer and shows bare background, too large and one batch stops being a
  // frame's worth of work. Retention is bounded by windowSize instead, which is
  // asserted separately, so this only has to stay inside a sane band.
  const maxRenderBatch = Number(
    roomScreen.match(/const CHAT_MAIN_MAX_RENDER_BATCH = (\d+);/)?.[1]
  );
  assert.ok(
    maxRenderBatch >= 6 && maxRenderBatch <= 12,
    "chat render batch must fill faster than a fling without oversizing a commit"
  );
  // Anchoring on a long-unread room must stay bounded rather than turning the
  // first commit into the whole history.
  const anchorCap = Number(
    roomScreen.match(/const CHAT_MAIN_ANCHOR_MAX_INITIAL_RENDER_COUNT = (\d+);/)?.[1]
  );
  assert.ok(Number.isFinite(anchorCap) && anchorCap <= 60, "anchor render cap must be bounded");
  assert.ok(anchorCap > initialRenderCount);
  assert.match(roomScreen, /anchorIndex \+ 2 <= CHAT_MAIN_ANCHOR_MAX_INITIAL_RENDER_COUNT/);
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

test("physical room fixes distinguish rooms, preserve compact tabs, and preserve gallery access", () => {
  assert.match(
    profileScreen,
    /accessibilityLabel=\{`Open \$\{memory\.title \|\| "memory"\} room/
  );
  assert.doesNotMatch(profileScreen, /accessibilityLabel="Open memory room"/);
  assert.match(roomScreen, /ROOM_HEADER_EXPANDED_HEIGHT\s*=\s*183/);
  assert.match(roomScreen, /modeButton:\s*\{[\s\S]*?minHeight:\s*34/);

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
