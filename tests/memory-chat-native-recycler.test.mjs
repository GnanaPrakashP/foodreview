import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(path, "utf8");
const nativeView = source(
  "mobile/modules/memory-chat-list/android/src/main/java/expo/modules/memorychatlist/MemoryChatListView.kt"
);
const nativeModels = source(
  "mobile/modules/memory-chat-list/android/src/main/java/expo/modules/memorychatlist/NativeMemoryChatModels.kt"
);
const nativeRevealState = source(
  "mobile/modules/memory-chat-list/android/src/main/java/expo/modules/memorychatlist/NativeMemoryChatRevealState.kt"
);
const nativeModule = source(
  "mobile/modules/memory-chat-list/android/src/main/java/expo/modules/memorychatlist/MemoryChatListModule.kt"
);
const wrapper = source("mobile/src/components/chat/NativeMemoryChatList.tsx");
const screen = source("mobile/app/memories/[id].tsx");
const offlineStore = source("mobile/src/services/memoryOfflineStore.ts");
const readRoute = source("app/api/mobile/memories/read/route.ts");
const migration = source(
  "supabase/migrations/202607290001_shared_memory_monotonic_reads.sql"
);
const physicalHarness = source(
  "tests/mobile-memory-room-jank-memory-validation.mjs"
);

test("native candidate owns a bounded RecyclerView pool and stable diff identity", () => {
  assert.match(nativeView, /RecyclerView\(context\)/);
  assert.match(nativeView, /ListAdapter<NativeMemoryChatRow/);
  assert.match(nativeView, /setHasStableIds\(true\)/);
  assert.match(nativeView, /itemAnimator = null/);
  assert.match(nativeView, /setItemViewCacheSize\(4\)/);
  assert.match(nativeView, /setMaxRecycledViews\(TYPE_INCOMING_TEXT, 12\)/);
  assert.match(nativeView, /setMaxRecycledViews\(TYPE_OUTGOING_REPLY, 8\)/);
  assert.match(nativeView, /MemoryRoomNativeChatCreatedCells/);
  assert.match(nativeView, /MemoryRoomNativeChatRecycledCells/);
  assert.match(nativeView, /MemoryRoomNativeChatLayout/);
  assert.match(nativeView, /MemoryRoomNativeChatRowUpdate/);
  assert.match(nativeModels, /nativeMemoryChatStableId/);
  assert.match(nativeModels, /nativeMemoryChatFingerprint/);
});

