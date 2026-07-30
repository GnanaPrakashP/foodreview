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

test("read acknowledgements are monotonic and opening Chat does not mark latest", () => {
  assert.match(migration, /greatest\(\s*public\.shared_memory_reads\.last_read_at/);
  assert.match(migration, /public\.can_read_shared_memory\(p_room_id\)/);
  // This was originally a native-renderer-only guarantee: the vendored
  // renderer marked the WHOLE room read the moment Chat was opened, which
  // erased the unread anchor before it could ever be shown. The visible-range
  // read path is now the contract for both renderers, so the "mark on open"
  // flag must be gone and every remaining mark-latest call must sit behind a
  // near-bottom check.
  assert.doesNotMatch(screen, /chatOpenMarkedRef/);
  assert.match(screen, /markVisibleRoomRead/);
  assert.match(screen, /onViewableItemsChanged: handleChatMainViewableItems/);
  assert.match(screen, /viewabilityConfig: CHAT_MAIN_VIEWABILITY_CONFIG/);
  assert.match(screen, /markRead\.mutate\(input/);
  assert.match(
    screen,
    /if \(!nearBottomRef\.current\) return;\s*markLatestRoomRead\(\);/
  );
  assert.match(
    screen,
    /if \(isNearBottom && !MEMORY_ROOM_CHAT_NATIVE_RENDERER\) \{\s*markLatestRoomRead\(\);/
  );
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

// ---------------------------------------------------------------------------
// Retained host + recycled rows.
//
// The two prior experiments each measured one half of this: `warm-bounded` kept
// a vendored tree alive, and `native-recycler` recycled rows inside a host that
// was destroyed on every exit — which is why its cross-activation pooled and
// recycled counters stayed at zero. These cover the composition.
// ---------------------------------------------------------------------------

const lifecycle = source("mobile/src/performance/memoryRoomChatLifecycle.ts");
const releaseProfile = source(
  "mobile/src/performance/memoryRoomReleaseProfile.ts"
);
const resumeState = source(
  "mobile/modules/memory-chat-list/android/src/main/java/expo/modules/memorychatlist/NativeMemoryChatRevealState.kt"
);

test("the retained-native-host combination requires BOTH profile selectors", () => {
  assert.match(
    lifecycle,
    /MEMORY_ROOM_CHAT_RETAINED_NATIVE_HOST\s*=\s*\n?\s*MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE === "warm-bounded" &&\s*\n?\s*MEMORY_ROOM_CHAT_RENDERER === "native-recycler"/
  );
  // Both selectors already refuse to leave the profile build, so the combined
  // flag cannot reach production without them.
  assert.match(
    lifecycle,
    /profileEnabled &&[\s\S]*requestedCandidate as MemoryRoomChatLifecycleCandidate\s*\n?\s*:\s*"cold"/
  );
});

test("a retained host resumes instead of re-running the reveal handshake", () => {
  assert.match(resumeState, /enum class NativeMemoryChatResumeDecision/);
  assert.match(resumeState, /RESUME,/);
  assert.match(resumeState, /REVEAL_CYCLE/);
  // Every precondition must hold; a partially built host takes the cold path.
  assert.match(
    resumeState,
    /snapshot\.hasSettledLayout &&\s*\n?\s*snapshot\.attached &&\s*\n?\s*snapshot\.expectedRows > 0 &&\s*\n?\s*snapshot\.adapterRows == snapshot\.expectedRows/
  );
  assert.match(nativeView, /nativeMemoryChatResumeDecision\(/);
  assert.match(
    nativeView,
    /NativeMemoryChatResumeDecision\.RESUME\) \{\s*\n\s*recyclerView\.alpha = 1f/
  );
  assert.match(nativeView, /EVENT_RESUMED = "NATIVE_CHAT_RESUMED"/);
});

test("deactivation keeps the tree attached and laid out", () => {
  const setActiveBody = nativeView.slice(
    nativeView.indexOf("fun setActive("),
    nativeView.indexOf("fun setDiagnosticsEnabled(")
  );
  assert.ok(setActiveBody.length > 0);
  // Alpha, not GONE and not a detach: the retained rows must stay measured, or
  // the next entry pays the layout it was supposed to have skipped.
  assert.match(
    setActiveBody,
    /if \(!value\) \{[\s\S]*recyclerView\.alpha = 0f[\s\S]*cancelRevealCycle\(invalidate = true\)/
  );
  assert.doesNotMatch(setActiveBody, /visibility =/);
  assert.doesNotMatch(setActiveBody, /removeView|removeAllViews/);
  // A real detach is the one event that invalidates the measured tree.
  assert.match(
    nativeView,
    /override fun onDetachedFromWindow\(\)[\s\S]*?hasSettledLayout = false/
  );
});

test("the entry anchor is one-shot so a resume cannot yank the viewport", () => {
  assert.match(nativeView, /anchorConsumed = false/);
  assert.match(
    nativeView,
    /if \(anchorConsumed\) \{[\s\S]*findFirstVisibleItemPosition\(\)[\s\S]*revealAnchorApplied = true/
  );
  // Cleared only by a genuinely new anchor generation.
  assert.match(
    nativeView,
    /fun setInitialAnchor[\s\S]*anchorConsumed = false/
  );
});

test("rows arriving while Chat is inactive keep the retained list following latest", () => {
  assert.match(
    nativeView,
    /val hidden = recyclerView\.alpha < 1f && !\(hasSettledLayout && attached\)/
  );
});

test("per-activation cell creation is reported so reuse is provable", () => {
  assert.match(resumeState, /class NativeMemoryChatActivationMetrics/);
  assert.match(resumeState, /fun createdThisActivation/);
  assert.match(nativeView, /activationMetrics\.onActivated\(adapter\.createdCells\)/);
  assert.match(nativeView, /MemoryRoomNativeChatCreatedCellsThisActivation/);
  assert.match(nativeView, /MemoryRoomNativeChatActivations/);
  assert.match(nativeModule, /"onMetrics"/);
  assert.match(wrapper, /createdCellsThisActivation: number/);
  assert.match(screen, /onMetrics=\{handleNativeMetrics\}/);
  assert.match(releaseProfile, /recordMemoryRoomNativeChatMetrics/);
  assert.match(
    releaseProfile,
    /"MemoryRoomNativeChatCreatedCellsThisActivation",\s*\n?\s*metrics\.createdCellsThisActivation/
  );
});

test("a resume closes the Chat transition spans like a cold reveal does", () => {
  assert.match(
    screen,
    /state\.event !== "NATIVE_CHAT_REVEALED" &&\s*\n?\s*state\.event !== "NATIVE_CHAT_RESUMED"/
  );
  assert.match(screen, /"native_chat_resumed"/);
});

test("the retained native host reads live rows rather than the frozen projection", () => {
  // `warm-bounded` freezes the projection for the vendored tree. The recycler
  // renders live `liteRows`, so freezing would leave visible rows that no
  // lookup could resolve into a message.
  assert.match(
    screen,
    /MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE === "warm-bounded" &&\s*\n?\s*!MEMORY_ROOM_CHAT_RETAINED_NATIVE_HOST\s*\n?\s*\? retainedChatMessagesRef\.current\.messages/
  );
});

test("the first Chat entry is warmed during idle rather than paid at the tap", () => {
  // The layout/anchor half of the reveal needs an attached view, not a visible
  // one. Warming runs it while Chat is inactive and stops one step short of
  // flipping alpha, so entry 1 resumes exactly like entry 2.
  assert.match(
    nativeView,
    /private fun canRunRevealCycle\(\) = attached && \(active \|\| warmWhileInactive\)/
  );
  // Every gate that previously demanded `active` now accepts a warming host.
  assert.doesNotMatch(nativeView, /!active \|\| !attached/);
  for (const guard of [
    /if \(!canRunRevealCycle\(\)\) return generation/,
    /OnPreDrawListener \{\s*\n\s*if \(!revealGate\.isCurrent\(generation\) \|\| !canRunRevealCycle\(\)\)/,
    /private fun attemptReveal\([\s\S]*?if \(!revealGate\.isCurrent\(generation\) \|\| !canRunRevealCycle\(\)\) return/,
    /Runnable \{\s*\n\s*if \(!revealGate\.isCurrent\(generation\) \|\| !canRunRevealCycle\(\)\) return@Runnable/
  ]) {
    assert.match(nativeView, guard);
  }
  // A warmed host is settled but deliberately still transparent.
  assert.match(
    nativeView,
    /hasSettledLayout = true[\s\S]*?if \(!active\) \{[\s\S]*?emitRevealEvent\(EVENT_PREPARED, generation\)\s*\n\s*return/
  );
  assert.match(nativeView, /EVENT_PREPARED = "NATIVE_CHAT_PREPARED"/);
});

test("warming is opt-in, ordering-safe and tied to the retained host", () => {
  assert.match(nativeModule, /Prop\("warmWhileInactive"\)/);
  assert.match(wrapper, /warmWhileInactive: boolean/);
  assert.match(
    screen,
    /warmWhileInactive=\{MEMORY_ROOM_CHAT_RETAINED_NATIVE_HOST\}/
  );
  // Props arrive in no guaranteed order, so enabling warming after the rows
  // have landed must still start the cycle.
  assert.match(
    nativeView,
    /fun setWarmWhileInactive[\s\S]*?if \(value && !active && canRunRevealCycle\(\) && !hasSettledLayout\) \{\s*\n\s*beginRevealCycle\(\)/
  );
  // Attaching while inactive is the first moment there is anything to measure.
  assert.match(
    nativeView,
    /override fun onAttachedToWindow\(\)[\s\S]*?if \(canRunRevealCycle\(\) && recyclerView\.alpha < 1f\) beginRevealCycle\(\)/
  );
});

test("a warmed-but-unseen host does not report a Chat transition", () => {
  // NATIVE_CHAT_PREPARED means nothing was entered, so it must not close the
  // transition spans the way REVEALED and RESUMED do.
  const revealHandler = screen.slice(
    screen.indexOf("const handleNativeRevealState"),
    screen.indexOf("const handleNativeMessagePress")
  );
  assert.ok(revealHandler.length > 0);
  assert.doesNotMatch(revealHandler, /NATIVE_CHAT_PREPARED/);
  // Opening a room must still not mark it read: visibility reporting stays
  // gated on the pane actually being active.
  assert.match(nativeView, /private fun postVisibility\(\) \{\s*\n\s*if \(!active/);
  assert.match(nativeView, /private fun emitVisibility\(\) \{\s*\n\s*if \(!active/);
});
