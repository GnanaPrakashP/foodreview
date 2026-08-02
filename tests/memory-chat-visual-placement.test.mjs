import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  configureMemoryChatPlacementDiagnostics,
  memoryChatPlacementSnapshot,
  recordMemoryChatPlacement,
  resetMemoryChatPlacementDiagnostics,
  updateMemoryChatPlacementContext
} from "../mobile/src/services/memoryChatPlacementDiagnostics.mjs";

const screen = readFileSync("mobile/app/memories/[id].tsx", "utf8");
const hooks = readFileSync("mobile/src/hooks/useMemories.ts", "utf8");
const offlineStore = readFileSync("mobile/src/services/memoryOfflineStore.ts", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const vendorMessage = readFileSync(
  "mobile/src/vendor/reactNativeChat/Message/index.tsx",
  "utf8"
);
const placementFixtures = readFileSync(
  "mobile/src/services/memoryChatPlacementFixtures.ts",
  "utf8"
);
const placementDiagnostics = readFileSync(
  "mobile/src/services/memoryChatPlacementDiagnostics.mjs",
  "utf8"
);
const androidRuntimeValidation = readFileSync(
  "tests/mobile-memory-chat-visual-android-runtime-validation.mjs",
  "utf8"
);
const appConfig = readFileSync("mobile/app.config.js", "utf8");
const messageRoute = readFileSync(
  "app/api/mobile/memories/[roomId]/messages/route.ts",
  "utf8"
);

function begin(clientId, renderIndex = 0) {
  recordMemoryChatPlacement("SEND_PRESS", { clientId, composerHeight: 96 });
  recordMemoryChatPlacement("OPTIMISTIC_ENTITY_INSERTED", { clientId, deliveryStatus: "pending" });
  recordMemoryChatPlacement("LIST_DATA_RECEIVED", { clientId, deliveryStatus: "pending", renderIndex });
  recordMemoryChatPlacement("ROW_MOUNTED", { clientId, deliveryStatus: "pending", renderIndex });
  recordMemoryChatPlacement("ROW_RENDERED", { clientId, deliveryStatus: "pending", renderIndex });
  recordMemoryChatPlacement("ROW_LAYOUT", {
    clientId,
    deliveryStatus: "pending",
    renderIndex,
    rowBottom: 720,
    rowHeight: 42,
    rowTop: 678
  });
}

test.beforeEach(() => {
  resetMemoryChatPlacementDiagnostics();
  configureMemoryChatPlacementDiagnostics({ enabled: true, sink: () => {} });
  updateMemoryChatPlacementContext({
    bottomClearance: 68,
    composerHeight: 96,
    contentHeight: 920,
    contentOffset: 0,
    keyboardInset: 312,
    viewportHeight: 720
  });
});

test("one optimistic insertion has one mount and no required bottom-follow command", () => {
  begin("visual-a");
  const snapshot = memoryChatPlacementSnapshot("visual-a");
  assert.equal(snapshot.mountCount, 1);
  assert.equal(snapshot.scrollCommandCount, 0);
  assert.equal(snapshot.latestRenderIndex, 0);
});

test("confirmation and duplicate delivery events preserve index and issue zero scroll commands", () => {
  begin("visual-confirm", 0);
  recordMemoryChatPlacement("REALTIME_CONFIRMED", {
    clientId: "visual-confirm",
    deliveryStatus: "sent",
    renderIndex: 0
  });
  recordMemoryChatPlacement("HTTP_CONFIRMED", {
    clientId: "visual-confirm",
    deliveryStatus: "sent",
    renderIndex: 0
  });
  recordMemoryChatPlacement("REALTIME_CONFIRMED", {
    clientId: "visual-confirm",
    deliveryStatus: "sent",
    renderIndex: 0
  });
  recordMemoryChatPlacement("ROW_STATUS_UPDATED", {
    clientId: "visual-confirm",
    deliveryStatus: "sent",
    renderIndex: 0
  });
  recordMemoryChatPlacement("ROW_RENDERED", {
    clientId: "visual-confirm",
    deliveryStatus: "sent",
    renderIndex: 0
  });

  const snapshot = memoryChatPlacementSnapshot("visual-confirm");
  assert.equal(snapshot.mountCount, 1);
  assert.equal(snapshot.latestRenderIndex, 0);
  assert.equal(snapshot.scrollCommandCount, 0);
  assert.equal(snapshot.confirmationLayoutCount, 0);
  assert.deepEqual(
    snapshot.events
      .filter((event) => event.name.endsWith("CONFIRMED"))
      .map((event) => event.contentOffset),
    [0, 0, 0]
  );
});

test("a user-requested follow remains bounded to one command and confirmation adds none", () => {
  begin("visual-follow");
  recordMemoryChatPlacement("BOTTOM_FOLLOW_REQUESTED", {
    clientId: "visual-follow",
    scrollCommandSource: "user_latest_button"
  });
  recordMemoryChatPlacement("HTTP_CONFIRMED", {
    clientId: "visual-follow",
    deliveryStatus: "sent",
    renderIndex: 0
  });
  assert.equal(memoryChatPlacementSnapshot("visual-follow").scrollCommandCount, 1);
});

test("multiline composer collapse changes clearance without scheduling a second scroll", () => {
  begin("visual-multiline");
  recordMemoryChatPlacement("COMPOSER_HEIGHT_CHANGED", {
    clientId: "visual-multiline",
    composerHeight: 44
  });
  recordMemoryChatPlacement("CONTENT_SIZE_CHANGED", {
    clientId: "visual-multiline",
    contentHeight: 966
  });
  const snapshot = memoryChatPlacementSnapshot("visual-multiline");
  assert.equal(snapshot.scrollCommandCount, 0);
  assert.equal(snapshot.contentSizeChangeCount, 1);
});

test("delivery confirmation cannot rebuild the measured multiline text subtree", () => {
  assert.match(screen, /const ChatMainStableMessageText = memo\(function ChatMainStableMessageText/);
  assert.match(
    screen,
    /<ChatMainStableMessageText[\s\S]*key=\{`\$\{String\(currentMessage\._id\)\}:\$\{resolvedTheme\}`\}/
  );
  const stableText = screen.match(
    /const ChatMainStableMessageText = memo\(function ChatMainStableMessageText[\s\S]*?\n\}\);/
  )?.[0] ?? "";
  assert.ok(stableText);
  assert.doesNotMatch(stableText, /deliveryStatus|streaming|pending|sent/);
  // The swipe wrapper stays mounted from the first optimistic frame; only the
  // gesture is gated. It also stands down while a selection is open, so a swipe
  // cannot open the composer on a message the selection toolbar is acting on.
  assert.match(
    screen,
    /isEnabled: true,[\s\S]{0,320}isGestureEnabled: canReply && !selectionMode/
  );
  assert.match(
    vendorMessage,
    /const isSwipeToReplyGestureEnabled = swipeToReply\?\.isGestureEnabled \?\? isSwipeToReplyEnabled/
  );
  assert.match(
    vendorMessage,
    /\.enabled\(Boolean\(isGestureEnabled && onSwipe\)\)/
  );
  // Every Reanimated allocation a swipe needs belongs to SwipeToReplyRow, never
  // to Message: hooks cannot be conditional, so declaring them in Message made
  // date separators, the unread divider, dish cards and standalone media rows
  // each build and serialize a gesture they threw away on the early return.
  // ~9.5% of JS thread time during a fling was this serialization, all of it
  // per mounted row.
  const messageBody = vendorMessage.match(
    /export const Message = <TMessage[\s\S]*?\n\}\n/
  )?.[0] ?? "";
  assert.ok(messageBody);
  assert.doesNotMatch(messageBody, /useSharedValue|useAnimatedStyle|Gesture\.Pan|GestureDetector/);
  assert.match(messageBody, /<SwipeToReplyRow/);
  // System rows are excluded structurally by the early return rather than by a
  // condition inside the gesture, so the gesture never has to know about them.
  assert.match(
    messageBody,
    /if \(currentMessage\.system \|\| !isSwipeToReplyEnabled\)/
  );
  // The worklets must not close over the per-row message: a fresh closure is
  // serialized per row instead of being served from Reanimated's cache.
  assert.match(vendorMessage, /const swipeStateRef = useRef\(\{ currentMessage, onSwipe \}\)/);
  assert.match(vendorMessage, /const \{ currentMessage: message, onSwipe: handler \} = swipeStateRef\.current/);
});

