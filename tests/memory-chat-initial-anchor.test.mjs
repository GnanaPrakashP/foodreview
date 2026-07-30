import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  memoryChatTimestampReservationWidth,
  resolveMemoryChatCollapsedComposerGeometry
} from "../mobile/src/features/memories/chat/memoryChatGeometry.mjs";
import {
  configureMemoryChatPlacementDiagnostics,
  recordMemoryChatPlacement,
  resetMemoryChatPlacementDiagnostics
} from "../mobile/src/services/memoryChatPlacementDiagnostics.mjs";

const screen = readFileSync("mobile/app/memories/[id].tsx", "utf8");
const diagnostics = readFileSync(
  "mobile/src/services/memoryChatPlacementDiagnostics.mjs",
  "utf8"
);
const appConfig = readFileSync("mobile/app.config.js", "utf8");
const scrollState = readFileSync(
  "mobile/src/features/memories/room/memoryRoomScrollState.ts",
  "utf8"
);

function physicalPixels(value, pixelRatio) {
  return Math.round(value * pixelRatio);
}

test("the audited Android device receives its final composer clearance before rows mount", () => {
  const pixelRatio = 2.8125;
  const geometry = resolveMemoryChatCollapsedComposerGeometry({
    bottomSafeAreaInset: 24.177777777777777,
    fontScale: 1,
    isEdgeToEdge: true,
    pixelRatio,
    platform: "android"
  });

  assert.equal(geometry.messageBoxHeight, 42);
  assert.equal(geometry.composerHeight, 80.35555555555555);
  assert.equal(geometry.listClearance, geometry.composerHeight);
  assert.notEqual(geometry.listClearance, 88);

  const initialRows = [
    { bottom: 700, height: 42, top: 658 },
    { bottom: 650, height: 58, top: 592 }
  ];
  const measuredComposerHeight = 80.35555555555555;
  const activeClearanceAfterValidation = geometry.listClearance;
  const afterValidationRows = initialRows.map((row) => ({ ...row }));

  assert.equal(
    physicalPixels(measuredComposerHeight, pixelRatio),
    physicalPixels(geometry.listClearance, pixelRatio)
  );
  assert.equal(activeClearanceAfterValidation, geometry.listClearance);
  assert.deepEqual(afterValidationRows, initialRows);
});

test("collapsed composer geometry is deterministic across cold and warm entries", () => {
  const cases = [
    {
      bottomSafeAreaInset: 0,
      fontScale: 1,
      isEdgeToEdge: false,
      pixelRatio: 3,
      platform: "android"
    },
    {
      bottomSafeAreaInset: 24.177777777777777,
      fontScale: 1,
      isEdgeToEdge: true,
      pixelRatio: 2.8125,
      platform: "android"
    },
    {
      bottomSafeAreaInset: 34,
      fontScale: 1.35,
      isEdgeToEdge: true,
      pixelRatio: 3,
      platform: "ios"
    }
  ];

  for (const input of cases) {
    const cold = resolveMemoryChatCollapsedComposerGeometry(input);
    const warm = resolveMemoryChatCollapsedComposerGeometry({ ...input });
    assert.deepEqual(warm, cold);
    assert.equal(cold.listClearance, cold.composerHeight);
    assert.equal(
      physicalPixels(cold.composerHeight, input.pixelRatio),
      cold.composerHeight * input.pixelRatio
    );
  }
});

test("collapsed onLayout validates the model without installing its measurement", () => {
  const surface = screen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";
  const handler = surface.match(
    /const handleInputToolbarLayout = useCallback\([\s\S]*?\n  \]\);/
  )?.[0] ?? "";

  assert.match(surface, /useSharedValue\(collapsedComposerGeometry\.messageBoxHeight\)/);
  assert.match(surface, /useSharedValue\(collapsedComposerGeometry\.listClearance\)/);
  assert.match(handler, /const modeledHeight =\s*collapsedComposerGeometry\.listClearance/);
  assert.match(
    handler,
    /const targetClearance = collapsedToolbarStructure\s*\?\s*modeledHeight\s*:\s*measuredHeight/
  );
  assert.match(handler, /recordMemoryChatPlacement\("CHAT_GEOMETRY_MISMATCH"/);
  assert.doesNotMatch(screen, /const CHAT_COMPOSER_CLEARANCE = 88/);
});

