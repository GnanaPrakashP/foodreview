import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const memoryRoomScreen = readFileSync("mobile/app/memories/[id].tsx", "utf8");
const profileScreen = readFileSync("mobile/app/(tabs)/profile.tsx", "utf8");
const notificationsScreen = readFileSync("mobile/app/notifications.tsx", "utf8");
const memoryRoomController = readFileSync("mobile/src/features/memories/room/useMemoryRoomController.ts", "utf8");
const vendoredChat = readFileSync("mobile/src/vendor/reactNativeChat/Chat/index.tsx", "utf8");
const vendoredChatTypes = readFileSync("mobile/src/vendor/reactNativeChat/Chat/types.ts", "utf8");
const vendoredMessages = readFileSync("mobile/src/vendor/reactNativeChat/MessagesContainer/index.tsx", "utf8");
const vendoredMessageTypes = readFileSync("mobile/src/vendor/reactNativeChat/MessagesContainer/types.ts", "utf8");
const vendoredMessage = readFileSync("mobile/src/vendor/reactNativeChat/Message/index.tsx", "utf8");
const memoryPreviewScreen = readFileSync("mobile/src/components/memories/camera/MediaPreviewScreen.tsx", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const memoryHooks = readFileSync("mobile/src/hooks/useMemories.ts", "utf8");
const memoryOfflineStore = readFileSync("mobile/src/services/memoryOfflineStore.ts", "utf8");
const memorySyncRunner = readFileSync("mobile/src/services/memorySyncRunner.ts", "utf8");
const memoryReadRoute = readFileSync("app/api/mobile/memories/read/route.ts", "utf8");
const memoryMessageRoute = readFileSync("app/api/mobile/memories/[roomId]/messages/route.ts", "utf8");
const memorySyncMigration = readFileSync(
  "supabase/migrations/202607250001_shared_memory_local_first_sync.sql",
  "utf8"
);
const appProviders = readFileSync("mobile/src/providers/AppProviders.tsx", "utf8");
const authGate = readFileSync("mobile/src/providers/AuthGate.tsx", "utf8");
const memorySyncBootstrap = readFileSync("mobile/src/providers/MemoryRoomSyncBootstrap.tsx", "utf8");
const appConfig = readFileSync("mobile/app.config.js", "utf8");
const queryPersistence = readFileSync("mobile/src/providers/queryPersistence.ts", "utf8");
const packageJson = readFileSync("mobile/package.json", "utf8");
const mediaPipeline = readFileSync("mobile/src/services/mediaPipeline.ts", "utf8");
const memoryValidation = readFileSync("mobile/src/services/memoryMediaValidation.ts", "utf8");
const nativeKeyboardInset = readFileSync(
  "mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/KeyboardInsetView.kt",
  "utf8"
);
const nativeChatInput = readFileSync(
  "mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/NativeChatInputView.kt",
  "utf8"
);
const nativeKeyboardModule = readFileSync(
  "mobile/modules/keyboard-inset/android/src/main/java/expo/modules/keyboardinset/KeyboardInsetModule.kt",
  "utf8"
);
const nativeChatInputWrapper = readFileSync(
  "mobile/src/components/chat/NativeChatInput.tsx",
  "utf8"
);
const memoryAddDishScreen = readFileSync("mobile/app/memories/[id]/add-dish.tsx", "utf8");

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
  assert.match(chatMainBody, /isDayAnimationEnabled=\{false\}/);
  assert.match(chatMainBody, /initiallyInitialized/);
  assert.match(
    vendoredChat,
    /useState<boolean>\(\s*\(\) => props\.initiallyInitialized === true\s*\)/
  );
  assert.match(vendoredChatTypes, /initiallyInitialized\?: boolean/);
  assert.doesNotMatch(memoryRoomScreen, /MemoryChatInstantPreview|chatListMounted|setChatListMounted/);
  assert.doesNotMatch(memoryRoomScreen, /startTransition/);
  assert.match(
    memoryRoomScreen,
    /<View style=\{styles\.chatMainMessagesLayer\}>\s*<ChatMain<MemoryChatMainMessage>/
  );
  assert.match(memoryRoomScreen, /initialNumToRender=\{CHAT_TIMELINE_INITIAL_RENDER_COUNT\}/);
  assert.match(memoryRoomScreen, /maxToRenderPerBatch=\{CHAT_TIMELINE_MAX_RENDER_BATCH\}/);
  assert.match(memoryRoomScreen, /windowSize=\{CHAT_TIMELINE_WINDOW_SIZE\}/);
  assert.match(
    chatMainBody,
    /removeClippedSubviews: Platform\.OS === "android"/
  );
  assert.match(memoryRoomScreen, /initialNumToRender=\{MEDIA_GALLERY_INITIAL_RENDER_COUNT\}/);
  assert.match(memoryRoomScreen, /maxToRenderPerBatch=\{MEDIA_GALLERY_MAX_RENDER_BATCH\}/);
  assert.match(memoryRoomScreen, /windowSize=\{MEDIA_GALLERY_WINDOW_SIZE\}/);
  const chatWindowSize = Number(
    memoryRoomScreen.match(/const CHAT_MAIN_WINDOW_SIZE = (\d+);/)?.[1]
  );
  assert.ok(
    chatWindowSize > 0 && chatWindowSize <= 3,
    "populated chat must not retain more than three viewport windows"
  );
  const chatInitialRenderCount = Number(
    memoryRoomScreen.match(/const CHAT_MAIN_INITIAL_RENDER_COUNT = (\d+);/)?.[1]
  );
  assert.ok(
    chatInitialRenderCount >= 6 && chatInitialRenderCount <= 10,
    "cold chat must paint one compact phone viewport without constructing a second viewport"
  );
});

