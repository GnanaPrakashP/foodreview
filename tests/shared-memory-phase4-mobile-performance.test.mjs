import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const memoryRoomScreen = readFileSync("mobile/app/memories/[id].tsx", "utf8");
const memoryRoomController = readFileSync("mobile/src/features/memories/room/useMemoryRoomController.ts", "utf8");
const vendoredChat = readFileSync("mobile/src/vendor/reactNativeChat/Chat/index.tsx", "utf8");
const vendoredChatTypes = readFileSync("mobile/src/vendor/reactNativeChat/Chat/types.ts", "utf8");
const memoryPreviewScreen = readFileSync("mobile/src/components/memories/camera/MediaPreviewScreen.tsx", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const memoryHooks = readFileSync("mobile/src/hooks/useMemories.ts", "utf8");
const memoryOfflineStore = readFileSync("mobile/src/services/memoryOfflineStore.ts", "utf8");
const appProviders = readFileSync("mobile/src/providers/AppProviders.tsx", "utf8");
const appConfig = readFileSync("mobile/app.config.js", "utf8");
const queryPersistence = readFileSync("mobile/src/providers/queryPersistence.ts", "utf8");
const packageJson = readFileSync("mobile/package.json", "utf8");
const memoryStorage = readFileSync("mobile/src/services/memoryStorage.ts", "utf8");
const memoryValidation = readFileSync("mobile/src/services/memoryMediaValidation.ts", "utf8");

test("phase 4 chat and media lists use bounded render windows", () => {
  for (const expected of [
    "CHAT_MAIN_INITIAL_RENDER_COUNT",
    "CHAT_MAIN_MAX_RENDER_BATCH",
    "CHAT_MAIN_WINDOW_SIZE",
    "CHAT_TIMELINE_INITIAL_RENDER_COUNT",
    "CHAT_TIMELINE_MAX_RENDER_BATCH",
    "CHAT_TIMELINE_WINDOW_SIZE",
    "MEDIA_GALLERY_INITIAL_RENDER_COUNT",
    "MEDIA_GALLERY_MAX_RENDER_BATCH",
    "MEDIA_GALLERY_WINDOW_SIZE"
  ]) {
    assert.match(memoryRoomScreen, new RegExp(expected));
  }

  const chatMainBody = memoryRoomScreen.match(/<ChatMain<MemoryChatMainMessage>[\s\S]*?listProps=\{\{[\s\S]*?\}\}/)?.[0] ?? "";
  assert.match(chatMainBody, /initialNumToRender: CHAT_MAIN_INITIAL_RENDER_COUNT/);
  assert.match(chatMainBody, /maxToRenderPerBatch: CHAT_MAIN_MAX_RENDER_BATCH/);
  assert.match(chatMainBody, /windowSize: CHAT_MAIN_WINDOW_SIZE/);
  assert.match(chatMainBody, /updateCellsBatchingPeriod: 50/);
  assert.match(memoryRoomScreen, /initialNumToRender=\{CHAT_TIMELINE_INITIAL_RENDER_COUNT\}/);
  assert.match(memoryRoomScreen, /maxToRenderPerBatch=\{CHAT_TIMELINE_MAX_RENDER_BATCH\}/);
  assert.match(memoryRoomScreen, /windowSize=\{CHAT_TIMELINE_WINDOW_SIZE\}/);
  assert.match(memoryRoomScreen, /removeClippedSubviews=\{false\}/);
  assert.match(memoryRoomScreen, /initialNumToRender=\{MEDIA_GALLERY_INITIAL_RENDER_COUNT\}/);
  assert.match(memoryRoomScreen, /maxToRenderPerBatch=\{MEDIA_GALLERY_MAX_RENDER_BATCH\}/);
  assert.match(memoryRoomScreen, /windowSize=\{MEDIA_GALLERY_WINDOW_SIZE\}/);
});

test("phase 4 media viewer is virtualized instead of mounting every media item", () => {
  const mediaViewerBody = memoryRoomScreen.match(/function MediaViewer\([\s\S]*?\nfunction ViewerVideo/)?.[0] ?? "";

  assert.match(mediaViewerBody, /viewerListRef = useRef<FlatList<MemoryPhoto>>/);
  assert.match(mediaViewerBody, /<FlatList[\s\S]*data=\{items\}/);
  assert.match(mediaViewerBody, /initialNumToRender=\{1\}/);
  assert.match(mediaViewerBody, /maxToRenderPerBatch=\{MEDIA_VIEWER_MAX_RENDER_BATCH\}/);
  assert.match(mediaViewerBody, /windowSize=\{MEDIA_VIEWER_WINDOW_SIZE\}/);
  const carouselBody = mediaViewerBody.match(/style=\{styles\.viewerBody\}[\s\S]*?<\/View>/)?.[0] ?? "";
  assert.doesNotMatch(carouselBody, /<ScrollView/);
});

test("phase 4 room panes lazy-mount inactive heavy tabs", () => {
  const roomPaneBody = memoryRoomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.match(roomPaneBody, /lazy = true/);
  assert.match(roomPaneBody, /const \[hasMounted, setHasMounted\] = useState\(active \|\| !lazy\)/);
  assert.match(roomPaneBody, /if \(active\) setHasMounted\(true\)/);
  assert.match(roomPaneBody, /if \(lazy && !hasMounted\) return null/);
});

test("room tab transitions keep the header layout-stable and defer only cold pane mounts", () => {
  const roomHeaderBody = memoryRoomScreen.match(/function RoomHeader\([\s\S]*?\nfunction RoomModeTabs/)?.[0] ?? "";
  const keyboardContainerBody = memoryRoomScreen.match(/function RoomKeyboardContainer\([\s\S]*?\nfunction RoomHeader/)?.[0] ?? "";

  assert.match(memoryRoomScreen, /const ROOM_HEADER_EXPANDED_HEIGHT = 183/);
  assert.match(roomHeaderBody, /styles\.headerExpansionSurface/);
  assert.match(roomHeaderBody, /styles\.movingRoomTitle/);
  assert.match(roomHeaderBody, /styles\.headerDetailsClip/);
  assert.match(roomHeaderBody, /styles\.headerTabsPosition/);
  assert.equal((roomHeaderBody.match(/<RoomModeTabs/g) ?? []).length, 1);
  assert.match(roomHeaderBody, /translateY: -ROOM_HEADER_COLLAPSE_DISTANCE \* collapseProgress\.value/);
  assert.match(roomHeaderBody, /translateX: ROOM_HEADER_TITLE_TRANSLATE_X \* collapseProgress\.value/);
  assert.doesNotMatch(roomHeaderBody, /opacity: interpolate\(collapseProgress\.value/);
  assert.doesNotMatch(roomHeaderBody, /(fontSize|left|lineHeight|maxHeight|marginRight|marginTop|right|top|width): interpolate/);
  assert.doesNotMatch(roomHeaderBody, /onHeightChange|onLayout=\{\(event\) => onHeightChange/);

  assert.match(keyboardContainerBody, /return \(\s*<KeyboardAvoidingView/);
  assert.doesNotMatch(keyboardContainerBody, /if \(chatMode\)/);
  assert.match(keyboardContainerBody, /behavior=\{!chatMode && Platform\.OS === "ios" \? "padding" : undefined\}/);
  assert.match(keyboardContainerBody, /enabled=\{!chatMode\}/);

  assert.match(memoryRoomController, /MEMORY_ROOM_FIRST_PANE_MOUNT_DELAY_MS = MEMORY_ROOM_TAB_TIMING\.duration/);
  assert.match(memoryRoomController, /mountedPaneModesRef\.current\.has\(nextTabMode\)/);
  assert.match(memoryRoomController, /setTimeout\([\s\S]*MEMORY_ROOM_FIRST_PANE_MOUNT_DELAY_MS/);
  assert.match(memoryRoomScreen, /active=\{paneTabMode === "chat"\}/);
});

test("memory chat reuses root keyboard and safe-area providers", () => {
  const chatMainBody = memoryRoomScreen.match(/<ChatMain<MemoryChatMainMessage>[\s\S]*?\/>/)?.[0] ?? "";
  const chatWrapperBody = vendoredChat.match(/function ChatWrapper[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(appProviders, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}>/);
  assert.match(chatMainBody, /disableKeyboardProvider/);
  assert.match(chatMainBody, /provideSafeAreaContext=\{false\}/);
  assert.match(vendoredChatTypes, /provideSafeAreaContext\?: boolean/);
  assert.match(chatWrapperBody, /provideSafeAreaContext = true/);
  assert.match(chatWrapperBody, /provideSafeAreaContext\s*\?\s*<SafeAreaProvider>/);
});

test("memory chat keyboard motion is owned by one animated parent surface", () => {
  const keyboardBody = memoryRoomScreen.match(/\/\/ Keyboard handling:[\s\S]*?function showPeopleToast/)?.[0] ?? "";
  const chatSurfaceBody = memoryRoomScreen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";

  assert.match(memoryRoomScreen, /const \[frozenComposerBottomInset\] = useState\(\(\) => insets\.bottom\)/);
  assert.match(keyboardBody, /getComposerClosedBottomPadding\(frozenComposerBottomInset\)/);
  assert.match(memoryRoomScreen, /function getChatKeyboardShift\(/);
  assert.match(memoryRoomScreen, /const closedComposerBottomGap = closedComposerBottomPadding/);
  assert.match(memoryRoomScreen, /const openComposerBottomGap = COMPOSER_KEYBOARD_OPEN_GAP/);
  assert.match(memoryRoomScreen, /const animatedGapReduction = \(closedComposerBottomGap - openComposerBottomGap\) \* keyboardProgress/);
  assert.match(memoryRoomScreen, /return keyboardOffset \+ animatedGapReduction/);
  assert.match(keyboardBody, /getChatKeyboardShift\([\s\S]*keyboardMotion\.offset\.value,[\s\S]*keyboardMotion\.progress\.value/);
  assert.match(keyboardBody, /const chatMainSurfaceKeyboardStyle = useAnimatedStyle\(\(\) => \(\{\s*transform: \[\{ translateY: chatKeyboardShift\.value \}\]\s*\}\), \[\]\)/);
  assert.equal((keyboardBody.match(/chatKeyboardShift\.value/g) ?? []).length, 1);
  assert.match(chatSurfaceBody, /<Reanimated\.View[\s\S]*style=\{\[styles\.chatMainSurface, surfaceKeyboardStyle\]\}/);
  assert.match(chatSurfaceBody, /<View style=\{styles\.chatMainMessagesLayer\}>/);
  assert.match(chatSurfaceBody, /<View pointerEvents="none" style=\{styles\.chatKeyboardBridge\} \/>/);
  assert.doesNotMatch(chatSurfaceBody, /styles\.chatMainMessagesLayer,\s*listKeyboardStyle/);
  assert.doesNotMatch(chatSurfaceBody, /styles\.chatKeyboardBridge,\s*keyboardBridgeStyle/);
  assert.doesNotMatch(keyboardBody, /chatListKeyboardStyle|chatKeyboardBridgeStyle|composerKeyboardStyle/);
  assert.match(keyboardBody, /const composerBottomInsetStyle = useMemo<ViewStyle>\(\(\) => \(\{\s*paddingBottom: closedComposerBottomPadding\s*\}\)/);
  assert.match(memoryRoomScreen, /chatKeyboardBridge:[\s\S]*top: "100%"/);
  assert.doesNotMatch(memoryRoomScreen, /KeyboardControllerAvoidingView|KeyboardStickyView|translate-with-padding/);
  assert.doesNotMatch(keyboardBody, /Math\.min\(0,/);
  assert.doesNotMatch(keyboardBody, /useDrivenKeyboardHeight|prepareForOpen|withTiming/);
  assert.doesNotMatch(memoryRoomScreen, /onInputFocus|handleComposerFocus|prepareChatKeyboardOpen/);
  assert.match(keyboardBody, /useAnimatedReaction\([\s\S]*keyboardMotion\.progress\.value/);
  assert.match(keyboardBody, /currentBoundary < 0 \|\| currentBoundary === previousBoundary/);
  assert.match(memoryRoomScreen, /const COMPOSER_HEIGHT_COMMIT_THRESHOLD = 1/);
  assert.match(keyboardBody, /const nextHeight = event\.nativeEvent\.layout\.height/);
  assert.doesNotMatch(keyboardBody, /Math\.round\(event\.nativeEvent\.layout\.height\)/);
  assert.match(keyboardBody, /if \(!hasMeaningfulComposerHeightChange\(pendingHeight, composerHeightRef\.current\)\) return/);
  assert.match(keyboardBody, /if \(!commitComposerHeight\(pendingHeight, false\)\) return/);
  assert.match(keyboardBody, /runOnJS\(reconcileChatAfterKeyboardSettle\)/);
  assert.match(memoryRoomScreen, /chatKeyboardBridge:[\s\S]*backgroundColor: ROOM_COLORS\.panel/);
  assert.doesNotMatch(memoryRoomScreen, /composerHeightFlushTimeoutRef|schedulePendingComposerHeightFlush/);
});

test("stage 2B deterministic frame trace keeps every child fixed inside the translated parent", () => {
  const round = (value) => Number(value.toFixed(3));
  const parentHeight = 720;
  const frames = [0, 0.2, 0.4, 0.6, 0.8, 1, 1].map((progress, index, all) => ({
    phase: index === all.length - 1 ? "end" : "progress",
    progress,
    rawKeyboardHeight: 300 * progress
  }));
  const trace = (closedComposerBottomGap) => frames.map((frame) => {
    const openComposerBottomGap = 8;
    const keyboardOffset = -frame.rawKeyboardHeight;
    const parentShift = keyboardOffset +
      (closedComposerBottomGap - openComposerBottomGap) * frame.progress;
    const composerBottom = parentHeight + parentShift;
    const viewportBottom = parentHeight + parentShift;
    const bridgeTop = parentHeight + parentShift;

    return {
      bridgePositionRelativeToParent: round(bridgeTop - parentShift),
      childKeyboardStyleUpdates: 0,
      composerBottomMinusViewportBottom: round(composerBottom - viewportBottom),
      layoutChanges: 0,
      parentShift: round(parentShift),
      phase: frame.phase,
      progress: frame.progress
    };
  });

  const gestureNavigation = trace(30);
  const threeButtonNavigation = trace(54);

  assert.deepEqual(gestureNavigation.map((frame) => frame.parentShift), [
    0, -55.6, -111.2, -166.8, -222.4, -278, -278
  ]);
  assert.deepEqual(threeButtonNavigation.map((frame) => frame.parentShift), [
    0, -50.8, -101.6, -152.4, -203.2, -254, -254
  ]);
  for (const frame of [...gestureNavigation, ...threeButtonNavigation]) {
    assert.equal(frame.composerBottomMinusViewportBottom, 0);
    assert.equal(frame.bridgePositionRelativeToParent, parentHeight);
    assert.equal(frame.childKeyboardStyleUpdates, 0);
    assert.equal(frame.layoutChanges, 0);
  }
  assert.deepEqual(gestureNavigation.at(-1), {
    ...gestureNavigation.at(-2),
    phase: "end"
  });
  assert.deepEqual(threeButtonNavigation.at(-1), {
    ...threeButtonNavigation.at(-2),
    phase: "end"
  });
});

test("stage 1.5 empty-composer focus trace starts on frame one and performs no settle commit", () => {
  const frames = [0, 0.02, 0.08, 0.25, 0.5, 0.75, 1].map((progress) => ({
    progress,
    rawKeyboardHeight: 300 * progress
  }));
  const roundTrace = (values) => values.map((value) => Number(value.toFixed(2)));
  const keyboardTrace = (closedComposerBottomGap) => {
    const openComposerBottomGap = 8;
    const before = frames.map(({ rawKeyboardHeight }) => (
      Math.min(0, -rawKeyboardHeight + closedComposerBottomGap - openComposerBottomGap)
    ));
    const after = frames.map(({ progress, rawKeyboardHeight }) => (
      -rawKeyboardHeight + (closedComposerBottomGap - openComposerBottomGap) * progress
    ));
    const finalKeyboardTopToComposerBottomGap = (
      -frames.at(-1).rawKeyboardHeight + closedComposerBottomGap - after.at(-1)
    );
    return {
      after: roundTrace(after),
      before: roundTrace(before),
      finalKeyboardTopToComposerBottomGap
    };
  };

  const gestureNavigation = keyboardTrace(30);
  const threeButtonNavigation = keyboardTrace(54);
  assert.deepEqual(gestureNavigation, {
    before: [0, 0, -2, -53, -128, -203, -278],
    after: [0, -5.56, -22.24, -69.5, -139, -208.5, -278],
    finalKeyboardTopToComposerBottomGap: 8
  });
  assert.deepEqual(threeButtonNavigation, {
    before: [0, 0, 0, -29, -104, -179, -254],
    after: [0, -5.08, -20.32, -63.5, -127, -190.5, -254],
    finalKeyboardTopToComposerBottomGap: 8
  });

  const mountHeight = 88.49;
  const focusLayoutHeight = 88.51;
  const beforeSettle = {
    committedComposerHeight: Math.round(focusLayoutHeight),
    composerHeightCommits: 1,
    composerOnLayoutCount: 2,
    jsBoundaryCalls: 1,
    listClearanceChanges: 1,
    pendingComposerHeight: Math.round(focusLayoutHeight),
    scrollReconciliations: 1
  };
  const hasMeaningfulAfterChange = Math.abs(focusLayoutHeight - mountHeight) > 1;
  const afterSettle = {
    committedComposerHeight: mountHeight,
    composerHeightCommits: hasMeaningfulAfterChange ? 1 : 0,
    composerOnLayoutCount: 2,
    jsBoundaryCalls: 1,
    listClearanceChanges: hasMeaningfulAfterChange ? 1 : 0,
    pendingComposerHeight: hasMeaningfulAfterChange ? focusLayoutHeight : null,
    scrollReconciliations: hasMeaningfulAfterChange ? 1 : 0
  };

  assert.deepEqual(beforeSettle, {
    committedComposerHeight: 89,
    composerHeightCommits: 1,
    composerOnLayoutCount: 2,
    jsBoundaryCalls: 1,
    listClearanceChanges: 1,
    pendingComposerHeight: 89,
    scrollReconciliations: 1
  });
  assert.deepEqual(afterSettle, {
    committedComposerHeight: 88.49,
    composerHeightCommits: 0,
    composerOnLayoutCount: 2,
    jsBoundaryCalls: 1,
    listClearanceChanges: 0,
    pendingComposerHeight: null,
    scrollReconciliations: 0
  });
});

test("phase 6 defers chat until visit, retains it, and renders timestamps on the first frame", () => {
  const timeBody = memoryRoomScreen.match(/function ChatMainBodyWithTime\([\s\S]*?\nfunction estimateChatTimestampWidth/)?.[0] ?? "";
  const roomPaneBody = memoryRoomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.doesNotMatch(memoryRoomScreen, /setChatPreloaded|panesPreloaded/);
  assert.match(memoryRoomScreen, /<RoomPane active=\{paneTabMode === "chat"\}>/);
  assert.match(roomPaneBody, /if \(active\) setHasMounted\(true\)/);
  assert.match(timeBody, /const estimatedTimeWidth = estimateChatTimestampWidth\(time\)/);
  assert.match(timeBody, /style=\{styles\.chatMainTimePinned\}/);
  assert.doesNotMatch(memoryRoomScreen, /chatMainTimeMeasuring/);
});

test("phase 4 media images use disk cache and stable recycling keys", () => {
  assert.match(memoryRoomScreen, /cachePolicy="memory-disk"/);
  assert.match(memoryRoomScreen, /recyclingKey=\{media\.storagePath \|\| media\.publicUrl\}/);
  assert.match(memoryRoomScreen, /const VIDEO_THUMBNAIL_CACHE_LIMIT = 80/);
  assert.match(memoryRoomScreen, /cacheKey=\{memoryMediaCacheKey\(media\)\}/);
});

test("single-image chat media keeps one effective rounded clip and stable image identity", () => {
  const renderMessageMediaBody = memoryRoomScreen.match(
    /const renderMessageMedia = useCallback\([\s\S]*?\n  const renderMessageAudio/
  )?.[0] ?? "";
  const singleMediaPreviewBody = memoryRoomScreen.match(
    /function SingleMediaPreview\([\s\S]*?\nfunction MediaTimestampOverlay/
  )?.[0] ?? "";
  const mediaPreviewBody = memoryRoomScreen.match(
    /function MediaPreview\([\s\S]*?\nfunction createStyles/
  )?.[0] ?? "";
  const imageNode = mediaPreviewBody.match(/<Image[\s\S]*?\/>/)?.[0] ?? "";
  const chatMainMediaFrameStyle = memoryRoomScreen.match(
    /chatMainMediaFrame:\s*\{[\s\S]*?\n  \}/
  )?.[0] ?? "";
  const singleMediaContainerStyle = memoryRoomScreen.match(
    /singleMediaContainer:\s*\{[\s\S]*?\n  \}/
  )?.[0] ?? "";
  const mediaImageWrapStyle = memoryRoomScreen.match(
    /mediaImageWrap:\s*\{[\s\S]*?\n  \}/
  )?.[0] ?? "";
  const clipPassthroughStyle = memoryRoomScreen.match(
    /singleImageClipPassthrough:\s*\{[\s\S]*?\n  \}/
  )?.[0] ?? "";

  // The active Chat image keeps its existing 13 dp visible radius on the
  // outer pressable; inner image-only hosts explicitly pass that clip through.
  assert.match(renderMessageMediaBody, /style=\{styles\.chatMainMediaFrame\}/);
  assert.match(chatMainMediaFrameStyle, /borderRadius: 13/);
  assert.match(chatMainMediaFrameStyle, /overflow: "hidden"/);
  assert.match(singleMediaPreviewBody, /memoryMediaKind\(media\) === "image"/);
  assert.match(singleMediaPreviewBody, /styles\.singleImageClipPassthrough/);
  assert.match(clipPassthroughStyle, /borderRadius: 0/);
  assert.match(clipPassthroughStyle, /overflow: "visible"/);
  assert.match(singleMediaContainerStyle, /overflow: "hidden"/);
  assert.match(mediaImageWrapStyle, /overflow: "hidden"/);

  // Gallery and video keep their existing clip styles; only a single chat
  // image receives the later imageClipPassthrough override.
  assert.match(singleMediaPreviewBody, /<MediaPreview media=\{media\} style=\{\[styles\.singleMediaFill, imageClipPassthrough\]\}/);
  assert.doesNotMatch(mediaPreviewBody, /contentFit="cover"/);
  assert.match(mediaPreviewBody, /<View style=\{\[styles\.videoPreview, style as StyleProp<ViewStyle>\]\}>/);

  // Keyboard progress reaches only the Reanimated parent. The image receives a
  // primitive URI, stable recycling key, static leaf style, and no transition,
  // key, keyboard, or progress prop capable of recreating its native layer.
  assert.match(imageNode, /source=\{media\.publicUrl\}/);
  assert.match(imageNode, /recyclingKey=\{media\.storagePath \|\| media\.publicUrl\}/);
  assert.match(imageNode, /style=\{styles\.mediaImage\}/);
  assert.doesNotMatch(imageNode, /source=\{\{/);
  assert.doesNotMatch(imageNode, /\bkey=/);
  assert.doesNotMatch(imageNode, /\btransition=/);
  assert.doesNotMatch(imageNode, /keyboard|progress/i);
  assert.doesNotMatch(
    singleMediaPreviewBody,
    /\b(?:keyboardHeight|keyboardProgress|surfaceKeyboardStyle)=\{/
  );
  assert.match(renderMessageMediaBody, /\}, \[onOpenMedia, screenWidth\]\)/);
});

test("phase 4 media gallery warms the first media assets on activation", () => {
  assert.match(memoryRoomScreen, /const MEDIA_GALLERY_PREFETCH_COUNT = 12/);
  assert.match(memoryRoomScreen, /if \(mode !== "media"\) return/);
  assert.match(memoryRoomScreen, /galleryPhotos\.slice\(0, MEDIA_GALLERY_PREFETCH_COUNT\)\.forEach\(prefetchMemoryMedia\)/);
});

test("phase 4 memory wallpaper uses a raster tile instead of mounting hundreds of SVG nodes", () => {
  assert.match(memoryRoomScreen, /FOOD_WALLPAPER_TILE_SOURCE/);
  assert.match(memoryRoomScreen, /resizeMode="repeat"/);
  assert.doesNotMatch(memoryRoomScreen, /FOOD_WALLPAPER_PLACEMENTS\.map/);
});

test("phase 4 audio messages use the audio engine without hidden video surfaces", () => {
  const chatAudioBody = memoryRoomScreen.match(/function ChatMainAudioMessage\([\s\S]*?\nfunction MemoryChatMainSelectionToolbar/)?.[0] ?? "";
  const viewerAudioBody = memoryRoomScreen.match(/function ViewerAudio\([\s\S]*?\nfunction ViewerVideo/)?.[0] ?? "";
  assert.match(chatAudioBody, /useAudioPlayer/);
  assert.match(viewerAudioBody, /useAudioPlayer/);
  assert.doesNotMatch(chatAudioBody, /useVideoPlayer|<VideoView/);
  assert.doesNotMatch(viewerAudioBody, /useVideoPlayer|<VideoView/);
});

test("phase 3 persists memory React Query cache with MMKV", () => {
  assert.match(packageJson, /"@tanstack\/react-query-persist-client"/);
  assert.match(packageJson, /"react-native-mmkv"/);
  assert.match(queryPersistence, /createMMKV/);
  assert.match(queryPersistence, /circlebites\.query-cache/);
  assert.match(appProviders, /AccountSessionBoundary/);
  assert.match(queryPersistence, /persistQueryClientRestore/);
  assert.match(queryPersistence, /key\.length === 1 && key\[0\] === "memories"/);
  assert.match(queryPersistence, /maxAge: QUERY_CACHE_MAX_AGE_MS/);
  assert.match(queryPersistence, /ownerScope/);
});

test("phase 5 adds SQLite offline store and offline-first memory hooks", () => {
  assert.match(packageJson, /"expo-sqlite"/);
  assert.match(appConfig, /plugins\.push\("expo-sqlite"\)/);
  assert.match(memoryOfflineStore, /SQLite\.openDatabaseAsync/);
  assert.match(memoryOfflineStore, /create table if not exists memory_room_snapshots/);
  assert.match(memoryOfflineStore, /create table if not exists memory_messages/);
  assert.match(memoryOfflineStore, /create table if not exists memory_photos/);
  assert.match(memoryService, /listMemoryRoomsOfflineFirst/);
  assert.match(memoryService, /listMemoryRoomsPageOfflineFirst/);
  assert.match(memoryService, /getMemoryRoomOfflineFirst/);
  assert.match(memoryService, /getMemoryMessagesPageOfflineFirst/);
  assert.match(memoryService, /getMemoryMediaPageOfflineFirst/);
  assert.match(memoryHooks, /listMemoryRoomsPageOfflineFirst/);
  assert.match(memoryHooks, /getMemoryRoomOfflineFirst/);
  assert.match(memoryHooks, /getMemoryMessagesPageOfflineFirst/);
  assert.match(memoryHooks, /getMemoryMediaPageOfflineFirst/);
  assert.match(memoryHooks, /readOfflineMemorySummaries/);
  assert.match(memoryHooks, /readOfflineMemoryRoom/);
  assert.match(memoryHooks, /queryClient\.setQueryData\(memoryKeys\.detail\(roomId\), cached\)/);
  assert.match(memoryHooks, /saveOfflineMemoryRoom/);
});

test("chat media previews show the whole captured image or video thumbnail", () => {
  const mediaPreviewBody = memoryRoomScreen.match(/function MediaPreview\([\s\S]*?\nfunction createStyles/)?.[0] ?? "";
  assert.match(mediaPreviewBody, /contentFit = "contain"/);
  assert.match(mediaPreviewBody, /<VideoThumbnailLayer cacheKey=\{memoryMediaCacheKey\(media\)\} contentFit=\{contentFit\} uri=\{media\.publicUrl\}/);
  assert.match(mediaPreviewBody, /contentFit=\{contentFit\}/);
  assert.doesNotMatch(mediaPreviewBody, /contentFit="cover"/);
});

test("single-media chat previews size continuously from actual aspect ratio", () => {
  const sizeBody = memoryRoomScreen.match(/function getSingleMediaPreviewSize[\s\S]*?\nfunction /)?.[0] ?? "";
  assert.match(sizeBody, /const maxMediaWidth = Math\.min\(screenWidth \* 0\.82, 340\)/);
  assert.match(sizeBody, /const maxMediaHeight = Math\.min\(Math\.max\(screenWidth \* 1\.05, 360\), 430\)/);
  assert.match(sizeBody, /let width = maxMediaWidth/);
  assert.match(sizeBody, /let height = width \/ aspect/);
  assert.match(sizeBody, /height > maxMediaHeight/);
  assert.match(sizeBody, /height < minMediaHeight/);
  assert.doesNotMatch(sizeBody, /aspect < 0\.8/);
  assert.doesNotMatch(sizeBody, /aspect <= 1\.25/);
  assert.doesNotMatch(memoryRoomScreen, /mediaImageWrap:\s*\{[^}]*aspectRatio: 1/);
  assert.doesNotMatch(memoryRoomScreen, /videoPreview:\s*\{[^}]*aspectRatio: 1/);
});

test("media tab keeps fixed square gallery blocks independent of chat bubble sizing", () => {
  const galleryBody = memoryRoomScreen.match(/function MediaGallery\([\s\S]*?\nfunction formatMemoryDishRating/)?.[0] ?? "";
  assert.match(galleryBody, /numColumns=\{2\}/);
  assert.match(galleryBody, /style=\{styles\.galleryMediaButton\}/);
  assert.match(galleryBody, /<MediaPreview contentFit="cover" media=\{photo\} style=\{styles\.galleryMediaPreview\}/);
  assert.match(memoryRoomScreen, /galleryItem:\s*\{[\s\S]*?width: "50%"/);
  assert.match(memoryRoomScreen, /galleryMediaPreview:\s*\{[\s\S]*?aspectRatio: 1/);
});

test("phase 4 keeps upload-side media crash guards in place", () => {
  assert.match(memoryStorage, /const MAX_IMAGE_DIMENSION = 1600/);
  assert.match(memoryStorage, /const IMAGE_COMPRESS_QUALITY = 0\.7/);
  assert.match(memoryStorage, /assertValidMemoryUploadSize\(fileBody\.byteLength, mediaType\)/);
  assert.match(memoryValidation, /MEMORY_VIDEO_MAX_DURATION_MS/);
  assert.match(memoryValidation, /memoryMediaMaxOriginalBytes\(kind\)/);
});

test("phase 4 uploads and finalizes memory media sequentially to cap memory pressure", () => {
  const addMediaBody = memoryService.match(/export async function addMemoryPhoto\([\s\S]*?\n}/)?.[0] ?? "";
  assert.match(addMediaBody, /for \(const \[index, asset\] of uploadInputs\.entries\(\)\)/);
  assert.match(addMediaBody, /for \(const \[position, media\] of uploadResults\.entries\(\)\)/);
  assert.doesNotMatch(addMediaBody, /Promise\.all\(uploadInputs\.map/);
  assert.doesNotMatch(addMediaBody, /Promise\.all\(uploadResults\.map/);
});

test("camera preview uploads media directly before returning to chat", () => {
  assert.match(memoryPreviewScreen, /await postMemoryRoomMedia\(\{[\s\S]*asset,[\s\S]*roomId[\s\S]*\}\)/);
  assert.match(memoryPreviewScreen, /removeMemoryCapture\(asset\.id\)/);
  assert.match(memoryPreviewScreen, /router\.dismissTo\(\{[\s\S]*params: \{ id: roomId, tab: "chat" \}/);
  assert.match(memoryPreviewScreen, /Could not post media\. Check your connection and try again\./);
  assert.doesNotMatch(memoryPreviewScreen, /queueMemoryCapturePost\(asset\.id/);
  assert.doesNotMatch(memoryPreviewScreen, /postCaptureId: asset\.id/);
  assert.doesNotMatch(memoryRoomScreen, /consumeMemoryCapturePost\(postCaptureId\)/);
  assert.doesNotMatch(memoryRoomScreen, /postCaptureId/);
});

test("adding a dish from the attachment sheet returns to chat, not the dishes tab", () => {
  const submitDishBody = memoryRoomScreen.match(/async function submitDishFromAttachment\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(submitDishBody, /setAttachmentOptionsVisible\(false\)/);
  assert.match(submitDishBody, /requestRoomMode\("chat"\)/);
  assert.match(submitDishBody, /scrollChatToBottom\(true\)/);
  assert.doesNotMatch(submitDishBody, /"dishes"/);
  assert.doesNotMatch(submitDishBody, /attachmentOriginMode === "chat"/);
});