test("timestamp width and line breaking are final in the first native Text pass", () => {
  const timestampBody = screen.match(
    /function ChatMainBodyWithTime\([\s\S]*?\nfunction formatAudioPlaybackTime/
  )?.[0] ?? "";

  assert.equal(
    memoryChatTimestampReservationWidth("9:39\u202fpm"),
    50
  );
  assert.equal(
    memoryChatTimestampReservationWidth("11:35\u202fpm"),
    51
  );
  assert.equal(
    memoryChatTimestampReservationWidth("11:35\u202fpm", { gap: 0 }),
    43
  );
  assert.match(timestampBody, /memoryChatTimestampReservationWidth\(time/);
  assert.match(timestampBody, /styles\.chatMainTimeSpacer/);
  assert.match(timestampBody, /style=\{styles\.chatMainTimePinned\}/);
  assert.match(timestampBody, /<View[\s\S]*width: timestampReservationWidth/);
  assert.match(timestampBody, /accessibilityLabel=\{text\}/);
  assert.match(timestampBody, /accessible=\{false\}/);
  assert.doesNotMatch(timestampBody, /\{timestampSpacer\}/);
  assert.doesNotMatch(timestampBody, /\{timestampReservation\}/);
  assert.doesNotMatch(
    timestampBody,
    /useState|setTimeout|requestAnimationFrame|setLayoutDecision|setMeasuredTime/
  );
  assert.doesNotMatch(
    screen,
    /chatTimestampWidthCache|estimateChatTimestampWidth|chatMainTimeMeasuring/
  );
});

test("first-eight coordinate sampling is generation-safe for the full 750 ms window", () => {
  const row = screen.match(
    /function MemoryChatPlacementRow\([\s\S]*?\nfunction useMemoryJourneySurfaceDiagnostics/
  )?.[0] ?? "";

  assert.match(row, /renderIndex >= CHAT_MAIN_INITIAL_RENDER_COUNT/);
  assert.match(row, /owner\.layoutGeneration !== layoutGeneration/);
  assert.match(row, /owner\.rowKey !== rowKey/);
  assert.match(row, /performance\.now\(\) - startedAt < 800/);
  assert.match(row, /CHAT_ROW_FIRST_LAYOUT/);
  assert.match(row, /CHAT_ROW_LAYOUT_CHANGED/);
  assert.match(row, /Math\.round\(\(windowY \+ windowHeight\) \* pixelRatio\)/);
  assert.match(row, /cancelAnimationFrame\(geometrySamplingFrameRef\.current\)/);
});

test("initial chat ownership is offset zero with no mount-time scroll correction", () => {
  const surface = screen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";
  const chatList = surface.match(
    /<ChatMain<MemoryChatMainMessage>[\s\S]*?listProps=\{\{[\s\S]*?\}\}/
  )?.[0] ?? "";

  assert.match(scrollState, /chat: 0/);
  assert.match(chatList, /contentOffset: \{ x: 0, y: initialScrollOffset \}/);
  assert.match(
    chatList,
    /maintainVisibleContentPosition: chatMainPreserveHistoryViewport\s*\?\s*CHAT_MAIN_SCROLL_POSITION_CONFIG\s*:\s*undefined/
  );
  // The regression this test exists for is a SECOND placement of a row that is
  // already mounted and visible: the newest/optimistic row appearing and then
  // moving. That is still forbidden everywhere on the latest path. It is NOT
  // the same thing as the first-unread anchor, which runs once on entry while
  // the list layer is still transparent and never touches the send path, so
  // the assertion is scoped to the paths that produced the defect rather than
  // banning the string outright.
  // These bodies document the original defect in prose ("a deferred
  // scrollToOffset(0) made the row appear and then move a second time"), so the
  // assertions must look at code, not comments.
  const stripComments = (source) => source.replace(/^\s*\/\/.*$/gm, "");

  assert.match(surface, /onContentSizeChange: handleChatMainContentSizeChange/);
  const contentSizeHandler = surface.match(
    /const handleChatMainContentSizeChange = useCallback\([\s\S]*?(?=\n\n  const surfaceInner)/
  )?.[0] ?? "";
  assert.notEqual(contentSizeHandler, "");
  assert.doesNotMatch(
    stripComments(contentSizeHandler),
    /scrollToOffset|scrollToEnd|scrollToIndex/
  );

  const newestMessageEffect = surface.match(
    /const previousLatestMessageId = latestChatMessageIdRef\.current;[\s\S]*?\}, \[active, latestChatMessageId/
  )?.[0] ?? "";
  assert.notEqual(newestMessageEffect, "");
  assert.doesNotMatch(
    stripComments(newestMessageEffect),
    /scrollToOffset|scrollToEnd|scrollToIndex/
  );

  // Exactly one mount-time scroll command may exist, it must be the unread
  // anchor, and it must be reveal-gated.
  assert.equal((stripComments(surface).match(/scrollToIndex\(\{/g) ?? []).length, 1);
  assert.match(surface, /const \[unreadAnchorSettled, setUnreadAnchorSettled\] = useState\(\s*unreadAnchorPlan\.index < 0\s*\)/);
  assert.match(surface, /!unreadAnchorSettled && styles\.chatMainMessagesLayerAnchoring/);
  // Failure must reveal rather than strand the surface behind the gate.
  assert.match(surface, /attempt < CHAT_MAIN_ANCHOR_REVEAL_MAX_FRAMES/);
  assert.match(surface, /onScrollToIndexFailed: handleChatMainScrollToIndexFailed/);
});

test("anchor diagnostics are opt-in, privacy-safe and forbidden in production", () => {
  const events = [];
  resetMemoryChatPlacementDiagnostics();
  configureMemoryChatPlacementDiagnostics({
    enabled: true,
    sink: (event) => events.push(event)
  });
  recordMemoryChatPlacement("CHAT_ROW_FIRST_LAYOUT", {
    body: "private message",
    layoutGeneration: 7,
    renderIndex: 0,
    rowBottom: 700,
    rowHeight: 42,
    rowKey: "message:bounded-id",
    rowTop: 658,
    signedUrl: "https://private.invalid/token",
    storagePath: "private/path",
    userIdentity: "private-user"
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].layoutGeneration, 7);
  assert.equal(events[0].name, "CHAT_ROW_FIRST_LAYOUT");
  assert.equal(events[0].renderIndex, 0);
  assert.equal(events[0].rowBottom, 700);
  assert.equal(events[0].rowHeight, 42);
  assert.equal(events[0].rowKey, "message:bounded-id");
  assert.equal(events[0].rowTop, 658);
  assert.ok(
    events[0].eventTimestamp < Date.now() / 2,
    "diagnostic timestamps must use the monotonic clock rather than wall time"
  );
  for (const forbidden of [
    "body",
    "signedUrl",
    "storagePath",
    "userIdentity"
  ]) {
    assert.equal(Object.hasOwn(events[0], forbidden), false);
  }
  assert.match(
    diagnostics,
    /process\.env\.EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS === "1"/
  );
  assert.doesNotMatch(
    screen,
    /eventTimestamp:\s*Date\.now\(\)/,
    "all placement events must stay on the monotonic diagnostic clock"
  );
  assert.match(
    appConfig,
    /env\.EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS === "1"[\s\S]*Memory Room diagnostics and fixtures are forbidden in production/
  );
});