test("active chat anchors the viewport and prefetches older rows before the edge", () => {
  const chatMainBody = memoryRoomScreen.match(
    /<ChatMain<MemoryChatMainMessage>[\s\S]*?listProps=\{\{[\s\S]*?\}\}/
  )?.[0] ?? "";
  const scrollPositionConfig = memoryRoomScreen.match(
    /const CHAT_MAIN_SCROLL_POSITION_CONFIG = \{[\s\S]*?\};/
  )?.[0] ?? "";
  const prefetchThreshold = Number(
    memoryRoomScreen.match(/const CHAT_MAIN_OLDER_PAGE_PREFETCH_THRESHOLD = ([\d.]+);/)?.[1]
  );

  assert.match(chatMainBody, /maintainVisibleContentPosition:/);
  assert.match(scrollPositionConfig, /minIndexForVisible: 0/);
  assert.match(chatMainBody, /onEndReached: requestOlderPage/);
  assert.match(chatMainBody, /onEndReachedThreshold:/);
  assert.ok(
    prefetchThreshold >= 0.4 && prefetchThreshold < 1,
    "older-page loading should begin with render-ahead before the list reaches its edge"
  );
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

test("media viewer video cleanup tolerates Expo releasing the native player first", () => {
  const viewerVideoBody = memoryRoomScreen.match(
    /function ViewerVideo\([\s\S]*?\nfunction SingleMediaPreview/
  )?.[0] ?? "";

  const cleanupBody = viewerVideoBody.match(/return \(\) => \{[\s\S]*?PLAYER_RELEASED[\s\S]*?\};/)?.[0] ?? "";
  assert.doesNotMatch(cleanupBody, /player\.(?:pause|release)\(/);
  assert.match(viewerVideoBody, /useVideoPlayer owns the native release/);
  assert.match(
    viewerVideoBody,
    /if \(!runtime\.isForeground\) pauseMediaPlayerQuietly\(player\)/
  );
});

test("media viewer mounts from a concrete selection so a stale index cannot flash a video player", () => {
  assert.match(
    memoryRoomScreen,
    /\{selectedMedia \? \(\s*<MediaViewer[\s\S]*?selection=\{selectedMedia\}[\s\S]*?\) : null\}/
  );
  assert.match(memoryRoomScreen, /useState\(selection\?\.index \?\? 0\)/);
});

test("phase 4 room panes unmount inactive heavy tabs", () => {
  const roomPaneBody = memoryRoomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.match(roomPaneBody, /if \(!active\) return null/);
  assert.match(roomPaneBody, /<View[\s\S]*style=\{styles\.roomPagerPage\}/);
  assert.doesNotMatch(roomPaneBody, /lazy|hasMounted|shouldPrewarm|Reanimated\.View/);
});

test("room tab transitions keep the header layout-stable and start cold panes immediately", () => {
  const roomHeaderBody = memoryRoomScreen.match(/function RoomHeader\([\s\S]*?\nfunction RoomModeTabs/)?.[0] ?? "";
  const keyboardContainerBody = memoryRoomScreen.match(/function RoomKeyboardContainer\([\s\S]*?\nfunction RoomHeader/)?.[0] ?? "";

  assert.match(memoryRoomScreen, /const ROOM_HEADER_EXPANDED_HEIGHT = 190/);
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

  assert.doesNotMatch(memoryRoomController, /MEMORY_ROOM_FIRST_PANE_MOUNT_DELAY_MS|paneMountTimerRef/);
  assert.match(memoryRoomController, /setMode\(nextMode\);[\s\S]*setPaneTabMode\(nextTabMode\)/);
  assert.doesNotMatch(memoryRoomController, /startTransition|setTimeout/);
  assert.match(memoryRoomScreen, /active=\{paneTabMode === "chat"\}/);
  const modeButtonBody = memoryRoomScreen.match(
    /function ModeButton\([\s\S]*?\nfunction RoomPane/
  )?.[0] ?? "";
  assert.match(modeButtonBody, /onPressIn=\{activateOnPressIn\}/);
  assert.match(modeButtonBody, /onPress=\{activateOnPress\}/);
  assert.match(modeButtonBody, /pointerReleasePendingRef/);
  assert.doesNotMatch(modeButtonBody, /Date\.now\(\).*pointer|lastPointerActivationAtRef/);
});

test("only the selected room tab owns a mounted native view tree", () => {
  const requestRoomModeBody = memoryRoomController.match(
    /const requestRoomMode = useCallback\([\s\S]*?\}, \[activePaneIndex, pagerPosition\]\);/
  )?.[0] ?? "";
  const roomPaneBody = memoryRoomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";

  assert.doesNotMatch(memoryRoomController, /shouldMountChatPane|shouldMountMediaPane|shouldMountDishesPane/);
  assert.doesNotMatch(memoryRoomController, /mountedPaneModesRef|paneMountTimerRef|setShouldMount/);
  assert.doesNotMatch(memoryRoomController, /InteractionManager|SECONDARY_PANE_WARM/);
  assert.match(requestRoomModeBody, /setPaneTabMode\(nextTabMode\)/);
  assert.doesNotMatch(requestRoomModeBody, /setTimeout/);
  assert.doesNotMatch(memoryRoomScreen, /RoomPaneMountHintContext/);
  assert.match(roomPaneBody, /if \(!active\) return null/);
  assert.match(roomPaneBody, /<View[\s\S]*style=\{styles\.roomPagerPage\}/);
  assert.doesNotMatch(roomPaneBody, /hasMounted|shouldPrewarm|withTiming|Reanimated\.View/);
});

test("Media and Dishes remount from cached data without retained hidden panes", () => {
  assert.match(memoryRoomScreen, /useMemoryMediaPagesQuery\(roomId, mode === "media", journeySession\)/);
  assert.match(memoryRoomScreen, /<RoomPane active=\{paneTabMode === "media"\}>/);
  assert.match(memoryRoomScreen, /<RoomPane active=\{paneTabMode === "dishes"\}>/);
  assert.doesNotMatch(memoryRoomScreen, /shouldMountMediaPane|shouldMountDishesPane/);
});

test("cached memory rooms bypass the loading shell", () => {
  assert.match(
    memoryRoomScreen,
    /export default function MemoryDetailScreen\(\)/
  );
  assert.doesNotMatch(memoryRoomScreen, /contentReady|setContentReady/);
  assert.match(memoryRoomScreen, /if \(room\.isLoading\) \{/);
  assert.match(
    memoryRoomScreen,
    /selectedMode=\{memoryRoomModeFromTabParam\(params\.tab\) \?\? "overview"\}/
  );
});

test("memory room back pops its existing stack entry without dismissing through profile", () => {
  const backBody = memoryRoomScreen.match(
    /const goBackToOrigin = useCallback\(\(\) => \{[\s\S]*?\}, \[beginRoomExit, router\]\);/
  )?.[0] ?? "";
  const hardwareBackBody = Array.from(memoryRoomScreen.matchAll(
    /BackHandler\.addEventListener\("hardwareBackPress",[\s\S]*?return true;\s*\}\);/g
  )).map((match) => match[0]).find((body) => body.includes("goBackToOrigin()")) ?? "";

  assert.match(backBody, /beginRoomExit\(\)/);
  assert.match(backBody, /if \(router\.canGoBack\(\)\)/);
  assert.match(backBody, /router\.back\(\)/);
  assert.match(backBody, /router\.replace\(\{ pathname: "\/profile", params: \{ tab: "memories" \} \}\)/);
  assert.doesNotMatch(backBody, /dismissTo/);
  assert.match(hardwareBackBody, /goBackToOrigin\(\)/);
});

test("room exit owns only the selected pane and defers pending read persistence", () => {
  const roomPaneBody = memoryRoomScreen.match(
    /function RoomPane\([\s\S]*?\nfunction PaneReveal/
  )?.[0] ?? "";
  const pendingReadCleanup = memoryRoomScreen.match(
    /useEffect\(\(\) => \(\) => \{[\s\S]*?markReadTimeoutRef\.current = null;[\s\S]*?\}, \[\]\);/
  )?.[0] ?? "";

  assert.match(roomPaneBody, /if \(!active\) return null/);
  assert.doesNotMatch(
    memoryRoomScreen,
    /MEMORY_ROOM_CHAT_WARM_DELAY_MS|chatWarmed|markPanesWarm|warm=\{/
  );
  assert.match(pendingReadCleanup, /InteractionManager\.runAfterInteractions/);
  assert.doesNotMatch(pendingReadCleanup, /markRead\.mutate\(undefined\)/);
});

test("memory room stack swaps without animating its retained chat view tree", () => {
  const protectedOptionsBody = authGate.match(
    /function protectedScreenOptions\(name: string\) \{[\s\S]*?\n\}/
  )?.[0] ?? "";

  assert.match(protectedOptionsBody, /name === "memories\/\[id\]"/);
  assert.match(protectedOptionsBody, /return \{ animation: "none" \}/);
});

test("Profile and Notifications push Memory Rooms so Back preserves the real origin", () => {
  assert.match(
    profileScreen,
    /router\.push\(\{ pathname: "\/memories\/\[id\]", params: \{ id: memory\.id \} \}\)/
  );
  assert.match(
    notificationsScreen,
    /router\.push\(\{ pathname: "\/memories\/\[id\]", params: \{ id: notification\.destination\.roomId \} \}\)/
  );
  assert.doesNotMatch(
    notificationsScreen,
    /router\.replace\(\{ pathname: "\/memories\/\[id\]"/
  );
  assert.match(profileScreen, /android_ripple=\{\{ color: PROFILE_COLORS\.accentDim, foreground: true \}\}/);
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

test("memory chat keyboard motion is owned by one native parent surface", () => {
  const keyboardBody = memoryRoomScreen.match(/\/\/ Keyboard handling:[\s\S]*?function showPeopleToast/)?.[0] ?? "";
  const chatSurfaceBody = memoryRoomScreen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";

  assert.match(memoryRoomScreen, /const \[frozenComposerBottomInset\] = useState\(\(\) => insets\.bottom\)/);
  assert.match(keyboardBody, /getComposerClosedBottomPadding\(frozenComposerBottomInset\)/);
  assert.match(memoryRoomScreen, /function getChatKeyboardShift\(/);
  assert.match(memoryRoomScreen, /const closedSafeAreaGap = Math\.max\(0, closedComposerBottomPadding - COMPOSER_KEYBOARD_OPEN_GAP\)/);
  assert.match(memoryRoomScreen, /return -Math\.max\(0, drivenKeyboardHeight - closedSafeAreaGap\)/);
  assert.match(keyboardBody, /getChatKeyboardShift\([\s\S]*drivenKeyboardHeight\.value,[\s\S]*closedComposerBottomPadding/);
  assert.match(keyboardBody, /const chatMainSurfaceKeyboardStyle = useAnimatedStyle\(\(\) => \(\{\s*transform: \[\{ translateY: chatKeyboardShift\.value \}\]\s*\}\), \[\]\)/);
  assert.equal((keyboardBody.match(/chatKeyboardShift\.value/g) ?? []).length, 1);
  assert.match(chatSurfaceBody, /<NativeKeyboardInsetView[\s\S]*style=\{styles\.chatKeyboardInsetContainer\}/);
  assert.match(chatSurfaceBody, /<View style=\{styles\.chatMainSurface\}>[\s\S]*\{surfaceInner\}/);
  assert.match(chatSurfaceBody, /<View style=\{styles\.chatMainMessagesLayer\}>/);
  assert.match(chatSurfaceBody, /<View pointerEvents="none" style=\{styles\.chatKeyboardBridge\} \/>/);
  assert.match(keyboardBody, /const composerBottomInsetStyle = useMemo<ViewStyle>\(\(\) => \(\{\s*paddingBottom: closedComposerBottomPadding\s*\}\)/);
  assert.match(memoryRoomScreen, /chatKeyboardBridge:[\s\S]*top: "100%"/);
  assert.match(nativeKeyboardInset, /WindowInsetsAnimationCompat\.Callback\(DISPATCH_MODE_CONTINUE_ON_SUBTREE\)/);
  assert.match(nativeKeyboardInset, /override fun onProgress/);
  assert.match(nativeKeyboardInset, /translationY = -shift/);
  assert.doesNotMatch(keyboardBody, /keyboardMotion|useKeyboardMotion/);
  assert.doesNotMatch(memoryRoomScreen, /onInputFocus|handleComposerFocus|prepareChatKeyboardOpen/);
  assert.match(memoryRoomScreen, /chatKeyboardBridge:[\s\S]*backgroundColor: ROOM_COLORS\.panel/);
});

test("dish sheet uses the native keyboard inset path without a live safe-area correction", () => {
  const sheetSurfaceBody = memoryRoomScreen.match(
    /function KeyboardAwareSheetSurface\([\s\S]*?\nfunction AttachmentOptionsSheet/
  )?.[0] ?? "";
  const attachmentSheetBody = memoryRoomScreen.match(
    /function AttachmentOptionsSheet\([\s\S]*?\nfunction RoomActionsSheet/
  )?.[0] ?? "";

  assert.match(sheetSurfaceBody, /const \[frozenBottomInset\] = useState\(\(\) => liveInsets\.bottom\)/);
  assert.match(sheetSurfaceBody, /const sheetSlideStyle = useAnimatedStyle/);
  assert.match(sheetSurfaceBody, /style=\{USE_NATIVE_KEYBOARD_INSET \? sheetSlideStyle : jsKeyboardSheetStyle\}/);
  assert.match(
    sheetSurfaceBody,
    /<NativeKeyboardInsetView[\s\S]*active[\s\S]*closedGap=\{frozenBottomInset\}[\s\S]*openGap=\{ATTACH_SHEET_KEYBOARD_GAP\}/
  );
  assert.match(sheetSurfaceBody, /paddingBottom: frozenBottomInset/);
  assert.match(sheetSurfaceBody, /style=\{styles\.attachSheetNativeKeyboardInset\}/);
  assert.doesNotMatch(sheetSurfaceBody, /paddingBottom:\s*drivenKeyboardHeight\.value/);
  assert.match(attachmentSheetBody, /const dismissSheet = useCallback\(\(\) => \{\s*Keyboard\.dismiss\(\);\s*onClose\(\)/);
  assert.match(attachmentSheetBody, /if \(!visible\) Keyboard\.dismiss\(\)/);
  assert.match(nativeKeyboardInset, /WindowInsetsAnimationCompat\.Callback\(DISPATCH_MODE_CONTINUE_ON_SUBTREE\)/);
});

test("native inset frame trace keeps every child fixed inside the translated parent", () => {
  const round = (value) => Number(value.toFixed(3));
  const parentHeight = 720;
  const frames = [0, 0.2, 0.4, 0.6, 0.8, 1, 1].map((progress, index, all) => ({
    phase: index === all.length - 1 ? "end" : "progress",
    progress,
    rawKeyboardHeight: 300 * progress
  }));
  const trace = (closedComposerBottomGap) => frames.map((frame) => {
    const openComposerBottomGap = 8;
    const closedSafeAreaGap = closedComposerBottomGap - openComposerBottomGap;
    const parentShift = -Math.max(0, frame.rawKeyboardHeight - closedSafeAreaGap);
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
    0, -38, -98, -158, -218, -278, -278
  ]);
  assert.deepEqual(threeButtonNavigation.map((frame) => frame.parentShift), [
    0, -14, -74, -134, -194, -254, -254
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

test("rapid newline and backspace use one native Android composer height transaction", () => {
  const chatSurfaceBody = memoryRoomScreen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";
  const toolbarBody = memoryRoomScreen.match(
    /function MemoryChatMainInputToolbar\([\s\S]*?\n\}\n\nfunction MemoryChatMainSelectionToolbar/
  )?.[0] ?? "";

  assert.match(chatSurfaceBody, /const messageBoxHeight = useSharedValue\(COMPOSER_MESSAGE_BOX_MIN_HEIGHT\)/);
  assert.match(chatSurfaceBody, /const composerClearance = useSharedValue\(CHAT_COMPOSER_CLEARANCE\)/);
  assert.match(chatSurfaceBody, /height: composerClearance\.value/);
  assert.match(chatSurfaceBody, /renderBottomSpacer=\{renderComposerListSpacer\}/);
  assert.match(chatSurfaceBody, /contentContainerStyle: styles\.chatMainListContent/);
  assert.match(chatSurfaceBody, /const toolbarLayoutIdentity = selectionMode/);
  assert.match(chatSurfaceBody, /measuredToolbarLayoutIdentityRef\.current === toolbarLayoutIdentity/);
  assert.match(chatSurfaceBody, /activeToolbarLayoutIdentityRef\.current !== toolbarLayoutIdentity/);
  assert.match(vendoredMessageTypes, /renderBottomSpacer\?: \(\) => React\.ReactNode/);
  assert.match(vendoredMessages, /<>\{BottomSpacerComponent\}\{ListFooterComponent\}<\/>/);

  assert.match(toolbarBody, /const handleNativeHeightChange = useEvent<NativeChatInputHeightEvent>/);
  assert.match(toolbarBody, /messageBoxHeight\.value = nextHeight/);
  assert.match(toolbarBody, /composerClearance\.value = Math\.max\(0, composerClearance\.value \+ nextHeight - previousHeight\)/);
  assert.match(toolbarBody, /<AnimatedNativeChatInput/);
  assert.match(toolbarBody, /onHeightChange=\{handleNativeHeightChange/);
  assert.match(toolbarBody, /style=\{styles\.chatMainNativeDraftInput\}/);
  assert.match(toolbarBody, /Platform\.OS === "android"/);
  assert.match(toolbarBody, /onContentSizeChange=\{handleContentSizeChange\}/);
  assert.doesNotMatch(toolbarBody, /chatMainDraftMeasureText|measuredDraft/);
  assert.doesNotMatch(memoryRoomScreen, /setChatBottomClearance|pendingComposerHeightRef|reconcileChatAfterKeyboardSettle/);

  assert.match(nativeKeyboardModule, /View\(NativeChatInputView::class\)/);
  assert.match(nativeKeyboardModule, /Name\("ChatInput"\)/);
  assert.match(nativeKeyboardModule, /Events\("onTextChange", "onHeightChange", "onHasTextChange"\)/);
  assert.match(nativeKeyboardModule, /AsyncFunction\("submit"\)/);
  assert.match(nativeChatInputWrapper, /requireNativeViewManager<NativeChatInputProps>\("KeyboardInset", "ChatInput"\)/);
  assert.match(nativeChatInput, /class NativeChatInputView[\s\S]*: ExpoView/);
  assert.match(nativeChatInput, /private val textWatcher = object : TextWatcher/);
  assert.match(nativeChatInput, /override fun afterTextChanged/);
  assert.match(nativeChatInput, /override fun afterTextChanged[\s\S]*synchronizeInputGeometry\(\)/);
  assert.match(nativeChatInput, /private fun synchronizeInputGeometry\(\)/);
  assert.match(nativeChatInput, /measureInput\(rootWidth\)[\s\S]*layoutInput\(rootWidth, rootHeight\)/);
  assert.match(nativeChatInput, /editText\.forceLayout\(\)/);
  assert.match(nativeChatInput, /mostRecentNativeEventCount \+= 1/);
  assert.match(nativeChatInput, /if \(eventCount < mostRecentNativeEventCount\) return/);
  assert.match(nativeChatInput, /if \(editText\.text\?\.toString\(\) == value\) return/);
  assert.match(nativeChatInput, /editText\.measure\([\s\S]*MeasureSpec\.UNSPECIFIED/);
  assert.match(nativeChatInput, /editText\.measure\([\s\S]*currentInputHeightPx[\s\S]*MeasureSpec\.EXACTLY/);
  assert.match(nativeChatInput, /val childTop = \(rootHeight - currentInputHeightPx\)/);
  assert.match(nativeChatInput, /editText\.layout\(0, childTop, rootWidth, childTop \+ currentInputHeightPx\)/);
  assert.match(nativeChatInput, /onHeightChange\(NativeChatInputHeightEvent/);

  let messageBoxHeight = 42;
  let composerClearance = 88;
  const trace = [];
  const applyNativeContentHeight = (nextHeight) => {
    const previousHeight = messageBoxHeight;
    messageBoxHeight = nextHeight;
    composerClearance += nextHeight - previousHeight;
    trace.push({ composerClearance, messageBoxHeight });
  };

  [63, 42, 63, 84, 63, 42].forEach(applyNativeContentHeight);
  assert.deepEqual(trace, [
    { composerClearance: 109, messageBoxHeight: 63 },
    { composerClearance: 88, messageBoxHeight: 42 },
    { composerClearance: 109, messageBoxHeight: 63 },
    { composerClearance: 130, messageBoxHeight: 84 },
    { composerClearance: 109, messageBoxHeight: 63 },
    { composerClearance: 88, messageBoxHeight: 42 }
  ]);
});

test("chat scrolling stays user-owned and the oldest message remains reachable above the keyboard", () => {
  const chatSurfaceBody = memoryRoomScreen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";
  const scrollHandlerBody = chatSurfaceBody.match(
    /const handleChatMainScroll = useCallback\([\s\S]*?(?=\n\n  const clearChatMainInteractionRelease)/
  )?.[0] ?? "";
  const contentSizeHandlerBody = chatSurfaceBody.match(
    /const handleChatMainContentSizeChange = useCallback\([\s\S]*?(?=\n\n  const surfaceInner)/
  )?.[0] ?? "";
  const keyboardBody = memoryRoomScreen.match(/\/\/ Keyboard handling:[\s\S]*?function showPeopleToast/)?.[0] ?? "";

  assert.match(scrollHandlerBody, /chatMainFollowBottomRef\.current = false/);
  assert.doesNotMatch(scrollHandlerBody, /scrollToBottom/);
  assert.match(chatSurfaceBody, /onMomentumScrollBegin: handleChatMainMomentumBegin/);
  assert.match(chatSurfaceBody, /onMomentumScrollEnd: handleChatMainMomentumEnd/);
  assert.match(contentSizeHandlerBody, /recordMemoryChatPlacement\("CONTENT_SIZE_CHANGED"/);
  assert.doesNotMatch(contentSizeHandlerBody, /scrollToBottom|scrollToOffset|scrollToIndex/);
  assert.match(chatSurfaceBody, /onContentSizeChange: handleChatMainContentSizeChange/);
  assert.match(chatSurfaceBody, /directionalLockEnabled: true/);
  assert.match(chatSurfaceBody, /nestedScrollEnabled: true/);
  assert.match(chatSurfaceBody, /scrollEnabled: true/);

  assert.match(keyboardBody, /Math\.max\(\s*targetKeyboardHeight\.value,\s*settledKeyboardHeight\.value/);
  assert.match(keyboardBody, /const chatKeyboardTopReserve = useDerivedValue/);
  assert.match(chatSurfaceBody, /renderTopSpacer=\{renderKeyboardTopSpacer\}/);
  assert.match(vendoredMessageTypes, /renderTopSpacer\?: \(\) => React\.ReactNode/);
  assert.match(vendoredMessages, /<>\{TopSpacerComponent\}\{ListHeaderComponent\}<\/>/);
});

test("reply requires a deliberate horizontal swipe and yields vertical drags to chat scrolling", () => {
  const messageRowBody = memoryRoomScreen.match(
    /function MessageRow\([\s\S]*?\nfunction ReplySwipeAction/
  )?.[0] ?? "";
  const activeSwipeBody = vendoredMessage.match(
    /const replySwipeGesture = useMemo\([\s\S]*?\n  \]\)/
  )?.[0] ?? "";

  assert.match(memoryRoomScreen, /const REPLY_SWIPE_ACTIVATION_DISTANCE = 30/);
  assert.match(memoryRoomScreen, /const REPLY_SWIPE_VERTICAL_TOLERANCE = 4/);
  assert.match(messageRowBody, /\.activeOffsetX\(REPLY_SWIPE_ACTIVATION_DISTANCE\)/);
  assert.match(
    messageRowBody,
    /\.failOffsetY\(\[-REPLY_SWIPE_VERTICAL_TOLERANCE, REPLY_SWIPE_VERTICAL_TOLERANCE\]\)/
  );
  assert.match(messageRowBody, /event\.translationX > Math\.abs\(event\.translationY\) \* 1\.5/);
  assert.match(messageRowBody, /<GestureDetector gesture=\{replySwipeGesture\} touchAction="pan-y">/);
  assert.doesNotMatch(messageRowBody, /ReanimatedSwipeable/);

  // ChatMain renders the vendored Message component, so its recognizer—not
  // only the dormant legacy timeline row—must carry the deliberate thresholds.
  assert.match(vendoredMessage, /const REPLY_SWIPE_ACTIVATION_DISTANCE = 18/);
  assert.match(vendoredMessage, /const REPLY_SWIPE_TRIGGER_DISTANCE = 48/);
  assert.match(vendoredMessage, /const REPLY_SWIPE_VERTICAL_TOLERANCE = 20/);
  assert.match(
    vendoredMessage,
    /isSwipeToReplyGestureEnabled = swipeToReply\?\.isGestureEnabled \?\? isSwipeToReplyEnabled/
  );
  assert.match(activeSwipeBody, /Gesture\.Pan\(\)/);
  assert.match(activeSwipeBody, /\.activeOffsetX\(/);
  assert.match(
    activeSwipeBody,
    /\.failOffsetY\(\[-REPLY_SWIPE_VERTICAL_TOLERANCE, REPLY_SWIPE_VERTICAL_TOLERANCE\]\)/
  );
  assert.match(activeSwipeBody, /directionalDistance > Math\.abs\(event\.translationY\) \* 1\.5/);
  assert.match(vendoredMessage, /<GestureDetector gesture=\{replySwipeGesture\} touchAction="pan-y">/);
  assert.doesNotMatch(vendoredMessage, /ReanimatedSwipeable/);
});

test("outgoing pending messages do not insert a temporary typing row", () => {
  const chatSurfaceBody = memoryRoomScreen.match(
    /function MemoryChatMainSurface\([\s\S]*?\n\}\n\n\/\/ Timestamp placement rule/
  )?.[0] ?? "";

  assert.doesNotMatch(chatSurfaceBody, /typingVisible|isTyping=/);
  assert.doesNotMatch(memoryRoomScreen, /typingVisible=\{addMessage\.isPending \|\| addPhoto\.isPending\}/);
  assert.match(
    memoryRoomScreen,
    /streaming: \(\s*message\.deliveryStatus === "pending"[\s\S]*message\.deliveryStatus === "retrying"[\s\S]*message\.deliveryStatus === "uploading"/
  );
});

test("phase 6 mounts chat only while selected and renders timestamps on the first frame", () => {
  const timeBody = memoryRoomScreen.match(/function ChatMainBodyWithTime\([\s\S]*?\nfunction estimateChatTimestampWidth/)?.[0] ?? "";
  const roomPaneBody = memoryRoomScreen.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.doesNotMatch(memoryRoomScreen, /setChatPreloaded|panesPreloaded/);
  assert.match(memoryRoomScreen, /<RoomPane active=\{paneTabMode === "chat"\}>/);
  assert.match(roomPaneBody, /if \(!active\) return null/);
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
  assert.match(imageNode, /source=\{media\.thumbnailUrl \|\| media\.publicUrl\}/);
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

test("phase 4 memory wallpaper is one bundled raster template with no query-derived asset", () => {
  const wallpaperBody = memoryRoomScreen.match(
    /const FoodChatWallpaper = memo\([\s\S]*?\n\}\);/
  )?.[0] ?? "";

  assert.equal(existsSync("mobile/assets/memories/food-wallpaper-tile-baked.png"), true);
  assert.match(
    memoryRoomScreen,
    /const FOOD_WALLPAPER_TILE_SOURCE = require\("\.\.\/\.\.\/assets\/memories\/food-wallpaper-tile-baked\.png"\)/
  );
  assert.match(memoryRoomScreen, /<FoodChatWallpaper \/>/);
  assert.match(memoryRoomScreen, /resizeMode="repeat"/);
  assert.match(wallpaperBody, /source=\{FOOD_WALLPAPER_TILE_SOURCE\}/);
  assert.doesNotMatch(wallpaperBody, /\buri\b|publicUrl|storagePath|patternKey|themeKey/);
  assert.doesNotMatch(memoryRoomScreen, /<FoodChatWallpaper patternKey=/);
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
  assert.match(memoryService, /readMemoryMediaPageOffline/);
  assert.match(memoryHooks, /listMemoryRoomsPageOfflineFirst/);
  assert.match(memoryHooks, /getMemoryRoomOfflineFirst/);
  assert.match(memoryHooks, /getMemoryMessagesPageOfflineFirst/);
  assert.match(memoryHooks, /readMemoryMediaPageOffline/);
  assert.match(memoryHooks, /readOfflineMemorySummaries/);
  assert.match(memoryHooks, /readOfflineMemoryRoom/);
  assert.match(memoryHooks, /queryClient\.setQueryData\(detailKey, cached, \{ updatedAt: 0 \}\)/);
  assert.match(memoryHooks, /saveOfflineMemoryMessage/);
  assert.match(memoryHooks, /saveOfflineMemoryPhoto/);
  assert.match(memoryHooks, /saveOfflineMemoryOutboxMessage/);
  assert.doesNotMatch(memoryHooks, /persistOfflineRoom/);
  assert.match(memoryOfflineStore, /create table if not exists memory_room_sync_state/);
  assert.match(memoryOfflineStore, /create table if not exists memory_message_outbox/);
  assert.match(memoryOfflineStore, /JSON\.stringify\(\{ \.\.\.room, messages: \[\], photos: \[\] \}\)/);
});

test("room mount resolves cached chat before background network reconciliation", () => {
  const roomQuery = memoryHooks.match(
    /export function useMemoryRoomQuery\([\s\S]*?(?=\nexport function useMemoryMessagePagesQuery)/
  )?.[0] ?? "";
  const queryFunction = roomQuery.match(/queryFn: async \(\) => \{[\s\S]*?(?=\n    enabled:)/)?.[0] ?? "";
  const cachedRead = queryFunction.indexOf("await readInitialLocalRoom()");
  const backgroundRefresh = queryFunction.indexOf('void refreshRoom("room_reconcile")');
  const cachedReturn = queryFunction.indexOf("return cached;");

  assert.notEqual(cachedRead, -1);
  assert.notEqual(backgroundRefresh, -1);
  assert.notEqual(cachedReturn, -1);
  assert.ok(cachedRead < backgroundRefresh);
  assert.ok(backgroundRefresh < cachedReturn);
  assert.match(
    roomQuery,
    /queryClient\.setQueryData<MemoryRoom>\(memoryKeys\.detail\(roomId\), \(current\) => \(\s*current \? preserveRecentMediaAttachments\(current, freshRoom\) as MemoryRoom : freshRoom/
  );
  assert.match(roomQuery, /isCacheGenerationActive\(ownerGeneration\)/);
});

test("profile memories warm complete owner-scoped rooms before navigation", () => {
  const roomsQuery = memoryHooks.match(
    /export function useMemoryRoomsQuery\([\s\S]*?(?=\nexport function useMemoryRoomsRealtime)/
  )?.[0] ?? "";
  const warmService = memoryService.match(
    /export async function warmMemoryRoomOfflineFirst\([\s\S]*?\n}/
  )?.[0] ?? "";

  assert.match(memoryHooks, /const MEMORY_ROOM_WARM_CONCURRENCY = 2/);
  assert.match(roomsQuery, /InteractionManager\.runAfterInteractions/);
  assert.match(memoryHooks, /await readOfflineMemoryRoom\(targetSummary\.id\)/);
  assert.match(memoryHooks, /queryClient\.setQueryData\(memoryKeys\.detail\(targetSummary\.id\), cached, \{ updatedAt: 0 \}\)/);
  assert.match(memoryHooks, /await warmMemoryRoomOfflineFirst\(targetSummary\.id\)/);
  assert.match(memoryHooks, /state\.revision !== targetRevision \|\|\s*state\.requestVersion !== targetRequestVersion/);
  assert.match(warmService, /recoverOutbox: false/);
  assert.match(memoryService, /isCacheGenerationActive\(ownerGeneration\)/);
});

test("authenticated runtime owns room sync across tabs, foreground and reconnect", () => {
  assert.match(appProviders, /<MemoryRoomSyncBootstrap \/>/);
  assert.match(memorySyncBootstrap, /useMemoryRoomsQuery\(\)/);
  assert.match(memorySyncBootstrap, /useMemoryRoomsRealtime\(\)/);
  assert.match(memorySyncBootstrap, /useRuntimeActivity\(\)/);
  assert.match(memorySyncBootstrap, /runtime\.isForeground && !previous\.isForeground/);
  assert.match(memorySyncBootstrap, /runtime\.isOnline && !previous\.isOnline/);
  assert.match(memorySyncBootstrap, /invalidateQueries\(\{[\s\S]*exact: true,[\s\S]*queryKey: memoryKeys\.list/);
  assert.match(memorySyncBootstrap, /syncLoadedMemoryRoomCaches\(queryClient, \{ force: true \}\)/);
  assert.doesNotMatch(memorySyncBootstrap, /AppState\.addEventListener|Network\.addNetworkStateListener/);
});

test("global realtime persists complete room entities through targeted snapshot sync", () => {
  const roomsRealtime = memoryHooks.match(
    /export function useMemoryRoomsRealtime\([\s\S]*?(?=\nexport function useMemoryRoomQuery)/
  )?.[0] ?? "";

  assert.match(roomsRealtime, /table: "shared_memory_messages"/);
  assert.match(roomsRealtime, /table: "shared_memory_photos"/);
  assert.match(roomsRealtime, /table: "shared_memory_dishes"/);
  assert.match(roomsRealtime, /table: "shared_memory_dish_ratings"/);
  assert.match(roomsRealtime, /table: "shared_memory_stops"/);
  assert.match(roomsRealtime, /table: "shared_memory_members"/);
  assert.match(roomsRealtime, /table: "shared_memory_rooms"/);
  assert.match(roomsRealtime, /warmMemoryRoomQueries\([\s\S]*\{ force: true \}/);
  assert.match(memoryService, /await saveOfflineMemoryRoom\(roomWithFreshMedia, result\.syncCursor/);
});

test("joining an invited room seeds SQLite and QueryClient before navigation resolves", () => {
  const inviteHook = memoryHooks.match(
    /export function useRespondToMemoryInviteMutation\([\s\S]*?(?=\nexport function useLeaveMemoryRoomMutation)/
  )?.[0] ?? "";

  assert.match(inviteHook, /onSuccess: async \(result\)/);
  assert.match(inviteHook, /result\.status === "accepted"/);
  assert.match(inviteHook, /await warmMemoryRoomOfflineFirst\(result\.roomId\)/);
  assert.match(inviteHook, /queryClient\.setQueryData\(memoryKeys\.detail\(result\.roomId\), joinedRoom\)/);
  assert.match(inviteHook, /captureMobileError\("memory\.joined_room_warm_failed"/);
  assert.match(memoryService, /await saveOfflineMemoryRoom\(roomWithFreshMedia, result\.syncCursor/);
});

test("room creation seeds the complete empty room before navigation", () => {
  const createHook = memoryHooks.match(
    /export function useCreateMemoryRoomMutation\([\s\S]*?(?=\nexport function useUpdateMemoryRoomOccasionMutation)/
  )?.[0] ?? "";
  const snapshotBuilder = memoryHooks.match(
    /function createdMemoryRoomSnapshot\([\s\S]*?(?=\nasync function warmMemoryRoomQueries)/
  )?.[0] ?? "";

  assert.match(snapshotBuilder, /\.\.\.result\.added/);
  assert.match(snapshotBuilder, /\.\.\.result\.alreadyMembers/);
  assert.doesNotMatch(snapshotBuilder, /\.\.\.result\.invited/);
  assert.match(snapshotBuilder, /messages: \[\]/);
  assert.match(snapshotBuilder, /photos: \[\]/);
  assert.match(snapshotBuilder, /stops: \[\]/);
  assert.match(snapshotBuilder, /dishes: \[\]/);
  assert.match(createHook, /queryClient\.setQueryData\(memoryKeys\.detail\(result\.id\), created\.room\)/);
  assert.match(createHook, /await Promise\.all\(\[[\s\S]*saveOfflineMemoryRoom\(created\.room, null, \{ replaceChat: true \}\)/);
  assert.match(createHook, /saveOfflineMemorySummaries\(\[created\.summary\]\)/);
  assert.match(createHook, /void warmMemoryRoomQueries\(queryClient, \[created\.summary\], ownerGeneration\)/);
  assert.match(createHook, /invalidateQueries\(\{ exact: true, queryKey: memoryKeys\.list \}\)/);
});

test("a cold room renders its cached summary shell instead of a black spinner", () => {
  const loadingBranch = memoryRoomScreen.match(
    /if \(room\.isLoading\) \{[\s\S]*?\n  }/
  )?.[0] ?? "";
  const loadingShell = memoryRoomScreen.match(
    /function MemoryRoomLoadingShell\([\s\S]*?(?=\nfunction RoomKeyboardContainer)/
  )?.[0] ?? "";

  assert.match(memoryRoomScreen, /const cachedRoomSummary = memoryRoomSummariesFromPages/);
  assert.match(loadingBranch, /<MemoryRoomLoadingShell/);
  assert.doesNotMatch(loadingBranch, /MemoryCenterState|ActivityIndicator/);
  assert.match(loadingShell, /summary\?\.title/);
  assert.match(loadingShell, /summary\?\.placeNames/);
  assert.match(loadingShell, /summary\.visitDate \?\? summary\.createdAt/);
  assert.doesNotMatch(loadingShell, /ActivityIndicator/);
});

test("older chat pages read SQLite before starting the network request", () => {
  const offlineFirstMessagesPage = memoryService.match(
    /export async function getMemoryMessagesPageOfflineFirst\([\s\S]*?(?=\nexport async function readMemoryMediaPageOffline)/
  )?.[0] ?? "";
  const cachedPageRead = offlineFirstMessagesPage.indexOf("await readOfflineMemoryMessagesPage");
  const networkPageRead = offlineFirstMessagesPage.indexOf("await getMemoryMessagesPage(");

  assert.notEqual(cachedPageRead, -1);
  assert.notEqual(networkPageRead, -1);
  assert.ok(cachedPageRead < networkPageRead, "SQLite must be consulted before the network page request starts");
  assert.match(offlineFirstMessagesPage, /const cached = input\.before[\s\S]*await readOfflineMemoryMessagesPage\(roomId, input\)/);
  assert.match(offlineFirstMessagesPage, /if \(cached\) return refreshMemoryMessagePageMedia\(cached\)/);
});

test("a short mounted cache still performs one older-history boundary lookup", () => {
  assert.match(memoryRoomScreen, /const cachedHistoryMayHaveOlder = \(room\.data\?\.messages\.length \?\? 0\) > 0/);
  assert.match(
    memoryRoomScreen,
    /const canLoadOlderMessages = cachedHistoryMayHaveOlder && Boolean\(olderMessagesCursor\)/
  );
  assert.doesNotMatch(memoryRoomScreen, /initialMessageSliceMayHaveOlder/);
});

test("cached room hydration and delta merging retain all locally stored chat history", () => {
  const offlineRoomRead = memoryOfflineStore.match(
    /export async function readOfflineMemoryRoom\([\s\S]*?(?=\nexport async function readOfflineMemoryRoomSyncCursor)/
  )?.[0] ?? "";
  const persistedMessagesQuery = offlineRoomRead.match(
    /`select payload\s+from memory_messages\s+where room_id = \?\s+order by created_at asc, client_sequence asc, client_order_key asc, message_id asc`/
  )?.[0] ?? "";
  const deltaMerge = memoryService.match(
    /function mergeMemoryRoomDelta\([\s\S]*?(?=\nasync function syncCachedMemoryRoom)/
  )?.[0] ?? "";

  assert.notEqual(persistedMessagesQuery, "");
  assert.doesNotMatch(persistedMessagesQuery, /\blimit\b/i);
  assert.doesNotMatch(offlineRoomRead, /DEFAULT_CHAT_PAGE_LIMIT/);
  assert.doesNotMatch(deltaMerge, /MEMORY_CHAT_PRELOAD_LIMIT/);
  assert.doesNotMatch(deltaMerge, /\.slice\(\s*-MEMORY_CHAT_PRELOAD_LIMIT\s*\)/);
  assert.match(deltaMerge, /visibleMessages = sortMemoryMessages\(visibleMessages\)/);
});

test("a short cached chat page still exposes an older-history cursor", () => {
  const offlineMessagesPageRead = memoryOfflineStore.match(
    /export async function readOfflineMemoryMessagesPage\([\s\S]*?(?=\nexport async function saveOfflineMemoryMediaPage)/
  )?.[0] ?? "";

  assert.match(offlineMessagesPageRead, /if \(messages\.length === 0\) return null/);
  assert.match(
    offlineMessagesPageRead,
    /nextCursor: encodeMemoryPageCursor\(messages\[0\]\?\.createdAt, messages\[0\]\?\.id\)/
  );
  assert.doesNotMatch(offlineMessagesPageRead, /nextCursor:\s*rows\.length > limit/);
});

test("local-first room sync is bounded, member scoped, and keeps private media server-side", () => {
  const ledgerDefinition = memorySyncMigration.match(
    /create table if not exists public\.shared_memory_chat_changes[\s\S]*?\);/
  )?.[0] ?? "";
  const syncFunction = memorySyncMigration.match(
    /create or replace function public\.shared_memory_room_sync_v1[\s\S]*?grant execute/
  )?.[0] ?? "";

  assert.doesNotMatch(ledgerDefinition, /\bbody\b|storage_path|public_url/);
  assert.match(memorySyncMigration, /revoke all on table public\.shared_memory_chat_changes from public, anon, authenticated/);
  assert.match(syncFunction, /security definer/);
  assert.match(syncFunction, /set search_path = public/);
  assert.match(syncFunction, /public\.can_read_shared_memory\(room\.id\)/);
  assert.match(syncFunction, /least\(greatest\(coalesce\(p_limit, 200\), 1\), 500\)/);
  assert.match(syncFunction, /photo\.id, photo\.room_id, photo\.stop_id, photo\.message_id/);
  assert.doesNotMatch(syncFunction, /photo\.storage_path|photo\.public_url/);
  assert.match(memorySyncMigration, /alter publication supabase_realtime add table public\.shared_memory_stops/);
  assert.match(memoryReadRoute, /signNestedChanges/);
  assert.match(memoryService, /action=sync/);
  assert.match(memoryService, /readOfflineMemoryRoomSyncCursor/);
  assert.match(memorySyncRunner, /pageIndex < input\.maxPages/);
  assert.match(memorySyncRunner, /memory_sync_cursor_did_not_advance/);
  assert.match(memoryService, /syncCursor: nextCursor/);
  assert.doesNotMatch(memoryService, /page < 4|pageIndex < 4/);
});

test("text sends persist an outbox row and use stable server idempotency", () => {
  assert.match(memoryMessageRoute, /claimIdempotency\(req, "memory\.message\.create"/);
  assert.match(memoryMessageRoute, /\.eq\("client_id", clientId\)/);
  assert.match(memoryMessageRoute, /author_name: actor\.actorName/);
  assert.match(memoryMessageRoute, /\.eq\("room_id", roomId\)/);
  assert.match(memoryService, /headers: \{ "Idempotency-Key": idempotencyKey \}/);
  assert.match(memoryHooks, /await saveOfflineMemoryOutboxMessage\(clientId, optimisticMessage\)/);
  assert.match(memoryHooks, /commitOfflineMemoryOutboxMessage\(context\.clientId, sentMessage\)/);
  assert.match(memoryOfflineStore, /create table if not exists memory_message_outbox/);
  assert.match(memorySyncMigration, /shared_memory_messages_author_client_id_uidx/);
  assert.match(memoryService, /recoverPendingMemoryMessages/);
  assert.match(memoryService, /message\.deliveryStatus === "pending"[\s\S]*Boolean\(message\.clientId\)/);
});

test("chat media previews show the whole captured image or video thumbnail", () => {
  const mediaPreviewBody = memoryRoomScreen.match(/function MediaPreview\([\s\S]*?\nfunction createStyles/)?.[0] ?? "";
  assert.match(mediaPreviewBody, /contentFit = "contain"/);
  assert.match(
    mediaPreviewBody,
    /<VideoThumbnailLayer cacheKey=\{memoryMediaCacheKey\(media\)\} contentFit=\{contentFit\} posterUri=\{media\.posterUrl\} uri=\{media\.publicUrl\}/
  );
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
  assert.match(mediaPipeline, /const UPLOAD_IMAGE_MAX_EDGE = 2400/);
  assert.match(mediaPipeline, /const UPLOAD_IMAGE_QUALITY = 0\.85/);
  assert.match(mediaPipeline, /uploadTimeoutFor\(fileSizeBytes\)/);
  assert.match(mediaPipeline, /FileSystem\.createUploadTask/);
  assert.doesNotMatch(mediaPipeline, /fileBodyFromUri\(uri\)[\s\S]*uploadTimeoutFor\(body\.byteLength\)/);
  assert.match(memoryValidation, /MEMORY_VIDEO_MAX_DURATION_MS/);
  assert.match(memoryValidation, /memoryMediaMaxOriginalBytes\(kind\)/);
});

test("phase 4 uploads and finalizes memory media sequentially to cap memory pressure", () => {
  const addMediaBody = memoryService.match(/export async function addMemoryPhoto\([\s\S]*?\n}/)?.[0] ?? "";
  assert.match(addMediaBody, /for \(const \[position, asset\] of assets\.entries\(\)\)/);
  assert.match(addMediaBody, /uploaded\.push\(await uploadMemoryMediaAsset/);
  assert.match(addMediaBody, /assetIds: uploaded\.map/);
  assert.doesNotMatch(addMediaBody, /Promise\.all\(assets\.map/);
});

test("camera preview persists a non-blocking optimistic send before returning to chat", () => {
  assert.match(memoryPreviewScreen, /const addPhoto = useAddMemoryPhotoMutation\(roomId\)/);
  assert.match(memoryPreviewScreen, /addPhoto\.mutate\(\{[\s\S]*clientCreatedAt,[\s\S]*clientOrderKey:[\s\S]*uploadBatchId: clientId/);
  assert.doesNotMatch(memoryPreviewScreen, /await addPhoto\.mutateAsync|await postMemoryRoomMedia/);
  assert.match(memoryPreviewScreen, /removeMemoryCapture\(asset\.id\)/);
  assert.match(
    memoryPreviewScreen,
    /router\.dismissTo\(\{[\s\S]*params: \{[\s\S]*id: roomId,[\s\S]*journeyRunId: journeySession\.journeyRunId,[\s\S]*roomSessionId: journeySession\.roomSessionId,[\s\S]*tab: "chat"/
  );
  assert.doesNotMatch(memoryPreviewScreen, /queueMemoryCapturePost\(asset\.id/);
  assert.doesNotMatch(memoryPreviewScreen, /postCaptureId: asset\.id/);
  assert.doesNotMatch(memoryRoomScreen, /consumeMemoryCapturePost\(postCaptureId\)/);
  assert.doesNotMatch(memoryRoomScreen, /postCaptureId/);
});

test("adding a dish uses the dedicated route and returns to the originating room", () => {
  const openDishBody = memoryRoomScreen.match(
    /function openFloatingAddDish\(\) \{[\s\S]*?\n  \}/
  )?.[0] ?? "";
  const submitDishBody = memoryAddDishScreen.match(
    /async function submitDish\(\) \{[\s\S]*?\n  \}/
  )?.[0] ?? "";

  assert.match(openDishBody, /setFloatingAddMenuOpen\(false\)/);
  assert.match(openDishBody, /pathname: "\/memories\/\[id\]\/add-dish"/);
  assert.match(submitDishBody, /await addDish\.mutateAsync/);
  assert.match(submitDishBody, /router\.back\(\)/);
  assert.doesNotMatch(submitDishBody, /router\.replace|requestRoomMode/);
  assert.doesNotMatch(memoryAddDishScreen, /stopId/);
});