test("every recycled text holder executes the content reset contract", () => {
  assert.match(
    nativeView,
    /override fun onViewRecycled[\s\S]*is MessageRowHolder -> holder\.reset\(\)/
  );
  assert.match(
    nativeView,
    /fun reset\(\) \{[\s\S]*reusableState\.reset\(\)[\s\S]*rowView\.reset\(\)/
  );
  for (const field of [
    "accessibilityLabel",
    "body",
    "deliveryState",
    "key",
    "replyAuthor",
    "replyBody",
    "selected"
  ]) {
    assert.match(nativeModels, new RegExp(`${field}\\s*=`));
  }
});

test("initial positioning is native, dynamic and applied only after dimensions exist", () => {
  assert.match(nativeView, /stackFromEnd = true/);
  assert.match(
    nativeView,
    /recyclerView\.width <= 0[\s\S]*recyclerView\.height <= 0[\s\S]*adapter\.itemCount != expectedRowCount/
  );
  assert.match(nativeView, /anchor\.kind == "unread"/);
  assert.match(nativeView, /"unread:\$\{anchor\.key\}"/);
  assert.match(nativeView, /scrollToPositionWithOffset\(position, dp\(16\.0\)\)/);
  assert.match(nativeView, /layoutManager\.scrollToPosition\(adapter\.itemCount - 1\)/);
  assert.doesNotMatch(nativeView, /postDelayed|Timer|Thread\.sleep/);
});

test("reveal observation is generation-safe, registered before layout, and bounded", () => {
  const revealCycle =
    /private fun beginRevealCycle\(\): Long \{([\s\S]*?)\n  \}/.exec(nativeView)?.[1] ?? "";
  assert.ok(revealCycle.length > 0);
  assert.ok(
    revealCycle.indexOf("addOnPreDrawListener") <
      revealCycle.indexOf("requestLayout()"),
    "pre-draw observation must be installed before requesting layout"
  );
  assert.match(nativeView, /MAX_REVEAL_FRAMES = 4/);
  assert.match(nativeView, /postOnAnimation\(runnable\)/);
  assert.match(nativeView, /revealGate\.isCurrent\(generation\)/);
  assert.match(nativeView, /onDetachedFromWindow[\s\S]*cancelRevealCycle\(invalidate = true\)/);
  assert.match(nativeRevealState, /NativeMemoryChatRevealDecision\.STALE/);
  assert.match(nativeRevealState, /attachedMessageCells > 0/);
  assert.match(nativeRevealState, /visibleCellInsideViewport/);
  assert.match(nativeRevealState, /if \(finalAttempt\)[\s\S]*NativeMemoryChatRevealDecision\.FAIL/);
});

test("native reveal diagnostics are content-free and unrecoverable failure selects vendor", () => {
  for (const event of [
    "NATIVE_CHAT_ROWS_RECEIVED",
    "NATIVE_CHAT_LAYOUT_LISTENER_REGISTERED",
    "NATIVE_CHAT_LAYOUT_REQUESTED",
    "NATIVE_CHAT_BOUNDS_READY",
    "NATIVE_CHAT_CELLS_ATTACHED",
    "NATIVE_CHAT_ANCHOR_APPLIED",
    "NATIVE_CHAT_PRE_DRAW",
    "NATIVE_CHAT_REVEALED",
    "NATIVE_CHAT_REVEAL_FALLBACK",
    "NATIVE_CHAT_REVEAL_FAILED"
  ]) {
    assert.match(nativeView, new RegExp(event));
  }
  assert.match(nativeModule, /"onRevealStateChanged"/);
  assert.match(wrapper, /NativeMemoryChatRevealEvent/);
  assert.match(screen, /state\.event === "NATIVE_CHAT_REVEAL_FAILED"/);
  assert.match(screen, /setNativeRevealFailed\(true\)/);
  assert.match(
    screen,
    /nativeRendererActive[\s\S]*!nativeRevealFailed[\s\S]*litePrototypeSupported/
  );
  assert.doesNotMatch(
    /private class RevealStateEvent\(([\s\S]*?)\) : Record/.exec(nativeView)?.[1] ?? "",
    /body|roomId|user|url|path|token/i
  );
});

test("physical harness rejects transparent native rows and retains visible evidence", () => {
  assert.match(physicalHarness, /native_chat_visibility_report_missing/);
  assert.match(physicalHarness, /native_chat_alpha_not_revealed/);
  assert.match(physicalHarness, /native_chat_visible_row_count_zero/);
  assert.match(physicalHarness, /native_chat_anchor_not_visible_before_reveal/);
  assert.match(physicalHarness, /vendor_chat_visible_message_nodes_missing/);
  assert.match(physicalHarness, /exec-out", "screencap", "-p"/);
});

test("visibility, reply and message actions cross the bridge without message bodies", () => {
  for (const event of [
    "onVisibleRangeChanged",
    "onMessageLongPress",
    "onMessagePress",
    "onReplySwipe",
    "onLoadOlder",
    "onLoadNewer",
    "onMetrics"
  ]) {
    assert.match(nativeModule, new RegExp(`"${event}"`));
  }
  assert.match(wrapper, /latestCreatedAt: string/);
  assert.match(wrapper, /latestSourceId: string/);
  assert.doesNotMatch(wrapper, /storagePath|signedUrl|privatePath/);
  assert.match(screen, /onVisibleReadPosition\(event\.nativeEvent\.latestCreatedAt\)/);
});

test("unread anchor lookup is bounded locally and on the member-scoped API", () => {
  assert.match(offlineStore, /readOfflineMemoryUnreadAnchorPage/);
  assert.match(
    offlineStore,
    /order by server_created_at asc, server_id asc\s+limit 1/
  );
  assert.match(offlineStore, /Math\.min\(Math\.max\(input\.beforeLimit \?\? 12, 0\), 24\)/);
  assert.match(offlineStore, /Math\.min\(Math\.max\(input\.afterLimit \?\? 24, 1\), 40\)/);
  assert.match(readRoute, /action === "chatAnchor"/);
  assert.match(readRoute, /\.neq\("author_name", actor\.actorName\)/);
  assert.match(readRoute, /shared_memory_chat_page_v2/);
  assert.doesNotMatch(readRoute, /service_role.*chatAnchor/);
});

test("read acknowledgements are monotonic and native open does not mark latest", () => {
  assert.match(migration, /greatest\(\s*public\.shared_memory_reads\.last_read_at/);
  assert.match(migration, /public\.can_read_shared_memory\(p_room_id\)/);
  assert.match(screen, /if \(MEMORY_ROOM_CHAT_NATIVE_RENDERER\) return;/);
  assert.match(screen, /markVisibleNativeRoomRead/);
  assert.match(screen, /markRead\.mutate\(input/);
});

test("unsupported rich rows and missing native registration fall back safely", () => {
  assert.match(wrapper, /try \{/);
  assert.match(wrapper, /AndroidNativeView = null/);
  assert.match(screen, /litePrototypeSupported/);
  assert.match(
    screen,
    /MEMORY_ROOM_CHAT_NATIVE_RENDERER[\s\S]*nativeMemoryChatListAvailable[\s\S]*litePrototypeSupported/
  );
  assert.match(screen, /nativeAnchorFailed/);
});