test("dish and message bubbles resolve colors from the same current room theme", () => {
  assert.doesNotMatch(screen, /CHAT_(?:OWN|OTHER)_BUBBLE_COLOR/);
  assert.match(
    screen,
    /chatMainBubbleRight:\s*\{[\s\S]*?backgroundColor: ROOM_COLORS\.sentBubble/
  );
  assert.match(
    screen,
    /dishTimelineBubbleMine:\s*\{[\s\S]*?backgroundColor: ROOM_COLORS\.sentBubble/
  );
  assert.match(
    screen,
    /chatMainBubbleLeft:\s*\{[\s\S]*?backgroundColor: ROOM_COLORS\.receivedBubble/
  );
  assert.match(
    screen,
    /dishTimelineBubbleOther:\s*\{[\s\S]*?backgroundColor: ROOM_COLORS\.receivedBubble/
  );
});

test("failed older-history loads stop automatic edge retries until explicit retry", () => {
  const historyQuery = hooks.match(
    /export function useMemoryMessagePagesQuery[\s\S]*?(?=export function useMemoryMediaPagesQuery)/
  )?.[0] ?? "";
  assert.ok(historyQuery);
  assert.match(
    screen,
    /olderMessagesFailed && !explicitRetry/
  );
  // The edge is still detected immediately, but the request is HELD while
  // momentum runs: a page of older messages falls through the incremental
  // projection's fast path to buildFull, which rebuilds every row object and
  // re-renders every mounted row — mid-fling that is exactly what leaves bare
  // wallpaper on screen. It is released when the fling settles, and a drag that
  // stops without throwing momentum must release it too, or the edge is
  // detected and never acted on.
  assert.match(
    screen,
    /const requestOlderPage = useCallback\(\(\) => \{[\s\S]{0,120}?if \(chatMainMomentumRef\.current\) \{\s*pendingOlderPageRef\.current = true;\s*return;\s*\}\s*runOlderPageRequest\(false\)/
  );
  assert.match(screen, /const flushPendingOlderPage = useCallback\(/);
  assert.match(
    screen,
    /const handleChatMainMomentumEnd = useCallback\(\(\) => \{\s*finishChatMainInteraction\(\);\s*flushPendingOlderPage\(\);/
  );
  assert.match(
    screen,
    /const retryOlderPage = useCallback\(\(\) => \{\s*runOlderPageRequest\(true\)/
  );
  assert.match(
    screen,
    /isInfiniteScrollEnabled: !olderMessagesFailed/
  );
  assert.match(
    screen,
    /label: olderMessagesFailed \? "Could not load earlier messages · Retry" : undefined/
  );
  assert.match(
    historyQuery,
    /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined,[\s\S]*?retry: false/
  );
});

test("diagnostic payload discards bodies, tokens, URLs, paths, and arbitrary identifiers", () => {
  const events = [];
  configureMemoryChatPlacementDiagnostics({ enabled: true, sink: (event) => events.push(event) });
  recordMemoryChatPlacement("SEND_PRESS", {
    body: "private message",
    clientId: "visual-safe",
    signedUrl: "https://private.example.test/value",
    storagePath: "private/path",
    token: "secret"
  });
  for (const forbidden of ["body", "signedUrl", "storagePath", "token"]) {
    assert.equal(Object.hasOwn(events[0], forbidden), false);
  }
});

test("chat placement diagnostics are opt-in and keep bounded per-client history", () => {
  assert.doesNotMatch(
    placementDiagnostics,
    /typeof __DEV__ !== "undefined" && __DEV__/
  );
  assert.match(
    placementDiagnostics,
    /process\.env\.EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS === "1"/
  );

  for (let index = 0; index < 300; index += 1) {
    recordMemoryChatPlacement("ROW_RENDERED", {
      clientId: "visual-bounded",
      deliveryStatus: "pending",
      renderIndex: index
    });
  }
  const snapshot = memoryChatPlacementSnapshot("visual-bounded");
  assert.equal(snapshot.events.length, 256);
  assert.equal(snapshot.renderCount, 300);
  assert.equal(snapshot.latestRenderIndex, 299);

  for (let index = 0; index < 300; index += 1) {
    recordMemoryChatPlacement("SEND_PRESS", { clientId: `bounded-client-${index}` });
  }
  assert.equal(memoryChatPlacementSnapshot("bounded-client-0"), null);
  assert.ok(memoryChatPlacementSnapshot("bounded-client-299"));
});

test("row diagnostics and the physical validator cannot hide a missed first tap", () => {
  assert.match(
    screen,
    /recordMemoryChatPlacement\("ROW_RENDERED",[\s\S]*?\}, \[clientId, deliveryStatus, renderIndex\]\);/
  );
  assert.match(
    androidRuntimeValidation,
    /"the first acknowledged tap did not reach SEND_PRESS"/
  );
  assert.doesNotMatch(androidRuntimeValidation, /retryable rapid send button/);
});

test("physical initial-anchor validation hard-fails any first-frame pixel movement", () => {
  assert.match(
    androidRuntimeValidation,
    /\["anchor", "exit", "full", "journey", "media", "stale", "tail"\]/
  );
  assert.match(
    androidRuntimeValidation,
    /scenario === "anchor"[\s\S]*app:assembleRelease/
  );
  assert.match(
    androidRuntimeValidation,
    /-Pandroid\.enableMinifyInReleaseBuilds=true/
  );
  assert.match(
    androidRuntimeValidation,
    /CHAT_ROW_LAYOUT_CHANGED"\)\.length,\s*0/
  );
  assert.match(
    androidRuntimeValidation,
    /movementThresholdPhysicalPixels: 0/
  );
  assert.match(
    androidRuntimeValidation,
    /observationWindowMs: 750/
  );
  assert.match(
    androidRuntimeValidation,
    /exact50_cold_first_open_from_table_keyboard_closed/
  );
  assert.match(
    androidRuntimeValidation,
    /exact8_cold_first_open_from_table_keyboard_closed/
  );
  assert.match(
    androidRuntimeValidation,
    /createAnchorContactSheet\(\)/
  );
});

test("active inverted data is newest-first at its final index before first render", () => {
  assert.match(screen, /return -compareMemoryMessages\(a\.value, b\.value\)/);
  assert.match(screen, /const placementIndexByRowKeyRef = useRef\(new Map<string, number>\(\)\)/);
  assert.match(screen, /displayChatMessages\.map\(\(chatMessage, index\) => \[String\(chatMessage\._id\), index\]\)/);
  assert.match(screen, /renderIndex=\{placementIndex\}/);
  assert.doesNotMatch(screen, /placementIndex: index/);
  assert.match(
    screen,
    /maintainVisibleContentPosition: chatMainPreserveHistoryViewport\s*\?\s*CHAT_MAIN_SCROLL_POSITION_CONFIG\s*:\s*undefined/
  );
  assert.match(screen, /setChatMainPreserveHistoryViewport\(!isNearBottom\)/);
  assert.match(screen, /const CHAT_MAIN_SCROLL_POSITION_CONFIG = \{\s*minIndexForVisible: 0\s*\}/);
  assert.doesNotMatch(
    screen.match(/const CHAT_MAIN_SCROLL_POSITION_CONFIG = \{[\s\S]*?\};/)?.[0] ?? "",
    /autoscrollToTopThreshold/
  );
});

test("active latest-row effect owns no delayed or confirmation-driven scroll", () => {
  const activeEffect = screen.match(
    /const previousLatestMessageId = latestChatMessageIdRef\.current;[\s\S]*?\}, \[active, latestChatMessageId, latestChatMessageMine, onNearBottomChange\]\);/
  )?.[0] ?? "";
  assert.ok(activeEffect);
  assert.doesNotMatch(
    activeEffect,
    /\b(?:setTimeout|requestAnimationFrame)\(|\bscrollToBottom\(|\.scrollToOffset\(/
  );

  const audioSend = screen.match(/async function sendAudioMessage[\s\S]*?\n  }\n\n  function openAddPlace/)?.[0] ?? "";
  assert.ok(audioSend);
  assert.doesNotMatch(audioSend, /scrollChatToBottom|scrollToOffset|requestAnimationFrame/);
});

test("a rapid second tap after text submit cannot transition the send control into voice", () => {
  assert.match(screen, /const CHAT_TEXT_SEND_MIC_GUARD_MS = 3_000/);
  assert.match(
    screen,
    /lastTextSubmitAtRef\.current > 0 &&\s*Date\.now\(\) - lastTextSubmitAtRef\.current < CHAT_TEXT_SEND_MIC_GUARD_MS/
  );
  assert.match(screen, /const lastTextSubmitAtRef = useRef\(0\)/);
  assert.match(screen, /lastTextSubmitAtRef=\{lastTextSubmitAtRef\}/);
  assert.match(screen, /const textSubmitInFlightRef = useRef\(false\)/);
  assert.match(screen, /textSubmitInFlightRef=\{textSubmitInFlightRef\}/);
  assert.doesNotMatch(screen, /const submitInFlightRef = useRef\(false\)/);
  const androidSubmit = screen.match(
    /if \(Platform\.OS === "android"\) \{[\s\S]*?\n    \}\n\n    \/\/ iOS uses/
  )?.[0] ?? "";
  assert.ok(androidSubmit);
  assert.match(
    androidSubmit,
    /try \{[\s\S]*lastTextSubmitAtRef\.current = Date\.now\(\);[\s\S]*\} finally \{\s*textSubmitInFlightRef\.current = false;\s*\}/
  );
  assert.doesNotMatch(
    screen,
    /nativeEventCountRef\.current <= lastSubmittedEventCountRef\.current/
  );
});

test("optimistic cache insertion precedes persistence and transport confirmation", () => {
  const messageMutation = hooks.match(
    /export function useAddMemoryMessageMutation[\s\S]*?export function useDismissFailedMemoryMessage/
  )?.[0] ?? "";
  assert.ok(messageMutation);
  assert.match(messageMutation, /onMutate: \(input\) => \{/);
  assert.match(
    messageMutation,
    /queryClient\.setQueryData<MemoryRoom>[\s\S]*?recordMemoryChatPlacement\("REACT_QUERY_COMMIT"[\s\S]*?const outboxWrite = saveOfflineMemoryOutboxMessage/
  );
  assert.doesNotMatch(
    messageMutation.match(/onMutate: \(input\) => \{[\s\S]*?\n    onError:/)?.[0] ?? "",
    /await saveOfflineMemoryOutboxMessage/
  );
  assert.match(messageMutation, /recordMemoryChatPlacement\("HTTP_STARTED"/);
  assert.match(messageMutation, /recordMemoryChatPlacement\("HTTP_CONFIRMED"/);
});

test("stale refresh cannot replay a foreground-owned durable outbox row", () => {
  assert.match(
    hooks,
    /beginForegroundMemoryMessageSend\(clientId\)[\s\S]*?const outboxWrite = saveOfflineMemoryOutboxMessage\(clientId, optimisticMessage\)/
  );
  assert.match(
    memoryService,
    /message\.deliveryStatus === "pending"[\s\S]*?!isForegroundMemoryMessageSend\(message\.clientId\)/
  );
  assert.match(hooks, /commitWrite\.then\([\s\S]*?endForegroundMemoryMessageSend/);
  assert.doesNotMatch(
    hooks.match(/onMutate: \(input\) => \{[\s\S]*?\n    onError:/)?.[0] ?? "",
    /endForegroundMemoryMessageSend/
  );
});

test("rapid text confirmations cannot overlap a media outbox SQLite transaction", () => {
  assert.match(offlineStore, /let offlineWriteQueue: Promise<void> = Promise\.resolve\(\)/);
  assert.match(offlineStore, /const result = offlineWriteQueue\.then\(execute, execute\)/);
  assert.match(
    offlineStore,
    /offlineWriteQueue = result\.then\(\(\) => undefined, \(\) => undefined\)/
  );
  assert.match(offlineStore, /async function closeActiveDb\(\) \{\s*await offlineWriteQueue\.catch/);
});

test("React row identity remains the client logical key across confirmation", () => {
  assert.match(screen, /_id: memoryChatRowKey\(message\)/);
  assert.doesNotMatch(screen, /_id: message\.serverId/);
});

test("physical stale-refresh forcing is development-only and schedules no scroll", () => {
  assert.match(messageRoute, /process\.env\.NODE_ENV === "production"/);
  assert.match(messageRoute, /MEMORY_CHAT_DEV_PRE_INSERT_DELAY_MS/);
  assert.match(placementFixtures, /typeof __DEV__ !== "undefined"[\s\S]*__DEV__/);
  assert.match(placementFixtures, /EXPO_PUBLIC_CHAT_PLACEMENT_STALE_REFRESH_MS/);
  assert.match(screen, /recordMemoryChatPlacement\("STALE_REFRESH_REQUESTED", \{ clientId \}\)/);
  assert.match(screen, /recordMemoryChatPlacement\("STALE_REFRESH_RESOLVED", \{ clientId \}\)/);
  const staleRefresh = screen.match(
    /const staleRefreshDelayMs = memoryChatPlacementStaleRefreshDelayMs\(\);[\s\S]*?placementStaleRefreshTimersRef\.current\.add\(timer\);/
  )?.[0] ?? "";
  assert.ok(staleRefresh);
  assert.doesNotMatch(staleRefresh, /scrollChatToBottom|scrollToOffset|BOTTOM_FOLLOW_REQUESTED/);
});

test("synthetic media placement fixtures are local, development-only, and forbidden in production", () => {
  assert.match(placementFixtures, /EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS === "1"/);
  assert.match(placementFixtures, /\["127\.0\.0\.1", "localhost", "10\.0\.2\.2"\]/);
  assert.doesNotMatch(placementFixtures, /console\.(?:log|info)|recordMemoryChatPlacement/);
  assert.match(appConfig, /EXPO_PUBLIC_CHAT_PLACEMENT_FIXTURE_ORIGIN/);
  assert.match(appConfig, /Memory Room diagnostics and fixtures are forbidden in production/);
});
