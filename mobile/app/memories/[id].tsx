import Ionicons from "@expo/vector-icons/Ionicons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  type RecorderState,
  type RecordingOptions
} from "expo-audio";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { PenLine, Star, Utensils } from "lucide-react-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import type { VideoThumbnailsResult } from "expo-video-thumbnails";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { createContext, memo, type ReactNode, type RefObject, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  ImageBackground,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextLayoutEventData,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  processColor,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewToken,
  type ViewStyle
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AndroidSoftInputModes,
  KeyboardController,
  useKeyboardContext,
  useKeyboardHandler
} from "react-native-keyboard-controller";
import Reanimated, {
  Easing as ReanimatedEasing,
  interpolate,
  runOnJS,
  type ScrollEvent,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useEvent,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { discardTemporaryAccountFile, stageAccountFile } from "@/services/accountFileStore";
import { createLocalVideoPoster } from "@/services/localVideoPoster";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import {
  getOccasionTheme,
  occasionThemeToMemoryRoomTokens,
  type OccasionTheme
} from "@/features/occasions/occasionThemes";
import type { OccasionType } from "@/features/occasions/occasionTypes";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  AnimatedNativeChatInput,
  type NativeChatInputHandle,
  type NativeChatInputHasTextEvent,
  type NativeChatInputHeightEvent,
  type NativeChatInputProps,
  type NativeChatInputSubmitResult,
  type NativeChatInputTextEvent
} from "@/components/chat/NativeChatInput";
import { NativeKeyboardInsetView } from "@/components/chat/NativeKeyboardInsetView";
import {
  NativeMemoryChatList,
  nativeMemoryChatListAvailable,
  type NativeMemoryChatMetricsEvent,
  type NativeMemoryChatRevealEvent,
  type NativeMemoryChatScrollCommand,
  type NativeMemoryChatVisibleEvent
} from "@/components/chat/NativeMemoryChatList";
import Svg, { Circle, Path } from "react-native-svg";
import {
  MEMORY_ROOM_TABS as ROOM_TABS,
  memoryRoomModeFromTabParam,
  useMemoryRoomController,
  type MemoryRoomMode as RoomMode,
  type MemoryRoomTabMode as RoomTabMode
} from "@/features/memories/room/useMemoryRoomController";
import {
  captureMemoryRoomScrollOffset,
  createMemoryRoomScrollSession,
  readMemoryRoomScrollOffset
} from "@/features/memories/room/memoryRoomScrollState";
import {
  adjustMemoryRoomResourceCounter,
  beginMemoryRoomExit as beginMemoryRoomExitTrace,
  beginMemoryRoomTabTransition,
  completeMemoryRoomExit,
  ensureMemoryRoomEntryTrace,
  markMemoryRoomTracePoint,
  markMemoryRoomSurfaceUsable,
  markMemoryRoomTransitionFirstFrame,
  markMemoryRoomTransitionSettled,
  MEMORY_ROOM_RELEASE_PROFILE_ENABLED,
  recordMemoryRoomCacheProfileSnapshot,
  recordMemoryRoomChatRendererCandidate,
  recordMemoryRoomNativeChatMetrics,
  recordMemoryRoomSurfaceLifecycle,
  traceMemoryRoomSection
} from "@/performance/memoryRoomReleaseProfile";
import {
  MEMORY_ROOM_CHAT_LITE_RENDERER,
  MEMORY_ROOM_CHAT_NATIVE_RENDERER,
  MEMORY_ROOM_CHAT_VENDOR_FLASHLIST,
  MEMORY_ROOM_CHAT_RENDERER,
  MEMORY_ROOM_CHAT_RENDERER_CODE
} from "@/performance/memoryRoomChatRenderer";
import {
  MemoryChatRowModelStore,
  type ChatRowViewModel
} from "@/features/memories/chat/memoryChatRowModel";
import { MemoryChatIncrementalProjectionStore } from "@/features/memories/chat/memoryChatIncrementalProjection.mjs";
import {
  memoryChatComposerLayoutContract,
  memoryChatTimestampReservationWidth,
  resolveMemoryChatCollapsedComposerGeometry
} from "@/features/memories/chat/memoryChatGeometry.mjs";
import {
  Bubble as ChatMainBubble,
  Chat as ChatMain,
  Message as ChatMainMessageRow
} from "@/vendor/reactNativeChat";
import type {
  BubbleProps as ChatMainBubbleProps
} from "@/vendor/reactNativeChat/Bubble";
import type { MessageProps as ChatMainMessageRowProps } from "@/vendor/reactNativeChat/Message";
import type { MessageTextProps as ChatMainMessageTextProps } from "@/vendor/reactNativeChat/MessageText";
import type { AnimatedList as ChatMainAnimatedList } from "@/vendor/reactNativeChat/MessagesContainer";
import type { IMessage as ChatMainMessage, MessageAudioProps as ChatMainMessageAudioProps, MessageReaction as ChatMainMessageReaction, ReplyMessage as ChatMainReplyMessage } from "@/vendor/reactNativeChat/Models";
import { useCircleAccessStatusesQuery } from "@/hooks/useCircle";
import { useRequestCircleAccessMutation } from "@/hooks/useEngagement";
import { useUserProfileSearch } from "@/hooks/useUserProfileSearch";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useDrivenKeyboardHeight } from "@/hooks/useDrivenKeyboardHeight";
import { useReducedMotionPreference } from "@/hooks/useReducedMotionPreference";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryPhotoMutation,
  useDeleteMemoryItemsMutation,
  useDeleteMemoryDishMutation,
  useDeleteMemoryStopMutation,
  useDismissFailedMemoryMessage,
  useEditMemoryMessageMutation,
  useLeaveMemoryRoomMutation,
  useMarkMemoryRoomActivityReadMutation,
  useMarkMemoryRoomReadMutation,
  useMemoryMediaPagesQuery,
  useMemoryMessagePagesQuery,
  useMemoryUnreadAnchorQuery,
  useMemoryRoomQuery,
  useMemoryRoomRealtime,
  memoryRoomSummariesFromPages,
  memoryKeys,
  useSetMemoryDishRatingMutation
} from "@/hooks/useMemories";
import type { CircleAccessStatus } from "@/services/circle";
import { consumeMemoryRoomTab } from "@/services/memoryCaptureSession";
import { memoryChatRowKey } from "@/services/memoryChatRowKeys";
import {
  isOptimisticMemoryMedia,
  settleMemoryRoomMedia
} from "@/services/memoryMediaSettle.mjs";
import { resolveMemoryUploadProgress } from "@/services/memoryUploadProgress.mjs";
import { setActiveMemorySurface } from "@/services/memoryActiveSurface";
import {
  memoryChatPlacementDiagnosticsEnabled,
  recordMemoryChatPlacement,
  updateMemoryChatPlacementContext
} from "@/services/memoryChatPlacementDiagnostics.mjs";
import {
  createMemoryRoomJourneySession,
  recordMemoryRoomJourney,
  type MemoryRoomJourneySession
} from "@/services/memoryRoomJourneyDiagnostics.mjs";
import {
  downloadMemoryChatPlacementFixture,
  memoryChatPlacementFixtureKinds,
  memoryChatPlacementFixtureStartDelayMs,
  memoryChatPlacementStaleRefreshDelayMs
} from "@/services/memoryChatPlacementFixtures";
import {
  compareMemoryMessages,
  mergeMemoryMessageSnapshot,
  memoryMessageServerId
} from "@/services/memoryMessageReconciliation.mjs";
import { createRequestId } from "@/services/installIdentity";
import { cancelPendingMemoryUploadBatch } from "@/services/mediaPipeline";
import { validateMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { memoryHistoryCursorFromMessages } from "@/services/memories";
import type { AddMemoryMediaAsset, MemoryRoomsPage } from "@/services/memories";
import { MEMORY_AUDIO_MAX_DURATION_MS } from "@/constants/memoryMediaPolicy";
import { MEMORY_TEXT_MAX_LENGTH } from "@/constants/memoryLimits";
import type { UserSearchResult } from "@/services/profiles";
import { useSessionStore } from "@/stores/sessionStore";
import { avatarAccents, fontFamilies, fontStyles, memoryRoomTokens, radius, spacing, type MemoryRoomTokens } from "@/theme";
import type { MemoryDish, MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom, MemoryRoomSummary, MemoryStop } from "@/types/models";
import { formatDisplayDate, formatDisplayTime } from "@/utils/datetime";

type MemberCircleStatus = CircleAccessStatus | "loading";
type TimelineItem =
  | { id: string; createdAt: string; type: "message"; value: MemoryMessage }
  | { id: string; createdAt: string; type: "media"; value: MemoryPhoto }
  | { id: string; createdAt: string; type: "dish"; value: MemoryDish };
type ChatTimelineRow =
  | { id: string; label: string; type: "date" }
  | { id: string; type: "unread" }
  | {
    groupPosition: MessageGroupPosition;
    id: string;
    mine: boolean;
    rowSpacing: "break" | "group-start" | "grouped";
    showSenderDetails: boolean;
    type: "message";
    value: MemoryMessage;
  }
  | {
    groupPosition: MessageGroupPosition;
    id: string;
    mine: boolean;
    rowSpacing: "break" | "group-start" | "grouped";
    showSenderDetails: boolean;
    type: "media";
    value: MemoryPhoto;
  }
  | {
    groupPosition: MessageGroupPosition;
    id: string;
    mine: boolean;
    rowSpacing: "break" | "group-start" | "grouped";
    showSenderDetails: boolean;
    type: "dish";
    value: MemoryDish;
  };
type MediaViewerState = {
  index: number;
  items: MemoryPhoto[];
};
type OpenMediaHandler = (media: MemoryPhoto, group?: MemoryPhoto[]) => void;
type ChatListScrollRef = {
  scrollToOffset: (options: { animated?: boolean; offset: number }) => void;
  // Present on both FlatList and FlashList. Optional because the vendored
  // container forwards whichever list engine is mounted, and the unread anchor
  // must degrade to the existing bottom placement rather than throw.
  // FlatList returns nothing and reports failure through onScrollToIndexFailed;
  // FlashList returns a promise that resolves when the scroll completes and has
  // no failure callback at all. The anchor below handles both.
  scrollToIndex?: (options: {
    animated?: boolean;
    index: number;
    viewOffset?: number;
    viewPosition?: number;
  }) => void | Promise<void>;
  /** FlashList only: undefined until the row has a resolved layout. */
  getLayout?: (index: number) => unknown;
};
type MemoryActionTarget =
  | { type: "dish"; value: MemoryDish }
  | { type: "message"; value: MemoryMessage }
  | { type: "photo"; value: MemoryPhoto };
type MemoryReactionState = Record<string, Record<string, Array<string | number>>>;
type MemoryChatMainMessage = ChatMainMessage & {
  kind: "dish" | "media" | "message" | "unread";
  memoryDish?: MemoryDish;
  memoryMessage?: MemoryMessage;
  memoryPhoto?: MemoryPhoto;
  extraAttachments?: MemoryPhoto[];
  showSenderDetails?: boolean;
};
// Pre-tinted (theme line #D7CAB9 @ 0.22 baked into pixels) so the chat wallpaper
// renders as a plain repeating image — no per-frame tintColor shader, no fade.
// Regenerate with scripts/generateFoodWallpaperTile.mjs after changing either.
const FOOD_WALLPAPER_TILE_SOURCE = require("../../assets/memories/food-wallpaper-tile-baked.png");
const ROOM_MAX_WIDTH = 640;
// Room palette mapped onto the shared memory tokens (see src/theme/tokens.ts).
// Key names are kept stable so styles read clearly; values follow the current
// app appearance with purple as the single memory-room primary accent.
function createRoomColors(tokens: MemoryRoomTokens) {
  return {
    // Surfaces / layered elevation
    bg: tokens.background,
    wallpaperBg: tokens.wallpaperBackground,
    wallpaperLine: tokens.wallpaperLine,
    wallpaperOpacity: tokens.wallpaperOpacity,
    header: tokens.surface, // app bar — match cards (level 1) so the bar doesn't out-shine content
    panel: tokens.surface, // cards & panels (level 1)
    panelRaised: tokens.surfaceRaised, // raised cards, message box (level 2)
    surfaceHigh: tokens.surfaceHigh, // sheets, popovers, selection bar (level 3)
    mediaPanel: tokens.surfaceDim, // media wells
    // Lines
    border: tokens.divider,
    borderStrong: tokens.outline,
    // Text / icons
    onSurface: tokens.onSurface,
    muted: tokens.onSurfaceVariant,
    faint: tokens.onSurfaceDisabled,
    timestamp: tokens.messageTimestamp,
    sentTimestamp: tokens.sentMessageTimestamp,
    mediaTimestamp: tokens.mediaOverlayTimestamp,
    sentBubble: tokens.sentBubble,
    sentBubbleBorder: tokens.sentBubbleOutline,
    onSentBubble: tokens.onSentBubble,
    sentReplyBackground: tokens.sentReplyBackground,
    sentReplyBorder: tokens.sentReplyBorder,
    sentReplyText: tokens.sentReplyText,
    receivedBubble: tokens.receivedBubble,
    onReceivedBubble: tokens.onReceivedBubble,
    // Accent (sparingly)
    cool: tokens.primary,
    coolPressed: tokens.primaryPressed,
    coolDim: tokens.primaryContainer,
    coolBorder: tokens.primaryOutline,
    coolOnContainer: tokens.onPrimaryContainer,
    onCool: tokens.onPrimary,
    selection: tokens.selection,
    // Status / tertiary
    gold: tokens.gold,
    goldDim: tokens.goldContainer,
    goldBorder: tokens.goldOutline,
    danger: tokens.error,
    dangerSoft: tokens.error,
    dangerDim: tokens.errorContainer,
    dangerBorder: tokens.errorOutline,
    // Scrims & glass
    scrim: tokens.scrim,
    scrimStrong: tokens.scrimStrong,
    scrimSoft: tokens.scrimSoft,
    scrimMedium: tokens.scrimMedium,
    glass: tokens.glass,
    glassDim: tokens.glassDim,
    outlineStrong: tokens.outlineStrong,
    white: tokens.white,
    black: tokens.black
  } as const;
}

type RoomColors = ReturnType<typeof createRoomColors>;

let ROOM_COLORS: RoomColors = createRoomColors(memoryRoomTokens.dark);
// Bubble styles read sentBubble/receivedBubble directly from the current
// createStyles argument; keeping a second mutable color source can apply the
// previous room's occasion theme.
const CHAT_ACCENTS = avatarAccents;
const CHAT_COMPOSER_LAYOUT_CONTRACT = memoryChatComposerLayoutContract(Platform.OS);
const COMPOSER_TOP_GAP = 8;
// Matches COMPOSER_TOP_GAP so the message box sits with an equal gap above (to the
// composer's opaque top edge) and below (to the keyboard) when the keyboard is open.
const COMPOSER_KEYBOARD_OPEN_GAP = 8;
const COMPOSER_CLOSED_SAFE_GAP = CHAT_COMPOSER_LAYOUT_CONTRACT.closedSafeGap;
const ANDROID_EDGE_TO_EDGE_MIN_VERSION = 30;
const IS_ANDROID_EDGE_TO_EDGE = Platform.OS === "android" && Number(Platform.Version) >= ANDROID_EDGE_TO_EDGE_MIN_VERSION;
// On Android the chat surface is glued to the keyboard by a native
// WindowInsetsAnimation-driven container (NativeKeyboardInsetView), which moves
// per-frame on the native side and bypasses the Fabric commit stall. iOS keeps
// the JS driven-height (park) transform. Flip to false to fall back to the JS
// transform on Android too.
const USE_NATIVE_KEYBOARD_INSET = Platform.OS === "android";
// Emit per-frame native inset logs (adb logcat -s KeyboardInsetView) to verify
// the callback cadence on device. Toggling this is a JS prop change (Metro
// reload), so it can be turned off without a native rebuild. Leave false in
// normal use; on only for on-device verification.
const NATIVE_KEYBOARD_INSET_DEBUG = false;
const MEDIA_GRID_GAP = 4;
const CHAT_ROW_SIDE_PADDING = Platform.OS === "web" ? spacing.base : spacing.md;
// Mirrors the vendored Message container's own side margin
// (`container_left`/`container_right` in vendor/reactNativeChat/Message/styles.ts).
// Rows that bypass that wrapper have to reproduce it or they sit wider than
// every bubble around them.
const CHAT_VENDOR_BUBBLE_SIDE_MARGIN = 8;
const CHAT_SENT_TEXT_ROW_MAX_WIDTH = "80%";
const CHAT_RECEIVED_TEXT_ROW_MAX_WIDTH = "74%";
const CHAT_GROUPED_MESSAGE_GAP = 3;
const CHAT_AVATAR_SIZE = 30;
const COMPOSER_INPUT_FONT_SIZE = CHAT_COMPOSER_LAYOUT_CONTRACT.inputFontSize;
const COMPOSER_INPUT_LINE_HEIGHT = CHAT_COMPOSER_LAYOUT_CONTRACT.inputLineHeight;
const COMPOSER_INPUT_VERTICAL_PADDING = CHAT_COMPOSER_LAYOUT_CONTRACT.inputVerticalPadding;
const COMPOSER_INPUT_BORDER_HEIGHT = CHAT_COMPOSER_LAYOUT_CONTRACT.inputBorderHeight;
const COMPOSER_INPUT_MIN_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING + COMPOSER_INPUT_BORDER_HEIGHT;
const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT * 5 + COMPOSER_INPUT_VERTICAL_PADDING + COMPOSER_INPUT_BORDER_HEIGHT;
const COMPOSER_MESSAGE_BOX_MIN_HEIGHT = Platform.OS === "web" ? COMPOSER_INPUT_MIN_HEIGHT : Math.max(42, COMPOSER_INPUT_MIN_HEIGHT);
const COMPOSER_ACTION_BUTTON_SIZE = CHAT_COMPOSER_LAYOUT_CONTRACT.actionButtonSize;
const VOICE_MESSAGE_MIN_DURATION_MS = 700;
const VOICE_MESSAGE_SEND_MIN_DURATION_MS = Platform.OS === "android" ? 1500 : VOICE_MESSAGE_MIN_DURATION_MS;
const VOICE_MESSAGE_MIME_TYPE = "audio/mp4";
// The native recorder instance handed back by VoiceRecorderHost.
type VoiceRecorder = ReturnType<typeof useAudioRecorder>;

const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  bitRate: Platform.OS === "android" ? 64000 : RecordingPresets.HIGH_QUALITY.bitRate,
  isMeteringEnabled: true,
  numberOfChannels: Platform.OS === "android" ? 1 : RecordingPresets.HIGH_QUALITY.numberOfChannels,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    audioSource: "mic",
    extension: ".m4a",
    sampleRate: 44100
  }
};
const SELECTION_INLINE_BUTTON_SIZE = Platform.OS === "web" ? 30 : 32;
const SELECTION_SECONDARY_ICON_SIZE = 19;
const REPLY_SWIPE_ACTIVATION_DISTANCE = 30;
const REPLY_SWIPE_VERTICAL_TOLERANCE = 4;
const REPLY_SWIPE_TRIGGER_DISTANCE = 54;
const REPLY_SWIPE_MAX_TRANSLATE = 58;
const FLOATING_ADD_EDGE_OFFSET = spacing.lg + 6;
const FLOATING_ADD_BUTTON_SIZE = 54;
const FLOATING_ADD_ICON_SIZE = 26;
const FLOATING_ADD_ACTION_ICON_SIZE = 46;
const FLOATING_ADD_MENU_GAP = 14;
const ROOM_HEADER_SECTION_GAP = 6;
const ROOM_HEADER_HORIZONTAL_PADDING = 18;
const ROOM_HEADER_CONTENT_INSET = 8;
// Inner padding of the room tab bar. Shared by the style and the active-pill
// geometry so the two can never drift apart.
const MODE_TABS_PADDING = 2;
const ROOM_HEADER_CONTROL_SIZE = 34;
const ROOM_HEADER_EXPANDED_CONTENT_TOP_GAP = 2;
const ROOM_HEADER_EXPANDED_TITLE_LEFT_NUDGE = 3;
const CHAT_HEADER_CLEARANCE = 112;
const ROOM_HEADER_EXPANDED_HEIGHT = 183;
const ROOM_HEADER_COMPACT_HEIGHT = 96;
const ROOM_HEADER_COLLAPSE_DISTANCE = ROOM_HEADER_EXPANDED_HEIGHT - ROOM_HEADER_COMPACT_HEIGHT;
const ROOM_HEADER_EXPANDED_TITLE_LEFT = ROOM_HEADER_HORIZONTAL_PADDING + ROOM_HEADER_CONTENT_INSET + ROOM_HEADER_EXPANDED_TITLE_LEFT_NUDGE;
const ROOM_HEADER_COMPACT_TITLE_LEFT = 56;
const ROOM_HEADER_COMPACT_TITLE_RIGHT = 58;
const ROOM_HEADER_TITLE_TRANSLATE_X = ROOM_HEADER_COMPACT_TITLE_LEFT - ROOM_HEADER_EXPANDED_TITLE_LEFT;
const ROOM_HEADER_EXPANDED_TITLE_TOP = spacing.sm + ROOM_HEADER_CONTROL_SIZE + ROOM_HEADER_EXPANDED_CONTENT_TOP_GAP;
const ROOM_HEADER_COMPACT_TITLE_TOP = 12;
const ROOM_HEADER_TITLE_TRANSLATE_Y = ROOM_HEADER_COMPACT_TITLE_TOP - ROOM_HEADER_EXPANDED_TITLE_TOP;
const ROOM_HEADER_DETAILS_TOP = ROOM_HEADER_EXPANDED_TITLE_TOP + 27 + ROOM_HEADER_SECTION_GAP;
const ROOM_HEADER_DETAILS_HEIGHT = 52;
const ROOM_HEADER_TABS_TOP = ROOM_HEADER_DETAILS_TOP + ROOM_HEADER_DETAILS_HEIGHT;
// Keep the Table content aligned to the fixed expanded header. A constant inset
// avoids feeding animated header measurements back into the room screen.
const TABLE_HEADER_CLEARANCE = ROOM_HEADER_EXPANDED_HEIGHT;
const MEMORY_ROOM_CHAT_WARM_DELAY_MS = 450;
const CHAT_KEYBOARD_BRIDGE_HEIGHT = 1000;

const MEDIA_GALLERY_GAP = 2;
const MEDIA_GALLERY_HALF_GAP = MEDIA_GALLERY_GAP / 2;
const MEMBERS_HEADER_CLEARANCE = spacing.sm + 34 + 14 + 1;
const MEDIA_GALLERY_TOP_CLEARANCE = ROOM_HEADER_COMPACT_HEIGHT + MEDIA_GALLERY_HALF_GAP;
const PEOPLE_PANEL_ENTER_DURATION = 230;
const PEOPLE_PANEL_EXIT_DURATION = 190;
// One viewport, not half of one. The previous value of 8 was chosen on the
// assumption that "a normal phone viewport contains at most eight compact chat
// rows"; three independent physical measurements contradict it — the vendored
// list settles at 29 mounted rows with windowSize 3 (~10 per viewport), the
// FlashList candidate's settled viewport was visually full with 12 rows, and
// the native recycler reported 15 visible rows per check. Rendering 8 therefore
// guaranteed a structurally incomplete first frame that maxToRenderPerBatch
// then filled in 6-row steps at least updateCellsBatchingPeriod apart, which is
// the staged "rows appearing in batches" the room has always shown.
//
// This is only affordable because the row itself got cheaper: the vendored
// bottom metadata subtree (two Views, Time's View/Text plus a dayjs format, and
// the tick Views/Texts) is no longer built per row now that renderBubble
// returns null for it. Treat the pair as one change when A/B-ing on device.
const CHAT_MAIN_INITIAL_RENDER_COUNT = 14;
// Anchoring on the first unread has to render down to the anchor before
// scrollToIndex can measure it, but a room that has been unread for weeks must
// not turn that into an unbounded first commit. Past this many rows the entry
// keeps the ordinary newest-first placement and the unread divider is reached
// by scrolling, exactly as it is today.
const CHAT_MAIN_ANCHOR_MAX_INITIAL_RENDER_COUNT = 40;
// Bounded reveal, mirroring the reviewed native contract: hold the list
// transparent until the requested anchor is applied, then reveal. Exhausting
// the budget reveals anyway at the ordinary newest-first position rather than
// leaving a blank surface.
const CHAT_MAIN_ANCHOR_REVEAL_MAX_FRAMES = 4;
// Ceiling on how long Chat may hold a blank surface waiting for the server-side
// unread anchor. useMemoryUnreadAnchorQuery carries React Query's default retry
// policy, so a flaky network can keep it un-settled for tens of seconds — far
// past the point where showing the ordinary newest-first entry is the better
// answer. Same principle as CHAT_MAIN_ANCHOR_REVEAL_MAX_FRAMES: bound the wait,
// then degrade to the placement that always works.
const CHAT_MAIN_ANCHOR_LOOKUP_MAX_WAIT_MS = 600;
// Past CHAT_MAIN_ANCHOR_MAX_INITIAL_RENDER_COUNT the entry no longer renders the
// tail down to the divider — it WITHHOLDS the rows newer than the divider and
// opens on a window instead. These are the rows kept immediately newer than it,
// which fill the screen beneath the divider so a far-back entry looks identical
// to a near one. Everything newer is restored by scrolling toward the newest
// message, or at once from "Jump to latest".
const CHAT_MAIN_ANCHOR_WINDOW_LEAD_ROWS = 12;
const CHAT_MAIN_ANCHOR_WINDOW_EXPAND_ROWS = 30;
// Deliberately much larger than the 96px near-bottom threshold. Restoring rows
// adds them at index 0, which on an inverted list is the visual bottom, so the
// expansion has to happen while `maintainVisibleContentPosition` is still armed
// (that is, while NOT near-bottom) or the viewport jumps under the reader.
const CHAT_MAIN_ANCHOR_WINDOW_EXPAND_THRESHOLD = 600;
// Fill RATE, not retention. A fast fling used to outrun the renderer and leave
// bare background until it caught up, because rows are variable height: with no
// getItemLayout the list must render sequentially to discover where anything
// is, and 6 rows per 50ms is only ~120 rows/second. Raising the batch and
// shortening the interval fills roughly five times faster while the window
// below still governs how many rows are RETAINED, so peak mounted views are
// unchanged.
const CHAT_MAIN_MAX_RENDER_BATCH = 10;
const CHAT_MAIN_CELL_BATCHING_PERIOD_MS = 16;
// Runway, and the fling gaps are made of it. A window of 3 is one render-ahead
// viewport on either side, and a hard fling crosses that in ~200ms — less than
// the scroll-event → setState → render → Fabric commit → layout pipeline takes
// for a screen of these rows, so the reader outruns the renderer and lands on
// bare wallpaper until it catches up.
//
// Measured on device 2026-08-01 (Motorola Edge 70 Fusion, identical driven
// fling bursts, screenshots scored by how much of the message area is not bare
// wallpaper; a settled viewport reads ~25%):
//   window 3 → mean  8.4% content, 3 of 6 sampled frames essentially EMPTY
//   window 5 → mean 18.4% content, 1 of 12 sampled frames EMPTY  (12 samples)
//   window 7 → mean 21.3% content, 0 of 6 frames EMPTY
// Frame timing moves the other way — janky frames 9.2% / 13.4% / 21.6% and 90th
// percentile 31 / 44 / 48ms — so this is a trade, not a free win, and 5 is the
// point where full blanks stop without buying them with visible choppiness.
//
// The earlier bound of 3 was set against a window of NINE mounting every row in
// medium rooms (42 messages produced ~1,000 native views); 5 is well short of
// that, and repeated PSS/View sampling could not resolve a retention cost at
// this size above run-to-run noise.
//
// Raising this further is the wrong next move: the real cost is what a row
// costs to mount (a fling profile put ~12% of JS in Fabric node creation and
// ~9.5% in Reanimated worklet serialization). Make rows cheaper and the
// remaining gaps go without buying them back in jank.
const CHAT_MAIN_WINDOW_SIZE = 5;
// FlashList has no windowSize/maxToRenderPerBatch: it renders ahead by a pixel
// distance instead. ~2 phone viewports, chosen to match the runway that
// CHAT_MAIN_WINDOW_SIZE buys the FlatList engine so the two can be compared.
const CHAT_MAIN_FLASHLIST_PROPS = { drawDistance: 1600 };
const CHAT_MAIN_LOAD_OLDER_DEBOUNCE_MS = 650;
// Long press selects the row outright. Kept a touch shorter than the RN default
// of 500ms so selecting feels deliberate rather than slow, and long enough that
// a fling that starts with a stationary finger does not select on the way past.
const CHAT_ROW_LONG_PRESS_DELAY_MS = 300;
const CHAT_MAIN_OLDER_PAGE_PREFETCH_THRESHOLD = 0.55;
const CHAT_TEXT_SEND_MIC_GUARD_MS = 3_000;
// Inverted list: index 0 is the NEWEST message, at the visual bottom.
//
// Anchor the actual newest row. Physical burst traces showed that starting at
// index 1 preserved the previous row on every index-0 insertion, increasing the
// inverted content offset by one row until new sends were below the viewport.
// Index 0 keeps an already-following viewport at native offset zero. There is
// deliberately no autoscroll threshold: it previously introduced a second,
// animated placement after the optimistic row was already mounted.
const CHAT_MAIN_SCROLL_POSITION_CONFIG = {
  minIndexForVisible: 0
};
// Module-level: VirtualizedList rejects a viewabilityConfig whose identity
// changes after mount. minimumViewTime keeps a fast fling from reporting every
// row it passes as read.
const CHAT_MAIN_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 60,
  minimumViewTime: 150
};
const CHAT_TIMELINE_PROGRESSIVE_INITIAL_ROWS = 18;
const CHAT_TIMELINE_INITIAL_RENDER_COUNT = 18;
const CHAT_TIMELINE_MAX_RENDER_BATCH = 12;
const CHAT_TIMELINE_WINDOW_SIZE = 9;
const CHAT_TIMELINE_LOAD_OLDER_DEBOUNCE_MS = 650;
const CHAT_LATEST_BUTTON_OFFSET_THRESHOLD = 180;
// How far the pinned time hangs below the text's layout box so the visible
// line under the last text line cuts the time in half: half the time's 13px
// line height (~6.5) minus the ~3px of line-height slack the 22px text line
// already leaves below its glyphs.
const CHAT_TIME_PINNED_DROP = 3;
const CHAT_TIME_GAP = 8;
const CHAT_TIME_FONT_SIZE = 11;
const CHAT_TIME_SPACER_HEIGHT = 13 - CHAT_TIME_PINNED_DROP;
const MEMORY_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😋", "👏"] as const;
const MEDIA_GALLERY_INITIAL_RENDER_COUNT = 8;
const MEDIA_GALLERY_MAX_RENDER_BATCH = 8;
const MEDIA_GALLERY_PREFETCH_COUNT = 12;
const MEDIA_GALLERY_WINDOW_SIZE = 7;
// The Table pane is the tab the room OPENS on, so every view it builds is on
// the room-open path and every view it holds is on the back-exit path. It was
// a plain ScrollView mapping the whole stop list, which made both costs scale
// with the number of places in the memory rather than with what is on screen.
const ITINERARY_INITIAL_RENDER_COUNT = 4;
const ITINERARY_MAX_RENDER_BATCH = 4;
const ITINERARY_WINDOW_SIZE = 3;
const DISHES_INITIAL_RENDER_COUNT = 4;
const DISHES_MAX_RENDER_BATCH = 4;
const DISHES_WINDOW_SIZE = 3;
const MEDIA_VIEWER_MAX_RENDER_BATCH = 2;
const MEDIA_VIEWER_WINDOW_SIZE = 3;
type MediaPreviewSize = { height: number; width: number };
type MediaTimestampPlacement = "bottom-left" | "bottom-right";
type MessageGroupPosition = "single" | "first" | "middle" | "last";

let memoryChatLayoutGenerationSequence = 0;

function nextMemoryChatLayoutGeneration() {
  memoryChatLayoutGenerationSequence += 1;
  return memoryChatLayoutGenerationSequence;
}

// Returns a referentially-stable callback that always invokes the LATEST
// `handler` closure. Lets us pass the room screen's per-render handlers into
// memo()'d panes without their identity thrashing memo on every parent render,
// and without the stale-closure risk of hand-maintained useCallback dependency
// arrays. Safe because the ref is only read when the callback fires (a user
// event), never during render.
function useStableHandler<TArgs extends unknown[], TReturn>(handler: (...args: TArgs) => TReturn) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

function useImmediateDishRating(
  dishId: string,
  confirmedRating: number | null,
  onRateDish: (rating: number | null) => void
) {
  const visualRatingRef = useRef(confirmedRating);
  const [visualRating, setVisualRating] = useState(confirmedRating);

  useEffect(() => {
    visualRatingRef.current = confirmedRating;
    setVisualRating(confirmedRating);
  }, [confirmedRating, dishId]);

  const selectRating = useCallback((star: number) => {
    const nextRating = visualRatingRef.current === star ? null : star;
    visualRatingRef.current = nextRating;
    setVisualRating(nextRating);
    onRateDish(nextRating);
  }, [onRateDish]);

  return { selectRating, visualRating };
}

function effectiveRoomOccasionType(room: Pick<MemoryRoom, "occasionConfidence" | "occasionConfirmedByUser" | "occasionType">): OccasionType {
  if (room.occasionConfirmedByUser || room.occasionConfidence >= 0.85) return room.occasionType;
  return "unknown";
}

type AttachmentSheetView = "actions" | "dish" | "media";

function memoryActionKey(target: MemoryActionTarget) {
  return `${target.type}:${target.value.id}`;
}

function findMemoryActionTarget(data: MemoryRoom, key: string): MemoryActionTarget | null {
  if (key.startsWith("dish:")) {
    const id = key.replace("dish:", "");
    const dish = data.dishes.find((item) => item.id === id);
    return dish ? { type: "dish", value: dish } : null;
  }

  if (key.startsWith("message:")) {
    const id = key.replace("message:", "");
    const message = data.messages.find((item) => item.id === id);
    return message ? { type: "message", value: message } : null;
  }

  if (key.startsWith("photo:")) {
    const id = key.replace("photo:", "");
    const photo = data.photos.find((item) => item.id === id);
    return photo ? { type: "photo", value: photo } : null;
  }

  return null;
}

function timeValue(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sameUsername(first: string, second: string) {
  return first.trim().toLowerCase() === second.trim().toLowerCase();
}

function unreadChatMessageCount(room: MemoryRoom, myUsername: string) {
  const lastReadTime = room.lastReadAt ? timeValue(room.lastReadAt) : 0;
  return room.messages.filter((message) => (
    timeValue(message.createdAt) > lastReadTime &&
    !sameUsername(message.authorName, myUsername)
  )).length;
}

function isVisibleMemoryMessage(message: MemoryMessage) {
  return Boolean(message.body.trim()) || message.attachments.length > 0;
}

function firstUnreadMemoryMessageId(messages: MemoryMessage[], lastReadAt: string | null, myUsername: string) {
  const lastReadTime = lastReadAt ? timeValue(lastReadAt) : 0;
  return [...messages]
    .filter(isVisibleMemoryMessage)
    .sort(compareMemoryMessages)
    .find((message) => (
      timeValue(message.createdAt) > lastReadTime &&
      !sameUsername(message.authorName, myUsername)
    ))?.id ?? null;
}

function mergeMemoryMessages(...groups: MemoryMessage[][]) {
  let messages: MemoryMessage[] = [];
  for (const group of groups) {
    messages = mergeMemoryMessageSnapshot(messages, group);
  }
  return messages;
}

function photosFromMessages(messages: MemoryMessage[]) {
  return messages.flatMap((message) => message.attachments);
}


function mergeMemoryPhotos(...groups: MemoryPhoto[][]) {
  const byId = new Map<string, MemoryPhoto>();
  for (const group of groups) {
    for (const photo of group) byId.set(photo.id, photo);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const dateSort = timeValue(b.createdAt) - timeValue(a.createdAt);
    return dateSort || a.position - b.position;
  });
}

function mergeRoomMessages(room: MemoryRoom, olderMessages: MemoryMessage[]): MemoryRoom {
  if (olderMessages.length === 0) return room;
  const messages = mergeMemoryMessages(olderMessages, room.messages);
  return {
    ...room,
    messages,
    photos: mergeMemoryPhotos(room.photos, photosFromMessages(olderMessages))
  };
}

function errorMessage(error: unknown) {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  return String(error);
}

function memoryChatUser(username: string, displayName: string) {
  // No avatar URL is available on room data, so the vendor falls back to its
  // initials circle for received messages; own messages show a bubble tail
  // instead (isUserAvatarVisible={false} hides the own-side avatar).
  return {
    _id: username || displayName || "unknown",
    name: displayName || username || "Unknown"
  };
}

function memoryMediaKind(media: MemoryPhoto | null | undefined) {
  return media?.mediaType === "audio" ? "audio" : media?.mediaType === "video" ? "video" : "image";
}

function memoryMediaLabel(media: MemoryPhoto | null | undefined) {
  const kind = memoryMediaKind(media);
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "photo";
}

function memoryMediaOpenLabel(media: MemoryPhoto | null | undefined) {
  return `Open ${memoryMediaLabel(media)}`;
}

function memoryChatIsAudioMedia(media: MemoryPhoto | null | undefined) {
  return memoryMediaKind(media) === "audio";
}

function memoryChatPrimaryAudio(message: MemoryMessage) {
  return message.attachments.find((attachment) => memoryChatIsAudioMedia(attachment)) ?? null;
}

function memoryChatPrimaryVisualMedia(message: MemoryMessage) {
  return message.attachments.find((attachment) => !memoryChatIsAudioMedia(attachment)) ?? null;
}

function memoryChatReplyMessage(message: MemoryMessage): ChatMainReplyMessage {
  const primaryAudio = memoryChatPrimaryAudio(message);
  const primaryImage = message.attachments.find((attachment) => memoryMediaKind(attachment) === "image");

  return {
    _id: message.id,
    audio: memoryChatMediaUrl(primaryAudio),
    text: message.body.trim() || (primaryAudio ? "Audio" : message.attachments.length > 0 ? "Media" : "Message"),
    user: memoryChatUser(message.authorName, message.authorDisplayName),
    image: memoryChatMediaUrl(primaryImage)
  };
}

function memoryChatReactionsForMessage(messageId: string, reactions: MemoryReactionState): ChatMainMessageReaction[] {
  return Object.entries(reactions[messageId] ?? {})
    .filter(([, userIds]) => userIds.length > 0)
    .map(([emoji, userIds]) => ({ emoji, userIds }));
}

function memoryChatMediaUrl(media: MemoryPhoto | null | undefined) {
  return media?.publicUrl ?? undefined;
}

function memoryMediaNeedsStatusOverlay(media: MemoryPhoto) {
  return isOptimisticMemoryMedia(media) || Boolean(
    media.processingStatus && media.processingStatus !== "ready"
  );
}

function memoryMediaHasVisual(media: MemoryPhoto) {
  return Boolean(media.posterUrl || media.thumbnailUrl || media.publicUrl);
}

const memoryMediaRenderTelemetrySeen = new Set<string>();
registerSensitiveResourceCleanup(() => memoryMediaRenderTelemetrySeen.clear());

function useMemoryMediaRenderTelemetry(media: MemoryPhoto, surface: "chat" | "media") {
  const profile = useSessionStore((state) => state.profile);
  const hasVisual = memoryMediaHasVisual(media);
  const status = media.processingStatus ?? null;
  const viewerRole = profile && (
    media.uploaderId === profile.userId || media.uploaderName === profile.username
  ) ? "sender" : "recipient";

  useEffect(() => {
    if (!hasVisual || !status || !["uploaded", "processing", "ready"].includes(status)) return;
    const createdAt = Date.parse(media.createdAt);
    if (!Number.isFinite(createdAt)) return;
    const durationMs = Math.max(0, Date.now() - createdAt);
    const usableKey = `${media.id}:${viewerRole}:usable`;
    if (!memoryMediaRenderTelemetrySeen.has(usableKey)) {
      memoryMediaRenderTelemetrySeen.add(usableKey);
      recordMobileFlow("memory.media_usable_render", durationMs, "success", {
        media_kind: memoryMediaKind(media),
        processing_status: status,
        surface,
        viewer_role: viewerRole
      });
    }
    if (status === "ready") {
      const finalKey = `${media.id}:${viewerRole}:final`;
      if (!memoryMediaRenderTelemetrySeen.has(finalKey)) {
        memoryMediaRenderTelemetrySeen.add(finalKey);
        recordMobileFlow("memory.media_final_render", durationMs, "success", {
          media_kind: memoryMediaKind(media),
          surface,
          viewer_role: viewerRole
        });
      }
    }
  }, [hasVisual, media.createdAt, media.id, media.mediaType, status, surface, viewerRole]);
}

function memoryChatMessageAttachments(message: MemoryChatMainMessage | undefined): MemoryPhoto[] {
  if (!message) return [];
  if (message.memoryMessage) return message.memoryMessage.attachments.filter((attachment) => !memoryChatIsAudioMedia(attachment));
  if (message.memoryPhoto && !memoryChatIsAudioMedia(message.memoryPhoto)) return [message.memoryPhoto];
  return [];
}

function memoryChatAudioAttachment(message: MemoryChatMainMessage | undefined): MemoryPhoto | null {
  if (!message) return null;
  if (message.memoryMessage) return memoryChatPrimaryAudio(message.memoryMessage);
  if (message.memoryPhoto && memoryChatIsAudioMedia(message.memoryPhoto)) return message.memoryPhoto;
  return null;
}

// FlashList reuses a row instance for the next item of the SAME type, so this
// has to separate rows whose subtree SHAPE differs — not merely their content.
// A text row recycled into a media row would have to build the whole media
// subtree anyway (losing the point of recycling) and would briefly reconcile a
// mismatched tree; splitting by side as well keeps a tail, sender header and
// bubble alignment stable within a pool, which is where the reuse pays.
function memoryChatItemType(
  message: MemoryChatMainMessage | undefined,
  currentUserId: string
): string {
  if (!message) return "text";
  if (message.memoryDish) return "dish";
  if (message.system) return "system";
  const side = String(message.user?._id ?? "") === currentUserId ? "mine" : "other";
  if (memoryChatAudioAttachment(message)) return `audio-${side}`;
  const attachments = memoryChatMessageAttachments(message);
  if (attachments.length > 1) return `media-grid-${side}`;
  if (attachments.length === 1) return `media-one-${side}`;
  if (message.replyMessage) return `reply-${side}`;
  return `text-${side}`;
}

function memoryChatActionTarget(message: MemoryChatMainMessage | undefined): MemoryActionTarget | null {
  if (!message) return null;
  if (message.memoryDish) return { type: "dish", value: message.memoryDish };
  if (message.memoryMessage) return { type: "message", value: message.memoryMessage };
  if (message.memoryPhoto) return { type: "photo", value: message.memoryPhoto };
  return null;
}

// A reply is stored as reply_to_message_id, so its target has to exist on the
// server. A pending or failed send only has a local optimistic id
// (`optimistic-message:…`), which would be sent verbatim and dangle — or
// violate the foreign key — the moment the reply itself went out.
function canReplyToMemoryMessage(message: MemoryMessage) {
  return Boolean(memoryMessageServerId(message)) && message.deliveryStatus === "sent";
}

function memoryDishReplyTarget(dish: MemoryDish): MemoryMessage {
  return {
    attachments: [],
    authorDisplayName: dish.addedByDisplayName,
    authorName: dish.addedBy,
    body: `Dish: ${dish.dishName}`,
    clientCreatedAt: dish.createdAt,
    clientId: null,
    clientOrderKey: `dish:${dish.createdAt}:${dish.id}`,
    clientSequence: null,
    createdAt: dish.createdAt,
    deliveryStatus: "sent",
    editedAt: null,
    id: dish.id,
    replyToMessage: null,
    replyToMessageId: null,
    roomId: dish.roomId,
    serverCreatedAt: dish.createdAt,
    serverId: dish.id
  };
}

function canEditMemoryMessage(message: MemoryMessage, myUsername: string) {
  return (
    message.authorName === myUsername &&
    message.body.trim().length > 0 &&
    message.attachments.length === 0 &&
    message.deliveryStatus === "sent"
  );
}

// Delete is a server operation and needs a landed message; discard is the local
// counterpart for one that never got there. Without it an upload stuck at
// "Uploading" is unrecoverable from the UI: the recovery pill deliberately does
// not render for in-progress states, and Delete below refuses anything that is
// not `sent`, so the row could be neither cancelled nor removed.
function canDiscardMemoryMessage(message: MemoryMessage, myUsername: string) {
  return (
    message.authorName === myUsername &&
    !memoryMessageServerId(message) &&
    message.deliveryStatus !== undefined &&
    message.deliveryStatus !== "sent"
  );
}

function canDeleteMemoryActionTarget(target: MemoryActionTarget, myUsername: string) {
  if (target.type === "dish") return sameUsername(target.value.addedBy, myUsername);
  if (target.type === "message") {
    return (
      target.value.authorName === myUsername &&
      target.value.deliveryStatus === "sent"
    );
  }
  return target.value.uploaderName === myUsername;
}

// Only outcomes a person has to act on. In-progress states — `uploading`,
// `processing`, `processing_delayed` — deliberately render nothing here: the
// media tile already carries the progress ring and its "Uploading" label, and
// an upload flips to `processing` at 90% (updateOptimisticProgress in
// useMemories), so a perfectly healthy send used to grow a red, danger-bordered
// failure pill under a bubble whose own tile still said it was uploading.
function hasMemoryDeliveryStrip(status: MemoryMessage["deliveryStatus"]) {
  return status === "failed" ||
    status === "failed_retryable" ||
    status === "failed_permanent" ||
    status === "processing_failed" ||
    status === "rejected";
}

function canRetryMemoryDelivery(status: MemoryMessage["deliveryStatus"]) {
  return status === "failed" || status === "failed_retryable" || status === "processing_failed";
}

// Same grouping rule the vendor uses for corner rounding: consecutive
// messages from the same user on the same day form one visual run.
function memoryChatIsGroupedToPrevious(
  current: MemoryChatMainMessage | undefined,
  previous: MemoryChatMainMessage | undefined
) {
  // A system row (dish card, unread divider) ends the visual run even when the
  // same person is on both sides of it. Dish rows carry their adder as `user`,
  // so without this a message right after your own dish card matched on user +
  // day and lost its tail, hugging a card it was never part of — while
  // `showSenderDetails` in buildMemoryChatMainMessages already treated a dish
  // as a break, leaving the two grouping rules disagreeing with each other.
  if (current?.system || previous?.system) return false;
  return Boolean(
    current && previous?.user && previous.user._id === current.user._id &&
    previous.createdAt && current.createdAt &&
    new Date(current.createdAt).toDateString() === new Date(previous.createdAt).toDateString()
  );
}

// Widest a media block can be and still fit inside its bubble: screen minus
// list padding, the vendor's 8px row margin, bubble border + media frame
// insets (8), and the 36px avatar column with its 8px gap on received rows
// (kept symmetric so sent and received media render at the same size).
function memoryChatMediaWidthBudget(screenWidth: number) {
  return Math.max(120, Math.floor(screenWidth - CHAT_ROW_SIDE_PADDING * 2 - 60));
}

function memoryChatSingleMediaSize(media: MemoryPhoto, screenWidth: number): MediaPreviewSize {
  const size = getSingleMediaPreviewSize({
    imageHeight: media.imageHeight,
    imageWidth: media.imageWidth,
    screenWidth
  });
  const budget = memoryChatMediaWidthBudget(screenWidth);
  if (size.width <= budget) return size;
  return {
    height: Math.max(1, Math.round((size.height * budget) / size.width)),
    width: budget
  };
}

function memoryChatGridWidth(screenWidth: number) {
  return Math.min(getMultiMediaGridWidth(screenWidth), memoryChatMediaWidthBudget(screenWidth));
}

function memoryChatTimestampLabel(message: MemoryChatMainMessage) {
  if (message.memoryMessage) return getMessageTimestampLabel(message.memoryMessage);
  if (!message.createdAt) return "";
  const value = message.createdAt instanceof Date ? message.createdAt.toISOString() : String(message.createdAt);
  return formatDisplayTime(value);
}

function buildMemoryChatMainMessageRow({
  message,
  reactions,
  showSenderDetails
}: {
  message: MemoryMessage;
  reactions: MemoryReactionState;
  showSenderDetails: boolean;
}): MemoryChatMainMessage {
  const primaryAudio = memoryChatPrimaryAudio(message);
  const primaryMedia = memoryChatPrimaryVisualMedia(message);
  const primaryAudioUrl = memoryChatMediaUrl(primaryAudio);
  const primaryMediaUrl = memoryChatMediaUrl(primaryMedia);

  return {
    // Not message.id: an own send changes id when it reconciles, and the list
    // keys on _id. The stable client key keeps the native row mounted.
    _id: memoryChatRowKey(message),
    audio: primaryAudioUrl,
    createdAt: new Date(message.createdAt),
    extraAttachments: message.attachments.slice(1),
    image: memoryMediaKind(primaryMedia) === "image" ? primaryMediaUrl : undefined,
    kind: "message",
    memoryMessage: message,
    reactions: memoryChatReactionsForMessage(message.id, reactions),
    replyMessage: message.replyToMessage
      ? {
        _id: message.replyToMessage.id,
        text: message.replyToMessage.body || "Message",
        user: memoryChatUser(
          message.replyToMessage.authorDisplayName,
          message.replyToMessage.authorDisplayName
        )
      }
      : undefined,
    showSenderDetails,
    streaming: (
      message.deliveryStatus === "pending" ||
      message.deliveryStatus === "retrying" ||
      message.deliveryStatus === "uploading" ||
      message.deliveryStatus === "processing" ||
      message.deliveryStatus === "processing_delayed"
    ),
    text: message.body.trim(),
    user: memoryChatUser(message.authorName, message.authorDisplayName),
    video: memoryMediaKind(primaryMedia) === "video" ? primaryMediaUrl : undefined
  };
}

function buildMemoryChatMainMessages({
  data,
  myUsername,
  reactions,
  unreadAnchorMessageId
}: {
  data: MemoryRoom;
  myUsername: string;
  reactions: MemoryReactionState;
  unreadAnchorMessageId?: string | null;
}): MemoryChatMainMessage[] {
  const timeline: TimelineItem[] = [
    ...data.messages.map((message): TimelineItem => ({
      createdAt: message.createdAt,
      id: `message:${message.id}`,
      type: "message",
      value: message
    })),
    ...data.photos.filter((photo) => !photo.messageId).map((photo): TimelineItem => ({
      createdAt: photo.createdAt,
      id: `media:${photo.id}`,
      type: "media",
      value: photo
    })),
    ...data.dishes.map((dish): TimelineItem => ({
      createdAt: dish.createdAt,
      id: `dish:${dish.id}`,
      type: "dish",
      value: dish
    }))
  ];

  // Sorted newest-first for the inverted chat list, so the chronologically
  // previous item (used for sender grouping) is the NEXT array entry.
  // Rows with nothing to show (whitespace-only bodies from old data, photos
  // without any URL) would render as empty bubble shells — drop them before
  // grouping so sender headers don't anchor to invisible rows.
  const sorted = timeline
    .sort((a, b) => {
      if (a.type === "message" && b.type === "message") {
        return -compareMemoryMessages(a.value, b.value);
      }
      return timeValue(b.createdAt) - timeValue(a.createdAt) || b.id.localeCompare(a.id);
    })
    .filter((item) => {
      if (item.type === "message") return Boolean(item.value.body.trim()) || item.value.attachments.length > 0;
      if (item.type === "media") return Boolean(item.value.publicUrl);
      return true;
    });

  const messages = sorted
    .map((item, index): MemoryChatMainMessage => {
      const senderUsername = getTimelineSenderUsername(item);
      const mine = senderUsername === myUsername;
      const previousItem = sorted[index + 1] ?? null;
      const showSenderDetails = !mine && (
        !previousItem ||
        previousItem.type === "dish" ||
        getTimelineSenderUsername(previousItem) !== senderUsername ||
        getTimelineDateKey(previousItem) !== getTimelineDateKey(item)
      );

      if (item.type === "message") {
        return buildMemoryChatMainMessageRow({
          message: item.value,
          reactions,
          showSenderDetails
        });
      }

      if (item.type === "media") {
        const media = item.value;
        const mediaUrl = memoryChatMediaUrl(media);
        return {
          _id: `media:${media.id}`,
          audio: memoryMediaKind(media) === "audio" ? mediaUrl : undefined,
          createdAt: new Date(media.createdAt),
          image: memoryMediaKind(media) === "image" ? mediaUrl : undefined,
          kind: "media",
          memoryPhoto: media,
          showSenderDetails,
          text: "",
          user: memoryChatUser(media.uploaderName, media.uploaderDisplayName),
          video: memoryMediaKind(media) === "video" ? mediaUrl : undefined
        };
      }

      const dish = item.value;
      return {
        _id: `dish:${dish.id}`,
        createdAt: new Date(dish.createdAt),
        kind: "dish",
        memoryDish: dish,
        showSenderDetails,
        system: true,
        text: `${dish.addedByDisplayName} added ${dish.dishName}`,
        user: memoryChatUser(dish.addedBy, dish.addedByDisplayName)
      };
    });

  if (unreadAnchorMessageId) {
    const anchorIndex = messages.findIndex((message) => message.memoryMessage?.id === unreadAnchorMessageId);
    if (anchorIndex >= 0) {
      const anchorMessage = messages[anchorIndex];
      // Sender details were resolved before the divider existed, against the
      // message that now sits on its far side. The divider is a visual break
      // like any other, so the first unread message has to reintroduce its
      // sender rather than read as a continuation across it.
      if (anchorMessage.memoryMessage && anchorMessage.memoryMessage.authorName !== myUsername) {
        messages[anchorIndex] = { ...anchorMessage, showSenderDetails: true };
      }
      messages.splice(anchorIndex + 1, 0, {
        _id: `unread:${unreadAnchorMessageId}`,
        createdAt: anchorMessage.createdAt,
        kind: "unread",
        system: true,
        text: "Unread messages",
        user: { _id: "system" }
      });
    }
  }

  return messages;
}

function MemoryChatPlacementRow({
  children,
  clientId,
  deliveryStatus,
  layoutGeneration,
  onLongPress,
  onPress,
  renderIndex,
  rowKey,
  style
}: {
  children: ReactNode;
  clientId?: string | null;
  deliveryStatus?: MemoryMessage["deliveryStatus"];
  layoutGeneration: number;
  onLongPress?: () => void;
  onPress?: () => void;
  renderIndex?: number;
  rowKey: string;
  style: StyleProp<ViewStyle>;
}) {
  const rowRef = useRef<View>(null);
  const geometrySamplingFrameRef = useRef<number | null>(null);
  const geometrySamplingStartedRef = useRef(false);
  const firstLayoutRecordedRef = useRef(false);
  const lastRoundedGeometryRef = useRef<{
    bottom: number;
    height: number;
    top: number;
  } | null>(null);
  const initialPlacementRef = useRef({
    deliveryStatus,
    layoutGeneration,
    renderIndex,
    rowKey
  });

  useEffect(() => {
    if (!clientId) return;
    recordMemoryChatPlacement("ROW_MOUNTED", {
      clientId,
      deliveryStatus: initialPlacementRef.current.deliveryStatus,
      renderIndex: initialPlacementRef.current.renderIndex
    });
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    recordMemoryChatPlacement("ROW_RENDERED", {
      clientId,
      deliveryStatus,
      renderIndex
    });
  }, [clientId, deliveryStatus, renderIndex]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { height, y } = event.nativeEvent.layout;
    if (clientId) {
      recordMemoryChatPlacement("ROW_LAYOUT", {
        clientId,
        deliveryStatus,
        renderIndex,
        rowBottom: y + height,
        rowHeight: height,
        rowTop: y
      });
      if (!firstLayoutRecordedRef.current) {
        firstLayoutRecordedRef.current = true;
        recordMemoryChatPlacement("ROW_FIRST_LAYOUT", {
          clientId,
          deliveryStatus,
          renderIndex,
          rowBottom: y + height,
          rowHeight: height,
          rowTop: y
        });
      }
    }
    if (
      !memoryChatPlacementDiagnosticsEnabled() ||
      geometrySamplingStartedRef.current ||
      renderIndex === undefined ||
      renderIndex < 0 ||
      renderIndex >= CHAT_MAIN_INITIAL_RENDER_COUNT
    ) {
      return;
    }
    geometrySamplingStartedRef.current = true;
    const owner = initialPlacementRef.current;
    const pixelRatio = PixelRatio.get();
    const startedAt = performance.now();
    let auditFrame = 0;
    const sampleGeometry = () => {
      rowRef.current?.measureInWindow((_x, windowY, _width, windowHeight) => {
        if (
          owner.layoutGeneration !== layoutGeneration ||
          owner.rowKey !== rowKey
        ) {
          return;
        }
        const rounded = {
          bottom: Math.round((windowY + windowHeight) * pixelRatio),
          height: Math.round(windowHeight * pixelRatio),
          top: Math.round(windowY * pixelRatio)
        };
        const previous = lastRoundedGeometryRef.current;
        if (!previous) {
          recordMemoryChatPlacement("CHAT_ROW_FIRST_LAYOUT", {
            framesToStable: auditFrame,
            layoutGeneration,
            renderIndex,
            rowBottom: windowY + windowHeight,
            rowHeight: windowHeight,
            rowKey,
            rowTop: windowY
          });
        } else if (
          previous.bottom !== rounded.bottom ||
          previous.height !== rounded.height ||
          previous.top !== rounded.top
        ) {
          recordMemoryChatPlacement("CHAT_ROW_LAYOUT_CHANGED", {
            framesToStable: auditFrame,
            layoutGeneration,
            renderIndex,
            rowBottom: windowY + windowHeight,
            rowHeight: windowHeight,
            rowKey,
            rowTop: windowY
          });
        }
        lastRoundedGeometryRef.current = rounded;
      });
      auditFrame += 1;
      if (performance.now() - startedAt < 800) {
        geometrySamplingFrameRef.current = requestAnimationFrame(sampleGeometry);
      } else {
        geometrySamplingFrameRef.current = null;
      }
    };
    geometrySamplingFrameRef.current = requestAnimationFrame(sampleGeometry);
  }, [clientId, deliveryStatus, layoutGeneration, renderIndex, rowKey]);

  useEffect(() => () => {
    if (geometrySamplingFrameRef.current !== null) {
      cancelAnimationFrame(geometrySamplingFrameRef.current);
      geometrySamplingFrameRef.current = null;
    }
  }, []);

  // The row is the press surface, not the bubble: a long press has to work on
  // the empty space beside a bubble too, which is outside the vendor's Message
  // container (it hugs its content and aligns to one edge). The bubble's own
  // Pressable is suppressed for the same reason — see the vendored Bubble.
  // Attaching onLayout makes RN deliver a layout event for EVERY row, and the
  // handler exists only to feed placement diagnostics whose recorders already
  // early-return when profiling is off. Passing undefined instead means no
  // listener is attached at all. It cannot affect layout — nothing reads the
  // callback's result but the diagnostics.
  const placementDiagnosticsOn = memoryChatPlacementDiagnosticsEnabled();

  return (
    <Pressable
      // Pressable defaults `accessible` to true, which would merge the whole
      // row into ONE accessibility node — swallowing the message text and,
      // worse, the Retry/Cancel buttons a failed send hangs below the bubble.
      // The row is a gesture surface, not a control; its children keep the
      // nodes they already had.
      accessible={false}
      delayLongPress={CHAT_ROW_LONG_PRESS_DELAY_MS}
      onLayout={placementDiagnosticsOn ? handleLayout : undefined}
      onLongPress={onLongPress}
      onPress={onPress}
      ref={rowRef}
      style={style}
    >
      {children}
    </Pressable>
  );
}

function useMemoryJourneySurfaceDiagnostics(
  journeySession: MemoryRoomJourneySession,
  tab: RoomTabMode,
  surface: string,
  deferUsable = false
) {
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "SURFACE_RENDER", { surface, tab });
  });
  useEffect(() => {
    recordMemoryRoomSurfaceLifecycle(tab, "mounted");
    recordMemoryRoomJourney(journeySession, "SURFACE_MOUNT", { surface, tab });
    const usableFrame = deferUsable
      ? null
      : requestAnimationFrame(() => {
        markMemoryRoomSurfaceUsable(tab);
        recordMemoryRoomJourney(journeySession, "TAB_USABLE", {
          screenState: "usable",
          surface,
          tab
        });
      });
    return () => {
      if (usableFrame !== null) cancelAnimationFrame(usableFrame);
      recordMemoryRoomSurfaceLifecycle(tab, "unmounted");
      recordMemoryRoomJourney(journeySession, "SURFACE_UNMOUNT", { surface, tab });
    };
  }, [deferUsable, journeySession, surface, tab]);
}

function MemoryJourneyRenderProbe({
  journeySession,
  surface,
  tab
}: {
  journeySession: MemoryRoomJourneySession;
  surface: string;
  tab: RoomTabMode;
}) {
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "SURFACE_RENDER", { surface, tab });
  });
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "SURFACE_MOUNT", { surface, tab });
    const releaseProfileCounter =
      surface === "chat_row"
        ? adjustMemoryRoomResourceCounter("MemoryRoomMountedChatRows", 1)
        : surface === "dish_row"
          ? adjustMemoryRoomResourceCounter("MemoryRoomMountedDishRows", 1)
          : surface === "media_tile"
            ? adjustMemoryRoomResourceCounter("MemoryRoomMountedMediaTiles", 1)
            : null;
    return () => {
      releaseProfileCounter?.();
      recordMemoryRoomJourney(journeySession, "SURFACE_UNMOUNT", { surface, tab });
    };
  }, [journeySession, surface, tab]);
  return null;
}

function useMemoryJourneyScrollDiagnostics(
  journeySession: MemoryRoomJourneySession,
  tab: RoomTabMode,
  onOffsetChange?: (offset: number) => void
) {
  const scrollingRef = useRef(false);
  const begin = useCallback(() => {
    if (scrollingRef.current) return;
    scrollingRef.current = true;
    recordMemoryRoomJourney(journeySession, "LIST_SCROLL_STARTED", { tab });
  }, [journeySession, tab]);
  const settle = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onOffsetChange?.(event.nativeEvent.contentOffset.y);
    if (!scrollingRef.current) return;
    scrollingRef.current = false;
    recordMemoryRoomJourney(journeySession, "LIST_SCROLL_SETTLED", {
      contentHeight: event.nativeEvent.contentSize.height,
      contentOffset: event.nativeEvent.contentOffset.y,
      contentWidth: event.nativeEvent.contentSize.width,
      tab,
      viewportHeight: event.nativeEvent.layoutMeasurement.height,
      viewportWidth: event.nativeEvent.layoutMeasurement.width
    });
  }, [journeySession, onOffsetChange, tab]);
  const capture = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onOffsetChange?.(event.nativeEvent.contentOffset.y);
  }, [onOffsetChange]);
  return { begin, capture, settle };
}

const LITE_CHAT_REPLY_TRIGGER_DISTANCE = 54;
const LITE_CHAT_REPLY_VERTICAL_TOLERANCE = 4;

const LiteChatTextRow = memo(function LiteChatTextRow({
  canReply,
  index,
  journeySession,
  onReply,
  onCancelFailed,
  onRetryFailed,
  onSelect,
  onToggleSelection,
  row,
  selected,
  selectionMode
}: {
  canReply: boolean;
  index: number;
  journeySession: MemoryRoomJourneySession;
  onReply: (key: string) => void;
  onCancelFailed: (key: string) => void;
  onRetryFailed: (key: string) => void;
  onSelect: (key: string) => void;
  onToggleSelection: (key: string) => void;
  row: ChatRowViewModel;
  selected: boolean;
  selectionMode: boolean;
}) {
  const initialPlacementRef = useRef({
    deliveryStatus: row.deliveryState,
    renderIndex: index
  });
  const mine = row.direction === "outgoing";
  const replyVisible = row.replyPreview !== null;

  useEffect(() => {
    const releaseText = adjustMemoryRoomResourceCounter(
      replyVisible
        ? "MemoryRoomMountedChatReplyRows"
        : "MemoryRoomMountedChatTextRows",
      1
    );
    const releaseGesture = adjustMemoryRoomResourceCounter(
      "MemoryRoomMountedChatGestureOwners",
      1
    );
    if (row.clientId) {
      recordMemoryChatPlacement("ROW_MOUNTED", {
        clientId: row.clientId,
        deliveryStatus: initialPlacementRef.current.deliveryStatus,
        renderIndex: initialPlacementRef.current.renderIndex
      });
    }
    return () => {
      releaseGesture();
      releaseText();
    };
  }, [replyVisible, row.clientId]);

  useEffect(() => {
    if (!row.clientId) return;
    recordMemoryChatPlacement("ROW_RENDERED", {
      clientId: row.clientId,
      deliveryStatus: row.deliveryState,
      renderIndex: index
    });
  }, [index, row.clientId, row.deliveryState]);

  const triggerReply = useCallback(() => {
    onReply(row.key);
  }, [onReply, row.key]);

  const replyGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canReply && !selectionMode)
        .activeOffsetX(LITE_CHAT_REPLY_TRIGGER_DISTANCE / 2)
        .failOffsetY([
          -LITE_CHAT_REPLY_VERTICAL_TOLERANCE,
          LITE_CHAT_REPLY_VERTICAL_TOLERANCE
        ])
        .onFinalize((event) => {
          if (
            event.translationX >= LITE_CHAT_REPLY_TRIGGER_DISTANCE &&
            event.translationX > Math.abs(event.translationY) * 1.5
          ) {
            runOnJS(triggerReply)();
          }
        }),
    [canReply, selectionMode, triggerReply]
  );

  const handleLongPress = useCallback(() => {
    if (selectionMode) {
      onToggleSelection(row.key);
      return;
    }
    onSelect(row.key);
  }, [onSelect, onToggleSelection, row.key, selectionMode]);

  const handlePress = useCallback(() => {
    if (selectionMode) onToggleSelection(row.key);
  }, [onToggleSelection, row.key, selectionMode]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!row.clientId) return;
      const { height, y } = event.nativeEvent.layout;
      recordMemoryChatPlacement("ROW_LAYOUT", {
        clientId: row.clientId,
        deliveryStatus: row.deliveryState,
        renderIndex: index,
        rowBottom: y + height,
        rowHeight: height,
        rowTop: y
      });
    },
    [index, row.clientId, row.deliveryState]
  );

  const deliveryLabel =
    row.deliveryState === "pending" || row.deliveryState === "uploading"
      ? " sending"
      : row.deliveryState === "retrying"
        ? " retrying"
        : row.deliveryState === "failed"
          ? " failed"
          : mine
            ? " sent"
            : "";
  const accessibilityActions = useMemo(
    () => [
      ...(canReply && !selectionMode
        ? [{ label: "Reply", name: "reply" as const }]
        : []),
      {
        label: selectionMode ? "Toggle selection" : "Select message",
        name: "activate" as const
      }
    ],
    [canReply, selectionMode]
  );

  return (
    <View
      onLayout={handleLayout}
      style={[
        styles.liteChatRow,
        mine ? styles.liteChatRowMine : styles.liteChatRowOther,
        row.grouping.spacing === "grouped"
          ? styles.liteChatRowGrouped
          : styles.liteChatRowBreak,
        selected && styles.chatMainRowSelectedBackground
      ]}
    >
      <MemoryJourneyRenderProbe
        journeySession={journeySession}
        surface="chat_row"
        tab="chat"
      />
      <GestureDetector gesture={replyGesture} touchAction="pan-y">
        <Pressable
          accessibilityActions={accessibilityActions}
          accessibilityLabel={`${row.senderLabel || (mine ? "You" : "Message")}: ${row.body}${deliveryLabel}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          delayLongPress={CHAT_ROW_LONG_PRESS_DELAY_MS}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "reply" && canReply) {
              triggerReply();
              return;
            }
            handleLongPress();
          }}
          onLongPress={handleLongPress}
          onPress={handlePress}
          style={[
            styles.liteChatBubble,
            mine ? styles.liteChatBubbleMine : styles.liteChatBubbleOther,
            row.grouping.showTail &&
              (mine
                ? styles.liteChatBubbleMineWithTail
                : styles.liteChatBubbleOtherWithTail)
          ]}
        >
          {row.grouping.showTail ? (
            <View
              pointerEvents="none"
              style={[
                styles.liteChatTail,
                mine ? styles.liteChatTailMine : styles.liteChatTailOther
              ]}
            />
          ) : null}
          {!mine && row.grouping.showSender ? (
            <Text
              numberOfLines={1}
              style={[
                styles.liteChatSender,
                { color: senderAccent(row.senderLabel) }
              ]}
            >
              {row.senderLabel}
            </Text>
          ) : null}
          {row.replyPreview ? (
            <ReplyPreviewBlock
              author={row.replyPreview.authorLabel}
              body={row.replyPreview.body}
              mine={mine}
              style={styles.liteChatReplyPreview}
            />
          ) : null}
          <Text
            android_hyphenationFrequency="none"
            style={[
              styles.liteChatBody,
              mine ? styles.messageTextMine : styles.messageTextOther
            ]}
            textBreakStrategy="simple"
          >
            <SmartMessageTextContent
              linkStyle={
                mine ? styles.messageLinkTextMine : styles.messageLinkText
              }
              text={row.body}
              textStyle={[
                styles.liteChatBody,
                mine ? styles.messageTextMine : styles.messageTextOther
              ]}
            />
            <Text
              style={[
                styles.liteChatInlineMeta,
                mine
                  ? styles.inlineTimestampMine
                  : styles.inlineTimestampOther,
                row.deliveryState === "failed" && styles.liteChatInlineMetaFailed
              ]}
            >
              {`  ${row.timestampLabel}${
                row.deliveryState === "pending" ||
                row.deliveryState === "uploading"
                  ? " ◷"
                  : row.deliveryState === "retrying"
                    ? " ↻"
                    : mine && row.deliveryState === "sent"
                      ? " ✓"
                      : row.deliveryState === "failed"
                        ? " !"
                        : ""
              }`}
            </Text>
          </Text>
        </Pressable>
      </GestureDetector>
      {row.deliveryState === "failed" ? (
        <View
          style={[
            styles.chatMainFailedRow,
            mine && styles.liteChatFailedRowMine
          ]}
        >
          <MessageDeliveryState
            mine={mine}
            onCancel={() => onCancelFailed(row.key)}
            onRetry={() => onRetryFailed(row.key)}
            status="failed"
          />
        </View>
      ) : null}
    </View>
  );
});

// Module-level so the identity is stable: passing an inline arrow to the
// vendored Bubble would churn its `props` object (and therefore its memoised
// render callbacks) on every row render.
const renderNoBubbleBottom = () => null;

const LiteChatSystemRow = memo(function LiteChatSystemRow({
  row
}: {
  row: ChatRowViewModel;
}) {
  if (row.itemType === "unread") return <UnreadDivider />;
  return (
    <View style={styles.liteChatSystemRow}>
      <Text style={styles.liteChatSystemText}>{row.body}</Text>
    </View>
  );
});

function MemoryChatMainSurface({
  active,
  canLoadOlderMessages,
  chatMessages,
  collapsedComposerGeometry,
  loadingOlderMessages,
  liteRows,
  message,
  myDisplayName,
  myUsername,
  unreadAnchorLookupFailed,
  unreadAnchorLookupReady,
  olderMessagesFailed,
  inputRef,
  initialScrollOffset,
  initialUnreadMessageId,
  journeySession,
  listRef,
  canDeleteSelected,
  copyableSelectedMessage,
  deleteError,
  discardableSelectedMessage,
  deletePending,
  editableSelectedMessage,
  editingMessage,
  replyableSelectedMessage,
  selectedItemKeys,
  unreadCount,
  onBeginSelection,
  onCancelFailedMessage,
  onCancelReply,
  onCancelEdit,
  onCancelSelection,
  onChangeMessage,
  onCopyMessage,
  onDeleteSelected,
  onEditMessage,
  onLoadOlderMessages,
  onNearBottomChange,
  onVisibleReadPosition,
  onScrollOffsetChange,
  onOpenDish,
  onOpenMedia,
  onRateDish,
  onReplyMessage,
  onRetryFailedMessage,
  onSend,
  onSendAudio,
  onToggleSelection,
  onToggleReaction,
  replyingToMessage,
  roomId,
  resolvedTheme,
  keyboardTopReserve,
  surfaceKeyboardStyle,
  toolbarInsetStyle
}: {
  active: boolean;
  canLoadOlderMessages: boolean;
  chatMessages: MemoryChatMainMessage[];
  collapsedComposerGeometry: ReturnType<typeof resolveMemoryChatCollapsedComposerGeometry>;
  loadingOlderMessages: boolean;
  liteRows: ChatRowViewModel[];
  message: string;
  myDisplayName: string;
  myUsername: string;
  unreadAnchorLookupFailed: boolean;
  unreadAnchorLookupReady: boolean;
  olderMessagesFailed: boolean;
  inputRef: RefObject<NativeChatInputHandle | null>;
  initialScrollOffset: number;
  initialUnreadMessageId: string | null;
  journeySession: MemoryRoomJourneySession;
  listRef: RefObject<ChatListScrollRef | null>;
  canDeleteSelected: boolean;
  copyableSelectedMessage: MemoryMessage | null;
  deleteError?: string;
  discardableSelectedMessage: MemoryMessage | null;
  deletePending: boolean;
  editableSelectedMessage: MemoryMessage | null;
  editingMessage: MemoryMessage | null;
  replyableSelectedMessage: MemoryMessage | null;
  selectedItemKeys: string[];
  unreadCount: number;
  onBeginSelection: (target: MemoryActionTarget) => void;
  onCancelFailedMessage: (message: MemoryMessage) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onCancelSelection: () => void;
  onChangeMessage: (value: string) => void;
  onCopyMessage: (message: MemoryMessage) => void;
  onDeleteSelected: () => void;
  onEditMessage: (message: MemoryMessage) => void;
  onLoadOlderMessages: () => void;
  onNearBottomChange: (isNearBottom: boolean) => void;
  onVisibleReadPosition: (createdAt: string) => void;
  onScrollOffsetChange: (offset: number) => void;
  onOpenDish: (dishId: string) => void;
  onOpenMedia: OpenMediaHandler;
  onRateDish: (dishId: string, rating: number | null) => void;
  onReplyMessage: (message: MemoryMessage) => void;
  onRetryFailedMessage: (message: MemoryMessage) => void;
  onSend: (draft?: string, clientId?: string, clientCreatedAt?: string) => void;
  onSendAudio: (asset: AddMemoryMediaAsset) => Promise<void>;
  onToggleSelection: (target: MemoryActionTarget) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  replyingToMessage: MemoryMessage | null;
  roomId: string;
  resolvedTheme: "dark" | "light";
  keyboardTopReserve: SharedValue<number>;
  surfaceKeyboardStyle: StyleProp<ViewStyle>;
  toolbarInsetStyle: StyleProp<ViewStyle>;
}) {
  useMemoryJourneySurfaceDiagnostics(
    journeySession,
    "chat",
    "chat",
    MEMORY_ROOM_CHAT_NATIVE_RENDERER
  );
  const [layoutGeneration] = useState(nextMemoryChatLayoutGeneration);
  const closedComposerBottomPadding = collapsedComposerGeometry.closedBottomPadding;
  const previousActiveRef = useRef(active);
  useEffect(
    () => adjustMemoryRoomResourceCounter("MemoryRoomMountedChatHosts", 1),
    []
  );
  useEffect(() => {
    recordMemoryRoomChatRendererCandidate(MEMORY_ROOM_CHAT_RENDERER_CODE);
  }, []);
  useEffect(() => {
    recordMemoryChatPlacement("CHAT_GEOMETRY_MODEL_READY", {
      bottomClearance: collapsedComposerGeometry.listClearance,
      composerHeight: collapsedComposerGeometry.composerHeight,
      fontScale: collapsedComposerGeometry.fontScale,
      layoutGeneration,
      pixelRatio: collapsedComposerGeometry.pixelRatio,
      safeAreaInset: collapsedComposerGeometry.safeAreaInset
    });
  }, [collapsedComposerGeometry, layoutGeneration]);
  useEffect(() => {
    const becameActive = active && !previousActiveRef.current;
    previousActiveRef.current = active;
    if (!becameActive || MEMORY_ROOM_CHAT_NATIVE_RENDERER) return undefined;
    // A warmed Chat host does not remount, so its mount-time journey probe
    // cannot close a later activation trace. Close it from the first frame
    // where the already-laid-out host is visible and interactive instead.
    const usableFrame = requestAnimationFrame(() => {
      markMemoryRoomSurfaceUsable("chat");
      recordMemoryRoomJourney(journeySession, "TAB_USABLE", {
        screenState: "usable",
        surface: "chat_retained_activation",
        tab: "chat"
      });
    });
    return () => cancelAnimationFrame(usableFrame);
  }, [active, journeySession]);
  useEffect(() => {
    if (active) return;
    void inputRef.current?.blur();
  }, [active, inputRef]);
  const { width: screenWidth } = useWindowDimensions();
  const currentUser = useMemo(
    () => memoryChatUser(myUsername, myDisplayName || myUsername || "You"),
    [myDisplayName, myUsername]
  );
  const [immediateTextRows, setImmediateTextRows] = useState<MemoryChatMainMessage[]>([]);
  const canonicalClientIds = useMemo(
    () => new Set(chatMessages.flatMap((row) => row.memoryMessage?.clientId ?? [])),
    [chatMessages]
  );
  const displayChatMessages = useMemo(
    () => [
      ...immediateTextRows.filter((row) => {
        const clientId = row.memoryMessage?.clientId;
        return Boolean(clientId && !canonicalClientIds.has(clientId));
      }),
      ...chatMessages
    ],
    [canonicalClientIds, chatMessages, immediateTextRows]
  );
  useEffect(() => {
    setImmediateTextRows((current) => {
      const next = current.filter((row) => {
        const clientId = row.memoryMessage?.clientId;
        return Boolean(clientId && !canonicalClientIds.has(clientId));
      });
      return next.length === current.length ? current : next;
    });
  }, [canonicalClientIds]);
  const latestChatMessage = displayChatMessages[0] ?? null;
  const latestChatMessageId = latestChatMessage?._id != null ? String(latestChatMessage._id) : null;
  const latestChatMessageMine = latestChatMessage
    ? String(latestChatMessage.user?._id ?? "") === String(currentUser._id ?? "")
    : false;
  const selectionMode = selectedItemKeys.length > 0;
  // ---- First-unread anchoring --------------------------------------------
  // The unread divider has always been spliced into this timeline, but nothing
  // on this renderer ever moved the viewport to it: the vendored list is a
  // plain inverted AnimatedFlatList with no getItemLayout, so an index can only
  // be scrolled to once its row has actually been rendered. The plan is latched
  // on the surface's FIRST render — the surface remounts on every activation,
  // so that is exactly "on entry" — and drives three things: how many rows the
  // first commit builds, the one scroll command, and the reveal gate that keeps
  // the correction off screen. Everything degrades to today's newest-first
  // placement if any part of it does not resolve.
  const unreadAnchorRowKey = initialUnreadMessageId
    ? `unread:${initialUnreadMessageId}`
    : null;
  const unreadAnchorPlanRef = useRef<{
    index: number;
    initialRenderCount: number;
    windowHeadKey: string | null;
  } | null>(null);
  if (!unreadAnchorPlanRef.current) {
    const anchorIndex = unreadAnchorRowKey
      ? displayChatMessages.findIndex(
        (row) => String(row._id) === unreadAnchorRowKey
      )
      : -1;
    // index 0 is the newest row, which the ordinary bottom placement already
    // shows; only an anchor genuinely above the fold is worth a scroll.
    const withinFirstCommit =
      anchorIndex > 0 &&
      anchorIndex + 2 <= CHAT_MAIN_ANCHOR_MAX_INITIAL_RENDER_COUNT;
    // A far-back divider used to be abandoned here: the entry fell back to
    // newest-first and the unread point was never shown, which is precisely the
    // case a reader most needs it. Rendering down to it instead would mean an
    // unbounded first commit. Neither is necessary — withholding the rows newer
    // than the divider puts it near the head of the list, so the SAME bounded
    // first commit lands on it.
    const windowed = anchorIndex > 0 && !withinFirstCommit;
    const windowHeadIndex = windowed
      ? anchorIndex - CHAT_MAIN_ANCHOR_WINDOW_LEAD_ROWS
      : 0;
    const index = windowed
      ? CHAT_MAIN_ANCHOR_WINDOW_LEAD_ROWS
      : withinFirstCommit ? anchorIndex : -1;
    unreadAnchorPlanRef.current = {
      index,
      initialRenderCount: index > 0
        ? Math.max(CHAT_MAIN_INITIAL_RENDER_COUNT, index + 2)
        : CHAT_MAIN_INITIAL_RENDER_COUNT,
      // Held as a KEY, not an index. New messages arrive at index 0, so an
      // index-based boundary would silently slide one row older per arrival.
      windowHeadKey: windowHeadIndex > 0
        ? String(displayChatMessages[windowHeadIndex]?._id ?? "") || null
        : null
    };
  }
  const unreadAnchorPlan = unreadAnchorPlanRef.current;
  const [chatWindowHeadKey, setChatWindowHeadKey] = useState<string | null>(
    unreadAnchorPlan.windowHeadKey
  );
  const chatWindowHeadOffset = useMemo(() => {
    if (!chatWindowHeadKey) return 0;
    const index = displayChatMessages.findIndex(
      (row) => String(row._id) === chatWindowHeadKey
    );
    // A vanished boundary (deleted message, replaced projection) opens the
    // window rather than stranding the reader in a window with no exit.
    return index > 0 ? index : 0;
  }, [chatWindowHeadKey, displayChatMessages]);
  const windowedChatMessages = useMemo(
    () => (chatWindowHeadOffset > 0
      ? displayChatMessages.slice(chatWindowHeadOffset)
      : displayChatMessages),
    [chatWindowHeadOffset, displayChatMessages]
  );
  const chatWindowActive = chatWindowHeadOffset > 0;
  const expandChatWindow = useCallback(() => {
    setChatWindowHeadKey((current) => {
      if (!current) return current;
      const index = displayChatMessages.findIndex(
        (row) => String(row._id) === current
      );
      if (index <= 0) return null;
      const nextIndex = index - CHAT_MAIN_ANCHOR_WINDOW_EXPAND_ROWS;
      if (nextIndex <= 0) return null;
      return String(displayChatMessages[nextIndex]?._id ?? "") || null;
    });
  }, [displayChatMessages]);
  const [unreadAnchorSettled, setUnreadAnchorSettled] = useState(
    unreadAnchorPlan.index < 0
  );
  // VirtualizedList does NOT throw when the target index is past the highest
  // measured frame and no getItemLayout exists — it calls onScrollToIndexFailed
  // synchronously and returns. So failure has to be observed through this flag,
  // read immediately after the call, not through a try/catch.
  const unreadAnchorFailedRef = useRef(false);
  const handleChatMainScrollToIndexFailed = useCallback(() => {
    unreadAnchorFailedRef.current = true;
  }, []);
  useEffect(() => {
    if (unreadAnchorSettled || !active || unreadAnchorPlan.index < 0) {
      return undefined;
    }
    let frame: number | null = null;
    let attempt = 0;
    let cancelled = false;
    const reveal = () => {
      frame = null;
      if (!cancelled) setUnreadAnchorSettled(true);
    };
    const retryOrReveal = () => {
      if (cancelled) return;
      if (attempt < CHAT_MAIN_ANCHOR_REVEAL_MAX_FRAMES) {
        frame = requestAnimationFrame(applyAnchor);
        return;
      }
      reveal();
    };
    const applyAnchor = () => {
      attempt += 1;
      const list = listRef.current;
      if (!list?.scrollToIndex) {
        reveal();
        return;
      }
      // FlashList only: an index whose row has no resolved layout yet scrolls
      // to an estimate and lands short. Waiting a frame for the real layout is
      // the same "is this index real yet?" question FlatList answers through
      // onScrollToIndexFailed, just asked before the scroll instead of after.
      if (
        typeof list.getLayout === "function" &&
        list.getLayout(unreadAnchorPlan.index) === undefined
      ) {
        retryOrReveal();
        return;
      }
      unreadAnchorFailedRef.current = false;
      const scrolled = list.scrollToIndex({
        animated: false,
        index: unreadAnchorPlan.index,
        // Inverted list: scroll-space "start" is the visual BOTTOM, so
        // viewPosition 1 places the divider at the visual top of the viewport
        // with the unread messages below it.
        viewPosition: 1
      });
      // FlashList resolves when the scroll has actually completed, so the
      // reveal waits for it rather than for a frame that may be too early.
      // There is no failure callback on that engine — a rejected or
      // never-settling promise must still reveal, or the surface stays blank.
      if (scrolled && typeof (scrolled as Promise<void>).then === "function") {
        void (scrolled as Promise<void>).then(reveal, reveal);
        return;
      }
      // FlatList: VirtualizedList does not throw for an index past its highest
      // measured frame, it calls onScrollToIndexFailed synchronously, so the
      // outcome is readable immediately after the call.
      if (unreadAnchorFailedRef.current) {
        retryOrReveal();
        return;
      }
      reveal();
    };
    frame = requestAnimationFrame(applyAnchor);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active, listRef, unreadAnchorPlan, unreadAnchorSettled]);
  // Advance the read position from what the viewport actually shows — the same
  // contract the native renderer reports through onVisibleRangeChanged, and the
  // reason opening Chat no longer has to mark the whole room read. The callback
  // and the config must both keep a stable identity: VirtualizedList refuses a
  // changed onViewableItemsChanged/viewabilityConfig after mount.
  const handleChatMainViewableItems = useStableHandler((info: {
    viewableItems: Array<{ item?: MemoryChatMainMessage | null }>;
  }) => {
    if (!active) return;
    let newestVisibleMs = 0;
    let newestVisibleAt: string | null = null;
    for (const entry of info.viewableItems) {
      const createdAt = entry.item?.memoryMessage?.createdAt;
      if (!createdAt) continue;
      const createdAtMs = Date.parse(createdAt);
      if (Number.isFinite(createdAtMs) && createdAtMs > newestVisibleMs) {
        newestVisibleMs = createdAtMs;
        newestVisibleAt = createdAt;
      }
    }
    if (newestVisibleAt) onVisibleReadPosition(newestVisibleAt);
  });
  const [chatMainPreserveHistoryViewport, setChatMainPreserveHistoryViewport] = useState(false);
  const [chatLatestButtonVisible, setChatLatestButtonVisible] = useState(false);
  // Read by the scroll and load-older callbacks so pane activation does not
  // rebuild them. They are spread into every message via the container's
  // restProps, so a new identity there recreates every cell element.
  const activeRef = useRef(active);
  activeRef.current = active;
  const chatMainNearBottomRef = useRef(true);
  const chatMainAtBottomRef = useRef(true);
  const chatMainFollowBottomRef = useRef(true);
  const chatMainInteractingRef = useRef(false);
  const chatMainMomentumRef = useRef(false);
  const pendingOlderPageRef = useRef(false);
  const chatMainInteractionReleaseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const olderPageRequestGuardRef = useRef({ inFlight: false, lastRequestAt: 0 });
  const latestChatMessageIdRef = useRef(latestChatMessageId);
  const placementLatestClientIdRef = useRef<string | null>(null);
  const placementStatusByClientRef = useRef(new Map<string, MemoryMessage["deliveryStatus"]>());
  const placementIndexByRowKeyRef = useRef(new Map<string, number>());
  placementIndexByRowKeyRef.current = new Map(
    displayChatMessages.map((chatMessage, index) => [String(chatMessage._id), index])
  );
  const placementContentHeightRef = useRef(0);
  const placementViewportHeightRef = useRef(0);
  const chatListLayoutMarkedRef = useRef(false);
  const placementScrollOffsetRef = useRef(0);
  const placementScrollActiveRef = useRef(false);
  const placementScrollFinishRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The vendored chat can recreate its toolbar when list data changes. Keep
  // this guard on the stable surface so a fast second tap cannot lose the
  // successful text-submit timestamp and reinterpret itself as a mic press.
  const lastTextSubmitAtRef = useRef(0);
  const textSubmitInFlightRef = useRef(false);
  // The recorder is created on demand, not on mount. `ensureVoiceRecorder`
  // mounts VoiceRecorderHost and resolves once it hands the instance back;
  // startVoiceRecording already awaits a permission round trip first, so the
  // extra render is hidden behind work that had to happen anyway.
  const [voiceRecorderMounted, setVoiceRecorderMounted] = useState(false);
  const voiceRecorderRef = useRef<VoiceRecorder | null>(null);
  const voiceRecorderReadyRef = useRef<((recorder: VoiceRecorder) => void) | null>(null);
  // The in-flight request is cached so overlapping callers share one promise.
  // Without it, a second press while the first is still awaiting microphone
  // permission would replace the pending resolver and leave the first await
  // hanging for the life of the screen.
  const voiceRecorderPendingRef = useRef<Promise<VoiceRecorder> | null>(null);
  const ensureVoiceRecorder = useCallback(() => {
    if (voiceRecorderRef.current) return Promise.resolve(voiceRecorderRef.current);
    if (voiceRecorderPendingRef.current) return voiceRecorderPendingRef.current;
    const pending = new Promise<VoiceRecorder>((resolve) => {
      voiceRecorderReadyRef.current = resolve;
    });
    voiceRecorderPendingRef.current = pending;
    setVoiceRecorderMounted(true);
    return pending;
  }, []);
  const handleVoiceRecorderReady = useCallback((recorder: VoiceRecorder) => {
    voiceRecorderRef.current = recorder;
    voiceRecorderPendingRef.current = null;
    const resolveReady = voiceRecorderReadyRef.current;
    voiceRecorderReadyRef.current = null;
    resolveReady?.(recorder);
  }, []);
  const [voiceMode, setVoiceMode] = useState<"idle" | "recording" | "sending">("idle");
  // Polling only while a recording is in flight: outside that there is no
  // recorder to ask, and its status cannot change.
  const voiceRecorderState = useVoiceRecorderState(voiceRecorderRef, 200, voiceMode !== "idle");
  const voiceModeRef = useRef(voiceMode);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceWallDurationMs = voiceMode === "recording" && voiceRecordingStartedAtRef.current
    ? Date.now() - voiceRecordingStartedAtRef.current
    : 0;
  const voiceDurationMs = Math.max(
    voiceRecorderState.durationMillis ?? 0,
    voiceWallDurationMs
  );
  const voiceActive = voiceMode !== "idle";
  const voiceSending = voiceMode === "sending";
  const voiceSendDisabled = voiceSending || voiceDurationMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS;
  // The message box and the list reserve share UI-thread height values. A
  // newline/backspace writes both in the same event, so the composer and newest
  // messages move together without a parent React render or follow-up RAF.
  const messageBoxHeight = useSharedValue(collapsedComposerGeometry.messageBoxHeight);
  const composerClearance = useSharedValue(collapsedComposerGeometry.listClearance);
  const composerListSpacerStyle = useAnimatedStyle(() => ({
    height: composerClearance.value
  }), [composerClearance]);
  const keyboardTopSpacerStyle = useAnimatedStyle(() => ({
    height: Math.max(0, keyboardTopReserve.value)
  }), [keyboardTopReserve]);
  const renderComposerListSpacer = useCallback(() => (
    <Reanimated.View pointerEvents="none" style={composerListSpacerStyle} />
  ), [composerListSpacerStyle]);
  const renderKeyboardTopSpacer = useCallback(() => (
    <Reanimated.View pointerEvents="none" style={keyboardTopSpacerStyle} />
  ), [keyboardTopSpacerStyle]);

  // Toolbar onLayout is a JS event and can arrive after a newer native
  // newline/backspace height. Measure only when the toolbar's structure really
  // changes; draft line-height changes are already applied atomically by the
  // native height event above.
  const toolbarLayoutIdentity = selectionMode
    ? [
        "selection",
        selectedItemKeys.length,
        deleteError ?? "",
        deletePending,
        editableSelectedMessage?.id ?? "",
        screenWidth,
        closedComposerBottomPadding
      ].join(":")
    : [
        "input",
        editingMessage?.id ?? "",
        editingMessage?.body ?? "",
        replyingToMessage?.id ?? "",
        replyingToMessage?.body ?? "",
        voiceMode,
        screenWidth,
        closedComposerBottomPadding
      ].join(":");
  const collapsedToolbarStructure =
    !selectionMode &&
    !editingMessage &&
    !replyingToMessage &&
    voiceMode === "idle";
  const activeToolbarLayoutIdentityRef = useRef(toolbarLayoutIdentity);
  const measuredToolbarLayoutIdentityRef = useRef<string | null>(null);
  const composerReadyMarkedRef = useRef(false);
  activeToolbarLayoutIdentityRef.current = toolbarLayoutIdentity;
  const handleInputToolbarLayout = useCallback((event: LayoutChangeEvent) => {
    if (
      activeToolbarLayoutIdentityRef.current !== toolbarLayoutIdentity ||
      measuredToolbarLayoutIdentityRef.current === toolbarLayoutIdentity
    ) {
      return;
    }
    measuredToolbarLayoutIdentityRef.current = toolbarLayoutIdentity;
    const measuredHeight = event.nativeEvent.layout.height;
    const modeledHeight =
      collapsedComposerGeometry.listClearance +
      Math.max(
        0,
        messageBoxHeight.value - collapsedComposerGeometry.messageBoxHeight
      );
    const targetClearance = collapsedToolbarStructure
      ? modeledHeight
      : measuredHeight;
    const firstComposerLayout = !composerReadyMarkedRef.current;
    if (firstComposerLayout) {
      recordMemoryChatPlacement("CHAT_COMPOSER_FIRST_LAYOUT", {
        bottomClearance: targetClearance,
        composerHeight: measuredHeight,
        composerModelHeight: modeledHeight,
        fontScale: collapsedComposerGeometry.fontScale,
        layoutGeneration,
        pixelRatio: collapsedComposerGeometry.pixelRatio,
        safeAreaInset: collapsedComposerGeometry.safeAreaInset
      });
    }
    if (
      collapsedToolbarStructure &&
      PixelRatio.roundToNearestPixel(measuredHeight) !==
        PixelRatio.roundToNearestPixel(modeledHeight)
    ) {
      recordMemoryChatPlacement("CHAT_GEOMETRY_MISMATCH", {
        bottomClearance: targetClearance,
        composerHeight: measuredHeight,
        composerModelHeight: modeledHeight,
        fontScale: collapsedComposerGeometry.fontScale,
        layoutGeneration,
        pixelRatio: collapsedComposerGeometry.pixelRatio,
        safeAreaInset: collapsedComposerGeometry.safeAreaInset
      });
    }
    // The collapsed list clearance is a mount-time contract. Native layout
    // validates it but never replaces it, so pixel-rounding or a late onLayout
    // cannot reposition rows that are already visible. Structural toolbar
    // modes still use their measured height after an explicit user action.
    if (Math.abs(composerClearance.value - targetClearance) > 0.5) {
      composerClearance.value = targetClearance;
    }
    if (!composerReadyMarkedRef.current) {
      composerReadyMarkedRef.current = true;
      markMemoryRoomTracePoint("MemoryRoomChatComposerReady");
    }
  }, [
    collapsedComposerGeometry,
    collapsedToolbarStructure,
    composerClearance,
    layoutGeneration,
    messageBoxHeight,
    toolbarLayoutIdentity
  ]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  const resetVoiceAudioMode = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "duckOthers",
      playsInSilentMode: true
    }).catch(() => undefined);
  }, []);

  const cancelVoiceRecording = useCallback(async () => {
    if (voiceModeRef.current === "idle") return;
    voiceModeRef.current = "idle";
    voiceRecordingStartedAtRef.current = null;
    setVoiceMode("idle");
    // Reachable only from a non-idle mode, which cannot be entered without the
    // recorder having been created, so a missing instance means there is simply
    // nothing to stop or clean up.
    const recorder = voiceRecorderRef.current;
    try {
      if (recorder && (recorder.isRecording || voiceRecorderState.isRecording)) {
        await recorder.stop();
      }
    } catch {
      // Cancelling should be quiet; a stale native recorder can already be stopped.
    } finally {
      await discardTemporaryAccountFile(recorder?.uri ?? voiceRecorderState.url).catch(() => {});
      await resetVoiceAudioMode();
    }
  }, [resetVoiceAudioMode, voiceRecorderState.isRecording, voiceRecorderState.url]);

  const startVoiceRecording = useCallback(async () => {
    if (voiceModeRef.current !== "idle" || message.trim().length > 0) return;
    if (Platform.OS === "web") {
      Alert.alert("Voice notes are mobile-only", "Use the mobile app to record audio messages.");
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone access needed",
          "Allow microphone access to record an audio message.",
          [
            { style: "cancel", text: "Not now" },
            { onPress: () => void Linking.openSettings(), text: "Open settings" }
          ]
        );
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "duckOthers",
        playsInSilentMode: true
      });
      const recorder = await ensureVoiceRecorder();
      await recorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
      recorder.record();
      voiceRecordingStartedAtRef.current = Date.now();
      voiceModeRef.current = "recording";
      setVoiceMode("recording");
    } catch (error) {
      console.warn("[memory-chat] Could not start voice recording");
      voiceRecordingStartedAtRef.current = null;
      voiceModeRef.current = "idle";
      setVoiceMode("idle");
      await resetVoiceAudioMode();
      Alert.alert("Could not start recording", error instanceof Error ? error.message : "Please try again.");
    }
  }, [ensureVoiceRecorder, message, resetVoiceAudioMode]);

  const finishAndSendVoiceRecording = useCallback(async () => {
    if (voiceModeRef.current !== "recording") return;
    const durationBeforeStopMs = Math.max(
      voiceRecorderState.durationMillis ?? 0,
      voiceRecordingStartedAtRef.current ? Date.now() - voiceRecordingStartedAtRef.current : 0
    );
    if (durationBeforeStopMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS) return;
    voiceModeRef.current = "sending";
    setVoiceMode("sending");

    // Recording mode cannot be entered without the recorder existing, so this
    // is resolved rather than optional from here down.
    const recorder = voiceRecorderRef.current;
    let retainedRecordingUri: string | null = null;
    try {
      if (!recorder) throw new Error("voice_recorder_unavailable");
      if (recorder.isRecording || voiceRecorderState.isRecording) {
        try {
          await recorder.stop();
        } catch (error) {
          if (durationBeforeStopMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS + 500) {
            Alert.alert("Audio is too short", "Record for a moment longer before sending.");
            return;
          }
          throw error;
        }
      }
      const status = recorder.getStatus();
      const durationMs = Math.max(durationBeforeStopMs, status.durationMillis ?? 0);
      const uri = recorder.uri ?? status.url ?? voiceRecorderState.url;
      if (!uri) throw new Error("voice_recording_missing_uri");
      if (durationMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS) {
        Alert.alert("Audio is too short", "Record for at least a moment before sending.");
        return;
      }
      if (durationMs > MEMORY_AUDIO_MAX_DURATION_MS + 250) {
        Alert.alert("Audio is too long", "Audio messages must be 60 seconds or less.");
        return;
      }
      retainedRecordingUri = uri;
      const sendPromise = onSendAudio({
        duration: durationMs,
        fileSize: null,
        imageHeight: null,
        imageWidth: null,
        mediaMimeType: VOICE_MESSAGE_MIME_TYPE,
        mediaType: "audio",
        mediaUri: uri
      });
      // Upload/confirmation owns the retained file, but it does not own the
      // composer. Text input is available again as soon as recording stops.
      voiceRecordingStartedAtRef.current = null;
      voiceModeRef.current = "idle";
      setVoiceMode("idle");
      void resetVoiceAudioMode();
      void sendPromise.catch((error) => {
        console.warn("[memory-chat] Could not send audio");
        Alert.alert("Could not send audio", error instanceof Error ? error.message : "Please try recording again.");
      }).finally(() => {
        void discardTemporaryAccountFile(uri).catch(() => {});
      });
      return;
    } catch (error) {
      console.warn("[memory-chat] Could not send audio");
      Alert.alert("Could not send audio", error instanceof Error ? error.message : "Please try recording again.");
    } finally {
      if (voiceModeRef.current !== "idle") {
        await discardTemporaryAccountFile(retainedRecordingUri ?? recorder?.uri ?? voiceRecorderState.url).catch(() => {});
        voiceRecordingStartedAtRef.current = null;
        voiceModeRef.current = "idle";
        setVoiceMode("idle");
        await resetVoiceAudioMode();
      }
    }
  }, [onSendAudio, resetVoiceAudioMode, voiceRecorderState.durationMillis, voiceRecorderState.isRecording, voiceRecorderState.url]);

  useEffect(() => {
    if (voiceMode !== "recording" || voiceDurationMs < MEMORY_AUDIO_MAX_DURATION_MS) return;
    void finishAndSendVoiceRecording();
  }, [finishAndSendVoiceRecording, voiceDurationMs, voiceMode]);

  useEffect(() => {
    if (active || voiceMode !== "recording") return;
    void cancelVoiceRecording();
  }, [active, cancelVoiceRecording, voiceMode]);

  useEffect(() => () => {
    if (voiceModeRef.current === "idle") return;
    voiceModeRef.current = "idle";
    voiceRecordingStartedAtRef.current = null;
    void voiceRecorderRef.current?.stop().catch(() => undefined);
    void resetVoiceAudioMode();
  }, [resetVoiceAudioMode]);

  useEffect(() => {
    chatMainNearBottomRef.current = true;
    chatMainAtBottomRef.current = true;
    chatMainFollowBottomRef.current = true;
    setChatMainPreserveHistoryViewport(false);
    chatMainInteractingRef.current = false;
    chatMainMomentumRef.current = false;
    if (chatMainInteractionReleaseRef.current) {
      clearTimeout(chatMainInteractionReleaseRef.current);
      chatMainInteractionReleaseRef.current = null;
    }
    latestChatMessageIdRef.current = latestChatMessageId;
    // Room switches reset the anchor baseline; new-message changes are handled
    // by the follow-bottom effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    for (const [renderIndex, chatMessage] of displayChatMessages.entries()) {
      const memoryMessage = chatMessage.memoryMessage;
      const clientId = memoryMessage?.clientId;
      if (!clientId || memoryMessage.authorName !== myUsername) continue;
      const previousStatus = placementStatusByClientRef.current.get(clientId);
      if (previousStatus === undefined) {
        recordMemoryChatPlacement("LIST_DATA_RECEIVED", {
          clientId,
          deliveryStatus: memoryMessage.deliveryStatus,
          renderIndex
        });
        recordMemoryChatPlacement("LIST_DATA_COMMIT", {
          clientId,
          deliveryStatus: memoryMessage.deliveryStatus,
          renderIndex
        });
      }
      if (previousStatus !== memoryMessage.deliveryStatus) {
        recordMemoryChatPlacement("ROW_STATUS_UPDATED", {
          clientId,
          deliveryStatus: memoryMessage.deliveryStatus,
          renderIndex
        });
      }
      placementStatusByClientRef.current.set(clientId, memoryMessage.deliveryStatus);
      if (renderIndex === 0) placementLatestClientIdRef.current = clientId;
    }
  }, [displayChatMessages, myUsername]);

  useEffect(() => {
    const previousLatestMessageId = latestChatMessageIdRef.current;
    latestChatMessageIdRef.current = latestChatMessageId;
    if (!active || !latestChatMessageId || previousLatestMessageId === latestChatMessageId) return;
    if (chatMainInteractingRef.current) return;
    if (!latestChatMessageMine && !chatMainNearBottomRef.current && !chatMainFollowBottomRef.current) return;
    chatMainFollowBottomRef.current = true;
    chatMainNearBottomRef.current = true;
    chatMainAtBottomRef.current = true;
    // Reaching this point means the viewport is committing to the bottom, so
    // the bottom has to be the room's newest row rather than the window's. It
    // matters most for the user's OWN send: the new row sits above a withheld
    // boundary, so without this the composer would clear and nothing would
    // appear. Someone else's message does not get here — the guard above
    // returns while the reader is parked at the divider.
    setChatWindowHeadKey(null);
    onNearBottomChange(true);
    // Inverted data already places the immutable newest row at index 0. When
    // following the bottom, maintainVisibleContentPosition applies the single
    // unavoidable displacement in this same layout pass. A deferred
    // scrollToOffset(0) made the row appear and then move a second time.
  }, [active, latestChatMessageId, latestChatMessageMine, onNearBottomChange]);

  const handleChatMainScroll = useCallback((event: ScrollEvent) => {
    if (!activeRef.current) return;
    const distanceFromBottom = event.contentOffset.y;
    onScrollOffsetChange(distanceFromBottom);
    const previousOffset = placementScrollOffsetRef.current;
    placementScrollOffsetRef.current = distanceFromBottom;
    updateMemoryChatPlacementContext({
      bottomClearance: composerClearance.value,
      composerHeight: messageBoxHeight.value,
      contentHeight: event.contentSize.height,
      contentOffset: distanceFromBottom,
      keyboardInset: keyboardTopReserve.value,
      viewportHeight: event.layoutMeasurement.height
    });
    const placementClientId = placementLatestClientIdRef.current;
    if (placementClientId && Math.abs(previousOffset - distanceFromBottom) > 0.5) {
      if (!placementScrollActiveRef.current) {
        placementScrollActiveRef.current = true;
        recordMemoryChatPlacement("SCROLL_STARTED", {
          clientId: placementClientId,
          contentOffset: distanceFromBottom
        });
      }
      if (placementScrollFinishRef.current) clearTimeout(placementScrollFinishRef.current);
      placementScrollFinishRef.current = setTimeout(() => {
        placementScrollFinishRef.current = null;
        placementScrollActiveRef.current = false;
        recordMemoryChatPlacement("SCROLL_FINISHED", {
          clientId: placementClientId,
          contentOffset: placementScrollOffsetRef.current
        });
      }, 80);
    }
    const isNearBottom = distanceFromBottom < 96;
    const isAtBottom = distanceFromBottom < 4;
    chatMainNearBottomRef.current = isNearBottom;
    chatMainAtBottomRef.current = isAtBottom;
    setChatMainPreserveHistoryViewport(!isNearBottom);
    // Restore withheld rows a viewport early, so the rows land while the list
    // is still position-maintained rather than under a reader sitting at the
    // bottom edge. Repeated calls are cheap: expandChatWindow is a no-op once
    // the boundary reaches index 0.
    //
    // Held until the anchor has settled. Restoring rows prepends them at index
    // 0, which moves the divider's index — and the entry scroll targets that
    // index. Expanding first would leave scrollToIndex pointing at whatever row
    // had shifted into position 12.
    if (
      chatWindowActive &&
      unreadAnchorSettled &&
      distanceFromBottom < CHAT_MAIN_ANCHOR_WINDOW_EXPAND_THRESHOLD
    ) {
      expandChatWindow();
    }
    const nextLatestVisible =
      distanceFromBottom > CHAT_LATEST_BUTTON_OFFSET_THRESHOLD;
    setChatLatestButtonVisible((current) =>
      current === nextLatestVisible ? current : nextLatestVisible);
    onNearBottomChange(isNearBottom);
    // A native scroll event only records intent. It must never issue another
    // scroll command or it will fight the user's drag on the next frame.
    if (!isAtBottom) {
      chatMainFollowBottomRef.current = false;
    } else if (!chatMainInteractingRef.current) {
      chatMainFollowBottomRef.current = true;
    }
  }, [
    chatWindowActive,
    composerClearance,
    expandChatWindow,
    journeySession,
    keyboardTopReserve,
    messageBoxHeight,
    onNearBottomChange,
    onScrollOffsetChange,
    unreadAnchorSettled
  ]);
  const handleLiteChatScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleChatMainScroll(event.nativeEvent as unknown as ScrollEvent);
    },
    [handleChatMainScroll]
  );

  const clearChatMainInteractionRelease = useCallback(() => {
    if (!chatMainInteractionReleaseRef.current) return;
    clearTimeout(chatMainInteractionReleaseRef.current);
    chatMainInteractionReleaseRef.current = null;
  }, []);

  const finishChatMainInteraction = useCallback(() => {
    clearChatMainInteractionRelease();
    chatMainMomentumRef.current = false;
    chatMainInteractingRef.current = false;
    if (chatMainAtBottomRef.current) chatMainFollowBottomRef.current = true;
    recordMemoryRoomJourney(journeySession, "LIST_SCROLL_SETTLED", {
      contentHeight: placementContentHeightRef.current,
      contentOffset: placementScrollOffsetRef.current,
      tab: "chat",
      viewportHeight: placementViewportHeightRef.current
    });
  }, [clearChatMainInteractionRelease, journeySession]);

  const handleChatMainScrollBeginDrag = useCallback(() => {
    clearChatMainInteractionRelease();
    chatMainMomentumRef.current = false;
    chatMainInteractingRef.current = true;
    chatMainFollowBottomRef.current = false;
    recordMemoryRoomJourney(journeySession, "LIST_SCROLL_STARTED", {
      contentHeight: placementContentHeightRef.current,
      contentOffset: placementScrollOffsetRef.current,
      tab: "chat",
      viewportHeight: placementViewportHeightRef.current
    });
  }, [clearChatMainInteractionRelease, journeySession]);

  // Held through a ref because the drag handler is declared above the runner.
  const runOlderPageRequestRef = useRef<((explicitRetry: boolean) => void) | null>(null);
  const flushPendingOlderPage = useCallback(() => {
    if (!pendingOlderPageRef.current) return;
    pendingOlderPageRef.current = false;
    runOlderPageRequestRef.current?.(false);
  }, []);

  const handleChatMainScrollEndDrag = useCallback(() => {
    clearChatMainInteractionRelease();
    // Momentum begins just after end-drag. Keep ownership with the user across
    // that hand-off; release only if no momentum event follows.
    chatMainInteractionReleaseRef.current = setTimeout(() => {
      chatMainInteractionReleaseRef.current = null;
      if (chatMainMomentumRef.current) return;
      chatMainInteractingRef.current = false;
      // A drag that stops without throwing momentum still has to release a held
      // older-page request, or the edge is detected and never acted on.
      flushPendingOlderPage();
      if (chatMainAtBottomRef.current) chatMainFollowBottomRef.current = true;
      recordMemoryRoomJourney(journeySession, "LIST_SCROLL_SETTLED", {
        contentHeight: placementContentHeightRef.current,
        contentOffset: placementScrollOffsetRef.current,
        tab: "chat",
        viewportHeight: placementViewportHeightRef.current
      });
    }, 48);
  }, [clearChatMainInteractionRelease, journeySession]);

  const handleChatMainMomentumBegin = useCallback(() => {
    clearChatMainInteractionRelease();
    chatMainMomentumRef.current = true;
    chatMainInteractingRef.current = true;
    chatMainFollowBottomRef.current = false;
  }, [clearChatMainInteractionRelease]);

  const handleChatMainMomentumEnd = useCallback(() => {
    finishChatMainInteraction();
    flushPendingOlderPage();
  }, [finishChatMainInteraction, flushPendingOlderPage]);

  useEffect(() => () => {
    clearChatMainInteractionRelease();
    if (placementScrollFinishRef.current) clearTimeout(placementScrollFinishRef.current);
  }, [clearChatMainInteractionRelease]);

  useEffect(() => {
    if (!loadingOlderMessages) olderPageRequestGuardRef.current.inFlight = false;
  }, [loadingOlderMessages]);

  const runOlderPageRequest = useCallback((explicitRetry: boolean) => {
    // A hidden prewarmed list can report an end-reached event while it lays out.
    // Only the active inverted list may extend the history window.
    // After a failed edge request, remain idle while the list is still parked
    // at that edge. Only the visible retry control may start another request.
    if (
      !activeRef.current ||
      !canLoadOlderMessages ||
      loadingOlderMessages ||
      (olderMessagesFailed && !explicitRetry)
    ) {
      return;
    }
    const now = Date.now();
    if (
      olderPageRequestGuardRef.current.inFlight ||
      (
        !explicitRetry &&
        now - olderPageRequestGuardRef.current.lastRequestAt < CHAT_MAIN_LOAD_OLDER_DEBOUNCE_MS
      )
    ) {
      return;
    }
    olderPageRequestGuardRef.current = { inFlight: true, lastRequestAt: now };
    onLoadOlderMessages();
  }, [
    canLoadOlderMessages,
    loadingOlderMessages,
    olderMessagesFailed,
    onLoadOlderMessages
  ]);
  // Loading a page mid-fling is the worst possible moment for it. The
  // incremental projection store only has a fast path for a single message
  // appended at the NEWEST end; a page of older messages falls through to
  // buildFull, which rebuilds every row object and therefore re-renders every
  // mounted row. Doing that while momentum is running is exactly what leaves
  // bare wallpaper on screen. The edge is still detected immediately — the
  // request is just held until the fling settles, which is fractions of a
  // second later and invisible to a reader who has not arrived yet.
  runOlderPageRequestRef.current = runOlderPageRequest;
  const requestOlderPage = useCallback(() => {
    if (chatMainMomentumRef.current) {
      pendingOlderPageRef.current = true;
      return;
    }
    runOlderPageRequest(false);
  }, [runOlderPageRequest]);
  const retryOlderPage = useCallback(() => {
    runOlderPageRequest(true);
  }, [runOlderPageRequest]);

  const liteMessageByKey = useMemo(
    () =>
      new Map(
        displayChatMessages.map((chatMessage) => [
          String(chatMessage._id),
          chatMessage
        ])
      ),
    [displayChatMessages]
  );
  const litePrototypeSupported = liteRows.every(
    (row) =>
      row.itemType === "incoming-text" ||
      row.itemType === "outgoing-text" ||
      row.itemType === "incoming-reply-text" ||
      row.itemType === "outgoing-reply-text" ||
      row.itemType === "date" ||
      row.itemType === "unread" ||
      row.itemType === "system"
  );
  const [nativeRevealFailed, setNativeRevealFailed] = useState(false);
  useEffect(() => {
    setNativeRevealFailed(false);
  }, [layoutGeneration]);
  const nativeRendererActive =
    MEMORY_ROOM_CHAT_NATIVE_RENDERER &&
    nativeMemoryChatListAvailable &&
    unreadAnchorLookupReady &&
    !unreadAnchorLookupFailed &&
    !nativeRevealFailed &&
    litePrototypeSupported;
  // Holds the list for EVERY renderer, not just the native one. The vendored
  // surface latches its anchor plan — initialNumToRender and the single
  // scrollToIndex — on its FIRST render and never recomputes it, so committing
  // before the lookup settles discards the anchor permanently. Only reachable
  // when unread exists and is absent from the local cache, so the ordinary
  // entry still commits immediately.
  // `unreadAnchorLookupReady` is already true whenever no lookup was needed, so
  // this is only ever pending for the case it exists to cover: unread present
  // and absent from the local cache. The ordinary entry still commits at once.
  const [unreadAnchorWaitExpired, setUnreadAnchorWaitExpired] = useState(false);
  useEffect(() => {
    if (unreadAnchorLookupReady || unreadAnchorLookupFailed) return undefined;
    const timer = setTimeout(
      () => setUnreadAnchorWaitExpired(true),
      CHAT_MAIN_ANCHOR_LOOKUP_MAX_WAIT_MS
    );
    return () => clearTimeout(timer);
  }, [unreadAnchorLookupFailed, unreadAnchorLookupReady]);
  const unreadAnchorPending =
    !unreadAnchorLookupReady &&
    !unreadAnchorLookupFailed &&
    !unreadAnchorWaitExpired;
  const liteRendererActive =
    MEMORY_ROOM_CHAT_LITE_RENDERER &&
    !MEMORY_ROOM_CHAT_NATIVE_RENDERER &&
    litePrototypeSupported;
  const liteSelectionKeys = useMemo(
    () => new Set(selectedItemKeys),
    [selectedItemKeys]
  );
  const liteMessageForKey = useCallback(
    (key: string) => liteMessageByKey.get(key),
    [liteMessageByKey]
  );
  // Long press selects on every renderer, so the profiling candidates measure
  // the gesture the shipping surface actually has.
  const selectLiteMessage = useCallback(
    (key: string) => {
      const target = memoryChatActionTarget(liteMessageForKey(key));
      if (target) onBeginSelection(target);
    },
    [liteMessageForKey, onBeginSelection]
  );
  const replyToLiteMessage = useCallback(
    (key: string) => {
      const message = liteMessageForKey(key)?.memoryMessage;
      if (message && canReplyToMemoryMessage(message)) onReplyMessage(message);
    },
    [liteMessageForKey, onReplyMessage]
  );
  const toggleLiteMessageSelection = useCallback(
    (key: string) => {
      const target = memoryChatActionTarget(liteMessageForKey(key));
      if (target) onToggleSelection(target);
    },
    [liteMessageForKey, onToggleSelection]
  );
  const retryLiteMessage = useCallback(
    (key: string) => {
      const message = liteMessageForKey(key)?.memoryMessage;
      if (message && canRetryMemoryDelivery(message.deliveryStatus)) onRetryFailedMessage(message);
    },
    [liteMessageForKey, onRetryFailedMessage]
  );
  const cancelLiteMessage = useCallback(
    (key: string) => {
      const message = liteMessageForKey(key)?.memoryMessage;
      if (message && hasMemoryDeliveryStrip(message.deliveryStatus)) onCancelFailedMessage(message);
    },
    [liteMessageForKey, onCancelFailedMessage]
  );
  const nativeSelectedRowKeys = useMemo(
    () => displayChatMessages
      .filter((candidate) => {
        const target = memoryChatActionTarget(candidate);
        return target
          ? liteSelectionKeys.has(memoryActionKey(target))
          : false;
      })
      .map((candidate) => String(candidate._id)),
    [displayChatMessages, liteSelectionKeys]
  );
  const nativeInitialAnchor = useMemo(
    () => initialUnreadMessageId
      ? {
        generation: layoutGeneration,
        key: initialUnreadMessageId,
        kind: "unread" as const
      }
      : {
        generation: layoutGeneration,
        key: "" as const,
        kind: "latest" as const
      },
    [initialUnreadMessageId, layoutGeneration]
  );
  const [nativeScrollCommand, setNativeScrollCommand] =
    useState<NativeMemoryChatScrollCommand>({
      generation: 0,
      key: "",
      kind: "none"
    });
  const [nativeNearLatest, setNativeNearLatest] = useState(true);
  const handleNativeVisibleRange = useCallback(
    (event: NativeSyntheticEvent<NativeMemoryChatVisibleEvent>) => {
      const nextNearLatest = event.nativeEvent.nearLatest;
      setNativeNearLatest((current) =>
        current === nextNearLatest ? current : nextNearLatest
      );
      onNearBottomChange(nextNearLatest);
      if (event.nativeEvent.latestCreatedAt) {
        onVisibleReadPosition(event.nativeEvent.latestCreatedAt);
      }
    },
    [onNearBottomChange, onVisibleReadPosition]
  );
  const handleNativeMetrics = useCallback(
    (event: NativeSyntheticEvent<NativeMemoryChatMetricsEvent>) => {
      recordMemoryRoomNativeChatMetrics(event.nativeEvent);
    },
    []
  );
  const handleNativeRevealState = useCallback(
    (event: NativeSyntheticEvent<NativeMemoryChatRevealEvent>) => {
      const state = event.nativeEvent;
      if (state.event === "NATIVE_CHAT_REVEAL_FAILED") {
        setNativeRevealFailed(true);
        return;
      }
      // A resume is a completed Chat entry just as much as a cold reveal is;
      // the transition spans have to close on either, or a retained host would
      // read as a transition that never finished.
      if (
        state.event !== "NATIVE_CHAT_REVEALED" &&
        state.event !== "NATIVE_CHAT_RESUMED"
      ) {
        return;
      }
      markMemoryRoomTransitionFirstFrame("chat");
      markMemoryRoomSurfaceUsable("chat");
      markMemoryRoomTransitionSettled("chat");
      recordMemoryRoomJourney(journeySession, "TAB_USABLE", {
        screenState: "usable",
        surface: state.event === "NATIVE_CHAT_RESUMED"
          ? "native_chat_resumed"
          : "native_chat_revealed",
        tab: "chat"
      });
    },
    [journeySession]
  );
  const handleNativeMessagePress = useCallback(
    (key: string) => {
      if (selectionMode) toggleLiteMessageSelection(key);
    },
    [selectionMode, toggleLiteMessageSelection]
  );
  const handleNativeMessageLongPress = useCallback(
    (key: string) => {
      if (selectionMode) {
        toggleLiteMessageSelection(key);
        return;
      }
      selectLiteMessage(key);
    },
    [selectLiteMessage, selectionMode, toggleLiteMessageSelection]
  );
  // Inverted list: offset 0 IS the newest message. Returning to it also hands
  // bottom-follow back, so an arriving message keeps the viewport pinned.
  const jumpChatToLatest = useCallback(() => {
    chatMainFollowBottomRef.current = true;
    chatMainNearBottomRef.current = true;
    setChatLatestButtonVisible(false);
    // Restore the whole timeline first. Scrolling to offset 0 while rows are
    // still withheld would land on the newest row of the WINDOW, not the newest
    // row of the room — the button would silently under-deliver.
    setChatWindowHeadKey(null);
    listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, [listRef]);
  const jumpNativeToLatest = useCallback(() => {
    setNativeScrollCommand((current) => ({
      generation: current.generation + 1,
      key: "",
      kind: "latest"
    }));
  }, []);
  const renderLiteChatRow = useCallback(
    ({ index, item }: { index: number; item: ChatRowViewModel }) => {
      if (
        item.itemType === "date" ||
        item.itemType === "unread" ||
        item.itemType === "system"
      ) {
        return <LiteChatSystemRow row={item} />;
      }
      const message = liteMessageForKey(item.key)?.memoryMessage;
      return (
        <LiteChatTextRow
          canReply={Boolean(
            message && canReplyToMemoryMessage(message) && active
          )}
          index={index}
          journeySession={journeySession}
          onCancelFailed={cancelLiteMessage}
          onSelect={selectLiteMessage}
          onReply={replyToLiteMessage}
          onRetryFailed={retryLiteMessage}
          onToggleSelection={toggleLiteMessageSelection}
          row={item}
          selected={
            message
              ? liteSelectionKeys.has(
                memoryActionKey({ type: "message", value: message })
              )
              : false
          }
          selectionMode={selectionMode}
        />
      );
    },
    [
      active,
      cancelLiteMessage,
      journeySession,
      liteMessageForKey,
      liteSelectionKeys,
      selectLiteMessage,
      replyToLiteMessage,
      retryLiteMessage,
      selectionMode,
      toggleLiteMessageSelection
    ]
  );

  const sendToolbarMessage = useCallback((
    outgoingMessages: Partial<MemoryChatMainMessage> | Partial<MemoryChatMainMessage>[]
  ) => {
    const firstMessage = Array.isArray(outgoingMessages) ? outgoingMessages[0] : outgoingMessages;
    const clientId = typeof firstMessage?._id === "string" ? firstMessage._id : undefined;
    const body = firstMessage?.text?.trim() ?? "";
    if (!body || !clientId || editingMessage) {
      onSend(body, clientId);
      return;
    }
    const createdAt = firstMessage.createdAt instanceof Date
      ? firstMessage.createdAt.toISOString()
      : new Date(firstMessage.createdAt ?? Date.now()).toISOString();
    const replyTarget = replyingToMessage;
    const optimisticMessage: MemoryMessage = {
      attachments: [],
      authorDisplayName: myDisplayName || myUsername,
      authorName: myUsername,
      body,
      clientCreatedAt: createdAt,
      clientId,
      clientOrderKey: `${createdAt}:${clientId}`,
      clientSequence: null,
      createdAt,
      deliveryStatus: "pending",
      editedAt: null,
      id: `optimistic-message:${roomId}:${clientId}`,
      replyToMessage: replyTarget
        ? {
          authorDisplayName: replyTarget.authorDisplayName,
          body: replyTarget.body || "Media",
          id: memoryMessageServerId(replyTarget) ?? replyTarget.id
        }
        : null,
      replyToMessageId: replyTarget
        ? memoryMessageServerId(replyTarget) ?? replyTarget.id
        : null,
      roomId,
      serverCreatedAt: null,
      serverId: null
    };
    const row = buildMemoryChatMainMessageRow({
      message: optimisticMessage,
      reactions: {},
      showSenderDetails: false
    });
    recordMemoryChatPlacement("OPTIMISTIC_ENTITY_CREATED", {
      clientId,
      deliveryStatus: "pending"
    });
    setImmediateTextRows((current) => [
      row,
      ...current.filter((candidate) => candidate.memoryMessage?.clientId !== clientId)
    ]);
    recordMemoryChatPlacement("ROW_MODEL_INSERTED", {
      affectedRows: 2,
      clientId,
      deliveryStatus: "pending",
      renderIndex: 0
    });
    onSend(body, clientId, createdAt);
  }, [
    editingMessage,
    myDisplayName,
    myUsername,
    onSend,
    replyingToMessage,
    roomId
  ]);

  const renderInputToolbar = useCallback(() => null, []);

  const composerToolbar = selectionMode ? (
    <MemoryChatMainSelectionToolbar
      canDelete={canDeleteSelected}
      copyableMessage={copyableSelectedMessage}
      count={selectedItemKeys.length}
      discardableMessage={discardableSelectedMessage}
      onDiscard={onCancelFailedMessage}
      deleteError={deleteError}
      deleting={deletePending}
      editableMessage={editableSelectedMessage}
      onCancel={onCancelSelection}
      onCopy={onCopyMessage}
      onDelete={onDeleteSelected}
      onEdit={onEditMessage}
      onInputToolbarLayout={handleInputToolbarLayout}
      onReply={onReplyMessage}
      replyableMessage={replyableSelectedMessage}
      toolbarInsetStyle={toolbarInsetStyle}
    />
  ) : (
    <MemoryChatMainInputToolbar
      active={active}
      collapsedMessageBoxHeight={collapsedComposerGeometry.messageBoxHeight}
      editingMessage={editingMessage}
      composerClearance={composerClearance}
      inputRef={inputRef}
      lastTextSubmitAtRef={lastTextSubmitAtRef}
      messageBoxHeight={messageBoxHeight}
      myUsername={myUsername}
      onCancelEdit={onCancelEdit}
      onCancelVoice={() => { void cancelVoiceRecording(); }}
      onClearReply={onCancelReply}
      onInputToolbarLayout={handleInputToolbarLayout}
      onSend={sendToolbarMessage}
      onSendAudio={() => { void finishAndSendVoiceRecording(); }}
      onStartAudio={() => { void startVoiceRecording(); }}
      replyMessage={replyingToMessage ? memoryChatReplyMessage(replyingToMessage) : null}
      text={message}
      textInputProps={{
        maxLength: MEMORY_TEXT_MAX_LENGTH,
        onChangeText: onChangeMessage
      }}
      textSubmitInFlightRef={textSubmitInFlightRef}
      themeMode={resolvedTheme}
      toolbarInsetStyle={toolbarInsetStyle}
      voiceActive={voiceActive}
      voiceDisabled={voiceSendDisabled}
      voiceDurationMs={voiceDurationMs}
      voiceSending={voiceSending}
    />
  );

  const chatMainTextInputProps = useMemo(() => ({
    maxLength: MEMORY_TEXT_MAX_LENGTH,
    onChangeText: onChangeMessage
  }), [onChangeMessage]);

  const chatMainLoadEarlierProps = useMemo(() => ({
    isAvailable: canLoadOlderMessages,
    isInfiniteScrollEnabled: !olderMessagesFailed,
    isLoading: loadingOlderMessages,
    label: olderMessagesFailed ? "Could not load earlier messages · Retry" : undefined,
    onPress: retryOlderPage
  }), [canLoadOlderMessages, loadingOlderMessages, olderMessagesFailed, retryOlderPage]);

  const handleChatMainQuickReply = useCallback((replies: Array<{ title?: string; value?: string }>) => {
    replies.forEach((reply) => {
      const value = (reply.value || reply.title || "").trim();
      if (value) onSend(value);
    });
  }, [onSend]);

  const handleChatMainSend = useCallback((outgoingMessages: Array<Partial<MemoryChatMainMessage>>) => {
    onSend(outgoingMessages[0]?.text ?? "");
  }, [onSend]);

  // Memoised for the same reason as the static props below: the container
  // spreads these into every message, so a fresh object each render rebuilt its
  // renderItem and made VirtualizedList recreate every cell element.
  const chatMainReply = useMemo(() => ({
    message: replyingToMessage ? memoryChatReplyMessage(replyingToMessage) : null,
    onClear: onCancelReply,
    renderMessageReply: (replyProps: { position?: "left" | "right"; replyMessage?: ChatMainReplyMessage | null }) => {
      const reply = replyProps.replyMessage;
      if (!reply) return null;
      const authorId = String(reply.user?._id ?? "");
      const author = authorId && authorId === myUsername ? "You" : reply.user?.name || "Unknown";
      return (
        <View style={styles.chatMainReplyWrap}>
          <ReplyPreviewBlock
            author={author}
            body={reply.text || "Message"}
            mine={replyProps.position === "right"}
            style={styles.chatMainReplyBlock}
          />
        </View>
      );
    },
    swipe: {
      direction: "right" as const,
      // renderMessage sets the real per-row value (true for a message, and the
      // whole prop is dropped for a row that cannot be replied to), so this
      // only exists to arm the container. Holding it constant matters because
      // the row memo compares it BY VALUE: `active` here re-rendered every
      // mounted row on each tab switch.
      isEnabled: true,
      onSwipe: (target: MemoryChatMainMessage) => {
        if (target.memoryMessage && canReplyToMemoryMessage(target.memoryMessage)) {
          onReplyMessage(target.memoryMessage);
        }
      }
    }
  }), [myUsername, onCancelReply, onReplyMessage, replyingToMessage]);

  // Folded out so this memo does NOT depend on `active`: MEMORY_REACTIONS_ENABLED
  // is false, so the value is constant and a tab switch cannot invalidate it.
  // Turning emoji reactions on brings `active` back, and that needs revisiting
  // together with where selection is armed.
  const reactionsEnabled = active && MEMORY_REACTIONS_ENABLED;
  const chatMainReactions = useMemo(() => ({
    emojis: [...MEMORY_REACTION_EMOJIS],
    // Emoji reactions ONLY. This gate mounts the vendor's reactions wrapper on
    // every row, and that wrapper brings its own long press and its own
    // Pressable — both of which would fight the row for the gesture that now
    // selects a message.
    isEnabled: reactionsEnabled,
    onReactionPress: (target: MemoryChatMainMessage, emoji: string) => {
      if (!MEMORY_REACTIONS_ENABLED || selectionMode) return;
      if (target.memoryMessage) onToggleReaction(target.memoryMessage.id, emoji);
    }
  }), [onToggleReaction, reactionsEnabled, selectionMode]);

  // Passed straight through to every message by the vendored container, so an
  // object literal in JSX made its `restProps` — and therefore its renderItem —
  // a new reference on every render, which makes VirtualizedList recreate every
  // cell element. These never change, so they are built once.
  const chatMainAvatarImageStyle = useMemo(() => ({ left: styles.chatMainAvatarImage }), []);
  const chatMainKeyboardAvoidingProps = useMemo(() => ({ enabled: false }), []);
  const chatMainMessageTextProps = useMemo(() => ({
    hashtag: true,
    customTextStyle: styles.textOnlyBubbleText,
    linkStyle: {
      left: styles.messageLinkText,
      right: styles.messageLinkTextMine
    },
    mention: true,
    onPress: (_message: unknown, url: string) => {
      void Linking.openURL(url);
    },
    stripPrefix: false,
    textStyle: {
      left: styles.messageTextOther,
      right: styles.messageTextMine
    }
  }), []);

  // FlashList only. Recycling reuses a row instance for the next item of the
  // same type, so this is what stops a text row being reused as a media row.
  const chatMainItemType = useCallback(
    (item: MemoryChatMainMessage) => memoryChatItemType(item, String(currentUser._id ?? "")),
    [currentUser._id]
  );

  // A long press selects outright — there is no intermediate menu. Holding a
  // row while a selection is already open extends it, which is the same thing
  // a tap does, so the two gestures never disagree about what a hold means.
  const handleRowLongPress = useCallback((target: MemoryChatMainMessage | undefined) => {
    const actionTarget = memoryChatActionTarget(target);
    if (!actionTarget) return;
    if (selectionMode) {
      onToggleSelection(actionTarget);
      return;
    }
    onBeginSelection(actionTarget);
  }, [onBeginSelection, onToggleSelection, selectionMode]);

  // Tapping a row only means anything once something is selected; otherwise it
  // has to stay inert so opening media and jumping to a reply keep working.
  const handleRowPress = useCallback((target: MemoryChatMainMessage | undefined) => {
    if (!selectionMode) return;
    const actionTarget = memoryChatActionTarget(target);
    if (actionTarget) onToggleSelection(actionTarget);
  }, [onToggleSelection, selectionMode]);

  // Row-level width caps live on the Message container (whose parent is the
  // full-width list row, so percentages resolve reliably); the bubble itself
  // just hugs its content. This replaces the vendor's hardcoded 70% cap.
  const renderMessage = useCallback((messageProps: ChatMainMessageRowProps<MemoryChatMainMessage>) => {
    const dish = messageProps.currentMessage?.memoryDish;
    if (dish) {
      const mine = String(messageProps.user?._id ?? "") === String(messageProps.currentMessage?.user?._id ?? "");
      const actionTarget: MemoryActionTarget = { type: "dish", value: dish };
      const selected = selectedItemKeys.includes(memoryActionKey(actionTarget));
      const rowMessage = messageProps.currentMessage;
      return (
        <MemoryChatPlacementRow
          layoutGeneration={layoutGeneration}
          onLongPress={() => handleRowLongPress(rowMessage)}
          onPress={selectionMode ? () => handleRowPress(rowMessage) : undefined}
          rowKey={`dish:${dish.id}`}
          style={[styles.chatMainRowSelectionFrame, selected && styles.chatMainRowSelectedBackground]}
        >
          <DishTimelineCard
            dish={dish}
            groupPosition="single"
            mine={mine}
            onLongPress={() => handleRowLongPress(rowMessage)}
            onOpenDish={() => onOpenDish(dish.id)}
            onPress={selectionMode ? () => handleRowPress(rowMessage) : undefined}
            onRateDish={(rating) => onRateDish(dish.id, rating)}
            rowStyle={styles.chatMainDishPollRow}
            selected={selected}
            selectionGestureOwnedByParent
            selectionMode={selectionMode}
            showSenderDetails={Boolean(messageProps.currentMessage?.showSenderDetails)}
          />
        </MemoryChatPlacementRow>
      );
    }

    const hasMedia = memoryChatMessageAttachments(messageProps.currentMessage).length > 0;
    const hasAudio = Boolean(memoryChatAudioAttachment(messageProps.currentMessage));
    const actionTarget = memoryChatActionTarget(messageProps.currentMessage);
    const selected = actionTarget ? selectedItemKeys.includes(memoryActionKey(actionTarget)) : false;
    const isGroupedWithNext = memoryChatIsGroupedToPrevious(messageProps.currentMessage, messageProps.nextMessage);
    const rowStyle = hasMedia || hasAudio
      ? styles.chatMainRowMedia
      : messageProps.position === "right"
        ? styles.chatMainRowTextMine
        : styles.chatMainRowTextOther;
    const groupedGapStyle = isGroupedWithNext ? styles.chatMainGroupedRowGap : null;
    // A send that never landed must say so and stay recoverable. Only outgoing
    // messages can fail, so the banner always sits on the sent (right) side;
    // media rows carry no MemoryMessage and report upload failures separately.
    const deliveryMessage = hasMemoryDeliveryStrip(
      messageProps.currentMessage?.memoryMessage?.deliveryStatus
    )
      ? messageProps.currentMessage?.memoryMessage ?? null
      : null;
    // Treat the recovery strip as the next outgoing message in the visual run:
    // the failed bubble groups into it, then the strip owns the normal spacing
    // to the following message (or the composer when it is newest).
    const bubbleBottomGapStyle = deliveryMessage ? styles.chatMainGroupedRowGap : groupedGapStyle;
    const failedBottomGapStyle = isGroupedWithNext
      ? styles.chatMainGroupedRowGap
      : styles.chatMainRowBreakGap;
    // A reply can only reference a message that exists on the server (the
    // column is reply_to_message_id), which rules out two kinds of row: a
    // standalone media row — a photo whose row carries no message_id, so there
    // is nothing to point at — and a message that has not landed yet, which
    // would hand over a local optimistic id. The vendor already blocks `system`
    // rows (dish cards, the unread divider) but neither of these, and the swipe
    // handler drops anything without a memoryMessage. A logical message keeps
    // the swipe wrapper mounted from its first optimistic frame; confirmation
    // only enables the gesture. Swapping plain View -> GestureDetector at sent
    // status remounted Android's measured multiline text subtree and replayed
    // its narrow/wide/settled layout cycle.
    const replyTarget = messageProps.currentMessage?.memoryMessage;
    const canReply = replyTarget ? canReplyToMemoryMessage(replyTarget) : false;
    const placementClientId = replyTarget?.clientId;
    const placementRowKey = String(messageProps.currentMessage?._id ?? "");
    const placementIndex = placementIndexByRowKeyRef.current.get(placementRowKey);
    const rowMessage = messageProps.currentMessage;
    return (
      <MemoryChatPlacementRow
        clientId={placementClientId}
        deliveryStatus={replyTarget?.deliveryStatus}
        layoutGeneration={layoutGeneration}
        onLongPress={() => handleRowLongPress(rowMessage)}
        onPress={selectionMode ? () => handleRowPress(rowMessage) : undefined}
        renderIndex={placementIndex}
        rowKey={placementRowKey}
        style={[styles.chatMainRowSelectionFrame, selected && styles.chatMainRowSelectedBackground]}
      >
        {/* Diagnostics only, and it is not free at row scale: a fiber plus a
            DEP-LESS useEffect that re-runs on every render of every mounted
            row, to call recorders that early-return when profiling is off. */}
        {MEMORY_ROOM_RELEASE_PROFILE_ENABLED ? (
          <MemoryJourneyRenderProbe
            journeySession={journeySession}
            surface="chat_row"
            tab="chat"
          />
        ) : null}
        <ChatMainMessageRow<MemoryChatMainMessage>
          {...messageProps}
          swipeToReply={replyTarget
            ? {
              ...messageProps.swipeToReply,
              isEnabled: true,
              // Swiping while a selection is open would open the composer on a
              // message the toolbar is still acting on, so the gesture stands
              // down for as long as the selection does.
              isGestureEnabled: canReply && !selectionMode
            }
            : undefined}
          containerStyle={{
            left: [rowStyle, styles.chatMainIncomingRowEdge, bubbleBottomGapStyle],
            right: [rowStyle, bubbleBottomGapStyle]
          }}
        />
        {deliveryMessage ? (
          <View style={[styles.chatMainFailedRow, failedBottomGapStyle]}>
            <MessageDeliveryState
              mine
              onCancel={() => onCancelFailedMessage(deliveryMessage)}
              onRetry={() => onRetryFailedMessage(deliveryMessage)}
              status={deliveryMessage.deliveryStatus}
            />
          </View>
        ) : null}
      </MemoryChatPlacementRow>
    );
  }, [handleRowLongPress, handleRowPress, journeySession, layoutGeneration, onCancelFailedMessage, onOpenDish, onRateDish, onRetryFailedMessage, selectedItemKeys, selectionMode]);

  // The long-press action menu used to arrive through the vendor's reactions
  // wrapper, so `reactions.isEnabled` had to stay true purely to get a
  // long-press handler even though emoji reactions are off. That put a
  // useState, a second useState for the anchor, a useSharedValue, an
  // useAnimatedStyle, an extra Reanimated view and a per-row menu publisher on
  // EVERY mounted row. The vendor's default bubble path already exposes
  // onLongPressMessage and now reports the bubble's window geometry with it, so
  // the menu opens from there and rows stop paying for the wrapper.
  // Message group tails are rendered by renderCustomView so they live INSIDE
  // the vendor's animated wrapper and scale together with the bubble on
  // long-press.
  const renderBubble = useCallback((bubbleProps: ChatMainBubbleProps<MemoryChatMainMessage>) => {
    const showTail = !memoryChatIsGroupedToPrevious(bubbleProps.currentMessage, bubbleProps.previousMessage);
    return (
      <ChatMainBubble
        {...bubbleProps}
        wrapperStyle={{
          left: [
            styles.chatMainBubbleLeft,
            showTail && styles.chatMainBubbleLeftWithTail
          ],
          right: [
            styles.chatMainBubbleRight,
            showTail && styles.chatMainBubbleRightWithTail
          ]
        }}
        // This surface owns its own timestamp and delivery marks: the time is
        // pinned inside the message text by ChatMainStableMessageText, and a
        // failed send gets the recovery strip in renderMessage. The vendor's
        // bottom metadata row was therefore built on EVERY mounted row and then
        // clipped to height 0 — two wrapper Views, Time's View/Text plus a
        // dayjs format per render, and the tick View/Texts, all invisible.
        // Returning null here means the vendor skips the container entirely
        // (see Bubble's renderBubbleBody), so the row stops paying for it.
        // Do not reintroduce a hidden bottomContainerStyle: it would make any
        // future bottom content silently invisible instead of merely unstyled.
        //
        // Deliberately NO onPressMessage/onLongPressMessage: the row owns both
        // gestures now (see MemoryChatPlacementRow). Handing either of them to
        // the bubble puts a Pressable back inside it, and that Pressable would
        // win every touch that lands on the bubble, so a long press would only
        // select when it landed on the empty space beside one.
        renderTime={renderNoBubbleBottom}
        renderTicks={renderNoBubbleBottom}
      />
    );
  }, []);

  const renderMessageText = useCallback((textProps: ChatMainMessageTextProps<MemoryChatMainMessage>) => {
    const { currentMessage, position = "left" } = textProps;
    const body = currentMessage.text?.trim() ?? "";
    if (!body) return null;

    const mine = position === "right";
    const hasMedia = memoryChatMessageAttachments(currentMessage).length > 0;
    const senderVisible = !hasMedia && !mine && Boolean(currentMessage.showSenderDetails);
    return (
      <ChatMainStableMessageText
        body={body}
        hasMedia={hasMedia}
        key={`${String(currentMessage._id)}:${resolvedTheme}`}
        layoutGeneration={layoutGeneration}
        mine={mine}
        replyVisible={Boolean(currentMessage.replyMessage)}
        rowKey={String(currentMessage._id)}
        senderVisible={senderVisible}
        time={memoryChatTimestampLabel(currentMessage)}
      />
    );
  }, [layoutGeneration, resolvedTheme]);

  const renderMessageMedia = useCallback((props: { currentMessage: MemoryChatMainMessage }) => {
    const attachments = memoryChatMessageAttachments(props.currentMessage);
    if (attachments.length === 0) return null;

    // Media-only messages stamp the time on the media itself; captioned media
    // gets the inline timestamp at the end of the caption instead.
    const hasCaption = Boolean(props.currentMessage.text?.trim());
    const timestamp = hasCaption ? undefined : memoryChatTimestampLabel(props.currentMessage);

    // Media owns its own touch (open the viewer), so the row underneath cannot
    // see a press on it. `disabled` while selecting hands the touch back — a
    // disabled Pressable declines the responder — and the long press is
    // forwarded so holding a photo selects it exactly like holding text does.
    const selectRow = () => handleRowLongPress(props.currentMessage);
    // `_id` is memoryChatRowKey(message) — it does NOT move when the send
    // confirms, so it anchors a view identity that survives the swap from the
    // optimistic preview to the real photo.
    const rowKey = String(props.currentMessage._id);

    if (attachments.length === 1) {
      const media = attachments[0];
      return (
        <Pressable
          accessibilityRole="imagebutton"
          delayLongPress={CHAT_ROW_LONG_PRESS_DELAY_MS}
          disabled={selectionMode}
          onLongPress={selectRow}
          onPress={() => onOpenMedia(media, attachments)}
          style={styles.chatMainMediaFrame}
        >
          <SingleMediaPreview
            media={media}
            sizeOverride={memoryChatSingleMediaSize(media, screenWidth)}
            timestamp={timestamp}
            timestampPlacement="bottom-right"
            viewKey={memoryMediaSlotViewKey(rowKey, media, 0)}
          />
        </Pressable>
      );
    }

    return (
      <View style={styles.chatMainMediaFrame}>
        <MediaAttachmentGrid
          gridWidth={memoryChatGridWidth(screenWidth)}
          media={attachments}
          onMediaLongPress={selectRow}
          onOpenMedia={onOpenMedia}
          rowKey={rowKey}
          selectionMode={selectionMode}
          shouldIgnoreMediaOpen={() => false}
          timestamp={timestamp}
        />
      </View>
    );
  }, [handleRowLongPress, onOpenMedia, screenWidth, selectionMode]);

  // Deliberately NOT dependent on `active`: the gate reads that from context, so
  // a tab switch stops invalidating every row through this callback's identity.
  const renderMessageAudio = useCallback((
    audioProps: ChatMainMessageAudioProps<MemoryChatMainMessage>
  ) => (
    // Keyed by message so a RECYCLED audio row cannot carry the previous
    // message's player: FlashList reuses the instance for the next item of the
    // same type, and useAudioPlayer would keep the old playback state while the
    // row now points at different audio. The message text does the same thing
    // for its latched measurement state.
    <ChatMainAudioMessageGate
      {...audioProps}
      journeySession={journeySession}
      key={String(audioProps.currentMessage?._id ?? "")}
      selectionMode={selectionMode}
    />
  ), [journeySession, selectionMode]);

  const renderCustomView = useCallback((props: {
    currentMessage: MemoryChatMainMessage;
    position?: "left" | "right";
    previousMessage?: MemoryChatMainMessage;
  }) => {
    const { currentMessage, position = "left", previousMessage } = props;

    // Tails are absolutely positioned inside the bubble wrapper. Drawn as SVG:
    // the fill overlaps ~4px into the bubble to paint over the bubble's own
    // border at the seam, and the stroke continues that border along the tail's
    // outer edge only so box and tail read as one outlined shape.
    if (position === "right") {
      const showTail = !memoryChatIsGroupedToPrevious(currentMessage, previousMessage);
      if (!showTail) return null;
      return (
        <Svg
          height={11}
          pointerEvents="none"
          style={styles.chatMainBubbleTail}
          viewBox="0 0 11 11"
          width={11}
        >
          <Path
            d="M0 0 H10.6 C9.8 3.8 7 7.6 3.2 9.8 L0 9 Z"
            fill={ROOM_COLORS.sentBubble}
          />
          <Path
            d="M0 0.5 H10.4 C9.6 3.9 6.9 7.5 3.4 9.6"
            fill="none"
            stroke={ROOM_COLORS.sentBubbleBorder}
            strokeWidth={1}
          />
        </Svg>
      );
    }

    const name = currentMessage.user?.name ?? "";
    const hasMedia = memoryChatMessageAttachments(currentMessage).length > 0;
    const showTail = !memoryChatIsGroupedToPrevious(currentMessage, previousMessage);
    const showSender = Boolean(currentMessage.showSenderDetails && name);
    if (!showTail && !showSender) return null;

    return (
      <>
        {showTail ? (
          <Svg
            height={11}
            pointerEvents="none"
            style={styles.chatMainBubbleTailLeft}
            viewBox="0 0 11 11"
            width={11}
          >
            <Path
              d="M11 0 H0.4 C1.2 3.8 4 7.6 7.8 9.8 L11 9 Z"
              fill={ROOM_COLORS.receivedBubble}
            />
            <Path
              d="M11 0.5 H0.6 C1.4 3.9 4.1 7.5 7.6 9.6"
              fill="none"
              stroke={ROOM_COLORS.border}
              strokeWidth={1}
            />
          </Svg>
        ) : null}
        {showSender ? (
          <View style={[styles.chatMainSenderHeader, hasMedia && styles.chatMainSenderHeaderMedia]}>
            <Text numberOfLines={1} style={[styles.senderName, { color: senderAccent(name) }]}>
              {name}
            </Text>
          </View>
        ) : null}
      </>
    );
  }, []);

  const renderSystemMessage = useCallback((props: { currentMessage?: MemoryChatMainMessage }) => {
    if (props.currentMessage?.kind === "unread") {
      // UnreadDivider has always accepted onJumpToLatest and never been given
      // one here, so the "Latest" escape from the divider was dead.
      return <UnreadDivider onJumpToLatest={jumpChatToLatest} />;
    }
    const dish = props.currentMessage?.memoryDish;
    if (!dish) return null;
    return <MemoryChatMainDishSystemMessage dish={dish} onOpenDish={onOpenDish} />;
  }, [jumpChatToLatest, onOpenDish]);

  const handleChatMainLayout = useCallback((event: LayoutChangeEvent) => {
    if (!chatListLayoutMarkedRef.current) {
      chatListLayoutMarkedRef.current = true;
      markMemoryRoomTracePoint("MemoryRoomChatListFirstLayout");
      recordMemoryChatPlacement("CHAT_LIST_FIRST_LAYOUT", {
        bottomClearance: composerClearance.value,
        composerHeight: messageBoxHeight.value,
        contentHeight: placementContentHeightRef.current,
        contentOffset: placementScrollOffsetRef.current,
        keyboardInset: keyboardTopReserve.value,
        layoutGeneration,
        safeAreaInset: collapsedComposerGeometry.safeAreaInset,
        viewportHeight: event.nativeEvent.layout.height
      });
    }
    placementViewportHeightRef.current = event.nativeEvent.layout.height;
    updateMemoryChatPlacementContext({
      bottomClearance: composerClearance.value,
      composerHeight: messageBoxHeight.value,
      contentHeight: placementContentHeightRef.current,
      contentOffset: placementScrollOffsetRef.current,
      keyboardInset: keyboardTopReserve.value,
      viewportHeight: placementViewportHeightRef.current
    });
  }, [
    collapsedComposerGeometry.safeAreaInset,
    composerClearance,
    keyboardTopReserve,
    layoutGeneration,
    messageBoxHeight
  ]);

  const handleChatMainContentSizeChange = useCallback((_width: number, height: number) => {
    if (Math.abs(height - placementContentHeightRef.current) <= 0.5) return;
    placementContentHeightRef.current = height;
    const clientId = placementLatestClientIdRef.current;
    updateMemoryChatPlacementContext({
      bottomClearance: composerClearance.value,
      composerHeight: messageBoxHeight.value,
      contentHeight: height,
      contentOffset: placementScrollOffsetRef.current,
      keyboardInset: keyboardTopReserve.value,
      viewportHeight: placementViewportHeightRef.current
    });
    if (clientId) {
      recordMemoryChatPlacement("CONTENT_SIZE_CHANGED", {
        clientId,
        contentHeight: height
      });
    }
  }, [composerClearance, keyboardTopReserve, messageBoxHeight]);
  const liteListHeader = useMemo(
    () => renderComposerListSpacer(),
    [renderComposerListSpacer]
  );
  const liteListFooter = useMemo(() => (
    <>
      {renderKeyboardTopSpacer()}
      {(canLoadOlderMessages || loadingOlderMessages || olderMessagesFailed) ? (
        <View style={styles.invertedListEdge}>
          <ChatHistoryHeader
            error={olderMessagesFailed ? "history_request_failed" : undefined}
            hasMore={canLoadOlderMessages}
            loading={loadingOlderMessages}
            onLoad={retryOlderPage}
          />
        </View>
      ) : null}
    </>
  ), [
    canLoadOlderMessages,
    loadingOlderMessages,
    olderMessagesFailed,
    renderKeyboardTopSpacer,
    retryOlderPage
  ]);
  const liteListKeyExtractor = useCallback(
    (row: ChatRowViewModel) => row.key,
    []
  );
  const liteListItemType = useCallback(
    (row: ChatRowViewModel) => row.itemType,
    []
  );
  const liteList =
    MEMORY_ROOM_CHAT_RENDERER === "lite-flashlist" ? (
      <FlashList<ChatRowViewModel>
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={styles.chatMainListContent}
        contentOffset={{ x: 0, y: initialScrollOffset }}
        data={liteRows}
        directionalLockEnabled
        drawDistance={720}
        extraData={selectedItemKeys.join("|")}
        getItemType={liteListItemType}
        inverted
        keyExtractor={liteListKeyExtractor}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={liteListFooter}
        ListHeaderComponent={liteListHeader}
        maintainVisibleContentPosition={{
          disabled: !chatMainPreserveHistoryViewport
        }}
        nestedScrollEnabled
        onContentSizeChange={handleChatMainContentSizeChange}
        onEndReached={requestOlderPage}
        onEndReachedThreshold={CHAT_MAIN_OLDER_PAGE_PREFETCH_THRESHOLD}
        onLayout={handleChatMainLayout}
        onMomentumScrollBegin={handleChatMainMomentumBegin}
        onMomentumScrollEnd={handleChatMainMomentumEnd}
        onScroll={handleLiteChatScroll}
        onScrollBeginDrag={handleChatMainScrollBeginDrag}
        onScrollEndDrag={handleChatMainScrollEndDrag}
        ref={listRef as RefObject<FlashListRef<ChatRowViewModel> | null>}
        renderItem={renderLiteChatRow}
        scrollEventThrottle={16}
        style={styles.chatMainMessages}
      />
    ) : (
      <FlatList<ChatRowViewModel>
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={styles.chatMainListContent}
        contentOffset={{ x: 0, y: initialScrollOffset }}
        data={liteRows}
        directionalLockEnabled
        extraData={selectedItemKeys.join("|")}
        initialNumToRender={10}
        inverted
        keyExtractor={liteListKeyExtractor}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={liteListFooter}
        ListHeaderComponent={liteListHeader}
        maintainVisibleContentPosition={
          chatMainPreserveHistoryViewport
            ? CHAT_MAIN_SCROLL_POSITION_CONFIG
            : undefined
        }
        maxToRenderPerBatch={6}
        nestedScrollEnabled
        onContentSizeChange={handleChatMainContentSizeChange}
        onEndReached={requestOlderPage}
        onEndReachedThreshold={CHAT_MAIN_OLDER_PAGE_PREFETCH_THRESHOLD}
        onLayout={handleChatMainLayout}
        onMomentumScrollBegin={handleChatMainMomentumBegin}
        onMomentumScrollEnd={handleChatMainMomentumEnd}
        onScroll={handleLiteChatScroll}
        onScrollBeginDrag={handleChatMainScrollBeginDrag}
        onScrollEndDrag={handleChatMainScrollEndDrag}
        ref={listRef as RefObject<FlatList<ChatRowViewModel> | null>}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={renderLiteChatRow}
        scrollEventThrottle={16}
        style={styles.chatMainMessages}
        updateCellsBatchingPeriod={32}
        windowSize={3}
      />
    );

  // Memoised because FlashList recomputes layout when its props change, and an
  // object literal in JSX is a NEW object on every render of this surface —
  // every keystroke, every realtime tick. FlatList tolerated the churn; on
  // FlashList it roughly doubled the frame-time tail during a tab switch
  // (90th 61ms -> 117ms measured on device).
  const chatMainListProps = useMemo(() => ({
        contentContainerStyle: styles.chatMainListContent,
        contentOffset: { x: 0, y: initialScrollOffset },
        directionalLockEnabled: true,
        extraData: selectedItemKeys.join("|"),
        initialNumToRender: unreadAnchorPlan.initialRenderCount,
        onScrollToIndexFailed: handleChatMainScrollToIndexFailed,
        onViewableItemsChanged: handleChatMainViewableItems,
        viewabilityConfig: CHAT_MAIN_VIEWABILITY_CONFIG,
        maintainVisibleContentPosition: chatMainPreserveHistoryViewport
          ? CHAT_MAIN_SCROLL_POSITION_CONFIG
          : undefined,
        maxToRenderPerBatch: CHAT_MAIN_MAX_RENDER_BATCH,
        nestedScrollEnabled: true,
        onEndReached: requestOlderPage,
        onEndReachedThreshold: CHAT_MAIN_OLDER_PAGE_PREFETCH_THRESHOLD,
        onScroll: handleChatMainScroll,
        onScrollBeginDrag: handleChatMainScrollBeginDrag,
        onScrollEndDrag: handleChatMainScrollEndDrag,
        onMomentumScrollBegin: handleChatMainMomentumBegin,
        onMomentumScrollEnd: handleChatMainMomentumEnd,
        onContentSizeChange: handleChatMainContentSizeChange,
        onLayout: handleChatMainLayout,
        // Android otherwise keeps off-window message subtrees attached to
        // the native hierarchy even though FlatList has virtualized their
        // React rows. Detaching them is essential for bounded route pop
        // cost in populated rooms; iOS retains its safer default because
        // transformed/inverted clipping behaves differently there.
        //
        // Measured 2026-08-01: forcing this off does NOT reduce the blank
        // gaps on a fast fling (device A/B, gaps unchanged), so Android's
        // inverted-list clipping is not what causes them. The render window
        // above is. Do not flip this again chasing blanks.
        removeClippedSubviews: Platform.OS === "android",
        scrollEnabled: true,
        updateCellsBatchingPeriod: CHAT_MAIN_CELL_BATCHING_PERIOD_MS,
        windowSize: CHAT_MAIN_WINDOW_SIZE
  }), [
    chatMainPreserveHistoryViewport,
    handleChatMainContentSizeChange,
    handleChatMainLayout,
    handleChatMainMomentumBegin,
    handleChatMainMomentumEnd,
    handleChatMainScroll,
    handleChatMainScrollBeginDrag,
    handleChatMainScrollEndDrag,
    handleChatMainScrollToIndexFailed,
    handleChatMainViewableItems,
    initialScrollOffset,
    requestOlderPage,
    selectedItemKeys,
    unreadAnchorPlan.initialRenderCount
  ]);

  // One provider around both return paths, so activation reaches the audio rows
  // that need it without travelling through the row memo's identity checks.
  const surfaceInner = (
    <ChatSurfaceActiveContext.Provider value={active}>
      {/* Held transparent only while an unread anchor is still being applied,
          so the entry cannot show the newest messages and then jump to the
          divider. With no unread anchor this is always 1 and the layer behaves
          exactly as before. */}
      <View
        style={[
          styles.chatMainMessagesLayer,
          !unreadAnchorSettled && styles.chatMainMessagesLayerAnchoring
        ]}
      >
        {unreadAnchorPending ? (
          <View
            accessibilityLabel="Loading unread messages"
            style={styles.chatMainMessages}
          />
        ) : nativeRendererActive ? (
          <>
            <NativeMemoryChatList
              active={active}
              bottomClearance={collapsedComposerGeometry.listClearance}
              diagnosticsEnabled={MEMORY_ROOM_RELEASE_PROFILE_ENABLED}
              initialAnchor={nativeInitialAnchor}
              myUsername={myUsername}
              onLoadOlder={requestOlderPage}
              onMessageLongPress={(event) =>
                handleNativeMessageLongPress(event.nativeEvent.key)}
              onMessagePress={(event) =>
                handleNativeMessagePress(event.nativeEvent.key)}
              onMetrics={handleNativeMetrics}
              onReplySwipe={(event) =>
                replyToLiteMessage(event.nativeEvent.key)}
              onRevealStateChanged={handleNativeRevealState}
              onVisibleRangeChanged={handleNativeVisibleRange}
              rows={liteRows}
              scrollCommand={nativeScrollCommand}
              selectedKeys={nativeSelectedRowKeys}
              style={styles.chatMainMessages}
              topClearance={CHAT_HEADER_CLEARANCE}
              warmWhileInactive
            />
            {!nativeNearLatest && liteRows.length > 0 ? (
              <Pressable
                accessibilityLabel="Jump to latest memory activity"
                accessibilityRole="button"
                onPress={jumpNativeToLatest}
                style={[
                  styles.chatLatestButton,
                  { bottom: collapsedComposerGeometry.listClearance + 12 }
                ]}
              >
                <Ionicons
                  name="chevron-down"
                  size={20}
                  color={ROOM_COLORS.onCool}
                />
              </Pressable>
            ) : null}
            {olderMessagesFailed ? (
              <View style={styles.chatHistoryRetryOverlay}>
                <ChatHistoryHeader
                  error="history_request_failed"
                  hasMore={canLoadOlderMessages}
                  loading={loadingOlderMessages}
                  onLoad={retryOlderPage}
                />
              </View>
            ) : null}
          </>
        ) : liteRendererActive ? liteList : (
          <>
          <ChatMain<MemoryChatMainMessage>
          colorScheme={resolvedTheme}
          listEngine={MEMORY_ROOM_CHAT_VENDOR_FLASHLIST ? "flashlist" : "flatlist"}
          getItemType={chatMainItemType}
          flashListProps={CHAT_MAIN_FLASHLIST_PROPS}
          disableKeyboardProvider
          initiallyInitialized
          provideSafeAreaContext={false}
          isDayAnimationEnabled={false}
          // The vendor's built-in control is not styled by this app, so it
          // rendered its unstyled fallback: a 40x40 white circle containing the
          // literal glyph "V". The room owns the real affordance below.
          isScrollToBottomEnabled={false}
          isAvatarOnTop
          isUserAvatarVisible={false}
          avatarImageStyle={chatMainAvatarImageStyle}
          avatarTextStyle={styles.chatMainAvatarText}
          keyboardAvoidingViewProps={chatMainKeyboardAvoidingProps}
          renderBottomSpacer={renderComposerListSpacer}
          renderTopSpacer={renderKeyboardTopSpacer}
          listProps={chatMainListProps}
          loadEarlierMessagesProps={chatMainLoadEarlierProps}
          messageTextProps={chatMainMessageTextProps}
          messages={windowedChatMessages}
          messagesContainerRef={listRef as RefObject<ChatMainAnimatedList<MemoryChatMainMessage>>}
          messagesContainerStyle={styles.chatMainMessages}
          onQuickReply={handleChatMainQuickReply}
          onSend={handleChatMainSend}
          renderBubble={renderBubble}
          renderCustomView={renderCustomView}
          renderInputToolbar={renderInputToolbar}
          renderMessage={renderMessage}
          renderMessageAudio={renderMessageAudio}
          renderMessageImage={renderMessageMedia}
          renderMessageText={renderMessageText}
          renderMessageVideo={renderMessageMedia}
          renderSystemMessage={renderSystemMessage}
          reply={chatMainReply}
          reactions={chatMainReactions}
          text={message}
          textInputProps={chatMainTextInputProps}
          user={currentUser}
          />
          {/* Scroll position alone decides this. Forcing it visible for the
              whole life of an unread window pinned the pill over the newest
              messages once the reader scrolled down to them, and it was
              redundant anyway: a windowed entry sits about twelve rows from
              the bottom, well past the threshold that shows it naturally. */}
          {chatLatestButtonVisible && displayChatMessages.length > 0 ? (
            <Pressable
              accessibilityLabel={
                unreadCount > 0
                  ? `Jump to latest, ${unreadCount} unread`
                  : "Jump to latest memory activity"
              }
              accessibilityRole="button"
              onPress={jumpChatToLatest}
              style={[
                styles.chatLatestButton,
                { bottom: collapsedComposerGeometry.listClearance + 12 }
              ]}
            >
              <Ionicons
                name="chevron-down"
                size={20}
                color={ROOM_COLORS.onCool}
              />
            </Pressable>
          ) : null}
          </>
        )}
      </View>
      <View pointerEvents="none" style={styles.chatKeyboardBridge} />
      {composerToolbar}
      {voiceRecorderMounted ? <VoiceRecorderHost onReady={handleVoiceRecorderReady} /> : null}
    </ChatSurfaceActiveContext.Provider>
  );

  // Android: a native WindowInsetsAnimation-driven container moves the whole
  // surface (list + composer + bridge) per-frame on the native side, gluing it
  // to the keyboard without a Fabric commit per frame. iOS: the JS driven-height
  // (park) transform. Both keep the composer + list as one rigid unit.
  if (USE_NATIVE_KEYBOARD_INSET) {
    // The native view is ONLY a flex container that translates itself; all
    // layout (including the absolutely-positioned composer + bridge) happens in
    // a plain RN View child. A custom ExpoView is not a reliable containing
    // block for `position:absolute` children, so nesting a normal View restores
    // standard RN layout while the native view still owns the keyboard motion.
    return (
      <NativeKeyboardInsetView
        active={active}
        closedGap={closedComposerBottomPadding}
        openGap={COMPOSER_KEYBOARD_OPEN_GAP}
        debug={NATIVE_KEYBOARD_INSET_DEBUG}
        pointerEvents={active ? "auto" : "none"}
        style={styles.chatKeyboardInsetContainer}
      >
        <View style={styles.chatMainSurface}>
          {surfaceInner}
        </View>
      </NativeKeyboardInsetView>
    );
  }

  return (
    <Reanimated.View
      pointerEvents={active ? "auto" : "none"}
      style={[styles.chatMainSurface, surfaceKeyboardStyle]}
    >
      {surfaceInner}
    </Reanimated.View>
  );
}

// Timestamp placement rule: the visible time remains pinned at the wrapper's
// bottom-right, while a non-text inline spacer participates in the body Text's
// FIRST native line-break pass. Its width comes synchronously from the bundled
// timestamp font metrics plus the established 8 px gap. No second timestamp
// string or post-paint measurement state exists in the native text tree.
function ChatMainBodyWithTime({
  bodyStyle,
  layoutGeneration,
  linkStyle,
  rowKey,
  stretch = false,
  text,
  time,
  timeStyle
}: {
  bodyStyle: StyleProp<TextStyle>;
  layoutGeneration: number;
  linkStyle: StyleProp<TextStyle>;
  // Stretch only when a sibling (media block, reply card) defines the bubble
  // width independently, so the time can pin to the bubble's right edge.
  // Default hugs content: stretching inside a bubble whose width comes FROM
  // this wrapper is circular sizing, which Yoga resolves differently across
  // layout passes — bubbles visibly oscillated between the two answers.
  rowKey: string;
  stretch?: boolean;
  text: string;
  time: string;
  timeStyle: StyleProp<TextStyle>;
}) {
  const measurementOwnerRef = useRef({
    active: true,
    layoutGeneration,
    rowKey
  });
  measurementOwnerRef.current = {
    active: true,
    layoutGeneration,
    rowKey
  };
  useEffect(() => () => {
    measurementOwnerRef.current.active = false;
  }, []);
  const timestampFontScale = PixelRatio.getFontScale();
  const timestampReservationWidth = useMemo(
    () => memoryChatTimestampReservationWidth(time, {
      fontScale: timestampFontScale,
      fontSize: CHAT_TIME_FONT_SIZE,
      gap: CHAT_TIME_GAP
    }),
    [time, timestampFontScale]
  );
  const handleTextLayout = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const owner = measurementOwnerRef.current;
    if (
      !owner.active ||
      owner.layoutGeneration !== layoutGeneration ||
      owner.rowKey !== rowKey
    ) {
      return;
    }
    const eventLines = event.nativeEvent.lines;
    if (!eventLines || eventLines.length === 0) return;
    recordMemoryChatPlacement("CHAT_TEXT_MEASUREMENT_RECEIVED", {
      layoutGeneration,
      lineCount: eventLines.length,
      rowHeight: eventLines.reduce(
        (height, line) => Math.max(height, line.y + line.height),
        0
      ),
      rowKey
    });
  }, [layoutGeneration, rowKey]);

  return (
    <View style={[styles.chatMainBodyWithTime, stretch && styles.chatMainBodyWithTimeStretch]}>
      <Text
        accessibilityLabel={text}
        android_hyphenationFrequency="none"
        onTextLayout={handleTextLayout}
        style={styles.chatMainBodyHostText}
        textBreakStrategy="simple"
      >
        <SmartMessageTextContent
          linkStyle={linkStyle}
          text={text}
          textStyle={bodyStyle}
        />
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.chatMainTimeSpacer,
            { width: timestampReservationWidth }
          ]}
        />
      </Text>
      <View
        pointerEvents="none"
        style={styles.chatMainTimePinned}
      >
        <Text
          numberOfLines={1}
          style={[styles.inlineTimestampText, timeStyle]}
        >
          {time}
        </Text>
      </View>
    </View>
  );
}

// Delivery confirmation replaces the MemoryMessage projection but does not
// change text geometry. Keeping this subtree memoized on geometry primitives
// prevents Android from re-running the multiline text/spacer measurement cycle
// (narrow → wide → settled) merely because pending became sent.
const ChatMainStableMessageText = memo(function ChatMainStableMessageText({
  body,
  hasMedia,
  layoutGeneration,
  mine,
  replyVisible,
  rowKey,
  senderVisible,
  time
}: {
  body: string;
  hasMedia: boolean;
  layoutGeneration: number;
  mine: boolean;
  replyVisible: boolean;
  rowKey: string;
  senderVisible: boolean;
  time: string;
}) {
  const bodyStyle = [
    hasMedia ? styles.mediaCaptionText : styles.textOnlyBubbleText,
    mine ? styles.messageTextMine : styles.messageTextOther
  ];
  return (
    <View
      style={[
        hasMedia ? styles.mediaCaptionContainer : styles.chatMainTextContainer,
        senderVisible && styles.chatMainTextContainerWithSender
      ]}
    >
      <ChatMainBodyWithTime
        bodyStyle={bodyStyle}
        layoutGeneration={layoutGeneration}
        linkStyle={mine ? styles.messageLinkTextMine : styles.messageLinkText}
        rowKey={rowKey}
        // Stretch whenever a sibling can out-width the text (media block,
        // reply card, or the sender-name header on received group starts),
        // so the time pins to the bubble's right edge instead of hugging
        // the text mid-bubble.
        stretch={hasMedia || replyVisible || senderVisible}
        text={body}
        time={time}
        timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
      />
    </View>
  );
});

function formatAudioPlaybackTime(seconds: number | null | undefined) {
  const total = Number.isFinite(seconds ?? NaN) ? Math.max(0, Math.floor(seconds ?? 0)) : 0;
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

function audioDurationSeconds(audio: MemoryPhoto | null, playerDuration: number) {
  if (Number.isFinite(playerDuration) && playerDuration > 0) return playerDuration;
  const durationMs = audio?.durationMs ?? null;
  return durationMs && durationMs > 0 ? durationMs / 1000 : 0;
}

function pauseMediaPlayerQuietly(player: { pause: () => void }) {
  try {
    player.pause();
  } catch {
    // Expo can release hidden media players before React cleanup runs on Android.
  }
}

function ChatMainAudioMessage({
  currentMessage,
  journeySession,
  position = "left",
  selectionMode = false
}: ChatMainMessageAudioProps<MemoryChatMainMessage> & {
  journeySession: MemoryRoomJourneySession;
  position?: "left" | "right";
  selectionMode?: boolean;
}) {
  const uri = currentMessage.audio ?? null;
  const mine = position === "right";
  const audio = memoryChatAudioAttachment(currentMessage);
  const hasCaption = Boolean(currentMessage.text?.trim());
  const timestamp = hasCaption ? "" : memoryChatTimestampLabel(currentMessage);
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const currentTime = status.currentTime;
  const duration = audioDurationSeconds(audio, status.duration);
  const progress = duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0;
  const isError = status.playbackState === "error";

  useEffect(() => {
    const releasePlayerCounter = adjustMemoryRoomResourceCounter(
      "MemoryRoomActivePlayers",
      1
    );
    recordMemoryRoomJourney(journeySession, "PLAYER_CREATED", {
      playerKind: "audio",
      tab: "chat"
    });
    return () => {
      pauseMediaPlayerQuietly(player);
      releasePlayerCounter();
      recordMemoryRoomJourney(journeySession, "PLAYER_RELEASED", {
        playerKind: "audio",
        tab: "chat"
      });
    };
  }, [journeySession, player]);

  function togglePlayback() {
    if (!uri || isError) return;
    try {
      if (player.playing) {
        player.pause();
        return;
      }
      if (duration > 0 && player.currentTime >= duration - 0.25) {
        void player.seekTo(0).then(() => player.play());
        return;
      }
      player.play();
    } catch {
      console.warn("[memory-chat] Could not toggle audio playback");
    }
  }

  if (!uri) return null;

  return (
    <View style={styles.chatMainAudioContent}>
      <Pressable
        accessibilityLabel={isPlaying ? "Pause audio message" : "Play audio message"}
        accessibilityRole="button"
        accessibilityState={{ disabled: isError || selectionMode }}
        // Same rule as media: while a selection is open the row owns the touch,
        // so tapping anywhere — including here — extends or clears it.
        disabled={isError || selectionMode}
        hitSlop={8}
        onPress={togglePlayback}
        style={[styles.chatMainAudioButton, mine && styles.chatMainAudioButtonMine, isError && styles.chatMainAudioButtonDisabled]}
      >
        <Ionicons name={isPlaying ? "pause" : "play"} size={18} color={mine ? ROOM_COLORS.onSentBubble : ROOM_COLORS.cool} />
      </Pressable>
      <View style={styles.chatMainAudioBody}>
        <View style={styles.chatMainAudioHeader}>
          <Ionicons name="mic-outline" size={14} color={mine ? ROOM_COLORS.sentReplyText : ROOM_COLORS.muted} />
          <Text numberOfLines={1} style={[styles.chatMainAudioTitle, mine && styles.chatMainAudioTitleMine]}>
            {isError ? "Audio unavailable" : "Audio message"}
          </Text>
        </View>
        <View style={[styles.chatMainAudioTrack, mine && styles.chatMainAudioTrackMine]}>
          <View style={[styles.chatMainAudioProgress, mine && styles.chatMainAudioProgressMine, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <View style={styles.chatMainAudioFooter}>
          <Text style={[styles.chatMainAudioTime, mine && styles.chatMainAudioTimeMine]}>
            {formatAudioPlaybackTime(currentTime)} / {formatAudioPlaybackTime(duration)}
          </Text>
          {timestamp ? (
            <Text style={[styles.inlineTimestampText, mine ? styles.inlineTimestampMine : styles.inlineTimestampOther]}>
              {timestamp}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function MemoryChatMainVoiceComposer({
  durationMs,
  sending
}: {
  durationMs: number;
  sending: boolean;
}) {
  return (
    <View style={styles.chatMainVoiceComposer}>
      <View style={[styles.chatMainVoiceDot, sending && styles.chatMainVoiceDotSending]} />
      <View style={styles.chatMainVoiceCopy}>
        <Text numberOfLines={1} style={styles.chatMainVoiceTitle}>
          {sending ? "Sending audio" : "Recording"}
        </Text>
        <Text numberOfLines={1} style={styles.chatMainVoiceTime}>
          {formatAudioPlaybackTime(durationMs / 1000)}
        </Text>
      </View>
    </View>
  );
}

type MemoryChatMainToolbarProps = {
  active: boolean;
  collapsedMessageBoxHeight: number;
  composerClearance: SharedValue<number>;
  editingMessage: MemoryMessage | null;
  inputRef: RefObject<NativeChatInputHandle | null>;
  lastTextSubmitAtRef: RefObject<number>;
  messageBoxHeight: SharedValue<number>;
  myUsername: string;
  onCancelEdit: () => void;
  onCancelVoice: () => void;
  onClearReply?: () => void;
  onInputToolbarLayout: (event: LayoutChangeEvent) => void;
  onSend?: (
    messages: Partial<MemoryChatMainMessage> | Partial<MemoryChatMainMessage>[],
    shouldResetInputToolbar: boolean
  ) => void;
  onSendAudio: () => void;
  onStartAudio: () => void;
  replyMessage?: ChatMainReplyMessage | null;
  text?: string;
  textInputProps?: Partial<TextInputProps>;
  textSubmitInFlightRef: RefObject<boolean>;
  toolbarInsetStyle: StyleProp<ViewStyle>;
  themeMode: "dark" | "light";
  voiceActive: boolean;
  voiceDisabled: boolean;
  voiceDurationMs: number;
  voiceSending: boolean;
};

function MemoryChatMainInputToolbar({
  active,
  collapsedMessageBoxHeight,
  composerClearance,
  editingMessage,
  inputRef,
  lastTextSubmitAtRef,
  messageBoxHeight,
  myUsername,
  onCancelEdit,
  onCancelVoice,
  onClearReply,
  onInputToolbarLayout,
  onSend,
  onSendAudio,
  onStartAudio,
  replyMessage,
  text,
  textInputProps,
  textSubmitInFlightRef,
  themeMode,
  toolbarInsetStyle,
  voiceActive,
  voiceDisabled,
  voiceDurationMs,
  voiceSending
}: MemoryChatMainToolbarProps) {
  useEffect(
    () => adjustMemoryRoomResourceCounter("MemoryRoomMountedChatInputs", 1),
    []
  );
  const [draft, setDraft] = useState(text ?? "");
  const [nativeEventCount, setNativeEventCount] = useState(0);
  const nativeEventCountRef = useRef(0);
  const draftRef = useRef(draft);
  const latestExternalTextRef = useRef(text ?? "");
  const ignoreExternalTextUntilResetRef = useRef(false);
  const trimmedText = draft.trim();
  const hasText = trimmedText.length > 0;
  const disabled = voiceActive && voiceDisabled;
  const label = voiceActive ? "Send audio message" : hasText ? "Send message" : "Record audio message";
  // 0 = mic, 1 = send. Driven from the native text event on the UI thread, the
  // same way the input's height already is, so the button flips in the
  // keystroke's own frame. Routing it through React state made it wait on a JS
  // round trip plus a commit, which is visible while typing fast — the box grew
  // instantly and the button lagged behind it.
  const sendAffordance = useSharedValue(text && text.trim().length > 0 ? 1 : 0);
  const sendIconStyle = useAnimatedStyle(() => ({
    opacity: sendAffordance.value
  }), [sendAffordance]);
  const micIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - sendAffordance.value
  }), [sendAffordance]);
  const editingBody = editingMessage?.body.trim() ?? "";
  const replyAuthorId = String(replyMessage?.user?._id ?? "");
  const replyAuthor = replyAuthorId && replyAuthorId === myUsername ? "You" : replyMessage?.user?.name || "Unknown";
  const replyBody = replyMessage?.text || (replyMessage?.image ? "Photo" : replyMessage?.audio ? "Audio" : "Message");
  const messageBoxHeightStyle = useAnimatedStyle(() => ({
    height: messageBoxHeight.value
  }), [messageBoxHeight]);
  const nativeInputColors = {
    cursor: processColor(ROOM_COLORS.cool) as number,
    fill: processColor(ROOM_COLORS.panelRaised) as number,
    placeholder: processColor(ROOM_COLORS.muted) as number,
    stroke: processColor(ROOM_COLORS.borderStrong) as number,
    text: processColor(ROOM_COLORS.onSurface) as number
  };

  const updateMessageBoxHeight = useCallback((nextHeight: number) => {
    const previousHeight = messageBoxHeight.value;
    if (Math.abs(nextHeight - previousHeight) <= 0.5) return;
    messageBoxHeight.value = nextHeight;
    composerClearance.value = Math.max(0, composerClearance.value + nextHeight - previousHeight);
  }, [composerClearance, messageBoxHeight]);

  // The button rides the UI thread; the TEXT deliberately does not. Routing the
  // text event through a worklet + runOnJS delayed the draft relative to the
  // touch that sends it, which is how a send could go out against stale text.
  const handleNativeHasTextChange = useEvent<NativeChatInputHasTextEvent>((event) => {
    "worklet";
    sendAffordance.value = event.hasText ? 1 : 0;
  }, ["onHasTextChange"]);

  const handleNativeHeightChange = useEvent<NativeChatInputHeightEvent>((event) => {
    "worklet";
    const nextHeight = Math.max(
      collapsedMessageBoxHeight,
      Math.min(COMPOSER_INPUT_MAX_HEIGHT, Math.ceil(event.height))
    );
    const previousHeight = messageBoxHeight.value;
    if (Math.abs(nextHeight - previousHeight) <= 0.5) return;
    messageBoxHeight.value = nextHeight;
    composerClearance.value = Math.max(0, composerClearance.value + nextHeight - previousHeight);
  }, ["onHeightChange"]);

  useEffect(() => {
    const externalText = text ?? "";
    if (ignoreExternalTextUntilResetRef.current) {
      latestExternalTextRef.current = externalText;
      if (externalText.length === 0) {
        ignoreExternalTextUntilResetRef.current = false;
      }
      return;
    }
    if (externalText === latestExternalTextRef.current) return;
    latestExternalTextRef.current = externalText;
    if (externalText === draftRef.current) return;
    draftRef.current = externalText;
    // An external set (edit prefill, cancel, clear-after-send) never produces a
    // native text event, so the affordance has to follow it explicitly.
    sendAffordance.value = externalText.trim().length > 0 ? 1 : 0;
    setDraft(externalText);
  }, [sendAffordance, text]);

  useEffect(() => {
    if (Platform.OS !== "android" && (text ?? "").length === 0) {
      updateMessageBoxHeight(collapsedMessageBoxHeight);
    }
  }, [collapsedMessageBoxHeight, text, updateMessageBoxHeight]);

  useEffect(() => {
    if (active) return;
    void inputRef.current?.blur();
  }, [active, inputRef]);

  useEffect(() => {
    if (!voiceActive) return;
    updateMessageBoxHeight(collapsedMessageBoxHeight);
  }, [collapsedMessageBoxHeight, updateMessageBoxHeight, voiceActive]);

  function handleChangeText(value: string) {
    draftRef.current = value;
    latestExternalTextRef.current = value;
    // Android's affordance is owned by the native-event worklet below. Setting
    // it again from here would let a queued JS callback resurrect a stale value
    // after a send has already reset it.
    if (Platform.OS !== "android") {
      sendAffordance.value = value.trim().length > 0 ? 1 : 0;
    }
    setDraft(value);
    textInputProps?.onChangeText?.(value);
  }

  function handleContentSizeChange(event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) {
    const contentHeight = event.nativeEvent.contentSize.height + COMPOSER_INPUT_BORDER_HEIGHT;
    const nextHeight = Math.max(
      collapsedMessageBoxHeight,
      Math.min(COMPOSER_INPUT_MAX_HEIGHT, Math.ceil(contentHeight))
    );
    updateMessageBoxHeight(nextHeight);
    textInputProps?.onContentSizeChange?.(event);
  }

  function handleNativeTextChange(event: NativeSyntheticEvent<NativeChatInputTextEvent>) {
    nativeEventCountRef.current = event.nativeEvent.eventCount;
    setNativeEventCount(event.nativeEvent.eventCount);
    handleChangeText(event.nativeEvent.text);
  }

  async function handlePress() {
    if (voiceActive) {
      if (!voiceDisabled) onSendAudio();
      return;
    }

    if (Platform.OS === "android") {
      // Always ask the native buffer what this tap means. The first character
      // can be painted before its JS/event-derived Send affordance arrives;
      // native atomic capture still sees and submits it instead of accidentally
      // starting voice recording.
      if (textSubmitInFlightRef.current) return;
      textSubmitInFlightRef.current = true;
      const pressedAt = performance.now();
      const clientId = createRequestId();
      const composerHeightBefore = messageBoxHeight.value;
      try {
        const submission: NativeChatInputSubmitResult | undefined = await inputRef.current?.submit();
        if (!submission) return;
        recordMemoryChatPlacement("NATIVE_SUBMIT", {
          clientId,
          eventTimestamp: submission.nativeSubmitAtMs
        });
        recordMemoryChatPlacement("PAYLOAD_CAPTURED", {
          clientId,
          eventTimestamp: submission.payloadCapturedAtMs
        });
        recordMemoryChatPlacement("INPUT_CLEARED", {
          clientId,
          eventTimestamp: submission.inputClearedAtMs
        });
        recordMemoryChatPlacement("JS_SUBMIT_RECEIVED", {
          clientId,
          eventTimestamp: performance.now()
        });
        nativeEventCountRef.current = submission.eventCount;
        const outgoingText = submission.text.trim();
        if (outgoingText) {
          recordMemoryChatPlacement("SEND_PRESS", {
            clientId,
            composerHeight: composerHeightBefore,
            eventTimestamp: pressedAt
          });
          recordMemoryChatPlacement("COMPOSER_HEIGHT_CHANGED", {
            clientId,
            composerHeight: messageBoxHeight.value
          });
          lastTextSubmitAtRef.current = Date.now();
          draftRef.current = "";
          ignoreExternalTextUntilResetRef.current = true;
          latestExternalTextRef.current = "";
          sendAffordance.value = 0;
          setDraft("");
          onSend?.({
            _id: clientId,
            createdAt: new Date(),
            text: outgoingText
          } as Partial<MemoryChatMainMessage>, true);
          return;
        }
        if (
          lastTextSubmitAtRef.current > 0 &&
          Date.now() - lastTextSubmitAtRef.current < CHAT_TEXT_SEND_MIC_GUARD_MS
        ) return;
        onStartAudio();
      } catch {
        return;
      } finally {
        textSubmitInFlightRef.current = false;
      }
      return;
    }

    // iOS uses the controlled TextInput buffer; Android never relies on this
    // React state to decide whether a tap is Send or Mic.
    if (sendAffordance.value === 1) {
      const outgoingText = draftRef.current.trim();
      if (!outgoingText) return;
      const clientId = createRequestId();
      const submitAt = performance.now();
      recordMemoryChatPlacement("NATIVE_SUBMIT", {
        clientId,
        eventTimestamp: submitAt
      });
      recordMemoryChatPlacement("PAYLOAD_CAPTURED", {
        clientId,
        eventTimestamp: submitAt
      });
      recordMemoryChatPlacement("SEND_PRESS", {
        clientId,
        composerHeight: messageBoxHeight.value
      });
      draftRef.current = "";
      ignoreExternalTextUntilResetRef.current = true;
      latestExternalTextRef.current = "";
      sendAffordance.value = 0;
      inputRef.current?.clear();
      recordMemoryChatPlacement("INPUT_CLEARED", {
        clientId,
        eventTimestamp: performance.now()
      });
      setDraft("");
      recordMemoryChatPlacement("COMPOSER_HEIGHT_CHANGED", {
        clientId,
        composerHeight: collapsedMessageBoxHeight
      });
      recordMemoryChatPlacement("JS_SUBMIT_RECEIVED", {
        clientId,
        eventTimestamp: performance.now()
      });
      onSend?.({
        _id: clientId,
        createdAt: new Date(),
        text: outgoingText
      } as Partial<MemoryChatMainMessage>, true);
      return;
    }
    onStartAudio();
  }

  return (
    <Reanimated.View onLayout={onInputToolbarLayout} style={[styles.chatMainToolbarShell, toolbarInsetStyle]}>
      <View style={styles.chatMainDraftContent}>
        {!voiceActive && editingMessage ? (
          <View style={styles.chatMainEditingBanner}>
            <View style={styles.chatMainEditingIcon}>
              <Ionicons name="create-outline" size={14} color={ROOM_COLORS.cool} />
            </View>
            <Text numberOfLines={1} style={styles.chatMainEditingText}>
              {editingBody || "Editing message"}
            </Text>
            <Pressable accessibilityLabel="Cancel edit" hitSlop={8} onPress={onCancelEdit}>
              <Text style={styles.chatMainEditingCancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {!voiceActive && replyMessage ? (
          <View style={styles.chatMainDraftReplyBanner}>
            <View style={styles.replyComposerAccent} />
            <View style={styles.replyComposerIcon}>
              <Ionicons name="arrow-undo-outline" size={14} color={ROOM_COLORS.cool} />
            </View>
            <View style={styles.replyComposerCopy}>
              <Text numberOfLines={1} style={styles.replyComposerLabel}>{replyAuthor}</Text>
              <Text numberOfLines={2} style={styles.replyComposerPreview}>{replyBody}</Text>
            </View>
            <Pressable accessibilityLabel="Cancel reply" hitSlop={8} onPress={onClearReply} style={styles.replyComposerClose}>
              <Ionicons name="close" size={15} color={ROOM_COLORS.muted} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.chatMainDraftRow}>
          {voiceActive ? (
            <Pressable
              accessibilityLabel="Cancel audio message"
              accessibilityRole="button"
              disabled={voiceSending}
              onPress={onCancelVoice}
              style={styles.chatMainActionTouchable}
            >
              <View style={[styles.chatMainActionButton, styles.chatMainVoiceCancelButton, voiceSending && styles.chatMainVoiceButtonDisabled]}>
                <Ionicons name="close" size={20} color={ROOM_COLORS.cool} />
              </View>
            </Pressable>
          ) : null}
          {voiceActive ? (
            <MemoryChatMainVoiceComposer
              durationMs={voiceDurationMs}
              sending={voiceSending}
            />
          ) : (
            <Reanimated.View
              style={[
                styles.chatMainDraftMessageBox,
                Platform.OS === "android" && styles.chatMainDraftMessageBoxNative,
                messageBoxHeightStyle
              ]}
            >
              {Platform.OS === "android" ? (
                <AnimatedNativeChatInput
                  // Unconditional: the native prop is declared `String`, not
                  // `String?`, so passing undefined fails conversion. It never
                  // did before Chat was retained, because the surface only
                  // existed while active. An inactive pane is hidden from
                  // assistive tech by RoomPane's accessibilityElementsHidden
                  // and importantForAccessibility, so the label does not need
                  // to be withheld here as well.
                  accessibilityLabel="Type a message"
                  borderRadius={radius.input}
                  borderWidth={1}
                  bottomPadding={10}
                  cursorColor={nativeInputColors.cursor}
                  editable={active}
                  fillColor={nativeInputColors.fill}
                  fontFamily={fontFamilies.medium}
                  fontSize={COMPOSER_INPUT_FONT_SIZE}
                  horizontalPadding={spacing.md}
                  lineHeight={COMPOSER_INPUT_LINE_HEIGHT}
                  maxInputHeight={COMPOSER_INPUT_MAX_HEIGHT}
                  maxLength={MEMORY_TEXT_MAX_LENGTH}
                  minInputHeight={collapsedMessageBoxHeight}
                  onHasTextChange={handleNativeHasTextChange as unknown as NativeChatInputProps["onHasTextChange"]}
                  onHeightChange={handleNativeHeightChange as unknown as NativeChatInputProps["onHeightChange"]}
                  onTextChange={handleNativeTextChange}
                  placeholder="Type a message"
                  placeholderColor={nativeInputColors.placeholder}
                  pointerEvents="box-none"
                  ref={inputRef}
                  strokeColor={nativeInputColors.stroke}
                  style={styles.chatMainNativeDraftInput}
                  textColor={nativeInputColors.text}
                  topPadding={8}
                  value={{ eventCount: nativeEventCount, text: draft }}
                />
              ) : (
                <TextInput
                  accessible={active}
                  accessibilityLabel={active ? "Type a message" : undefined}
                  autoCapitalize="sentences"
                  blurOnSubmit={false}
                  disableFullscreenUI
                  editable={active}
                  enablesReturnKeyAutomatically
                  keyboardAppearance={themeMode === "dark" ? "dark" : "default"}
                  maxLength={MEMORY_TEXT_MAX_LENGTH}
                  multiline
                  onChangeText={handleChangeText}
                  onContentSizeChange={handleContentSizeChange}
                  placeholder="Type a message"
                  placeholderTextColor={ROOM_COLORS.muted}
                  ref={inputRef as RefObject<TextInput | null>}
                  scrollEnabled
                  smartInsertDelete={false}
                  style={styles.chatMainDraftInput}
                  submitBehavior="newline"
                  textContentType="none"
                  value={draft}
                />
              )}
            </Reanimated.View>
          )}
          <View style={styles.chatMainSendContainer}>
            <Pressable
              accessibilityLabel={label}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={handlePress}
              style={styles.chatMainSendTouchable}
            >
              <View style={[styles.chatMainSendButton, disabled && styles.chatMainSendButtonDisabled]}>
                {voiceActive ? (
                  <Ionicons
                    name={voiceSending ? "hourglass-outline" : "send"}
                    size={19}
                    color={ROOM_COLORS.onCool}
                  />
                ) : (
                  <>
                    <Reanimated.View style={[styles.chatMainSendIconLayer, sendIconStyle]}>
                      <Ionicons name="send" size={19} color={ROOM_COLORS.onCool} />
                    </Reanimated.View>
                    <Reanimated.View style={[styles.chatMainSendIconLayer, micIconStyle]}>
                      <Ionicons name="mic-outline" size={19} color={ROOM_COLORS.onCool} />
                    </Reanimated.View>
                  </>
                )}
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Reanimated.View>
  );
}

// Everything the retired long-press menu could do lives here. Reply and Copy
// only appear for a single message — they have no meaning for a multi
// selection — which is the same rule Edit already followed.
function MemoryChatMainSelectionToolbar({
  canDelete,
  copyableMessage,
  count,
  deleteError,
  deleting,
  discardableMessage,
  editableMessage,
  onCancel,
  onCopy,
  onDelete,
  onDiscard,
  onEdit,
  onInputToolbarLayout,
  onReply,
  replyableMessage,
  toolbarInsetStyle
}: {
  canDelete: boolean;
  copyableMessage: MemoryMessage | null;
  count: number;
  deleteError?: string;
  deleting: boolean;
  discardableMessage: MemoryMessage | null;
  editableMessage: MemoryMessage | null;
  onCancel: () => void;
  onCopy: (message: MemoryMessage) => void;
  onDelete: () => void;
  onDiscard: (message: MemoryMessage) => void;
  onEdit: (message: MemoryMessage) => void;
  onInputToolbarLayout: (event: LayoutChangeEvent) => void;
  onReply: (message: MemoryMessage) => void;
  replyableMessage: MemoryMessage | null;
  toolbarInsetStyle: StyleProp<ViewStyle>;
}) {
  return (
    <Reanimated.View onLayout={onInputToolbarLayout} style={[styles.chatMainToolbarShell, toolbarInsetStyle]}>
      <View style={styles.chatMainDraftContent}>
        {deleteError ? <Text style={styles.chatMainError}>{deleteError}</Text> : null}
        <View style={styles.chatMainDraftRow}>
          <View style={styles.chatMainSelectionBox}>
            <Pressable accessibilityLabel="Cancel selection" hitSlop={8} onPress={onCancel} style={styles.selectionInlineButton}>
              <Ionicons name="close" size={20} color={ROOM_COLORS.onSurface} />
            </Pressable>
            <Text numberOfLines={1} style={styles.selectionBarTitle}>
              {count} selected
            </Text>
          </View>
          {replyableMessage ? (
            <Pressable
              accessibilityLabel="Reply to selected message"
              accessibilityRole="button"
              disabled={deleting}
              onPress={() => onReply(replyableMessage)}
              style={[styles.selectionActionButton, deleting && styles.selectionDeleteButtonDisabled]}
            >
              <Ionicons name="arrow-undo-outline" size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.onSurface} />
            </Pressable>
          ) : null}
          {copyableMessage ? (
            <Pressable
              accessibilityLabel="Copy selected message"
              accessibilityRole="button"
              disabled={deleting}
              onPress={() => onCopy(copyableMessage)}
              style={[styles.selectionActionButton, deleting && styles.selectionDeleteButtonDisabled]}
            >
              <Ionicons name="copy-outline" size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.onSurface} />
            </Pressable>
          ) : null}
          {editableMessage ? (
            <Pressable
              accessibilityLabel="Edit selected message"
              accessibilityRole="button"
              disabled={deleting}
              onPress={() => onEdit(editableMessage)}
              style={[styles.selectionEditButton, deleting && styles.selectionDeleteButtonDisabled]}
            >
              <Ionicons name="create-outline" size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.onCool} />
            </Pressable>
          ) : null}
          {/* Mutually exclusive with Delete: Delete needs a landed message,
              Discard needs one that never landed. Discard is the only way out
              of an upload stuck mid-flight, since the recovery pill does not
              render for in-progress states. */}
          {discardableMessage ? (
            <Pressable
              accessibilityLabel="Discard unsent message"
              accessibilityRole="button"
              onPress={() => onDiscard(discardableMessage)}
              style={styles.selectionDeleteButton}
            >
              <Ionicons name="close-circle-outline" size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.white} />
            </Pressable>
          ) : null}
          {canDelete ? (
            <Pressable
              accessibilityLabel="Delete selected items"
              accessibilityRole="button"
              disabled={deleting || count === 0}
              onPress={onDelete}
              style={[styles.selectionDeleteButton, (deleting || count === 0) && styles.selectionDeleteButtonDisabled]}
            >
              <Ionicons name={deleting ? "hourglass-outline" : "trash-outline"} size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.white} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Reanimated.View>
  );
}

function MemoryChatMainQuickAction({
  icon,
  label,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.chatMainQuickAction}>
      <Ionicons name={icon} size={14} color={ROOM_COLORS.cool} />
      <Text numberOfLines={1} style={styles.chatMainQuickActionText}>{label}</Text>
    </Pressable>
  );
}

function MemoryChatMainDishSystemMessage({
  dish,
  onOpenDish
}: {
  dish: MemoryDish;
  onOpenDish: (dishId: string) => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={() => onOpenDish(dish.id)} style={styles.chatMainDishSystem}>
      <View style={styles.chatMainDishIcon}>
        <Ionicons name="restaurant-outline" size={14} color={ROOM_COLORS.cool} />
      </View>
      <Text numberOfLines={1} style={styles.chatMainDishText}>
        {dish.addedByDisplayName} added {dish.dishName}
      </Text>
      {dish.averageRating ? (
        <View style={styles.chatMainDishRating}>
          <Ionicons name="star" size={11} color={ROOM_COLORS.gold} />
          <Text style={styles.chatMainDishRatingText}>{dish.averageRating.toFixed(1)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

type SmartTextSegment =
  | { text: string; type: "text" }
  | { text: string; type: "link"; url: string };

const SMART_LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|#[A-Z0-9_]+|@[A-Z0-9_.-]+|\+?\d[\d\s().-]{6,}\d/gi;

function smartLinkUrl(value: string) {
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) return `mailto:${value}`;
  if (/^#/.test(value)) return `https://www.instagram.com/explore/tags/${encodeURIComponent(value.slice(1))}`;
  if (/^@/.test(value)) return `https://www.instagram.com/${encodeURIComponent(value.slice(1))}`;
  if (/^\+?\d[\d\s().-]{6,}\d$/.test(value)) return `tel:${value.replace(/[\s().-]/g, "")}`;
  if (/^www\./i.test(value)) return `https://${value}`;
  return value;
}

function parseSmartTextSegments(text: string): SmartTextSegment[] {
  const segments: SmartTextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SMART_LINK_PATTERN)) {
    const matchText = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, index), type: "text" });
    }
    segments.push({ text: matchText, type: "link", url: smartLinkUrl(matchText) });
    lastIndex = index + matchText.length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), type: "text" });
  return segments.length > 0 ? segments : [{ text, type: "text" }];
}

function openSmartLink(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Could not open link", "Please check this link and try again.");
  });
}

function getSingleMediaPreviewSize({
  imageHeight,
  imageWidth,
  screenWidth
}: {
  imageHeight?: number | null;
  imageWidth?: number | null;
  screenWidth: number;
}): MediaPreviewSize {
  const maxMediaWidth = Math.min(screenWidth * 0.82, 340);
  const maxMediaHeight = Math.min(Math.max(screenWidth * 1.05, 360), 430);
  const minMediaWidth = Math.min(maxMediaWidth * 0.55, 180);
  const minMediaHeight = 160;

  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    return {
      height: 220,
      width: Math.min(maxMediaWidth * 0.9, 310)
    };
  }

  const aspect = imageWidth / imageHeight;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return {
      height: 220,
      width: Math.min(maxMediaWidth * 0.9, 310)
    };
  }

  let width = maxMediaWidth;
  let height = width / aspect;

  if (height > maxMediaHeight) {
    height = maxMediaHeight;
    width = height * aspect;
  }

  if (height < minMediaHeight) {
    height = minMediaHeight;
    width = height * aspect;
  }

  width = Math.max(minMediaWidth, Math.min(width, maxMediaWidth));
  height = Math.max(minMediaHeight, Math.min(height, maxMediaHeight));

  return {
    height: Math.round(height),
    width: Math.round(width)
  };
}

function getMultiMediaGridWidth(screenWidth: number) {
  const baseContentWidth = Math.max(0, screenWidth - 32);
  return Math.round(Math.min(baseContentWidth * 0.82, 330));
}

function getTimelineSenderUsername(item: TimelineItem) {
  if (item.type === "message") return item.value.authorName;
  if (item.type === "media") return item.value.uploaderName;
  return item.value.addedBy;
}

function getTimelineDateKey(item: TimelineItem) {
  return new Date(item.createdAt).toDateString();
}

function getMessageGroupPosition(startsGroup: boolean, endsGroup: boolean): MessageGroupPosition {
  if (startsGroup && endsGroup) return "single";
  if (startsGroup) return "first";
  if (endsGroup) return "last";
  return "middle";
}

function formatRestaurantDisplayName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return name;

  return normalized.replace(/(^|[\s\-\/(\[])([a-z])/g, (_, prefix: string, letter: string) => (
    `${prefix}${letter.toUpperCase()}`
  ));
}

function getChatKeyboardShift(
  drivenKeyboardHeight: number,
  closedComposerBottomPadding: number
) {
  "worklet";
  // Geometry (ONE monotonic signal, no second progress channel):
  // - closed: drivenKeyboardHeight=0, so shift=0 and the composer keeps its
  //   full safe-area/navigation resting padding;
  // - open: shift=-(drivenKeyboardHeight - closedSafeAreaGap), lifting the
  //   composer to rest COMPOSER_KEYBOARD_OPEN_GAP above the keyboard top.
  // The driven height PARKS on open — one pre-calculated move announced by the
  // IME's onStart, landing ~1 frame before the keyboard — and follows per-frame
  // only on close. The surface therefore never chases the ~4 app frames this
  // device freezes at slide start (raw-follow's proven hop/judder). The
  // safe-area part of the resting gap is a FLAT subtraction from that single
  // value: blending it against a separate progress signal wiggles at the settle
  // point because the two signals can land on different frames.
  const closedSafeAreaGap = Math.max(0, closedComposerBottomPadding - COMPOSER_KEYBOARD_OPEN_GAP);
  return -Math.max(0, drivenKeyboardHeight - closedSafeAreaGap);
}

type KeyboardMotionValues = {
  offset: SharedValue<number>;
  progress: SharedValue<number>;
};

function useKeyboardMotion(): KeyboardMotionValues {
  const { reanimated } = useKeyboardContext();

  // The root KeyboardProvider already receives every native keyboard frame to
  // maintain these shared values. Reusing them avoids registering a second
  // per-frame worklet listener for chat.
  return useMemo(() => ({
    offset: reanimated.height,
    progress: reanimated.progress
  }), [reanimated.height, reanimated.progress]);
}

function useSmoothedKeyboardOffset(): SharedValue<number> {
  return useKeyboardMotion().offset;
}

// expo-audio's useAudioRecorderState polls the native recorder on an
// unconditional setInterval. Keep that polling gated to the visible Chat pane
// so a recorder can never extend the work performed while leaving the room.
const IDLE_VOICE_RECORDER_STATE: RecorderState = {
  canRecord: false,
  durationMillis: 0,
  isRecording: false,
  mediaServicesDidReset: false,
  url: null
};

function useVoiceRecorderState(
  recorderRef: RefObject<VoiceRecorder | null>,
  intervalMs: number,
  enabled: boolean
) {
  const [state, setState] = useState<RecorderState>(IDLE_VOICE_RECORDER_STATE);

  useEffect(() => {
    if (!enabled) return;
    const recorder = recorderRef.current;
    if (!recorder) return;
    // Seed synchronously so the first frame after activation is not a stale read.
    setState(recorder.getStatus());
    const intervalId = setInterval(() => {
      setState((previous) => {
        const current = recorderRef.current;
        if (!current) return previous;
        const next = current.getStatus();
        if (
          previous.canRecord !== next.canRecord ||
          previous.isRecording !== next.isRecording ||
          previous.mediaServicesDidReset !== next.mediaServicesDidReset ||
          previous.url !== next.url ||
          Math.abs((previous.durationMillis ?? 0) - (next.durationMillis ?? 0)) > 50
        ) {
          return next;
        }
        return previous;
      });
    }, intervalMs);
    return () => {
      clearInterval(intervalId);
      // Nothing is polling once recording ends, so drop back to the idle
      // snapshot rather than leaving the last recording's duration/url behind.
      setState(IDLE_VOICE_RECORDER_STATE);
    };
  }, [enabled, intervalMs, recorderRef]);

  return state;
}

// Owns the native AudioRecorder and nothing else. Mounted only once the user
// has actually asked to record, because `useAudioRecorder` allocates a native
// recorder plus a status listener on mount and releases them on unmount — a
// cost every chat surface used to pay, and (now that Chat is warmed in the
// background) one that every room open paid even for people who never record.
// Rendering null keeps it out of the composer's layout entirely.
function VoiceRecorderHost({ onReady }: { onReady: (recorder: VoiceRecorder) => void }) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);

  useEffect(() => {
    onReady(recorder);
  }, [onReady, recorder]);
  useEffect(() => adjustMemoryRoomResourceCounter("MemoryRoomActiveRecorders", 1), []);

  return null;
}

// Memoized pane components keep active-tab updates scoped to the data or
// handlers that actually changed.
const ItineraryPanelPane = memo(ItineraryPanel);
const MemoryChatMainSurfacePane = memo(MemoryChatMainSurface);

// Pane activation used to travel to every row. The vendored Item memo compares
// the render callbacks by IDENTITY, so `active` sitting in renderMessageAudio's
// dependency list re-rendered EVERY mounted row on every tab switch — measured
// at ~58 row renders per switch against ~29 mounted rows. Activation is only
// meaningful to one kind of row (audio owns a player), so it travels by context
// instead: flipping it now re-renders the audio rows that read it and nothing
// else, while "an inactive Chat pane owns no audio player" still holds.
const ChatSurfaceActiveContext = createContext(true);

function ChatMainAudioMessageGate(
  props: ChatMainMessageAudioProps<MemoryChatMainMessage> & {
    journeySession: MemoryRoomJourneySession;
    selectionMode?: boolean;
  }
) {
  const active = useContext(ChatSurfaceActiveContext);
  if (!active) return null;
  return <ChatMainAudioMessage {...props} />;
}
const MediaGalleryPane = memo(MediaGallery);
const DishesPanelPane = memo(DishesPanel);

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    journeyRunId?: string;
    roomSessionId?: string;
    tab?: string;
  }>();
  const roomId = params.id ?? "";
  const scrollSessionRef = useRef(createMemoryRoomScrollSession(roomId));
  if (scrollSessionRef.current.roomId !== roomId) {
    scrollSessionRef.current = createMemoryRoomScrollSession(roomId);
  }
  const entryTraceRoomIdRef = useRef("");
  if (entryTraceRoomIdRef.current !== roomId) {
    entryTraceRoomIdRef.current = roomId;
    ensureMemoryRoomEntryTrace(memoryRoomModeFromTabParam(params.tab) ?? "overview");
  }
  const initialJourneyTabRef = useRef({
    roomId,
    tab: memoryRoomModeFromTabParam(params.tab) ?? "overview"
  });
  if (initialJourneyTabRef.current.roomId !== roomId) {
    initialJourneyTabRef.current = {
      roomId,
      tab: memoryRoomModeFromTabParam(params.tab) ?? "overview"
    };
  }
  const initialJourneyTab = initialJourneyTabRef.current.tab;
  const journeySession = useMemo(() => createMemoryRoomJourneySession({
    initialTab: initialJourneyTab,
    journeyRunId: params.journeyRunId,
    roomSessionId: params.roomSessionId
  }), [initialJourneyTab, params.journeyRunId, params.roomSessionId, roomId]);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const runtime = useRuntimeActivity();
  // Keep the chat composer's closed-state baseline stable while the IME covers
  // the gesture area. Edge-to-edge Android can report bottom=0 mid-transition;
  // accepting that live inset would add a React layout correction on top of
  // the UI-thread keyboard transform.
  const [frozenComposerBottomInset] = useState(() => insets.bottom);
  const [frozenChatGeometryInputs] = useState(() => ({
    fontScale: PixelRatio.getFontScale(),
    pixelRatio: PixelRatio.get()
  }));
  const collapsedComposerGeometry = useMemo(
    () => resolveMemoryChatCollapsedComposerGeometry({
      bottomSafeAreaInset: frozenComposerBottomInset,
      fontScale: frozenChatGeometryInputs.fontScale,
      isEdgeToEdge:
        IS_ANDROID_EDGE_TO_EDGE ||
        (Platform.OS === "ios" && frozenComposerBottomInset > 0),
      pixelRatio: frozenChatGeometryInputs.pixelRatio,
      platform: Platform.OS
    }),
    [frozenChatGeometryInputs, frozenComposerBottomInset]
  );
  const { resolvedTheme } = useThemePreference();
  const cachedRoomSummary = memoryRoomSummariesFromPages(
    queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
  ).find((memory) => memory.id === roomId);
  applyRoomTheme(resolvedTheme, cachedRoomSummary?.occasionType ?? "unknown");
  const room = useMemoryRoomQuery(roomId, journeySession);
  useMemoryRoomRealtime(roomId, journeySession);
  const addParticipant = useAddMemoryParticipantMutation(roomId);
  const addMessage = useAddMemoryMessageMutation(roomId);
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const rateDish = useSetMemoryDishRatingMutation(roomId);
  const flushPendingDishRatings = rateDish.flushPending;
  const deleteDish = useDeleteMemoryDishMutation(roomId);
  const deleteStop = useDeleteMemoryStopMutation(roomId);
  const editMessage = useEditMemoryMessageMutation(roomId);
  const deleteItems = useDeleteMemoryItemsMutation(roomId);
  const dismissFailedMessage = useDismissFailedMemoryMessage(roomId);
  const markRead = useMarkMemoryRoomReadMutation(roomId);
  const markMediaRead = useMarkMemoryRoomActivityReadMutation(roomId, "media");
  const markDishesRead = useMarkMemoryRoomActivityReadMutation(roomId, "dishes");
  const leaveRoom = useLeaveMemoryRoomMutation(roomId);
  const requestCircleAccess = useRequestCircleAccessMutation();
  const sessionProfile = useSessionStore((state) => state.profile);
  const myUsername = sessionProfile?.username ?? "";
  const myDisplayName = sessionProfile?.displayName || myUsername;
  useEffect(() => {
    if (!runtime.isOnline) return;
    void flushPendingDishRatings().catch((error) => {
      captureMobileError("memory.dish_rating_recovery_failed", error, { roomId });
    });
  }, [flushPendingDishRatings, roomId, runtime.isOnline]);
  const addMessageMutateAsyncRef = useRef(addMessage.mutateAsync);
  addMessageMutateAsyncRef.current = addMessage.mutateAsync;
  const markReadMutateRef = useRef(markRead.mutate);
  markReadMutateRef.current = markRead.mutate;
  const peopleInputRef = useRef<TextInput>(null);
  const messageInputRef = useRef<NativeChatInputHandle>(null);
  const chatMainListRef = useRef<ChatListScrollRef>(null);
  const keyboardVisibleRef = useRef(false);
  const nearBottomRef = useRef(false);
  // Active chat uses the vendored inverted AnimatedFlatList (newest at offset 0).
  // Keep bottom-follow wired to that live list, not the inactive ChatTimeline.
  const scrollChatToBottom = useCallback((animated: boolean) => {
    recordMemoryChatPlacement("CHAT_SCROLL_COMMAND", {
      contentOffset: 0,
      scrollCommandSource: "host_scroll_to_bottom"
    });
    recordMemoryChatPlacement("BOTTOM_FOLLOW_REQUESTED", {
      scrollCommandSource: "host_scroll_to_bottom"
    });
    recordMemoryChatPlacement("SCROLL_STARTED", {
      scrollCommandSource: "host_scroll_to_bottom"
    });
    chatMainListRef.current?.scrollToOffset({ animated, offset: 0 });
    requestAnimationFrame(() => {
      recordMemoryChatPlacement("SCROLL_FINISHED", {
        scrollCommandSource: "host_scroll_to_bottom"
      });
    });
  }, []);
  const readMarkerRef = useRef<string | null>(null);
  const markReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleReadMarkerRef = useRef<string | null>(null);
  const visibleReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleReadInputRef = useRef<{
    readAt: string;
    remainingUnreadCount: number;
  } | null>(null);
  const deletingItemKeysRef = useRef<Set<string>>(new Set());
  const selectedItemKeysRef = useRef<string[]>([]);
  const sendSequenceRef = useRef(0);
  const placementStaleRefreshTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const placementFixtureRunRef = useRef(false);
  const peopleToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomMountedAtRef = useRef(Date.now());
  const roomExitStartedRef = useRef(false);
  const {
    mode,
    pagerPosition,
    activePaneIndex,
    paneTabMode,
    requestRoomMode: requestRoomModeController
  } = useMemoryRoomController(params.tab);
  // React can leave a tab button holding the previous render's `mode` closure
  // while Fabric is committing a native-heavy pane. Compare and update a
  // synchronous request ref instead, so a legitimate first press can never be
  // discarded as "already selected". The controller has the same last-request
  // protection; this ref also keeps transition tracing from opening duplicate
  // spans for a press on the current tab.
  const requestedRoomModeRef = useRef<RoomMode>(mode);
  useEffect(() => {
    requestedRoomModeRef.current = mode;
  }, [mode]);
  const commitRoomMode = useCallback((
    nextMode: RoomMode,
    options?: {
      fromMode?: RoomMode;
      startedAt?: number;
      traceStarted?: boolean;
    }
  ) => {
    const requestedMode = requestedRoomModeRef.current;
    if (nextMode === requestedMode) return;
    const fromMode = options?.fromMode ?? requestedMode;
    requestedRoomModeRef.current = nextMode;
    recordMemoryRoomChatRendererCandidate(MEMORY_ROOM_CHAT_RENDERER_CODE);
    if (
      !options?.traceStarted &&
      fromMode !== "people" &&
      nextMode !== "people"
    ) {
      beginMemoryRoomTabTransition(fromMode, nextMode);
    }
    const startedAt = options?.startedAt ?? Date.now();
    if (!options?.traceStarted) {
      recordMemoryRoomJourney(journeySession, "TAB_TRANSITION_STARTED", {
        fromTab: fromMode,
        screenState: "transitioning",
        tab: nextMode
      });
    }
    requestRoomModeController(nextMode);
    requestAnimationFrame(() => {
      const nativeChatOwnsVisibleTiming =
        nextMode === "chat" && MEMORY_ROOM_CHAT_NATIVE_RENDERER;
      if (nextMode !== "people" && !nativeChatOwnsVisibleTiming) {
        markMemoryRoomTransitionFirstFrame(nextMode);
      }
      recordMemoryRoomJourney(journeySession, "TAB_FIRST_FRAME", {
        durationMs: Date.now() - startedAt,
        screenState: "visible",
        tab: nextMode
      });
      InteractionManager.runAfterInteractions(() => {
        if (nextMode !== "people" && !nativeChatOwnsVisibleTiming) {
          markMemoryRoomTransitionSettled(nextMode);
        }
        recordMemoryRoomJourney(journeySession, "TAB_TRANSITION_SETTLED", {
          durationMs: Date.now() - startedAt,
          screenState: "usable",
          tab: nextMode
        });
      });
    });
  }, [journeySession, requestRoomModeController]);
  const requestRoomMode = useCallback((nextMode: RoomMode) => {
    commitRoomMode(nextMode);
  }, [commitRoomMode]);
  // Coming back from the capture flow. `dismissTo` returns to this screen
  // without remounting it, so the destination tab arrives out-of-band instead
  // of through `params.tab` — see requestMemoryRoomTab.
  useFocusEffect(useCallback(() => {
    const requestedTab = consumeMemoryRoomTab(roomId);
    if (requestedTab) requestRoomMode(requestedTab);
  }, [requestRoomMode, roomId]));
  const handleRoomTabPress = useCallback((nextMode: RoomMode) => {
    setActiveStopActionId(null);
    recordMemoryRoomJourney(journeySession, "TAB_PRESS", {
      fromTab: mode,
      tab: nextMode
    });
    requestRoomMode(nextMode);
  }, [journeySession, mode, requestRoomMode]);
  // Chat is retained for the whole room visit. It is the only pane worth
  // carrying: Table, Media and Dishes are small trees whose cold mount is
  // already imperceptible, while Chat rebuilt ~291 native views on every
  // switch. Warmed late and once, so the room's opening frames stay clear.
  const [chatWarmReady, setChatWarmReady] = useState(
    initialJourneyTab === "chat"
  );
  useEffect(() => {
    recordMemoryRoomChatRendererCandidate(MEMORY_ROOM_CHAT_RENDERER_CODE);
  }, [roomId]);
  useEffect(() => {
    setChatWarmReady(paneTabMode === "chat");
    // The room id is the ownership boundary. A retained host must never cross
    // this reset even when Expo Router reuses the route component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);
  useEffect(() => {
    if (chatWarmReady || !room.data) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(
        () => setChatWarmReady(true),
        MEMORY_ROOM_CHAT_WARM_DELAY_MS
      );
    });
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [chatWarmReady, room.data]);
  // The chat row projection used to run unconditionally in the render body, so
  // every room open built the entire timeline even when the user opened Table,
  // never touched Chat, and backed straight out. It is O(messages) and it sat
  // directly on the open path. Arming it after the first idle keeps it off that
  // path without moving the cost onto the Chat tap — and a tap that beats the
  // idle callback still projects synchronously, exactly as it does today.
  const [chatProjectionArmed, setChatProjectionArmed] = useState(
    initialJourneyTab === "chat"
  );
  const [mediaProjectionArmed, setMediaProjectionArmed] = useState(
    initialJourneyTab === "media"
  );
  useEffect(() => {
    if (mediaProjectionArmed || !room.data) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      setMediaProjectionArmed(true);
    });
    return () => task.cancel();
  }, [mediaProjectionArmed, room.data]);
  useEffect(() => {
    if (chatProjectionArmed || !room.data) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      setChatProjectionArmed(true);
    });
    return () => task.cancel();
  }, [chatProjectionArmed, room.data]);
  const [peopleClosing, setPeopleClosing] = useState(false);
  const [participant, setParticipant] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<UserSearchResult[]>([]);
  const [peopleToastMessage, setPeopleToastMessage] = useState("");
  // Dish whose detail / "who rated" sheet is open (null = closed). Held by id so
  // realtime rating updates flow into the open sheet via the live `data.dishes`.
  const [detailDishId, setDetailDishId] = useState<string | null>(null);
  const [activeStopActionId, setActiveStopActionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const messageDraftRef = useRef("");
  const [editingMessage, setEditingMessage] = useState<MemoryMessage | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<MemoryMessage | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [messageReactions, setMessageReactions] = useState<MemoryReactionState>({});
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [floatingAddMenuOpen, setFloatingAddMenuOpen] = useState(false);
  const overlayKeyboardProgress = useSharedValue(0);
  const [roomActionsVisible, setRoomActionsVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaViewerState | null>(null);
  const [memberCircleStatusOverrides, setMemberCircleStatusOverrides] = useState<Record<string, MemberCircleStatus>>({});
  const floatingAddMenuProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Chat is retained now, so releasing its ownership on the way out is not
    // optional: a mounted-but-inactive pane must not hold IME focus, a live
    // reply target, a selection or an open reaction picker.
    if (mode === "chat") return;
    void messageInputRef.current?.blur();
    if (keyboardVisibleRef.current) Keyboard.dismiss();
    if (replyingToMessage) setReplyingToMessage(null);
    if (reactionPickerMessageId) setReactionPickerMessageId(null);
    if (selectedItemKeysRef.current.length > 0 || selectedItemKeys.length > 0) {
      selectedItemKeysRef.current = [];
      setSelectedItemKeys([]);
    }
    if (editingMessage) {
      setEditingMessage(null);
      updateMessageDraft("");
    }
  }, [
    editingMessage,
    mode,
    reactionPickerMessageId,
    replyingToMessage,
    selectedItemKeys.length
  ]);
  const recordKeyboardJourneyStart = useCallback((height: number) => {
    recordMemoryRoomJourney(journeySession, "KEYBOARD_STARTED", {
      keyboardState: height > 0 ? "open" : "closed",
      tab: paneTabMode
    });
  }, [journeySession, paneTabMode]);
  useKeyboardHandler({
    onStart: (event) => {
      "worklet";
      runOnJS(recordKeyboardJourneyStart)(event.height);
    }
  }, [recordKeyboardJourneyStart]);
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "ROOM_SCREEN_MOUNT", {
      queryState: room.data ? "usable" : "loading",
      screenState: "mounted",
      tab: paneTabMode
    });
    const firstFrame = requestAnimationFrame(() => {
      recordMemoryRoomJourney(journeySession, "ROOM_FIRST_FRAME", {
        durationMs: Date.now() - roomMountedAtRef.current,
        queryState: room.data ? "usable" : "loading",
        screenState: "visible",
        tab: paneTabMode
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (roomExitStartedRef.current) {
        recordMemoryRoomJourney(journeySession, "ROOM_EXIT_FINISHED", {
          screenState: "unmounted",
          tab: paneTabMode
        });
      }
      recordMemoryRoomJourney(journeySession, "ROOM_SCREEN_UNMOUNT", {
        screenState: "unmounted",
        tab: paneTabMode
      });
    };
  }, [journeySession]);
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "SURFACE_RENDER", {
      queryState: room.data ? "usable" : room.isError ? "failed" : "loading",
      surface: "room",
      tab: paneTabMode
    });
  });
  useEffect(() => {
    recordMemoryRoomJourney(
      journeySession,
      runtime.isForeground ? "APP_FOREGROUND" : "APP_BACKGROUND",
      { screenState: runtime.isForeground ? "visible" : "background", tab: paneTabMode }
    );
  }, [journeySession, paneTabMode, runtime.isForeground]);
  const excludedParticipantUsernames = useMemo(() => ([
    myUsername,
    ...(room.data?.participants ?? []).map((item) => item.username),
    ...selectedParticipants.map((item) => item.username)
  ].filter(Boolean)), [myUsername, room.data?.participants, selectedParticipants]);
  const participantSearch = useUserProfileSearch({
    enabled: mode === "people" && !peopleClosing,
    excludedUsernames: excludedParticipantUsernames,
    limit: 8,
    query: participant
  });
  const memberCircleUsernames = useMemo(() => (
    Array.from(new Set(
      (room.data?.participants ?? [])
        .map((participantItem) => participantItem.username)
        .filter((username) => username && username.toLowerCase() !== myUsername.toLowerCase())
    )).sort()
  ), [myUsername, room.data?.participants]);
  const memberCircleStatusQuery = useCircleAccessStatusesQuery(memberCircleUsernames, {
    enabled: mode === "people" && memberCircleUsernames.length > 0
  });
  const memberCircleStatuses = useMemo<Record<string, MemberCircleStatus>>(() => ({
    ...(memberCircleStatusQuery.data ?? {}),
    ...memberCircleStatusOverrides
  }), [memberCircleStatusOverrides, memberCircleStatusQuery.data]);
  // External sets (edit prefill, reply, clear-after-send) must push a value
  // back down to the composer, so they update BOTH the ref and parent state.
  function updateMessageDraft(value: string) {
    messageDraftRef.current = value;
    setMessage(value);
  }
  // Live typing from the composer updates ONLY the ref — never parent state —
  // so a keystroke no longer re-renders the ~12k-line room screen or the chat
  // surface. The composer owns its live text (native EditText + local draft);
  // send/caption paths read messageDraftRef, which this keeps current. Parent
  // `message` state is intentionally allowed to lag the ref while typing; the
  // composer ignores an unchanged `text` prop, so it never loses characters.
  function syncComposerDraft(value: string) {
    messageDraftRef.current = value;
  }

  const finishPeopleClose = useCallback(() => {
    requestRoomMode("overview");
  }, [requestRoomMode]);

  useEffect(() => {
    // Keep the Members panel at the end of its exit animation until the
    // deferred room-mode commit has actually removed it. Resetting `closing`
    // inside the animation callback made the still-mounted panel begin its
    // enter animation again for a frame: close -> reopen -> close.
    if (mode !== "people" && peopleClosing) setPeopleClosing(false);
  }, [mode, peopleClosing]);

  useEffect(() => {
    if (!room.data) return;
    setSelectedMedia((current) => {
      if (!current) return current;
      // Settled first: photosFromMessages reads attachments verbatim, so an
      // unsettled room would put the superseded preview straight back.
      const settledRoom = settleMemoryRoomMedia(room.data);
      const latestPhotos = mergeMemoryPhotos(
        settledRoom.photos,
        photosFromMessages(settledRoom.messages)
      );
      const latestById = new Map(latestPhotos.map((photo) => [photo.id, photo]));
      let changed = false;
      const items = current.items.map((item) => {
        const latest = latestById.get(item.id);
        if (!latest) return item;
        if (latest.publicUrl !== item.publicUrl) changed = true;
        return latest;
      });
      return changed ? { ...current, items } : current;
    });
  }, [room.data]);

  useEffect(() => {
    Animated.timing(floatingAddMenuProgress, {
      duration: floatingAddMenuOpen ? 180 : 140,
      easing: Easing.out(Easing.cubic),
      toValue: floatingAddMenuOpen ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [floatingAddMenuOpen, floatingAddMenuProgress]);

  useEffect(() => {
    if (mode !== "overview") setFloatingAddMenuOpen(false);
  }, [mode]);

  useEffect(() => () => {
    if (peopleToastTimeoutRef.current) clearTimeout(peopleToastTimeoutRef.current);
  }, []);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
      recordMemoryRoomJourney(journeySession, "KEYBOARD_SETTLED", {
        keyboardState: "open",
        tab: "chat"
      });
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
      recordMemoryRoomJourney(journeySession, "KEYBOARD_SETTLED", {
        keyboardState: "closed",
        tab: "chat"
      });
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [journeySession]);

  // ADJUST_RESIZE is required for keyboard show/hide to be trackable per-frame:
  // with ADJUST_NOTHING, Android treats the window as not IME-aware and never
  // dispatches the per-frame WindowInsetsAnimation callbacks, so the library only
  // reports the keyboard at the END of the transition (composer/list snap late).
  // The window never actually resizes because react-native-keyboard-controller
  // keeps it edge-to-edge, so ADJUST_RESIZE here only re-enables inset dispatch.
  useEffect(() => {
    if (Platform.OS !== "android" || mode !== "chat") return undefined;
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_RESIZE);
    return () => {
      KeyboardController.setDefaultMode();
    };
  }, [mode]);

  const beginRoomExit = useCallback(() => {
    if (roomExitStartedRef.current) return;
    roomExitStartedRef.current = true;
    beginMemoryRoomExitTrace();
    recordMemoryRoomJourney(journeySession, "ROOM_EXIT_STARTED", {
      screenState: "exiting",
      tab: paneTabMode
    });
  }, [journeySession, paneTabMode]);

  useEffect(() => () => {
    completeMemoryRoomExit();
  }, []);

  const goBackToOrigin = useCallback(() => {
    beginRoomExit();
    if (router.canGoBack()) {
      router.back();
      return;
    }

    // A room can also be the first route after a cold deep link. There is no
    // previous screen to pop in that case, so rebuild the expected destination.
    router.replace({ pathname: "/profile", params: { tab: "memories" } });
  }, [beginRoomExit, router]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedMedia) {
        traceMemoryRoomSection("MemoryRoomViewerClose", () => undefined);
        recordMemoryRoomJourney(journeySession, "MEDIA_VIEWER_CLOSED", { tab: paneTabMode });
        setSelectedMedia(null);
        return true;
      }

      if (roomActionsVisible) {
        setRoomActionsVisible(false);
        return true;
      }

      if (detailDishId) {
        setDetailDishId(null);
        return true;
      }

      if (floatingAddMenuOpen) {
        setFloatingAddMenuOpen(false);
        return true;
      }

      if (reactionPickerMessageId) {
        setReactionPickerMessageId(null);
        return true;
      }

      if (selectedItemKeysRef.current.length > 0 || selectedItemKeys.length > 0) {
        selectedItemKeysRef.current = [];
        setSelectedItemKeys([]);
        return true;
      }

      if (editingMessage) {
        setEditingMessage(null);
        updateMessageDraft("");
        return true;
      }

      if (replyingToMessage) {
        setReplyingToMessage(null);
        return true;
      }

      if (mode === "chat" && keyboardVisibleRef.current) {
        Keyboard.dismiss();
        return true;
      }

      if (mode === "people") {
        if (!peopleClosing) setPeopleClosing(true);
        return true;
      }

      goBackToOrigin();
      return true;
    });

    return () => subscription.remove();
  }, [
    detailDishId,
    editingMessage,
    floatingAddMenuOpen,
    goBackToOrigin,
    journeySession,
    mode,
    paneTabMode,
    peopleClosing,
    reactionPickerMessageId,
    replyingToMessage,
    roomActionsVisible,
    selectedItemKeys.length,
    selectedMedia
  ]));

  // Deferred so the mutation's cache writes (and the re-renders they trigger) stay out
  // of the tab-transition window; competing commits stall the header collapse animation.
  function markLatestRoomRead() {
    if (!roomId || !room.data) return;
    const latestMessage = room.data.messages[room.data.messages.length - 1];
    const marker = latestMessage?.createdAt ?? room.data.createdAt;
    if (readMarkerRef.current === marker) return;
    readMarkerRef.current = marker;
    if (markReadTimeoutRef.current) clearTimeout(markReadTimeoutRef.current);
    markReadTimeoutRef.current = setTimeout(() => {
      markReadTimeoutRef.current = null;
      markRead.mutate(undefined, {
        onError: () => {
          readMarkerRef.current = null;
        }
      });
    }, 400);
  }

  // Advance the read position to the newest message the user has actually
  // seen. This used to be reachable only from the native renderer; the vendored
  // renderer instead marked the WHOLE room read the moment Chat was opened,
  // which destroyed the unread anchor it had just computed and made "open the
  // room, see where you left off" impossible on a second visit.
  function markVisibleRoomRead(readAt: string) {
    if (!Number.isFinite(Date.parse(readAt))) return;
    const previousMarkerMs = Date.parse(visibleReadMarkerRef.current ?? "");
    const nextMarkerMs = Date.parse(readAt);
    if (Number.isFinite(previousMarkerMs) && previousMarkerMs >= nextMarkerMs) {
      return;
    }
    visibleReadMarkerRef.current = readAt;
    const currentRoom =
      queryClient.getQueryData<MemoryRoom>(memoryKeys.detail(roomId)) ??
      room.data;
    const currentSummary = memoryRoomSummariesFromPages(
      queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
    ).find((memory) => memory.id === roomId);
    if ((currentSummary?.unreadCount ?? 0) <= 0) return;
    const previousReadMs = Date.parse(currentRoom?.lastReadAt ?? "");
    const newlyVisibleIncoming = currentRoom?.messages.filter((candidate) => {
      const createdAt = Date.parse(candidate.createdAt);
      return (
        candidate.authorName !== myUsername &&
        createdAt <= nextMarkerMs &&
        (!Number.isFinite(previousReadMs) || createdAt > previousReadMs)
      );
    }).length ?? 0;
    const remainingUnreadCount = Math.max(
      0,
      (currentSummary?.unreadCount ?? newlyVisibleIncoming) -
        newlyVisibleIncoming
    );
    const input = { readAt, remainingUnreadCount };
    visibleReadInputRef.current = input;
    if (visibleReadTimeoutRef.current) clearTimeout(visibleReadTimeoutRef.current);
    visibleReadTimeoutRef.current = setTimeout(() => {
      visibleReadTimeoutRef.current = null;
      visibleReadInputRef.current = null;
      markRead.mutate(input, {
        onError: () => {
          visibleReadMarkerRef.current = null;
        }
      });
    }, 300);
  }

  useEffect(() => () => {
    if (!visibleReadTimeoutRef.current) return;
    clearTimeout(visibleReadTimeoutRef.current);
    visibleReadTimeoutRef.current = null;
    const pending = visibleReadInputRef.current;
    visibleReadInputRef.current = null;
    if (pending) markReadMutateRef.current(pending);
  }, []);

  useEffect(() => () => {
    if (!markReadTimeoutRef.current) return;
    clearTimeout(markReadTimeoutRef.current);
    markReadTimeoutRef.current = null;
    const persistReadState = markReadMutateRef.current;
    // Cache projection and SQLite/network writes do not need to share the
    // route-pop commit. Run them after navigation has revealed the previous
    // screen so a quick Chat visit cannot make Back wait on read persistence.
    InteractionManager.runAfterInteractions(() => persistReadState(undefined));
  }, []);

  // Opening Chat does NOT mark the room read any more. It used to, on the
  // grounds that requiring "near bottom" left rooms permanently unread when the
  // entry anchored at the unread divider — but the entry never actually
  // anchored there on this renderer, so the rule only had the effect of
  // erasing the unread state before it could ever be shown. The anchor is now
  // applied on entry (unreadAnchorPlan in MemoryChatMainSurface) and the read
  // position advances from what the viewport reports, which is the same
  // contract the native renderer was designed against.
  //
  // A message ARRIVING while the user is already parked at the newest row is
  // the one case a blanket mark is honest: they are looking at it. Entry does
  // not qualify and is handled by markVisibleRoomRead instead — nearBottomRef
  // starts false and is only set by a real scroll event, so a fresh mount
  // cannot reach this.
  useEffect(() => {
    if (mode !== "chat") return;
    if (!nearBottomRef.current) return;
    markLatestRoomRead();
  }, [markRead, mode, room.data, roomId]);

  // Keyboard handling: one common surface carries the composer, message list,
  // and panel-coloured bridge, translated by a SINGLE transform so the composer
  // and content can never diverge from each other during the IME transition.
  // That transform is driven by the PARKED keyboard height (pre-calculated open,
  // gated per-frame close) — not the raw per-frame keyboard frame — because
  // raw-following was proven on-device to hop/judder at the top of the open
  // (the display freezes ~4 app frames until the IME animation completes). See
  // useDrivenKeyboardHeight for the full forensics. The closed safe-area gap is
  // a flat subtraction from that one value; the panel-coloured bridge masks the
  // strip the keyboard is still sliding into while the parked surface waits.
  const {
    height: drivenKeyboardHeight,
    settled: settledKeyboardHeight,
    target: targetKeyboardHeight
  } = useDrivenKeyboardHeight();
  const isChatMode = mode === "chat";
  const closedComposerBottomPadding = collapsedComposerGeometry.closedBottomPadding;
  const chatKeyboardShift = useDerivedValue(() => {
    if (!isChatMode) return 0;
    return getChatKeyboardShift(
      drivenKeyboardHeight.value,
      closedComposerBottomPadding
    );
  }, [closedComposerBottomPadding, isChatMode]);
  // The chat surface translates upward with the keyboard instead of resizing.
  // Reserve the same distance beyond the oldest message so the user can still
  // pull that message fully below the fixed header while the IME is open.
  // max(target, settled) changes only at transition boundaries: it appears at
  // open-start and stays until close-end, avoiding per-frame list layout work.
  const chatKeyboardTopReserve = useDerivedValue(() => {
    if (!isChatMode) return 0;
    const reservedKeyboardHeight = Math.max(
      targetKeyboardHeight.value,
      settledKeyboardHeight.value
    );
    return Math.max(
      0,
      -getChatKeyboardShift(reservedKeyboardHeight, closedComposerBottomPadding)
    );
  }, [closedComposerBottomPadding, isChatMode]);
  const chatMainSurfaceKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: chatKeyboardShift.value }]
  }), []);
  const composerBottomInsetStyle = useMemo<ViewStyle>(() => ({
    paddingBottom: closedComposerBottomPadding
  }), [closedComposerBottomPadding]);
  useEffect(() => {
    recordMemoryChatPlacement("BOTTOM_INSET_CHANGED", {
      bottomClearance: closedComposerBottomPadding
    });
  }, [closedComposerBottomPadding]);

  function handleChatNearBottomChange(isNearBottom: boolean) {
    nearBottomRef.current = isNearBottom;
    // Deliberately does NOT mark the room read. Near-bottom is the position the
    // list LANDS in whenever an unread anchor could not be applied — no anchor
    // in the local cache, or an anchor past the initial-render bound — so
    // marking here declared 50 unread messages read on entry having shown ten
    // of them. That is the same defect the comment above markLatestRoomRead
    // describes being removed from the open path; it had simply come back
    // through this handler.
    //
    // Catching up still clears the room: markVisibleRoomRead advances the read
    // position to the newest message the viewport actually reports, so genuinely
    // scrolling to the newest message marks it read — and only what was seen.
  }

  function showPeopleToast(message: string) {
    if (peopleToastTimeoutRef.current) clearTimeout(peopleToastTimeoutRef.current);
    setPeopleToastMessage(message);
    peopleToastTimeoutRef.current = setTimeout(() => {
      peopleToastTimeoutRef.current = null;
      setPeopleToastMessage("");
    }, 2800);
  }

  function participantDisplayName(username: string, selectedNameMap: Map<string, string>) {
    return selectedNameMap.get(username.toLowerCase()) ?? `@${username}`;
  }

  function buildParticipantInviteToast({
    added,
    alreadyMembers,
    invited,
    selectedNameMap
  }: {
    added: string[];
    alreadyMembers: string[];
    invited: string[];
    selectedNameMap: Map<string, string>;
  }) {
    const parts = [];
    if (added.length === 1) {
      parts.push(`${participantDisplayName(added[0], selectedNameMap)} added`);
    } else if (added.length > 1) {
      parts.push(`${added.length} added to the table`);
    }
    if (invited.length === 1) {
      parts.push(`Invite sent to ${participantDisplayName(invited[0], selectedNameMap)}`);
    } else if (invited.length > 1) {
      parts.push(`${invited.length} invites sent`);
    }
    if (alreadyMembers.length === 1) {
      parts.push(`${participantDisplayName(alreadyMembers[0], selectedNameMap)} already at the table`);
    } else if (alreadyMembers.length > 1) {
      parts.push(`${alreadyMembers.length} already at the table`);
    }
    return parts.join(" · ");
  }

  async function submitParticipants() {
    if (selectedParticipants.length === 0) return;
    peopleInputRef.current?.blur();
    Keyboard.dismiss();
    const selectedNameMap = new Map(selectedParticipants.map((person) => [person.username.toLowerCase(), person.displayName]));
    try {
      const results = [];
      for (const selected of selectedParticipants) {
        results.push(await addParticipant.mutateAsync(selected.username));
      }
      const added = Array.from(new Set(results.flatMap((result) => result.added)));
      const invited = Array.from(new Set(results.flatMap((result) => result.invited)));
      const alreadyMembers = Array.from(new Set(results.flatMap((result) => result.alreadyMembers)));
      setParticipant("");
      setSelectedParticipants([]);
      if (added.length > 0 || invited.length > 0 || alreadyMembers.length > 0) {
        showPeopleToast(buildParticipantInviteToast({ added, alreadyMembers, invited, selectedNameMap }));
      }
    } catch {
      // Rendered from mutation state.
    }
  }

  function selectParticipantSuggestion(person: UserSearchResult) {
    setSelectedParticipants((current) => {
      if (current.some((item) => item.username.toLowerCase() === person.username.toLowerCase())) return current;
      return [...current, person];
    });
    setParticipant("");
    requestAnimationFrame(() => peopleInputRef.current?.focus());
  }

  function removeSelectedParticipant(username: string) {
    setSelectedParticipants((current) => current.filter((item) => item.username.toLowerCase() !== username.toLowerCase()));
  }

  async function submitMessage(
    draftOverride?: string,
    clientIdOverride?: string,
    clientCreatedAtOverride?: string
  ) {
    const draftBody = draftOverride ?? messageDraftRef.current;
    try {
      if (editingMessage) {
        // Never save an edit down to nothing — it would leave an empty bubble.
        if (!draftBody.trim()) return;
        await editMessage.mutateAsync({ body: draftBody, messageId: editingMessage.id });
        setEditingMessage(null);
      } else {
        const outgoingBody = draftBody;
        const trimmedBody = outgoingBody.trim();
        if (!trimmedBody) return;
        const outgoingReply = replyingToMessage;
        const clientId = clientIdOverride ?? createRequestId();
        if (!clientIdOverride) {
          recordMemoryChatPlacement("SEND_PRESS", {
            clientId,
            composerHeight: collapsedComposerGeometry.messageBoxHeight
          });
        }
        const clientCreatedAt = clientCreatedAtOverride ?? new Date().toISOString();
        const clientSequence = sendSequenceRef.current;
        sendSequenceRef.current += 1;
        const clientOrderKey = `${clientCreatedAt}:${String(clientSequence).padStart(16, "0")}:${clientId}`;
        // WhatsApp-style: the message just appears at the bottom (optimistic),
        // no entry animation. Clear the input and pin to the newest message.
        updateMessageDraft("");
        setReplyingToMessage(null);
        recordMemoryRoomJourney(journeySession, "MESSAGE_OPTIMISTIC", {
          queryState: "mutating",
          tab: "chat"
        });
        void addMessageMutateAsyncRef.current({
          body: outgoingBody,
          clientCreatedAt,
          clientId,
          clientOrderKey,
          clientSequence,
          deferUntilOnline: !runtime.isOnline,
          replyToMessageId: outgoingReply ? memoryMessageServerId(outgoingReply) ?? outgoingReply.id : null
        }).then(() => {
          recordMemoryRoomJourney(journeySession, "MESSAGE_CONFIRMED", {
            queryState: "ready",
            tab: "chat"
          });
        }).catch(() => {
          recordMemoryRoomJourney(journeySession, "MESSAGE_FAILED", {
            queryState: "degraded",
            tab: "chat"
          });
          // The failed optimistic row stays visible with retry/cancel actions.
        });
        const staleRefreshDelayMs = memoryChatPlacementStaleRefreshDelayMs();
        if (staleRefreshDelayMs !== null) {
          const timer = setTimeout(() => {
            placementStaleRefreshTimersRef.current.delete(timer);
            recordMemoryChatPlacement("STALE_REFRESH_REQUESTED", { clientId });
            void room.refetch().finally(() => {
              recordMemoryChatPlacement("STALE_REFRESH_RESOLVED", { clientId });
            });
          }, staleRefreshDelayMs);
          placementStaleRefreshTimersRef.current.add(timer);
        }
        messageInputRef.current?.focus();
        return;
      }
      updateMessageDraft("");
      setReplyingToMessage(null);
      requestAnimationFrame(() => scrollChatToBottom(true));
    } catch {
      // Rendered from mutation state.
    }
  }

  function retryFailedMessage(target: MemoryMessage) {
    if (!canRetryMemoryDelivery(target.deliveryStatus)) return;
    const clientId = target.clientId ?? createRequestId();
    const clientCreatedAt = target.clientCreatedAt || new Date().toISOString();
    const clientSequence = target.clientSequence ?? sendSequenceRef.current++;
    const clientOrderKey = target.clientOrderKey ||
      `${clientCreatedAt}:${String(clientSequence).padStart(16, "0")}:${clientId}`;
    if (target.attachments.length > 0) {
      const assets: AddMemoryMediaAsset[] = target.attachments.map((attachment, index) => ({
        clientId: attachment.id.startsWith("optimistic-media:")
          ? attachment.id.slice("optimistic-media:".length)
          : `${clientId}-${index}`,
        duration: attachment.durationMs ?? null,
        fileSize: attachment.fileSizeBytes ?? null,
        imageHeight: attachment.imageHeight,
        imageWidth: attachment.imageWidth,
        mediaMimeType: attachment.mimeType ?? null,
        mediaType: attachment.mediaType,
        mediaUri: attachment.publicUrl
      }));
      void addPhoto.mutateAsync({
        assets,
        body: target.body,
        clientCreatedAt,
        clientOrderKey,
        clientSequence,
        replacesMessageId: target.id,
        replyToMessageId: target.replyToMessageId,
        roomId,
        uploadBatchId: clientId
      }).catch(() => {
        // The same logical row returns to failed without disturbing siblings.
      });
      requestRoomMode("chat");
      return;
    }
    void addMessageMutateAsyncRef.current({
      body: target.body,
      clientCreatedAt,
      clientId,
      clientOrderKey,
      clientSequence,
      deferUntilOnline: !runtime.isOnline,
      replacesMessageId: target.id,
      replyToMessageId: target.replyToMessageId
    }).catch(() => {
      // The replacement optimistic row is marked failed by the mutation hook.
    });
    requestRoomMode("chat");
  }

  function cancelFailedMessage(target: MemoryMessage) {
    // Gated on the message never having landed, NOT on the recovery pill being
    // visible: the pill only renders for outright failures, while the same
    // cancel is what rescues a send stuck mid-upload from the selection bar.
    if (target.deliveryStatus === "sent" || memoryMessageServerId(target)) return;
    if (!target.deliveryStatus) return;
    // The selected row is about to disappear, so close selection immediately.
    // Leaving its key armed kept the toolbar and purple selection overlay on
    // screen and made a successful discard look like the button did nothing.
    cancelSelection();
    const messageIdentity = target.clientId ?? target.id;
    dismissFailedMessage(messageIdentity);
    if (target.attachments.length > 0 && target.clientId) {
      // Repeat the local delete after the server/pending-record cancellation.
      // A source-staging SQLite write may already be in flight when the first
      // delete runs; this final pass makes the cancellation durable.
      void cancelPendingMemoryUploadBatch(roomId, target.clientId)
        .catch(() => undefined)
        .finally(() => dismissFailedMessage(messageIdentity));
    }
  }

  function beginEditMessage(target: MemoryMessage) {
    selectedItemKeysRef.current = [];
    setSelectedItemKeys([]);
    setReactionPickerMessageId(null);
    setReplyingToMessage(null);
    setEditingMessage(target);
    updateMessageDraft(target.body);
    requestRoomMode("chat");
  }

  function beginReplyMessage(target: MemoryMessage) {
    selectedItemKeysRef.current = [];
    setSelectedItemKeys([]);
    setReactionPickerMessageId(null);
    setEditingMessage(null);
    setReplyingToMessage(target);
    recordMemoryRoomJourney(journeySession, "REPLY_OPENED", { tab: "chat" });
    requestRoomMode("chat");
    // Focus in the same event as the state change so the IME starts its slide
    // together with the reply chip. Deferring it (a frame plus 80 ms) made the
    // chip appear first and the keyboard follow as a separate second stage.
    // The composer is always mounted with the chat surface, so the ref is
    // normally live already; the retry only covers a first entry where the
    // chat pane is still mounting.
    if (!messageInputRef.current) {
      requestAnimationFrame(() => messageInputRef.current?.focus());
      return;
    }
    messageInputRef.current.focus();
  }

  function cancelEditMessage() {
    setEditingMessage(null);
    updateMessageDraft("");
  }

  function cancelReplyMessage() {
    setReplyingToMessage(null);
    recordMemoryRoomJourney(journeySession, "REPLY_CANCELLED", { tab: "chat" });
  }

  // Selection is armed by a long press, and React Native does not fire onPress
  // after onLongPress, so the press that opened the selection can never also
  // toggle it. The guard that used to swallow one following tap per row is gone
  // with the menu that needed it: keeping it would eat the user's first attempt
  // to deselect the row they just held.
  function beginSelection(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    setReactionPickerMessageId(null);
    setEditingMessage(null);
    setReplyingToMessage(null);
    updateMessageDraft("");
    selectedItemKeysRef.current = [key];
    setSelectedItemKeys([key]);
    requestRoomMode("chat");
  }

  function toggleSelectedItem(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    setSelectedItemKeys((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      selectedItemKeysRef.current = next;
      return next;
    });
  }

  function cancelSelection() {
    selectedItemKeysRef.current = [];
    setSelectedItemKeys([]);
  }

  // Closing the selection is the only confirmation a copy gets — the clipboard
  // write itself is silent — so it has to happen, and it matches what Edit and
  // Reply already do when they take over from the toolbar.
  function copyMessageBody(target: MemoryMessage) {
    void Clipboard.setStringAsync(target.body);
    cancelSelection();
  }

  function openReactionPicker(messageId: string) {
    if (selectedItemKeysRef.current.length > 0) return;
    setReactionPickerMessageId((current) => (current === messageId ? null : messageId));
  }

  function closeReactionPicker() {
    setReactionPickerMessageId(null);
  }

  function toggleMessageReaction(messageId: string, emoji: string) {
    const userKey = myUsername || "me";
    setMessageReactions((current) => {
      const messageState = current[messageId] ?? {};
      const hasReactedWithEmoji = (messageState[emoji] ?? []).includes(userKey);
      const nextMessageState: Record<string, Array<string | number>> = {};

      Object.entries(messageState).forEach(([reactionEmoji, users]) => {
        const nextUsers = users.filter((id) => id !== userKey);
        if (nextUsers.length > 0) nextMessageState[reactionEmoji] = nextUsers;
      });

      if (!hasReactedWithEmoji) {
        nextMessageState[emoji] = [...(nextMessageState[emoji] ?? []), userKey];
      }

      if (Object.keys(nextMessageState).length === 0) {
        const next = { ...current };
        delete next[messageId];
        return next;
      }

      return {
        ...current,
        [messageId]: nextMessageState
      };
    });
    setReactionPickerMessageId(null);
  }

  function deleteMemoryItemKeys(
    keysToDelete: string[],
    { clearSelection }: { clearSelection: boolean }
  ) {
    const queuedKeys = keysToDelete.filter((key) => !deletingItemKeysRef.current.has(key));
    if (queuedKeys.length === 0) return;
    queuedKeys.forEach((key) => deletingItemKeysRef.current.add(key));
    const messageIds = queuedKeys
      .filter((key) => key.startsWith("message:"))
      .map((key) => key.replace("message:", ""));
    const photoIds = queuedKeys
      .filter((key) => key.startsWith("photo:"))
      .map((key) => key.replace("photo:", ""));
    const dishIds = queuedKeys
      .filter((key) => key.startsWith("dish:"))
      .map((key) => key.replace("dish:", ""));

    try {
      if (editingMessage && messageIds.includes(editingMessage.id)) cancelEditMessage();
      if (replyingToMessage && messageIds.includes(replyingToMessage.id)) setReplyingToMessage(null);
      if (clearSelection) {
        selectedItemKeysRef.current = [];
        setSelectedItemKeys([]);
      }
      const deleteRequests: Array<Promise<unknown>> = dishIds.map((dishId) => (
        deleteDish.mutateAsync(dishId)
      ));
      if (messageIds.length > 0 || photoIds.length > 0) {
        deleteRequests.push(deleteItems.mutateAsync({ messageIds, photoIds }));
      }
      void Promise.all(deleteRequests).catch((error) => {
        if (clearSelection && selectedItemKeysRef.current.length === 0) {
          selectedItemKeysRef.current = queuedKeys;
          setSelectedItemKeys(queuedKeys);
        }
        Alert.alert(
          "Could not delete",
          errorMessage(error) ?? (clearSelection ? "The selected items were restored. Try again." : "Try again.")
        );
      }).finally(() => {
        queuedKeys.forEach((key) => deletingItemKeysRef.current.delete(key));
      });
    } catch (error) {
      queuedKeys.forEach((key) => deletingItemKeysRef.current.delete(key));
      Alert.alert("Could not delete", errorMessage(error) ?? "Try again.");
    }
  }

  function confirmDeleteMemoryItemKeys(
    keysToDelete: string[],
    { clearSelection, title }: { clearSelection: boolean; title: string }
  ) {
    Alert.alert(
      title,
      "It will be removed for everyone at the table.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            deleteMemoryItemKeys(keysToDelete, { clearSelection });
          },
          style: "destructive",
          text: "Delete"
        }
      ]
    );
  }

  function removeSelectedItems() {
    const keysToDelete = selectedItemKeysRef.current.length > 0 ? selectedItemKeysRef.current : selectedItemKeys;
    const queuedKeys = keysToDelete.filter((key) => !deletingItemKeysRef.current.has(key));
    if (queuedKeys.length === 0) return;
    const messageCount = queuedKeys.filter((key) => key.startsWith("message:")).length;
    const photoCount = queuedKeys.filter((key) => key.startsWith("photo:")).length;
    const dishCount = queuedKeys.filter((key) => key.startsWith("dish:")).length;
    const title = queuedKeys.length === 1
      ? `Delete ${dishCount === 1 ? "dish" : messageCount === 1 ? "message" : "media"}?`
      : `Delete ${messageCount + photoCount + dishCount} items?`;
    confirmDeleteMemoryItemKeys(queuedKeys, {
      clearSelection: true,
      title
    });
  }

  async function sendAudioMessage(asset: AddMemoryMediaAsset) {
    setMediaError("");
    if (editingMessage) throw new Error("Finish editing before sending audio.");
    const validationError = validateMemoryMediaAssets([asset]);
    if (validationError) {
      setMediaError(validationError);
      throw new Error(validationError);
    }

    const clientId = createRequestId();
    const clientCreatedAt = new Date().toISOString();
    const clientSequence = sendSequenceRef.current++;
    const clientOrderKey = `${clientCreatedAt}:${String(clientSequence).padStart(16, "0")}:${clientId}`;
    const outgoingReply = replyingToMessage;
    recordMemoryChatPlacement("SEND_PRESS", {
      clientId,
      composerHeight: collapsedComposerGeometry.messageBoxHeight
    });
    updateMessageDraft("");
    setReplyingToMessage(null);
    requestRoomMode("chat");
    recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_ENQUEUED", {
      networkRequestCategory: "memory_audio_upload",
      queryState: "mutating",
      tab: "chat"
    });
    try {
      await addPhoto.mutateAsync({
        assets: [asset],
        clientCreatedAt,
        clientOrderKey,
        clientSequence,
        replyToMessageId: outgoingReply ? memoryMessageServerId(outgoingReply) ?? outgoingReply.id : null,
        roomId,
        uploadBatchId: clientId
      });
      recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_FINISHED", {
        networkRequestCategory: "memory_audio_upload",
        queryState: "ready",
        tab: "chat"
      });
    } catch (error) {
      recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_FAILED", {
        networkRequestCategory: "memory_audio_upload",
        queryState: "degraded",
        tab: "chat"
      });
      setMediaError(error instanceof Error ? error.message : "Could not send audio.");
      throw error;
    }
  }

  function openAddPlace() {
    setFloatingAddMenuOpen(false);
    router.push({ pathname: "/memories/[id]/add-place", params: { id: roomId } });
  }

  function editMemoryStop(stop: MemoryStop) {
    setActiveStopActionId(null);
    router.push({
      pathname: "/memories/[id]/add-place",
      params: { id: roomId, stopId: stop.id }
    });
  }

  function confirmDeleteMemoryStop(stop: MemoryStop) {
    setActiveStopActionId(null);
    Alert.alert(
      "Delete place?",
      `${stop.name} will be removed for everyone at the table.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () => {
            void deleteStop.mutateAsync(stop.id).catch((error) => {
              Alert.alert("Could not delete place", errorMessage(error) ?? "The place was restored. Try again.");
            });
          },
          style: "destructive",
          text: "Delete"
        }
      ]
    );
  }

  function openPeopleAdd() {
    setPeopleClosing(false);
    requestRoomMode("people");
  }

  function openPeopleList() {
    setPeopleClosing(false);
    requestRoomMode("people");
  }

  function closePeopleScreen() {
    if (peopleClosing) return;
    if (peopleToastTimeoutRef.current) {
      clearTimeout(peopleToastTimeoutRef.current);
      peopleToastTimeoutRef.current = null;
    }
    setPeopleToastMessage("");
    setPeopleClosing(true);
  }

  function openMemberProfile(username: string) {
    if (!username) return;
    if (myUsername && username.toLowerCase() === myUsername.toLowerCase()) {
      router.push("/profile");
      return;
    }
    router.push({ pathname: "/people/[username]", params: { username } });
  }

  async function requestMemberCircle(username: string) {
    if (!myUsername || !username || username.toLowerCase() === myUsername.toLowerCase()) return;
    const currentStatus = memberCircleStatuses[username] ?? "idle";
    if (currentStatus === "loading" || currentStatus === "pending" || currentStatus === "joined") return;

    setMemberCircleStatusOverrides((current) => ({ ...current, [username]: "loading" }));
    try {
      const result = await requestCircleAccess.mutateAsync({ receiverName: username });
      setMemberCircleStatusOverrides((current) => ({
        ...current,
        [username]: result === "joined" ? "joined" : "pending"
      }));
      void memberCircleStatusQuery.refetch();
    } catch (error) {
      setMemberCircleStatusOverrides((current) => {
        const next = { ...current };
        delete next[username];
        return next;
      });
      Alert.alert("Could not request circle access", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function openMediaViewer(media: MemoryPhoto, group: MemoryPhoto[] = [media]) {
    const index = Math.max(0, group.findIndex((item) => item.id === media.id));
    traceMemoryRoomSection("MemoryRoomViewerOpen", () => undefined);
    recordMemoryRoomJourney(journeySession, "MEDIA_VIEWER_OPENED", {
      screenState: "viewer",
      tab: paneTabMode
    });
    setSelectedMedia({ index, items: group });
  }

  function closeMediaViewer() {
    traceMemoryRoomSection("MemoryRoomViewerClose", () => undefined);
    recordMemoryRoomJourney(journeySession, "MEDIA_VIEWER_CLOSED", {
      screenState: "usable",
      tab: paneTabMode
    });
    setSelectedMedia(null);
  }

  function refreshSelectedMedia() {
    void room.refetch();
  }

  function closeFloatingAddMenu() {
    setFloatingAddMenuOpen(false);
  }

  function openFloatingAddMedia() {
    setFloatingAddMenuOpen(false);
    router.push({
      pathname: "/memories/[id]/camera",
      params: {
        id: roomId,
        journeyRunId: journeySession.journeyRunId,
        roomSessionId: journeySession.roomSessionId
      }
    });
  }

  function openFloatingAddDish() {
    setFloatingAddMenuOpen(false);
    router.push({ pathname: "/memories/[id]/add-dish", params: { id: roomId } });
  }

  function openRoomActions() {
    setRoomActionsVisible(true);
  }

  function closeRoomActions() {
    setRoomActionsVisible(false);
  }

  function confirmLeaveRoom() {
    closeRoomActions();
    Alert.alert(
      "Leave room?",
      "You will no longer see this table memory in your rooms. Messages and media you shared will remain for everyone else.",
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: async () => {
            try {
              await leaveRoom.mutateAsync();
              beginRoomExit();
              router.replace({ pathname: "/profile", params: { tab: "memories" } });
            } catch (error) {
              Alert.alert("Could not leave room", error instanceof Error ? error.message : "Please try again.");
            }
          },
          style: "destructive",
          text: leaveRoom.isPending ? "Leaving..." : "Leave"
        }
      ]
    );
  }

  // The pagination anchor is latched to the oldest message the room had when
  // history paging first became possible, and only re-latches when the room
  // itself changes. Reading it live from `room.data` fed pagination its own
  // output: each loaded page lands in SQLite, the next detail refetch returns a
  // wider room, the anchor slides older, and paging restarts — the top of the
  // chat spun "loading earlier messages" forever without ever finishing.
  const olderMessagesAnchorRef = useRef<{ cursor: string | null; roomId: string }>({ cursor: null, roomId });
  if (olderMessagesAnchorRef.current.roomId !== roomId) {
    olderMessagesAnchorRef.current = { cursor: null, roomId };
  }
  if (!olderMessagesAnchorRef.current.cursor) {
    // Must be the opaque {createdAt, id} cursor the mobile API decodes, not the
    // oldest row's raw createdAt: the route base64url-decodes what it is given,
    // so a bare timestamp came back 400 "Invalid cursor" and every network page
    // past the SQLite cache failed. That is what put "Could not load earlier
    // messages" at the top of history.
    olderMessagesAnchorRef.current.cursor = memoryHistoryCursorFromMessages(
      room.data?.messages
    );
  }
  const olderMessagesCursor = olderMessagesAnchorRef.current.cursor;
  const olderMessages = useMemoryMessagePagesQuery(roomId, olderMessagesCursor, journeySession);
  const olderMessageItems = useMemo(() => (
    olderMessages.data?.pages.flatMap((page) => page.messages) ?? []
  ), [olderMessages.data]);
  const mergedRoomData = useMemo(() => (
    room.data
      ? settleMemoryRoomMedia(mergeRoomMessages(room.data, olderMessageItems))
      : null
  ), [olderMessageItems, room.data]);
  const mediaPages = useMemoryMediaPagesQuery(roomId, mode === "media", journeySession);
  const pagedMediaPhotos = useMemo(() => (
    mediaPages.data?.pages.flatMap((page) => page.photos) ?? []
  ), [mediaPages.data]);
  // Media-only, and armed the same way the chat projection is. It de-duplicates
  // and sorts every photo in the room, which was pure waste when the user opened
  // to Table and backed out without ever touching Media. A Media tap that beats
  // the idle callback still merges synchronously, exactly as before.
  const mediaProjectionNeeded = mediaProjectionArmed || mode === "media";
  const galleryPhotos = useMemo(() => (
    mediaProjectionNeeded && mergedRoomData
      ? mergeMemoryPhotos(pagedMediaPhotos, mergedRoomData.photos)
      : []
  ), [mediaProjectionNeeded, mergedRoomData, pagedMediaPhotos]);
  useEffect(() => {
    if (mode !== "media") return;
    const prefetchTask = InteractionManager.runAfterInteractions(() => {
      galleryPhotos.slice(0, MEDIA_GALLERY_PREFETCH_COUNT).forEach(prefetchMemoryMedia);
    });
    return () => prefetchTask.cancel();
  }, [galleryPhotos, mode]);
  const hasLoadedOlderMessagePages = Boolean(olderMessages.data?.pages.length);
  // Do not show a speculative "Load earlier messages" row when the room
  // summary already proves that every server-backed message is present
  // locally. Pending/failed optimistic rows are excluded from this comparison
  // because they are not part of the server's message count. If the summary is
  // absent or indicates a larger history, preserve the one boundary lookup
  // used by older installs, partial syncs and offline-first rooms.
  const cachedServerMessageCount = room.data?.messages.reduce(
    (count, candidate) => count + (memoryMessageServerId(candidate) ? 1 : 0),
    0
  ) ?? 0;
  const knownMessageCount = cachedRoomSummary?.messageCount;
  const cachedHistoryKnownComplete =
    typeof knownMessageCount === "number" &&
    knownMessageCount > 0 &&
    cachedServerMessageCount >= knownMessageCount;
  const cachedHistoryMayHaveOlder =
    cachedServerMessageCount > 0 && !cachedHistoryKnownComplete;
  const canLoadOlderMessages = cachedHistoryMayHaveOlder && Boolean(olderMessagesCursor) && (
    !hasLoadedOlderMessagePages || Boolean(olderMessages.hasNextPage)
  );
  const olderMessagesFailed =
    canLoadOlderMessages && olderMessages.isFetchNextPageError;
  const loadOlderMessages = useCallback(() => {
    if (!canLoadOlderMessages || olderMessages.isFetchingNextPage) return;
    void olderMessages.fetchNextPage();
  }, [canLoadOlderMessages, olderMessages]);
  const loadMoreMedia = useCallback(() => {
    if (!mediaPages.hasNextPage || mediaPages.isFetchingNextPage) return;
    void mediaPages.fetchNextPage();
  }, [mediaPages]);

  // Stable identities for every handler passed into the memo()'d panes below.
  // Without these, each parent render (every keystroke, every realtime tick)
  // hands the panes fresh function props and defeats memo. The panes that carry
  // no `active` prop (Itinerary / Media / Dishes) then re-render only when their
  // own data changes — not on chat typing or tab switches. setDetailDishId,
  // loadOlderMessages, loadMoreMedia and scrollChatToBottom are already stable.
  const stableOpenMedia = useStableHandler(openMediaViewer);
  const stableRateDish = useStableHandler((dishId: string, rating: number | null) => {
    recordMemoryRoomJourney(journeySession, "DISH_MUTATION_STARTED", {
      queryState: "mutating",
      tab: paneTabMode
    });
    rateDish.mutate({ deferUntilOnline: !runtime.isOnline, dishId, rating }, {
      onError: () => {
        recordMemoryRoomJourney(journeySession, "DISH_MUTATION_FAILED", {
          queryState: "degraded",
          tab: paneTabMode
        });
      },
      onSuccess: () => {
        recordMemoryRoomJourney(journeySession, "DISH_MUTATION_FINISHED", {
          queryState: "ready",
          tab: paneTabMode
        });
      }
    });
  });
  const stableBeginSelection = useStableHandler(beginSelection);
  const stableToggleSelection = useStableHandler(toggleSelectedItem);
  const stableCancelSelection = useStableHandler(cancelSelection);
  const stableDeleteSelected = useStableHandler(removeSelectedItems);
  const stableEditMessage = useStableHandler(beginEditMessage);
  const stableCancelEdit = useStableHandler(cancelEditMessage);
  const stableReplyMessage = useStableHandler(beginReplyMessage);
  const stableCancelReply = useStableHandler(cancelReplyMessage);
  const stableRetryFailedMessage = useStableHandler(retryFailedMessage);
  const stableCancelFailedMessage = useStableHandler(cancelFailedMessage);
  const stableCopyMessage = useStableHandler(copyMessageBody);
  // React Query's result object is a new reference on every render, so
  // loadOlderMessages was too — and it is the ONE prop that broke the chat
  // pane's memo on every single non-bailing render (14 of 14 measured). Every
  // other handler on that pane already goes through useStableHandler.
  const stableLoadOlderMessages = useStableHandler(loadOlderMessages);
  const stableChangeMessage = useStableHandler(syncComposerDraft);
  const stableSend = useStableHandler(submitMessage);
  const stableSendAudio = useStableHandler(sendAudioMessage);
  const stableToggleReaction = useStableHandler(toggleMessageReaction);
  const stableNearBottomChange = useStableHandler(handleChatNearBottomChange);
  const stableVisibleReadPosition = useStableHandler(markVisibleRoomRead);
  const captureTableScroll = useCallback((offset: number) => {
    captureMemoryRoomScrollOffset(scrollSessionRef.current, "overview", offset);
  }, []);
  const captureChatScroll = useCallback((offset: number) => {
    captureMemoryRoomScrollOffset(scrollSessionRef.current, "chat", offset);
  }, []);
  const captureMediaScroll = useCallback((offset: number) => {
    captureMemoryRoomScrollOffset(scrollSessionRef.current, "media", offset);
  }, []);
  const captureDishesScroll = useCallback((offset: number) => {
    captureMemoryRoomScrollOffset(scrollSessionRef.current, "dishes", offset);
  }, []);
  const placementRoomReady = Boolean(room.data);

  useEffect(() => () => {
    for (const timer of placementStaleRefreshTimersRef.current) clearTimeout(timer);
    placementStaleRefreshTimersRef.current.clear();
  }, []);

  // Runs after the Chat surface's first render, so that render still receives
  // the anchor and every later remount in this room visit does not.
  useEffect(() => {
    if (paneTabMode === "chat") roomUnreadAnchorConsumedRef.current = true;
  }, [paneTabMode]);

  useEffect(() => {
    const fixtureKinds = memoryChatPlacementFixtureKinds();
    if (
      placementFixtureRunRef.current ||
      fixtureKinds.length === 0 ||
      paneTabMode !== "chat" ||
      !placementRoomReady
    ) return;
    placementFixtureRunRef.current = true;
    let cancelled = false;
    void (async () => {
      const startDelayMs = memoryChatPlacementFixtureStartDelayMs();
      if (startDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, startDelayMs));
      }
      for (const kind of fixtureKinds) {
        if (cancelled) return;
        const asset = await downloadMemoryChatPlacementFixture(kind);
        if (cancelled) {
          await discardTemporaryAccountFile(asset.mediaUri).catch(() => undefined);
          return;
        }
        await stableSendAudio(asset);
        await discardTemporaryAccountFile(asset.mediaUri).catch(() => undefined);
      }
    })().catch(() => {
      console.warn("[memory-chat] Placement fixture could not be sent");
    });
    return () => {
      cancelled = true;
    };
  }, [paneTabMode, placementRoomReady, stableSendAudio]);

  const projectedRoomData = mergedRoomData ?? room.data ?? null;
  const projectedSummaryUnreadCount = memoryRoomSummariesFromPages(
    queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
  ).find((memory) => memory.id === projectedRoomData?.id)?.unreadChatCount;
  const projectedUnreadCount = projectedRoomData
    ? projectedSummaryUnreadCount ??
      unreadChatMessageCount(projectedRoomData, myUsername)
    : 0;
  const cachedUnreadAnchorId = projectedRoomData
    ? firstUnreadMemoryMessageId(
      projectedRoomData.messages,
      projectedRoomData.lastReadAt,
      myUsername
    )
    : null;
  // Renderer-independent on purpose. This was gated on the native recycler,
  // which is profile-only, so in every shipping build the bounded server-side
  // anchor lookup — the API action, the indexed owner-scoped SQLite page and
  // its tests — was unreachable code. Production resolved the anchor purely
  // from `cachedUnreadAnchorId`, so an unread message older than the local
  // cache window produced no divider and no jump at all: the room simply
  // opened at the newest row as though nothing were unread.
  const unreadAnchorLookupNeeded =
    Boolean(projectedRoomData) &&
    projectedUnreadCount > 0 &&
    !cachedUnreadAnchorId;
  const nativeUnreadAnchor = useMemoryUnreadAnchorQuery(
    roomId,
    projectedRoomData?.lastReadAt ?? null,
    unreadAnchorLookupNeeded
  );
  const projectedRoomDataWithUnreadAnchor = useMemo(
    () => projectedRoomData && nativeUnreadAnchor.data?.messages.length
      ? mergeRoomMessages(
        projectedRoomData,
        nativeUnreadAnchor.data.messages
      )
      : projectedRoomData,
    [nativeUnreadAnchor.data, projectedRoomData]
  );
  const resolvedUnreadAnchorId =
    cachedUnreadAnchorId ??
    nativeUnreadAnchor.data?.anchorMessageId ??
    null;
  const unreadAnchorLookupReady =
    !unreadAnchorLookupNeeded || nativeUnreadAnchor.isSuccess;
  const unreadAnchorLookupFailed =
    unreadAnchorLookupNeeded && nativeUnreadAnchor.isError;
  // This anchor belongs to the room-screen lifetime, not the Chat pane
  // lifetime. Chat is intentionally unmounted when inactive, so keeping the
  // ref inside Chat recreated its entire row projection after mark-read changed
  // `lastReadAt` on every return.
  const roomUnreadAnchorRef = useRef<{
    id: string | null;
    roomId: string;
  } | null>(null);
  // The anchor id lives for the whole room visit so the divider keeps its place
  // in the timeline, but the viewport may only be MOVED to it once. Without
  // this, leaving Chat for Media and coming back would remount the surface,
  // re-latch the same anchor and drag the user back up to a divider they had
  // already read past, discarding their restored scroll offset.
  const roomUnreadAnchorConsumedRef = useRef(false);
  if (
    projectedRoomDataWithUnreadAnchor &&
    roomUnreadAnchorRef.current?.roomId !== projectedRoomDataWithUnreadAnchor.id
  ) {
    roomUnreadAnchorRef.current = {
      id: resolvedUnreadAnchorId,
      roomId: projectedRoomDataWithUnreadAnchor.id
    };
    roomUnreadAnchorConsumedRef.current = false;
  } else if (
    resolvedUnreadAnchorId &&
    roomUnreadAnchorRef.current &&
    !roomUnreadAnchorRef.current.id
  ) {
    roomUnreadAnchorRef.current.id = resolvedUnreadAnchorId;
  }
  const productionProjectionStoreRef = useRef<MemoryChatIncrementalProjectionStore<MemoryMessage, MemoryChatMainMessage> | null>(null);
  if (!productionProjectionStoreRef.current) {
    productionProjectionStoreRef.current = new MemoryChatIncrementalProjectionStore();
  }
  // Ordinary own-text insertion and confirmation are projected incrementally:
  // the new row (and only its immediate grouping neighbour) changes identity.
  // Media, dishes, reactions, unread anchors, and history pages deliberately
  // fall back to the canonical mixed-timeline projector.
  const chatProjectionNeeded = chatProjectionArmed || paneTabMode === "chat";
  const projectedChatMessages = useMemo(() => (
    chatProjectionNeeded && projectedRoomDataWithUnreadAnchor
      ? traceMemoryRoomSection(
        "MemoryRoomChatCachedMessages",
        () => productionProjectionStoreRef.current!.project({
          buildFull: () => buildMemoryChatMainMessages({
            data: projectedRoomDataWithUnreadAnchor,
            myUsername,
            reactions: messageReactions,
            unreadAnchorMessageId: roomUnreadAnchorRef.current?.id ?? null
          }),
          buildOwnTextRow: (candidate) => (
            candidate.authorName === myUsername &&
            candidate.attachments.length === 0 &&
            Boolean(candidate.body.trim())
              ? buildMemoryChatMainMessageRow({
                message: candidate,
                reactions: messageReactions,
                showSenderDetails: false
              })
              : null
          ),
          dependencies: [
            projectedRoomDataWithUnreadAnchor.id,
            projectedRoomDataWithUnreadAnchor.photos,
            projectedRoomDataWithUnreadAnchor.dishes,
            messageReactions,
            myUsername,
            roomUnreadAnchorRef.current?.id ?? null
          ],
          messageIdentity: (candidate) => memoryChatRowKey(candidate),
          messages: projectedRoomDataWithUnreadAnchor.messages,
          rowIdentity: (row) => String(row._id)
        })
      )
      : []
  ), [
    chatProjectionNeeded,
    messageReactions,
    myUsername,
    projectedRoomDataWithUnreadAnchor
  ]);
  const liteRowStoreRef = useRef<MemoryChatRowModelStore | null>(null);
  if (!liteRowStoreRef.current) {
    liteRowStoreRef.current = new MemoryChatRowModelStore();
  }
  const projectedLiteChatRows = useMemo(
    () =>
      MEMORY_ROOM_CHAT_LITE_RENDERER && projectedRoomDataWithUnreadAnchor
        ? traceMemoryRoomSection("MemoryRoomChatLiteRows", () =>
          liteRowStoreRef.current!.project(
            projectedRoomDataWithUnreadAnchor,
            myUsername,
            roomUnreadAnchorRef.current?.id ?? null
          ))
        : [],
    [myUsername, projectedRoomDataWithUnreadAnchor]
  );
  const visiblePaneTabMode = paneTabMode;
  const interactivePaneTabMode = paneTabMode;
  const chatSurfaceActive =
    visiblePaneTabMode === "chat" && interactivePaneTabMode === "chat";
  // Deliberately NOT frozen while inactive. The warm-bounded experiment held a
  // snapshot so a retained vendored tree would not re-render off-screen, but a
  // retained pane that ignores arrivals shows stale history on return, and the
  // row identity lookups (liteMessageByKey, selection keys) read the live list
  // — so a frozen list also rendered rows that no tap could resolve. Rows are
  // memoized, so an arrival re-renders the new row and its neighbour only.
  const chatMessagesForHost = projectedChatMessages;
  // Chat, once warmed, stays mounted for the rest of the room visit; every
  // other pane still mounts on first visit. Switching to Chat is then a
  // visibility change rather than a rebuild, which is the whole point.
  const paneMounted = (tab: RoomTabMode) => (
    tab === "chat"
      ? chatWarmReady || paneTabMode === "chat"
      : paneTabMode === tab
  );
  useEffect(() => {
    if (!projectedRoomData) return;
    const queries = queryClient.getQueryCache().getAll();
    recordMemoryRoomCacheProfileSnapshot({
      chatEntities: projectedRoomData.messages.length,
      dishEntities: projectedRoomData.dishes.length,
      inactiveQueries: queries.filter((query) => !query.isActive()).length,
      mediaEntities: projectedRoomData.photos.length,
      mutations: queryClient.getMutationCache().getAll().length,
      observers: queries.reduce(
        (count, query) => count + query.getObserversCount(),
        0
      ),
      queries: queries.length,
      roomQueries: queries.filter((query) => query.queryKey.includes(roomId)).length
    });
  }, [paneTabMode, projectedRoomData, queryClient, roomId]);

  const currentRoomSummary = memoryRoomSummariesFromPages(
    queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
  ).find((memory) => memory.id === roomId);
  const currentMediaUnread = currentRoomSummary?.unreadMediaCount ?? 0;
  const currentDishUnread = currentRoomSummary?.unreadDishCount ?? 0;
  useEffect(() => {
    if (!runtime.isForeground || mode === "people") {
      setActiveMemorySurface(null);
      return;
    }
    setActiveMemorySurface({ roomId, surface: paneTabMode });
    return () => setActiveMemorySurface(null);
  }, [mode, paneTabMode, roomId, runtime.isForeground]);
  useEffect(() => {
    if (paneTabMode !== "media" || currentMediaUnread <= 0 || markMediaRead.isPending) return;
    markMediaRead.mutate(undefined);
  }, [currentMediaUnread, markMediaRead, paneTabMode]);
  useEffect(() => {
    if (paneTabMode !== "dishes" || currentDishUnread <= 0 || markDishesRead.isPending) return;
    markDishesRead.mutate(undefined);
  }, [currentDishUnread, markDishesRead, paneTabMode]);

  if (room.isLoading) {
    return (
      <MemoryRoomLoadingShell
        onBack={goBackToOrigin}
        selectedMode={memoryRoomModeFromTabParam(params.tab) ?? "overview"}
        showSkeleton={room.isColdLoading}
        summary={cachedRoomSummary}
      />
    );
  }

  if (room.isError || !room.data) {
    return (
      <Screen>
        <MemoryCenterState
          body={room.error?.message ?? "Table memory not found"}
          buttonLabel="Go back"
          onPress={goBackToOrigin}
          title="Could not load memory"
        />
      </Screen>
    );
  }

  const data = projectedRoomData ?? room.data;
  const roomOccasionType = effectiveRoomOccasionType(data);
  const roomOccasionTheme = getOccasionTheme(roomOccasionType);
  applyRoomTheme(resolvedTheme, roomOccasionType);
  const detailDish = detailDishId ? data.dishes.find((dish) => dish.id === detailDishId) ?? null : null;
  const displayRestaurantName = formatRestaurantDisplayName(data.restaurantName);
  const selectedTargets = selectedItemKeys
    .map((key) => findMemoryActionTarget(data, key))
    .filter((target): target is MemoryActionTarget => Boolean(target));
  const canDeleteSelected = selectedTargets.length > 0 && selectedTargets.every((target) => (
    canDeleteMemoryActionTarget(target, myUsername)
  ));
  // Everything the retired long-press menu offered now lives on the selection
  // toolbar. Copy and Reply act on a single message by definition, so they are
  // resolved the same way Edit already was rather than by folding a multi
  // selection into one action.
  const singleSelectedMessage =
    selectedTargets.length === 1 && selectedTargets[0].type === "message"
      ? selectedTargets[0].value
      : null;
  const singleSelectedDish =
    selectedTargets.length === 1 && selectedTargets[0].type === "dish"
      ? selectedTargets[0].value
      : null;
  const editableSelectedMessage =
    singleSelectedMessage && canEditMemoryMessage(singleSelectedMessage, myUsername)
      ? singleSelectedMessage
      : null;
  const copyableSelectedMessage =
    singleSelectedMessage && singleSelectedMessage.body.trim().length > 0
      ? singleSelectedMessage
      : null;
  const replyableSelectedMessage =
    singleSelectedMessage && canReplyToMemoryMessage(singleSelectedMessage)
      ? singleSelectedMessage
      : singleSelectedDish
        ? memoryDishReplyTarget(singleSelectedDish)
        : null;
  const discardableSelectedMessage =
    singleSelectedMessage && canDiscardMemoryMessage(singleSelectedMessage, myUsername)
      ? singleSelectedMessage
      : null;
  const floatingAddAvailable = !selectedMedia;
  const floatingAddVisible = mode === "overview" && floatingAddAvailable;
  const headerMode = mode === "people" ? "overview" : mode;
  const summaryUnreadChatCount = currentRoomSummary?.unreadChatCount;
  const unreadChatCount = summaryUnreadChatCount ?? unreadChatMessageCount(data, myUsername);
  const unreadMediaCount = currentRoomSummary?.unreadMediaCount ?? 0;
  const unreadDishCount = currentRoomSummary?.unreadDishCount ?? 0;

  return (
    <Screen padded={false} style={styles.screenContent}>
      <RoomHeader
        activePaneIndex={activePaneIndex}
        data={data}
        displayRestaurantName={displayRestaurantName}
        keyboardProgress={overlayKeyboardProgress}
        mode={headerMode}
        myUsername={myUsername}
        pagerPosition={pagerPosition}
        onAddPeople={openPeopleAdd}
        onBack={mode === "people" ? closePeopleScreen : goBackToOrigin}
        onChangeMode={handleRoomTabPress}
        onOpenActions={openRoomActions}
        onViewPeople={openPeopleList}
        transitioning={mode === "people"}
        unreadChatCount={unreadChatCount}
        unreadDishCount={unreadDishCount}
        unreadMediaCount={unreadMediaCount}
      />
      <RoomKeyboardContainer chatMode={mode === "chat"}>
        <View
          style={[
            styles.roomStage,
            headerMode === "overview" && styles.roomStageTable,
            mode === "chat" && styles.roomStageChat
          ]}
        >
          <FoodChatWallpaper />
          <View style={styles.roomStageShift}>
            <View style={styles.body}>
              <View style={styles.roomPager}>
                <RoomPane
                  active={visiblePaneTabMode === "overview"}
                  interactive={interactivePaneTabMode === "overview"}
                  mounted={paneMounted("overview")}
                >
                  <ItineraryPanelPane
                    activeStopActionId={activeStopActionId}
                    initialScrollOffset={readMemoryRoomScrollOffset(scrollSessionRef.current, "overview")}
                    journeySession={journeySession}
                    onActivateStopActions={setActiveStopActionId}
                    onDeleteStop={confirmDeleteMemoryStop}
                    onDismissStopActions={() => setActiveStopActionId(null)}
                    onEditStop={editMemoryStop}
                    onScrollOffsetChange={captureTableScroll}
                    stops={data.stops}
                    themeCopy={roomOccasionTheme.copy}
                    topInset={TABLE_HEADER_CLEARANCE}
                  />
                </RoomPane>
                <RoomPane
                  active={visiblePaneTabMode === "chat"}
                  interactive={interactivePaneTabMode === "chat"}
                  mounted={paneMounted("chat")}
                >
                  <MemoryChatMainSurfacePane
                    active={chatSurfaceActive}
                    canDeleteSelected={canDeleteSelected}
                    canLoadOlderMessages={canLoadOlderMessages}
                    chatMessages={chatMessagesForHost}
                    collapsedComposerGeometry={collapsedComposerGeometry}
                    copyableSelectedMessage={copyableSelectedMessage}
                    discardableSelectedMessage={discardableSelectedMessage}
                    deleteError={errorMessage(deleteItems.error ?? deleteDish.error)}
                    deletePending={deleteItems.isPending || deleteDish.isPending}
                    editableSelectedMessage={editableSelectedMessage}
                    editingMessage={editingMessage}
                    inputRef={messageInputRef}
                    initialScrollOffset={readMemoryRoomScrollOffset(scrollSessionRef.current, "chat")}
                    initialUnreadMessageId={
                      roomUnreadAnchorConsumedRef.current
                        ? null
                        : roomUnreadAnchorRef.current?.id ?? null
                    }
                    journeySession={journeySession}
                    keyboardTopReserve={chatKeyboardTopReserve}
                    listRef={chatMainListRef}
                    liteRows={projectedLiteChatRows}
                    loadingOlderMessages={olderMessages.isFetchingNextPage}
                    message={message}
                    myDisplayName={myDisplayName}
                    myUsername={myUsername}
                    unreadAnchorLookupFailed={unreadAnchorLookupFailed}
                    unreadAnchorLookupReady={unreadAnchorLookupReady}
                    olderMessagesFailed={olderMessagesFailed}
                    replyableSelectedMessage={replyableSelectedMessage}
                    selectedItemKeys={selectedItemKeys}
                    unreadCount={unreadChatCount}
                    onBeginSelection={stableBeginSelection}
                    onCancelEdit={stableCancelEdit}
                    onCancelFailedMessage={stableCancelFailedMessage}
                    onCancelReply={stableCancelReply}
                    onCancelSelection={stableCancelSelection}
                    onChangeMessage={stableChangeMessage}
                    onCopyMessage={stableCopyMessage}
                    onDeleteSelected={stableDeleteSelected}
                    onEditMessage={stableEditMessage}
                    onLoadOlderMessages={stableLoadOlderMessages}
                    onNearBottomChange={stableNearBottomChange}
                    onVisibleReadPosition={stableVisibleReadPosition}
                    onScrollOffsetChange={captureChatScroll}
                    onOpenDish={setDetailDishId}
                    onOpenMedia={stableOpenMedia}
                    onRateDish={stableRateDish}
                    onReplyMessage={stableReplyMessage}
                    onRetryFailedMessage={stableRetryFailedMessage}
                    onSend={stableSend}
                    onSendAudio={stableSendAudio}
                    onToggleSelection={stableToggleSelection}
                    onToggleReaction={stableToggleReaction}
                    replyingToMessage={replyingToMessage}
                    roomId={roomId}
                    resolvedTheme={resolvedTheme}
                    surfaceKeyboardStyle={chatMainSurfaceKeyboardStyle}
                    toolbarInsetStyle={composerBottomInsetStyle}
                  />
                </RoomPane>
                <RoomPane
                  active={visiblePaneTabMode === "media"}
                  interactive={interactivePaneTabMode === "media"}
                  mounted={paneMounted("media")}
                >
                  <MediaGalleryPane
                    error={mediaError || addPhoto.error?.message || errorMessage(mediaPages.error)}
                    hasMore={Boolean(mediaPages.hasNextPage)}
                    initialScrollOffset={readMemoryRoomScrollOffset(scrollSessionRef.current, "media")}
                    loading={
                      room.openedWithoutLocalReplica &&
                      mediaPages.isLoading &&
                      galleryPhotos.length === 0
                    }
                    loadingMore={mediaPages.isFetchingNextPage}
                    journeySession={journeySession}
                    onLoadMore={loadMoreMedia}
                    onOpenMedia={stableOpenMedia}
                    onScrollOffsetChange={captureMediaScroll}
                    photos={galleryPhotos}
                    themeCopy={roomOccasionTheme.copy}
                  />
                </RoomPane>
                <RoomPane
                  active={visiblePaneTabMode === "dishes"}
                  interactive={interactivePaneTabMode === "dishes"}
                  mounted={paneMounted("dishes")}
                >
                  <DishesPanelPane
                    dishes={data.dishes}
                    error={rateDish.error?.message}
                    initialScrollOffset={readMemoryRoomScrollOffset(scrollSessionRef.current, "dishes")}
                    journeySession={journeySession}
                    onOpenDish={setDetailDishId}
                    onRateDish={stableRateDish}
                    onScrollOffsetChange={captureDishesScroll}
                    themeCopy={roomOccasionTheme.copy}
                  />
                </RoomPane>
              </View>
            </View>

          </View>
        </View>

        <RoomActionsSheet
          leavePending={leaveRoom.isPending}
          onClose={closeRoomActions}
          onLeave={confirmLeaveRoom}
          visible={roomActionsVisible}
        />
        {selectedMedia ? (
          <MediaViewer
            journeySession={journeySession}
            onClose={closeMediaViewer}
            onMediaError={refreshSelectedMedia}
            selection={selectedMedia}
            tab={paneTabMode}
          />
        ) : null}
      </RoomKeyboardContainer>
      {/* Outside RoomKeyboardContainer and outside the chat's keyboard-inset
          view, so the menu is placed in stable screen space rather than riding
          the composer's translation while it is open. */}
      {/* Scrim for the speed-dial only. Place, Dish and Media each navigate to
          their own route, so this layer disappears before the next screen opens. */}
      {floatingAddMenuOpen ? (
        <Pressable
          accessibilityLabel="Close add menu"
          onPress={closeFloatingAddMenu}
          style={styles.floatingAddBackdrop}
        >
          <BlurView
            blurReductionFactor={4}
            experimentalBlurMethod="dimezisBlurView"
            intensity={36}
            style={StyleSheet.absoluteFill}
            tint={resolvedTheme === "dark" ? "dark" : "light"}
          />
          <View pointerEvents="none" style={styles.floatingAddBackdropDim} />
        </Pressable>
      ) : null}
      {floatingAddAvailable ? (
        <FloatingAddMenu
          bottomInset={insets.bottom}
          pagerPosition={pagerPosition}
          visible={floatingAddVisible}
          open={floatingAddMenuOpen}
          progress={floatingAddMenuProgress}
          onToggle={() => setFloatingAddMenuOpen((current) => !current)}
        />
      ) : null}
      {floatingAddAvailable ? (
        <AddMenuStack
          bottomInset={insets.bottom}
          onDish={openFloatingAddDish}
          onMedia={openFloatingAddMedia}
          onStop={openAddPlace}
          open={floatingAddMenuOpen}
          progress={floatingAddMenuProgress}
        />
      ) : null}
      <DishDetailSheet
        dish={detailDish}
        error={rateDish.error?.message}
        myUsername={myUsername}
        onClose={() => setDetailDishId(null)}
        onRateDish={stableRateDish}
      />
      {mode === "people" ? (
        <PeoplePanel
          addParticipantError={addParticipant.error?.message}
          addParticipantPending={addParticipant.isPending}
          bottomInset={insets.bottom}
          circleStatuses={memberCircleStatuses}
          closing={peopleClosing}
          inputRef={peopleInputRef}
          myUsername={myUsername}
          onBack={closePeopleScreen}
          onChangeParticipant={setParticipant}
          onCloseAnimationEnd={finishPeopleClose}
          onOpenProfile={openMemberProfile}
          onRemoveSelectedParticipant={removeSelectedParticipant}
          onRequestCircle={requestMemberCircle}
          onSelectParticipant={selectParticipantSuggestion}
          onSubmitParticipants={submitParticipants}
          participantSearchError={participantSearch.error}
          participantValue={participant}
          participantsLoading={participantSearch.loading}
          participantSuggestions={participantSearch.results}
          participants={data.participants}
          selectedParticipants={selectedParticipants}
          toastMessage={peopleToastMessage}
        />
      ) : null}
    </Screen>
  );
}

function MemoryRoomLoadingShell({
  onBack,
  selectedMode = "overview",
  showSkeleton,
  summary
}: {
  onBack: () => void;
  selectedMode?: RoomTabMode;
  showSkeleton: boolean;
  summary?: MemoryRoomSummary;
}) {
  const roomTitle = summary?.title?.trim() || summary?.restaurantName?.trim() || "Table memory";
  const placeLabel = summary?.placeNames?.filter(Boolean).join(" · ")
    || summary?.restaurantName?.trim()
    || "Your table";
  const dateLabel = summary
    ? formatDisplayDate(summary.visitDate ?? summary.createdAt)
    : "Opening room";
  return (
    <Screen padded={false} style={styles.screenContent}>
      <View style={styles.roomLoadingHeader}>
        <View style={styles.roomLoadingTopRow}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack}
            style={[styles.headerIconButton, styles.headerBackButton]}
          >
            <Ionicons name="arrow-back" size={20} color={ROOM_COLORS.onSurface} />
          </Pressable>
          <View style={styles.roomLoadingTitleBlock}>
            <Text numberOfLines={1} style={styles.roomLoadingTitle}>{roomTitle}</Text>
            <Text numberOfLines={1} style={styles.roomLoadingSubtitle}>{placeLabel} · {dateLabel}</Text>
          </View>
          <View style={styles.roomLoadingHeaderSpacer} />
        </View>
        <View accessibilityRole="tablist" style={styles.roomLoadingTabs}>
          {ROOM_TABS.map((tab) => (
            <View
              accessibilityRole="tab"
              accessibilityState={{ selected: tab.mode === selectedMode }}
              key={tab.mode}
              style={[styles.roomLoadingTab, tab.mode === selectedMode && styles.roomLoadingTabActive]}
            >
              <Ionicons
                name={tab.icon}
                size={17}
                color={tab.mode === selectedMode ? ROOM_COLORS.onSurface : ROOM_COLORS.muted}
              />
              <Text style={[styles.roomLoadingTabText, tab.mode === selectedMode && styles.roomLoadingTabTextActive]}>
                {tab.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.roomLoadingStage}>
        <FoodChatWallpaper />
        <View style={styles.roomLoadingContent}>
          {showSkeleton ? <RoomTabLoadingSkeleton mode={selectedMode} /> : null}
        </View>
      </View>
    </Screen>
  );
}

function RoomSkeletonPulse({
  accessibilityLabel,
  children
}: {
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotionPreference();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    opacity.stopAnimation();
    if (reducedMotion) {
      opacity.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          duration: 850,
          toValue: 0.52,
          useNativeDriver: true
        }),
        Animated.timing(opacity, {
          duration: 850,
          toValue: 1,
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => {
      animation.stop();
      opacity.stopAnimation();
    };
  }, [opacity, reducedMotion]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      pointerEvents="none"
    >
      <Animated.View style={{ opacity }}>
        {children}
      </Animated.View>
    </View>
  );
}

function RoomTabLoadingSkeleton({ mode }: { mode: RoomTabMode }) {
  if (mode === "chat") {
    return (
      <RoomSkeletonPulse accessibilityLabel="Loading messages">
        <View style={styles.roomSkeletonChat}>
          {[0, 1, 2, 3, 4].map((row) => {
            const mine = row === 1 || row === 3;
            return (
              <View
                key={row}
                style={[styles.roomSkeletonChatRow, mine && styles.roomSkeletonChatRowMine]}
              >
                {!mine ? <View style={styles.roomSkeletonAvatar} /> : null}
                <View
                  style={[
                    styles.roomSkeletonBubble,
                    mine && styles.roomSkeletonBubbleMine,
                    row === 2 && styles.roomSkeletonBubbleWide
                  ]}
                >
                  <View style={styles.roomSkeletonLineWide} />
                  <View style={styles.roomSkeletonLineShort} />
                </View>
              </View>
            );
          })}
        </View>
      </RoomSkeletonPulse>
    );
  }

  if (mode === "media") {
    return (
      <RoomSkeletonPulse accessibilityLabel="Loading media">
        <View style={styles.roomSkeletonMediaGrid}>
          {Array.from({ length: 6 }, (_, index) => (
            <View key={index} style={styles.roomSkeletonMediaTile} />
          ))}
        </View>
      </RoomSkeletonPulse>
    );
  }

  if (mode === "dishes") {
    return (
      <RoomSkeletonPulse accessibilityLabel="Loading dishes">
        <View style={styles.roomSkeletonDishList}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.roomSkeletonDishCard}>
              <View style={styles.roomSkeletonDishIcon} />
              <View style={styles.roomSkeletonDishCopy}>
                <View style={styles.roomSkeletonLineMedium} />
                <View style={styles.roomSkeletonLineShort} />
              </View>
              <View style={styles.roomSkeletonRating} />
            </View>
          ))}
        </View>
      </RoomSkeletonPulse>
    );
  }

  return (
    <RoomSkeletonPulse accessibilityLabel="Loading places">
      <View style={styles.roomSkeletonTable}>
        <View style={styles.roomSkeletonPostButton} />
        <View style={styles.roomSkeletonSectionTitle} />
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.roomSkeletonStopRow}>
            <View style={styles.roomSkeletonStopRail}>
              {row > 0 ? <View style={styles.roomSkeletonStopConnectorTop} /> : null}
              {row < 2 ? <View style={styles.roomSkeletonStopConnectorBottom} /> : null}
              <View style={styles.roomSkeletonStopMarker} />
            </View>
            <View style={styles.roomSkeletonStopCard}>
              <View style={styles.roomSkeletonStopCopy}>
                <View style={styles.roomSkeletonLineMedium} />
                <View style={styles.roomSkeletonLineShort} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </RoomSkeletonPulse>
  );
}

function RoomKeyboardContainer({ chatMode, children }: { chatMode: boolean; children: ReactNode }) {
  return (
    <KeyboardAvoidingView
      behavior={!chatMode && Platform.OS === "ios" ? "padding" : undefined}
      enabled={!chatMode}
      keyboardVerticalOffset={0}
      style={styles.keyboard}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

function RoomHeader({
  activePaneIndex,
  data,
  displayRestaurantName,
  keyboardProgress,
  mode,
  myUsername,
  onAddPeople,
  onBack,
  onChangeMode,
  onOpenActions,
  onViewPeople,
  pagerPosition,
  transitioning,
  unreadChatCount,
  unreadDishCount,
  unreadMediaCount
}: {
  activePaneIndex: SharedValue<number>;
  data: MemoryRoom;
  displayRestaurantName: string;
  keyboardProgress: SharedValue<number>;
  mode: RoomMode;
  myUsername: string;
  onAddPeople: () => void;
  onBack: () => void;
  onChangeMode: (mode: RoomMode) => void;
  onOpenActions: () => void;
  onViewPeople: () => void;
  pagerPosition: SharedValue<number>;
  transitioning: boolean;
  unreadChatCount: number;
  unreadDishCount: number;
  unreadMediaCount: number;
}) {
  const roomTitle = data.title?.trim() || displayRestaurantName;
  const roomDateLabel = formatDisplayDate(data.visitDate ?? data.createdAt);
  const isMembersArea = mode === "people";
  const isCompactHeader = mode !== "overview";
  const compactTitle = isMembersArea ? "Members" : roomTitle;
  const visualTabMode: RoomTabMode = isMembersArea ? "overview" : mode;
  // Collapse + tab indicator follow the controlled room tab position. Table
  // (index 0) stays expanded; every other tab is compact.
  const collapseProgress = useDerivedValue(() => Math.min(Math.max(pagerPosition.value, 0), 1));
  // Fully fades + slides the whole header out of the way while the dish/media
  // sheet's keyboard is up, in exact lockstep with the keyboard (no own timing).
  const headerHideStyle = useAnimatedStyle(() => ({
    opacity: 1 - keyboardProgress.value,
    transform: [{ translateY: -24 * keyboardProgress.value }]
  }));
  // One continuous header collapses: the lower surface edge and tab bar travel
  // upward together, the same title moves into the compact top row, and details
  // roll out through a fixed clip. Every animated value is a transform.
  const expansionSurfaceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -ROOM_HEADER_COLLAPSE_DISTANCE * collapseProgress.value }]
  }));
  const titleMotionStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ROOM_HEADER_TITLE_TRANSLATE_X * collapseProgress.value },
      { translateY: ROOM_HEADER_TITLE_TRANSLATE_Y * collapseProgress.value }
    ]
  }));
  const detailsMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -ROOM_HEADER_DETAILS_HEIGHT * collapseProgress.value }]
  }));
  const tabsMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -ROOM_HEADER_COLLAPSE_DISTANCE * collapseProgress.value }]
  }));
  const addFriendMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -ROOM_HEADER_CONTROL_SIZE * 1.5 * collapseProgress.value }]
  }));
  const orderedParticipants = useMemo(() => [...data.participants].sort((first, second) => {
    const firstIsMe = first.username.toLowerCase() === myUsername.toLowerCase();
    const secondIsMe = second.username.toLowerCase() === myUsername.toLowerCase();
    if (firstIsMe === secondIsMe) return 0;
    return firstIsMe ? -1 : 1;
  }), [data.participants, myUsername]);
  const visibleAvatars = orderedParticipants.slice(0, 4);
  const hiddenAvatarCount = Math.max(0, orderedParticipants.length - visibleAvatars.length);
  const friendNames = orderedParticipants.map((participant) => friendSummaryName(participant, myUsername));
  const friendsLabel = friendNames.length > 0
    ? friendNames.join(", ")
    : "No friends yet";

  return (
    <Reanimated.View
      aria-hidden={transitioning ? true : undefined}
      accessibilityElementsHidden={transitioning}
      importantForAccessibility={transitioning ? "no-hide-descendants" : "auto"}
      pointerEvents={transitioning ? "none" : "box-none"}
      style={[styles.header, headerHideStyle]}
    >
      <View pointerEvents="none" style={styles.headerCompactSurface} />
      <Reanimated.View
        pointerEvents="none"
        style={[styles.headerExpansionSurface, expansionSurfaceStyle]}
      />

      <View style={styles.headerTop}>
        <Pressable
          accessibilityLabel={transitioning ? undefined : "Go back"}
          accessibilityRole={transitioning ? undefined : "button"}
          hitSlop={8}
          onPress={onBack}
          style={[styles.headerIconButton, styles.headerBackButton]}
        >
          <Ionicons name="arrow-back" size={20} color={ROOM_COLORS.onSurface} />
        </Pressable>
        <View pointerEvents="none" style={styles.headerTopTitleSpacer} />
        <View style={styles.headerActions}>
          {isMembersArea ? null : (
            <Reanimated.View
              pointerEvents={isCompactHeader ? "none" : "auto"}
              style={[styles.headerAddFriendSlot, addFriendMotionStyle]}
            >
              <Pressable
                accessibilityLabel={transitioning ? undefined : "Add friends"}
                accessibilityRole={transitioning ? undefined : "button"}
                hitSlop={8}
                onPress={onAddPeople}
                style={styles.headerIconButton}
              >
                <Ionicons name="person-add-outline" size={20} color={ROOM_COLORS.onSurface} />
              </Pressable>
            </Reanimated.View>
          )}
          <Pressable
            accessibilityLabel={transitioning ? undefined : "Room actions"}
            accessibilityRole={transitioning ? undefined : "button"}
            hitSlop={8}
            onPress={onOpenActions}
            style={styles.headerIconButton}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={ROOM_COLORS.onSurface} />
          </Pressable>
        </View>
      </View>

      <Reanimated.Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1}
        minimumFontScale={0.78}
        numberOfLines={1}
        pointerEvents="none"
        style={[styles.movingRoomTitle, titleMotionStyle]}
      >
        {compactTitle}
      </Reanimated.Text>

      <View
        accessibilityElementsHidden={isCompactHeader || transitioning}
        importantForAccessibility={isCompactHeader || transitioning ? "no-hide-descendants" : "auto"}
        pointerEvents={isCompactHeader || transitioning ? "none" : "box-none"}
        style={styles.headerDetailsClip}
      >
        <Reanimated.View style={[styles.headerDetails, detailsMotionStyle]}>
          <View style={styles.roomMetaRow}>
            <View style={styles.roomMetaGroup}>
              <View style={styles.roomMetaIconSlot}>
                <Ionicons name="calendar-outline" size={13} color={ROOM_COLORS.muted} />
              </View>
              <Text numberOfLines={1} style={[styles.roomMetaText, styles.roomMetaDateText]}>{roomDateLabel}</Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel={transitioning ? undefined : "View members"}
            accessibilityRole={transitioning ? undefined : "button"}
            onPress={onViewPeople}
            style={styles.roomFriendsRow}
          >
            <View style={styles.roomFriendAvatars}>
              {visibleAvatars.map((participant, index) => (
                <View
                  key={participant.id}
                  style={[
                    styles.roomFriendAvatar,
                    index > 0 && styles.roomFriendAvatarOverlap,
                    { backgroundColor: senderAccent(participant.displayName) }
                  ]}
                >
                  <Text style={styles.roomFriendInitial}>{senderInitials(participant.displayName)}</Text>
                </View>
              ))}
              {hiddenAvatarCount > 0 ? (
                <View style={[styles.roomFriendAvatar, visibleAvatars.length > 0 && styles.roomFriendAvatarOverlap, styles.roomFriendMoreAvatar]}>
                  <Text style={styles.roomFriendInitial}>+{hiddenAvatarCount}</Text>
                </View>
              ) : null}
            </View>
            <Text numberOfLines={1} style={styles.roomFriendsText}>{friendsLabel}</Text>
          </Pressable>
        </Reanimated.View>
      </View>

      <Reanimated.View style={[styles.headerTabsPosition, tabsMotionStyle]}>
        <RoomModeTabs
          activePaneIndex={activePaneIndex}
          mode={visualTabMode}
          onChangeMode={onChangeMode}
          pagerPosition={pagerPosition}
          unreadChatCount={unreadChatCount}
          unreadDishCount={unreadDishCount}
          unreadMediaCount={unreadMediaCount}
        />
      </Reanimated.View>
    </Reanimated.View>
  );
}

// Vector icons render a <Text> under the hood, so the glyph colour is a style
// prop and Reanimated can drive it directly.
const AnimatedIonicons = Reanimated.createAnimatedComponent(Ionicons);

function RoomModeTabs({
  activePaneIndex,
  mode,
  onChangeMode,
  pagerPosition,
  unreadChatCount,
  unreadDishCount,
  unreadMediaCount
}: {
  activePaneIndex: SharedValue<number>;
  mode: RoomTabMode;
  onChangeMode: (mode: RoomMode) => void;
  pagerPosition: SharedValue<number>;
  unreadChatCount: number;
  unreadDishCount: number;
  unreadMediaCount: number;
}) {
  // The pill is four equal flex tabs wide inside a header that is the window
  // width capped at ROOM_MAX_WIDTH, so its geometry is known at the FIRST
  // render — no measurement required. It used to be gated behind an
  // onLayout -> setState round trip (`tabWidth > 0 ? ... : null`), which meant
  // the purple box did not exist in the room's first frames at all and popped
  // in only after a layout event and a header re-render.
  const { width: windowWidth } = useWindowDimensions();
  const derivedTabWidth = Math.max(
    0,
    Math.min(windowWidth, ROOM_MAX_WIDTH)
      - ROOM_HEADER_HORIZONTAL_PADDING * 2
      - ROOM_HEADER_CONTENT_INSET * 2
      - MODE_TABS_PADDING * 2
  ) / ROOM_TABS.length;
  // Layout corrections land here rather than in state, so a correction can
  // never re-render the header mid-transition.
  const tabWidth = useSharedValue(derivedTabWidth);
  useEffect(() => {
    tabWidth.value = derivedTabWidth;
  }, [derivedTabWidth, tabWidth]);
  const handleTabBarLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = Math.max(0, event.nativeEvent.layout.width - MODE_TABS_PADDING * 2) / ROOM_TABS.length;
    if (Math.abs(measured - tabWidth.value) > 0.5) tabWidth.value = measured;
  }, [tabWidth]);
  const tabIndicatorStyle = useAnimatedStyle(() => ({
    width: tabWidth.value,
    transform: [
      {
        translateX: MODE_TABS_PADDING
          + tabWidth.value * Math.min(Math.max(pagerPosition.value, 0), ROOM_TABS.length - 1)
      }
    ]
  }));

  return (
    <View style={styles.modeTabsAnimated}>
      <View
        onLayout={handleTabBarLayout}
        style={styles.modeTabs}
      >
        <Reanimated.View
          pointerEvents="none"
          style={[styles.modeTabIndicator, tabIndicatorStyle]}
        />
        {ROOM_TABS.map((tab, index) => (
          <ModeButton
            activePaneIndex={activePaneIndex}
            active={mode === tab.mode}
            icon={tab.icon}
            index={index}
            key={tab.mode}
            label={tab.label}
            onPress={() => onChangeMode(tab.mode)}
            unreadCount={
              tab.mode === "chat"
                ? unreadChatCount
                : tab.mode === "media"
                  ? unreadMediaCount
                  : tab.mode === "dishes"
                    ? unreadDishCount
                    : 0
            }
          />
        ))}
      </View>
    </View>
  );
}

function friendSummaryName(participant: MemoryParticipant, myUsername: string) {
  if (participant.username.toLowerCase() === myUsername.toLowerCase()) return "You";
  return participant.displayName.trim().split(/\s+/)[0] || participant.username;
}

function ModeButton({
  activePaneIndex,
  active,
  icon,
  index,
  label,
  onPress,
  onPrepare,
  unreadCount
}: {
  activePaneIndex: SharedValue<number>;
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  index: number;
  label: string;
  onPress: () => void;
  onPrepare?: () => void;
  unreadCount?: number;
}) {
  // Lit the moment the tap is handled, independent of the indicator's travel.
  // `activePaneIndex` is written synchronously in requestRoomMode, on the UI
  // thread, so the label brightens on the next frame while the box is still
  // sliding toward it. Deliberately NOT tied to the slide: syncing the two was
  // tried (withTiming's completion callback, an exact-position test, then a
  // continuous interpolation of the box's position) and the user preferred the
  // label leading. A step also means a tab the box merely slides past on a
  // non-adjacent jump can never flash. `active` still feeds accessibilityState,
  // where a commit-time update is fine.
  const tintStyle = useAnimatedStyle(() => ({
    color: activePaneIndex.value === index ? ROOM_COLORS.onSurface : ROOM_COLORS.muted
  }));
  const hasUnread = Boolean(unreadCount && unreadCount > 0);
  const accessibilityLabel = hasUnread ? `${label}, ${unreadCount} unread` : label;
  // Android can begin dismissing/resizing the IME between pointer down and the
  // release-time `onPress`. That native relayout cancels Pressable's release
  // callback, making the first tab tap appear ignored while Chat has focus.
  // Activate on pointer down, before the IME can move the window; keep onPress
  // as the keyboard/accessibility path and consume the matching release even
  // when a heavy tab mount delays it beyond an arbitrary clock threshold.
  const pointerReleasePendingRef = useRef(false);
  const pointerReleaseExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (pointerReleaseExpiryRef.current) {
      clearTimeout(pointerReleaseExpiryRef.current);
    }
  }, []);
  const activateOnPressIn = useCallback(() => {
    pointerReleasePendingRef.current = true;
    if (pointerReleaseExpiryRef.current) {
      clearTimeout(pointerReleaseExpiryRef.current);
    }
    pointerReleaseExpiryRef.current = setTimeout(() => {
      pointerReleasePendingRef.current = false;
      pointerReleaseExpiryRef.current = null;
    }, 5_000);
    (onPrepare ?? onPress)();
  }, [onPrepare, onPress]);
  const activateOnPress = useCallback(() => {
    if (pointerReleasePendingRef.current) {
      pointerReleasePendingRef.current = false;
      if (pointerReleaseExpiryRef.current) {
        clearTimeout(pointerReleaseExpiryRef.current);
        pointerReleaseExpiryRef.current = null;
      }
      return;
    }
    onPress();
  }, [onPress]);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={activateOnPress}
      onPressIn={activateOnPressIn}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && !active && styles.modeButtonPressed
      ]}
    >
      <AnimatedIonicons name={icon} size={15} style={tintStyle} />
      <Reanimated.Text style={[styles.modeButtonText, tintStyle]}>{label}</Reanimated.Text>
      {hasUnread ? (
        <View pointerEvents="none" style={styles.modeButtonUnreadBadge}>
          <Text style={styles.modeButtonUnreadText}>{unreadCount && unreadCount > 99 ? "99+" : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function RoomPane({
  active,
  children,
  interactive = active,
  mounted = active,
  onLayout
}: {
  active: boolean;
  children: ReactNode;
  interactive?: boolean;
  mounted?: boolean;
  onLayout?: () => void;
}) {
  if (!mounted) return null;

  return (
    <View
      aria-hidden={interactive ? undefined : true}
      accessibilityElementsHidden={!interactive}
      collapsable={false}
      importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
      onLayout={onLayout}
      pointerEvents={interactive ? "auto" : "none"}
      style={[
        styles.roomPagerPage,
        active ? styles.roomPagerPageActive : styles.roomPagerPageInactive
      ]}
    >
      {children}
    </View>
  );
}

function PaneReveal({
  active,
  children,
  pointerEvents,
  style
}: {
  active: boolean;
  children: ReactNode;
  pointerEvents?: "auto" | "none";
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: active ? 180 : 0,
      easing: Easing.out(Easing.cubic),
      toValue: active ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [active, progress]);

  return (
    <Animated.View pointerEvents={pointerEvents} style={[style, { opacity: progress }]}>
      {children}
    </Animated.View>
  );
}

function FloatingAddMenu({
  bottomInset,
  onToggle,
  pagerPosition,
  visible,
  open,
  progress
}: {
  bottomInset: number;
  onToggle: () => void;
  pagerPosition: SharedValue<number>;
  visible: boolean;
  open: boolean;
  progress: Animated.Value;
}) {
  const buttonBottom = Math.max(FLOATING_ADD_EDGE_OFFSET, bottomInset + 6);
  const iconRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "45deg"]
  });
  // The button belongs to Table, so it rides the SAME value as the header's
  // collapse rather than running its own timeline. It used to be a legacy
  // Animated.timing kicked off by a useEffect on a `mode`-derived prop, which
  // put it two steps behind: it could not start until React committed the mode
  // change, and only then began its own 180ms. Coming back to Table, the header
  // had finished expanding on
  // the UI thread before the button had started moving. Reading pagerPosition
  // means it expands WITH the header, on the same clock, with no timing of its
  // own to drift.
  const buttonMotionStyle = useAnimatedStyle(() => {
    const revealed = 1 - Math.min(Math.max(pagerPosition.value, 0), 1);
    return {
      opacity: revealed,
      transform: [
        { translateX: 86 * (1 - revealed) },
        { scale: 0.92 + (0.08 * revealed) }
      ]
    };
  });

  return (
    <Reanimated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.floatingAddButtonFrame,
        {
          bottom: buttonBottom,
          right: FLOATING_ADD_EDGE_OFFSET
        },
        buttonMotionStyle
      ]}
    >
      <Pressable
        accessibilityLabel={open ? "Close add menu" : "Add to table"}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.floatingAddButton}
      >
        <Animated.View style={[styles.floatingAddIconWrap, { transform: [{ rotate: iconRotate }] }]}>
          <Ionicons name="add" size={FLOATING_ADD_ICON_SIZE} color={ROOM_COLORS.onCool} style={styles.floatingAddIcon} />
        </Animated.View>
      </Pressable>
    </Reanimated.View>
  );
}

// Speed-dial actions anchored to the + button. The menu grows upward from the
// control instead of sliding a sheet over the bottom of the room.
function AddMenuStack({
  bottomInset,
  onDish,
  onMedia,
  onStop,
  open,
  progress
}: {
  bottomInset: number;
  onDish: () => void;
  onMedia: () => void;
  onStop: () => void;
  open: boolean;
  progress: Animated.Value;
}) {
  const stackBottom = Math.max(FLOATING_ADD_EDGE_OFFSET, bottomInset + 6) + FLOATING_ADD_BUTTON_SIZE + FLOATING_ADD_MENU_GAP;
  const stackRight = FLOATING_ADD_EDGE_OFFSET + ((FLOATING_ADD_BUTTON_SIZE - FLOATING_ADD_ACTION_ICON_SIZE) / 2);
  // Latched, not mirrored: once the menu has been opened the actions stay so a
  // second open costs nothing and the closing animation still has children.
  const renderedRef = useRef(open);
  if (open) renderedRef.current = true;
  const rendered = renderedRef.current;

  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      style={[
        styles.addMenuStack,
        {
          bottom: stackBottom,
          right: stackRight
        }
      ]}
    >
      {/* Built on first open, not on every room open. The speed-dial is closed
          for almost the whole life of the room, and its actions were mounting
          on the room-open path and tearing down on the back-exit path to sit
          invisible in between. Kept mounted once opened so reopening it stays
          instant, and so the close animation has something to animate. */}
      {rendered ? (
        <>
          <AddMenuAction icon="location-outline" label="Place" onPress={onStop} progress={progress} stackIndexFromBottom={2} />
          <AddMenuAction icon="restaurant-outline" label="Dish" onPress={onDish} progress={progress} stackIndexFromBottom={1} />
          <AddMenuAction icon="camera-outline" label="Media" onPress={onMedia} progress={progress} stackIndexFromBottom={0} />
        </>
      ) : null}
    </Animated.View>
  );
}

function AddMenuAction({
  icon,
  label,
  onPress,
  progress,
  stackIndexFromBottom
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  progress: Animated.Value;
  stackIndexFromBottom: number;
}) {
  const originOffsetY =
    (FLOATING_ADD_BUTTON_SIZE / 2) +
    FLOATING_ADD_MENU_GAP +
    (FLOATING_ADD_ACTION_ICON_SIZE / 2) +
    (stackIndexFromBottom * (FLOATING_ADD_ACTION_ICON_SIZE + spacing.sm));
  const actionOpacity = progress.interpolate({
    inputRange: [0, 0.12, 1],
    outputRange: [0, 1, 1]
  });
  const actionTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [originOffsetY, 0]
  });
  const iconScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.62, 1]
  });
  const labelOpacity = progress.interpolate({
    inputRange: [0, 0.48, 1],
    outputRange: [0, 0, 1]
  });
  const labelTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0]
  });

  return (
    <Animated.View
      style={{
        opacity: actionOpacity,
        transform: [{ translateY: actionTranslateY }]
      }}
    >
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.addMenuAction, pressed && styles.addMenuActionPressed]}
      >
        <Animated.View style={[styles.addMenuActionLabel, { opacity: labelOpacity, transform: [{ translateX: labelTranslateX }] }]}>
          <Text style={styles.addMenuActionText}>{label}</Text>
        </Animated.View>
        <Animated.View style={[styles.addMenuActionIcon, { transform: [{ scale: iconScale }] }]}>
          <Ionicons color={ROOM_COLORS.cool} name={icon} size={21} style={styles.addMenuActionGlyph} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function rowSpacingStyle(rowSpacing: Extract<ChatTimelineRow, { type: "message" | "media" | "dish" }>["rowSpacing"]) {
  if (rowSpacing === "break") return styles.chatMessageRowAfterBreak;
  if (rowSpacing === "group-start") return styles.chatMessageRowGroupStart;
  return styles.chatMessageRowGrouped;
}

function ChatHistoryHeader({
  error,
  hasMore,
  loading,
  onLoad
}: {
  error?: string;
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.timelineHistoryStatus}>
        <Text style={styles.timelineHistoryText}>Loading earlier messages...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <Pressable accessibilityRole="button" onPress={onLoad} style={styles.timelineHistoryStatus}>
        <Text style={styles.timelineHistoryText}>Could not load earlier messages · Retry</Text>
      </Pressable>
    );
  }

  if (!hasMore) return null;

  return (
    <Pressable accessibilityRole="button" onPress={onLoad} style={styles.timelineHistoryStatus}>
      <Text style={styles.timelineHistoryText}>Load earlier messages</Text>
    </Pressable>
  );
}

const prefetchedMemoryMediaKeys = new Set<string>();
// Reactions are intentionally disabled until they have server authority,
// realtime delivery and a SQLite projection. Do not present component-only
// state as a shared room feature.
//
// There is no longer a separate "message options" flag: the long-press menu is
// always available and no longer rides on the reactions wrapper, so a flag that
// existed only to keep that wrapper mounted would now be misleading.
const MEMORY_REACTIONS_ENABLED = false;

function memoryMediaCacheKey(media: MemoryPhoto) {
  return media.storagePath || media.id || media.publicUrl;
}

// A photo's own identity MOVES when the send confirms: the optimistic preview
// (`optimistic-media:…`, no storagePath) is replaced by the real photo, so
// memoryMediaCacheKey jumps from the preview's id to the real storagePath. That
// changes both the React key and expo-image's recyclingKey, which tears the tile
// down and rebuilds it — the picture visibly blanking the moment processing
// finishes, even though warmMemoryPhotoCache already has its bytes on disk.
//
// The SLOT does not move. Key the view on the message's logical row key (stable
// across optimistic -> confirmed, see memoryChatRowKey) plus the position, so
// the same view survives the swap and expo-image just crossfades the source.
function memoryMediaSlotViewKey(rowKey: string, media: MemoryPhoto, index: number) {
  return `${rowKey}:${Number.isFinite(media.position) ? media.position : index}`;
}

function prefetchMemoryMedia(media: MemoryPhoto) {
  const cacheKey = memoryMediaCacheKey(media);
  if (!media.publicUrl || prefetchedMemoryMediaKeys.has(cacheKey)) return;
  prefetchedMemoryMediaKeys.add(cacheKey);
  if (media.mediaType === "video") {
    if (media.posterUrl) {
      Image.prefetch(media.posterUrl).catch(() => {
        prefetchedMemoryMediaKeys.delete(cacheKey);
      });
      return;
    }
    void generateCachedVideoThumbnail(cacheKey, media.publicUrl)
      .then((thumbnail) => {
        if (!thumbnail) prefetchedMemoryMediaKeys.delete(cacheKey);
      });
    return;
  }
  if (memoryMediaKind(media) === "audio") return;
  Image.prefetch(media.publicUrl).catch(() => {
    prefetchedMemoryMediaKeys.delete(cacheKey);
  });
}

function prefetchTimelineRowMedia(row: ChatTimelineRow) {
  if (row.type === "media") {
    prefetchMemoryMedia(row.value);
    return;
  }
  if (row.type === "message") {
    row.value.attachments.forEach(prefetchMemoryMedia);
  }
}

// Inactive legacy chat list. The memory room currently renders
// MemoryChatMainSurface above, which wraps the vendored ChatMain AnimatedFlatList.
// Keep keyboard/bottom-follow fixes on that active path unless this component is
// deliberately wired back in.
function ChatTimeline({
  active,
  bottomClearance,
  data,
  editingMessageId,
  hasOlderMessages,
  myUsername,
  loadingOlderMessages,
  onAddDish,
  onAddMedia,
  onAddPeople,
  onBeginSelection,
  onCloseReactionPicker,
  onContentHeightChange,
  onLayoutChange,
  onLoadOlderMessages,
  onNearBottomChange,
  onOpenDish,
  onOpenMedia,
  onOpenReactionPicker,
  onRateDish,
  onCancelFailedMessage,
  onReplyMessage,
  onRetryFailedMessage,
  onScrollBeginDrag,
  onSelectionPressOut,
  onToggleSelection,
  onToggleReaction,
  lastReadAt,
  olderMessagesError,
  reactionPickerMessageId,
  reactions,
  scrollRef,
  scrollToBottom,
  selectedItemKeys,
  selectionMode,
  themeCopy,
  typingVisible
}: {
  active: boolean;
  bottomClearance: number;
  data: MemoryRoom;
  editingMessageId: string | null;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  myUsername: string;
  onAddDish: () => void;
  onAddMedia: () => void;
  onAddPeople: () => void;
  onBeginSelection: (target: MemoryActionTarget) => void;
  onCloseReactionPicker: () => void;
  onContentHeightChange: (height: number) => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
  onLoadOlderMessages: () => void;
  onNearBottomChange: (isNearBottom: boolean) => void;
  onOpenDish: (dishId: string) => void;
  onOpenMedia: OpenMediaHandler;
  onOpenReactionPicker: (messageId: string) => void;
  onRateDish: (dishId: string, rating: number | null) => void;
  onCancelFailedMessage: (message: MemoryMessage) => void;
  onReplyMessage: (message: MemoryMessage) => void;
  onRetryFailedMessage: (message: MemoryMessage) => void;
  onScrollBeginDrag: () => void;
  onSelectionPressOut: (target: MemoryActionTarget) => void;
  onToggleSelection: (target: MemoryActionTarget) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  lastReadAt: string | null;
  olderMessagesError?: string;
  reactionPickerMessageId: string | null;
  reactions: MemoryReactionState;
  scrollRef: React.RefObject<FlatList<ChatTimelineRow> | null>;
  scrollToBottom: (animated: boolean) => void;
  selectedItemKeys: string[];
  selectionMode: boolean;
  themeCopy: OccasionTheme["copy"];
  typingVisible: boolean;
}) {
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [
      ...data.messages.map((message): TimelineItem => ({
        createdAt: message.createdAt,
        id: `message:${message.id}`,
        type: "message",
        value: message
      })),
      ...data.photos.filter((photo) => !photo.messageId).map((photo): TimelineItem => ({
        createdAt: photo.createdAt,
        id: `media:${photo.id}`,
        type: "media",
        value: photo
      })),
      ...data.dishes.map((dish): TimelineItem => ({
        createdAt: dish.createdAt,
        id: `dish:${dish.id}`,
        type: "dish",
        value: dish
      }))
    ];
    return items.sort((a, b) => {
      if (a.type === "message" && b.type === "message") {
        return compareMemoryMessages(a.value, b.value);
      }
      return timeValue(a.createdAt) - timeValue(b.createdAt) || a.id.localeCompare(b.id);
    });
  }, [data.dishes, data.messages, data.photos]);
  const participantNames = useMemo(
    () => new Map(data.participants.map((participant) => [participant.username, participant.displayName])),
    [data.participants]
  );
  const latestTimelineItem = timeline[timeline.length - 1] ?? null;
  const latestTimelineItemId = latestTimelineItem?.id ?? null;
  const latestTimelineItemMine = latestTimelineItem ? getTimelineSenderUsername(latestTimelineItem) === myUsername : false;
  const [initialAnchorReady, setInitialAnchorReady] = useState(false);
  const wasActiveRef = useRef(active);
  const initialAnchorReadyRef = useRef(false);
  const didScrollToUnreadRef = useRef(false);
  const didInitialBottomScrollRef = useRef(false);
  const listNearBottomRef = useRef(false);
  const latestTimelineItemIdRef = useRef(latestTimelineItemId);
  // While true, the list self-corrects to the exact content end (latest message sitting
  // just above the composer) on every scroll/content-size event — late-mounting rows,
  // the header collapse resize, and media loads all land short otherwise. Released only
  // when the user drags away from the bottom.
  const followBottomRef = useRef(false);
  const isDraggingRef = useRef(false);
  const loadOlderGuardRef = useRef({ inFlight: false, lastRequestAt: 0 });
  const viewabilityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progressiveRowsUnlocked, setProgressiveRowsUnlocked] = useState(false);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [hasUnseenLatest, setHasUnseenLatest] = useState(false);
  const latestButtonVisibleRef = useRef(false);
  // Set the follow-bottom intent DURING render (before layout/onContentSizeChange),
  // so the new message is pinned in the same layout pass. If we only set it in an
  // effect (which runs after onContentSizeChange), the content-size scroll sees
  // stale flags and skips, leaving the new bubble parked behind the composer until
  // a deferred scroll drags it up.
  const renderPinnedForIdRef = useRef<string | null>(latestTimelineItemId);
  if (
    active &&
    latestTimelineItemId &&
    latestTimelineItemId !== renderPinnedForIdRef.current &&
    (latestTimelineItemMine || listNearBottomRef.current || followBottomRef.current)
  ) {
    renderPinnedForIdRef.current = latestTimelineItemId;
    followBottomRef.current = true;
    listNearBottomRef.current = true;
  }
  const computeFirstUnreadItemId = useCallback((items: TimelineItem[], lastReadValue: string | null) => {
    const lastReadTime = lastReadValue ? new Date(lastReadValue).getTime() : 0;
    return items.find((item) => {
      const itemTime = new Date(item.createdAt).getTime();
      if (!Number.isFinite(itemTime) || itemTime <= lastReadTime) return false;
      if (item.type === "message") return item.value.authorName !== myUsername;
      if (item.type === "media") return item.value.uploaderName !== myUsername;
      return false;
    })?.id ?? null;
  }, [myUsername]);
  // The unread anchor is frozen per visit: lastReadAt cache updates (markRead, the
  // periodic room refetch) must not move or remove the divider while the tab is open.
  // It is recomputed each time the chat tab becomes active.
  const [firstUnreadItemId, setFirstUnreadItemId] = useState<string | null>(() => (
    computeFirstUnreadItemId(timeline, lastReadAt)
  ));
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReplyJumpRef = useRef<string | null>(null);
  const lastActiveRenderRef = useRef(active);
  if (lastActiveRenderRef.current !== active) {
    lastActiveRenderRef.current = active;
    if (active) {
      const nextFirstUnreadItemId = computeFirstUnreadItemId(timeline, lastReadAt);
      if (nextFirstUnreadItemId !== firstUnreadItemId) setFirstUnreadItemId(nextFirstUnreadItemId);
    }
  }

  useEffect(() => {
    didScrollToUnreadRef.current = false;
  }, [firstUnreadItemId]);

  useEffect(() => {
    didInitialBottomScrollRef.current = false;
    listNearBottomRef.current = false;
    followBottomRef.current = false;
    initialAnchorReadyRef.current = false;
    setHasUnseenLatest(false);
    setInitialAnchorReady(false);
    latestButtonVisibleRef.current = false;
    setProgressiveRowsUnlocked(false);
    setShowLatestButton(false);
  }, [data.id]);

  const revealInitialAnchor = useCallback(() => {
    if (initialAnchorReadyRef.current) return;
    initialAnchorReadyRef.current = true;
    requestAnimationFrame(() => setInitialAnchorReady(true));
  }, []);
  const setLatestButtonVisible = useCallback((visible: boolean) => {
    if (latestButtonVisibleRef.current === visible) return;
    latestButtonVisibleRef.current = visible;
    setShowLatestButton(visible);
  }, []);

  const timelineRows = useMemo(() => {
    const rows: ChatTimelineRow[] = [];

    timeline.forEach((item, index) => {
      const senderUsername = getTimelineSenderUsername(item);
      const previousItem = timeline[index - 1];
      const nextItem = timeline[index + 1];
      const previousSenderUsername = previousItem ? getTimelineSenderUsername(previousItem) : null;
      const nextSenderUsername = nextItem ? getTimelineSenderUsername(nextItem) : null;
      const startsNewDay = !previousItem || getTimelineDateKey(previousItem) !== getTimelineDateKey(item);
      const nextStartsNewDay = nextItem ? getTimelineDateKey(nextItem) !== getTimelineDateKey(item) : false;
      const mine = senderUsername === myUsername;
      const startsUnreadGroup = item.id === firstUnreadItemId;
      const nextStartsUnreadGroup = nextItem?.id === firstUnreadItemId;
      const startsGroup = startsNewDay || startsUnreadGroup || senderUsername !== previousSenderUsername;
      const endsGroup = !nextItem || nextStartsNewDay || nextStartsUnreadGroup || senderUsername !== nextSenderUsername;
      const rowSpacing = startsNewDay || startsUnreadGroup || index === 0
        ? "break"
        : startsGroup
          ? "group-start"
          : "grouped";

      if (startsNewDay) {
        rows.push({
          id: `date:${getTimelineDateKey(item)}`,
          label: formatDisplayDate(item.createdAt),
          type: "date"
        });
      }

      if (startsUnreadGroup) {
        rows.push({
          id: `unread:${item.id}`,
          type: "unread"
        });
      }

      if (item.type === "message") {
        rows.push({
          groupPosition: getMessageGroupPosition(startsGroup, endsGroup),
          id: item.id,
          mine,
          rowSpacing,
          showSenderDetails: !mine && startsGroup,
          type: "message",
          value: item.value
        });
        return;
      }

      if (item.type === "dish") {
        rows.push({
          groupPosition: getMessageGroupPosition(startsGroup, endsGroup),
          id: item.id,
          mine,
          rowSpacing,
          showSenderDetails: !mine && startsGroup,
          type: "dish",
          value: item.value
        });
        return;
      }

      rows.push({
        groupPosition: getMessageGroupPosition(startsGroup, endsGroup),
        id: item.id,
        mine,
        rowSpacing,
        showSenderDetails: !mine && startsGroup,
        type: "media",
        value: item.value
      });
    });

    return rows;
  }, [firstUnreadItemId, myUsername, timeline]);
  // Inverted list: data is rendered newest-first (index 0 = newest, at the bottom).
  // All scroll-to-index lookups must use this reversed array's indices.
  const invertedRows = useMemo(() => timelineRows.slice().reverse(), [timelineRows]);
  const firstUnreadRowIndex = useMemo(
    () => invertedRows.findIndex((row) => row.type === "unread"),
    [invertedRows]
  );
  const renderedRows = useMemo(() => {
    const canRenderProgressively = (
      firstUnreadRowIndex < 0 &&
      !progressiveRowsUnlocked &&
      invertedRows.length > CHAT_TIMELINE_PROGRESSIVE_INITIAL_ROWS
    );
    return canRenderProgressively
      ? invertedRows.slice(0, CHAT_TIMELINE_PROGRESSIVE_INITIAL_ROWS)
      : invertedRows;
  }, [firstUnreadRowIndex, invertedRows, progressiveRowsUnlocked]);
  const messageRowIndexById = useMemo(() => {
    const byId = new Map<string, number>();
    invertedRows.forEach((row, index) => {
      if (row.type === "message" || row.type === "dish") byId.set(row.value.id, index);
    });
    return byId;
  }, [invertedRows]);
  const hideUntilAnchored = timelineRows.length > 0 && !initialAnchorReady;

  useEffect(() => () => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    if (viewabilityDebounceRef.current) clearTimeout(viewabilityDebounceRef.current);
  }, []);

  useEffect(() => {
    if (!loadingOlderMessages) loadOlderGuardRef.current.inFlight = false;
  }, [loadingOlderMessages]);

  const requestLoadOlderMessages = useCallback(() => {
    if (!hasOlderMessages || loadingOlderMessages) return;
    const now = Date.now();
    if (
      loadOlderGuardRef.current.inFlight ||
      now - loadOlderGuardRef.current.lastRequestAt < CHAT_TIMELINE_LOAD_OLDER_DEBOUNCE_MS
    ) {
      return;
    }
    loadOlderGuardRef.current = { inFlight: true, lastRequestAt: now };
    onLoadOlderMessages();
  }, [hasOlderMessages, loadingOlderMessages, onLoadOlderMessages]);

  const highlightMessage = useCallback((messageId: string) => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedMessageId(messageId);
    highlightTimeoutRef.current = setTimeout(() => {
      highlightTimeoutRef.current = null;
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 1000);
  }, []);

  const scrollToMessage = useCallback((messageId: string, animated: boolean) => {
    const rowIndex = messageRowIndexById.get(messageId);
    if (rowIndex == null) return false;
    if (rowIndex >= renderedRows.length) {
      setProgressiveRowsUnlocked(true);
      requestAnimationFrame(() => scrollToMessage(messageId, animated));
      return true;
    }
    followBottomRef.current = false;
    listNearBottomRef.current = false;
    onNearBottomChange(false);
    scrollRef.current?.scrollToIndex({
      animated,
      index: rowIndex,
      viewPosition: 0.45
    });
    highlightMessage(messageId);
    return true;
  }, [highlightMessage, messageRowIndexById, onNearBottomChange, renderedRows.length, scrollRef]);

  const jumpToRepliedMessage = useCallback((messageId: string) => {
    if (scrollToMessage(messageId, true)) return;
    pendingReplyJumpRef.current = messageId;
    requestLoadOlderMessages();
  }, [requestLoadOlderMessages, scrollToMessage]);

  useEffect(() => {
    const pendingMessageId = pendingReplyJumpRef.current;
    if (!pendingMessageId) return;
    if (scrollToMessage(pendingMessageId, true)) {
      pendingReplyJumpRef.current = null;
      return;
    }
    if (hasOlderMessages && !loadingOlderMessages) {
      requestLoadOlderMessages();
      return;
    }
    if (!hasOlderMessages && !loadingOlderMessages) {
      pendingReplyJumpRef.current = null;
    }
  }, [hasOlderMessages, loadingOlderMessages, requestLoadOlderMessages, scrollToMessage, timelineRows.length]);

  useEffect(() => {
    if (!active || !listNearBottomRef.current) return;
    onNearBottomChange(true);
  }, [active, onNearBottomChange]);

  useEffect(() => {
    const previousLatestId = latestTimelineItemIdRef.current;
    latestTimelineItemIdRef.current = latestTimelineItemId;
    if (!active || !latestTimelineItemId || previousLatestId === latestTimelineItemId) return undefined;
    if (!latestTimelineItemMine && !listNearBottomRef.current && !followBottomRef.current) {
      setHasUnseenLatest(true);
      setLatestButtonVisible(true);
      return undefined;
    }

    // The primary scroll is done by onContentSizeChange, which fires once the new
    // row has laid out and so uses the correct content height — scrolling here with
    // a stale height is what parked the message below the composer then jumped it
    // up. We only set the follow flags, plus one deferred safety-net scroll (next
    // tick, after the height ref is fresh) for the case the user had scrolled up.
    followBottomRef.current = true;
    listNearBottomRef.current = true;
    setHasUnseenLatest(false);
    setLatestButtonVisible(false);
    onNearBottomChange(true);
    const timeout = setTimeout(() => scrollToBottom(false), 0);
    return () => clearTimeout(timeout);
  }, [
    active,
    latestTimelineItemId,
    latestTimelineItemMine,
    onNearBottomChange,
    setLatestButtonVisible,
    scrollToBottom
  ]);

  const anchorStateRef = useRef({
    firstUnreadRowIndex,
    onNearBottomChange,
    rowCount: timelineRows.length,
    scrollToBottom
  });
  anchorStateRef.current = {
    firstUnreadRowIndex,
    onNearBottomChange,
    rowCount: timelineRows.length,
    scrollToBottom
  };

  // Anchors once per activation. Live values come from anchorStateRef so that
  // mid-transition re-renders (mark-read cache writes, row mounts) cannot re-run
  // this effect and cancel the pending retry timers.
  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      return undefined;
    }
    if (wasActiveRef.current) return undefined;
    wasActiveRef.current = true;

    const anchorList = (animated: boolean) => {
      const anchor = anchorStateRef.current;
      if (anchor.rowCount === 0) {
        revealInitialAnchor();
        return;
      }
      if (anchor.firstUnreadRowIndex >= 0) {
        followBottomRef.current = false;
        listNearBottomRef.current = false;
        anchor.onNearBottomChange(false);
        scrollRef.current?.scrollToIndex({
          animated,
          index: anchor.firstUnreadRowIndex,
          viewPosition: 0.12
        });
      } else {
        followBottomRef.current = true;
        listNearBottomRef.current = true;
        anchor.onNearBottomChange(true);
        anchor.scrollToBottom(animated);
      }
    };

    const frame = requestAnimationFrame(() => anchorList(false));
    const timeouts = [64, 240, 450, 700].map((delay) => (
      setTimeout(() => anchorList(false), delay)
    ));

    return () => {
      cancelAnimationFrame(frame);
      timeouts.forEach(clearTimeout);
    };
  }, [active, revealInitialAnchor, scrollRef]);

  useEffect(() => {
    if (firstUnreadRowIndex < 0 || didScrollToUnreadRef.current) return;
    const timeout = setTimeout(() => {
      didScrollToUnreadRef.current = true;
      scrollRef.current?.scrollToIndex({
        animated: false,
        index: firstUnreadRowIndex,
        viewPosition: 0.08
      });
      revealInitialAnchor();
    }, 50);

    return () => clearTimeout(timeout);
  }, [firstUnreadRowIndex, revealInitialAnchor, scrollRef]);

  useEffect(() => {
    if (timelineRows.length === 0) {
      revealInitialAnchor();
      return;
    }

    const timeout = setTimeout(revealInitialAnchor, 320);
    return () => clearTimeout(timeout);
  }, [revealInitialAnchor, timelineRows.length]);

  const rowHandlersRef = useRef({ onBeginSelection, onCancelFailedMessage, onCloseReactionPicker, onOpenDish, onOpenMedia, onOpenReactionPicker, onRateDish, onReplyMessage, onRetryFailedMessage, onSelectionPressOut, onToggleReaction, onToggleSelection });
  rowHandlersRef.current = { onBeginSelection, onCancelFailedMessage, onCloseReactionPicker, onOpenDish, onOpenMedia, onOpenReactionPicker, onRateDish, onReplyMessage, onRetryFailedMessage, onSelectionPressOut, onToggleReaction, onToggleSelection };
  const beginRowSelection = useCallback((target: MemoryActionTarget) => rowHandlersRef.current.onBeginSelection(target), []);
  const cancelFailedRowMessage = useCallback((message: MemoryMessage) => rowHandlersRef.current.onCancelFailedMessage(message), []);
  const closeRowReactionPicker = useCallback(() => rowHandlersRef.current.onCloseReactionPicker(), []);
  const finishRowSelectionPress = useCallback((target: MemoryActionTarget) => rowHandlersRef.current.onSelectionPressOut(target), []);
  const openRowDish = useCallback((dishId: string) => rowHandlersRef.current.onOpenDish(dishId), []);
  const rateRowDish = useCallback((dishId: string, rating: number | null) => rowHandlersRef.current.onRateDish(dishId, rating), []);
  const openRowMedia = useCallback<OpenMediaHandler>((media, group) => rowHandlersRef.current.onOpenMedia(media, group), []);
  const openRowReactionPicker = useCallback((messageId: string) => rowHandlersRef.current.onOpenReactionPicker(messageId), []);
  const replyToRow = useCallback((message: MemoryMessage) => rowHandlersRef.current.onReplyMessage(message), []);
  const retryFailedRowMessage = useCallback((message: MemoryMessage) => rowHandlersRef.current.onRetryFailedMessage(message), []);
  const toggleRowReaction = useCallback((messageId: string, emoji: string) => rowHandlersRef.current.onToggleReaction(messageId, emoji), []);
  const toggleRowSelection = useCallback((target: MemoryActionTarget) => rowHandlersRef.current.onToggleSelection(target), []);
  const jumpToLatest = useCallback((animated: boolean) => {
    followBottomRef.current = true;
    listNearBottomRef.current = true;
    setHasUnseenLatest(false);
    setLatestButtonVisible(false);
    onNearBottomChange(true);
    scrollToBottom(animated);
  }, [onNearBottomChange, scrollToBottom, setLatestButtonVisible]);

  const renderTimelineRow = useCallback(({ item }: { item: ChatTimelineRow }) => {
    if (item.type === "date") return <DateDivider label={item.label} />;

    if (item.type === "unread") {
      return (
        <UnreadDivider
          onJumpToLatest={() => jumpToLatest(true)}
        />
      );
    }

    const rowStyle = [rowSpacingStyle(item.rowSpacing)];

    if (item.type === "message") {
      return (
        <MessageBubble
          message={item.value}
          mine={item.mine}
          onBeginSelection={() => beginRowSelection({ type: "message", value: item.value })}
          onCancelFailed={() => cancelFailedRowMessage(item.value)}
          onOpenMedia={openRowMedia}
          onCloseReactionPicker={closeRowReactionPicker}
          onJumpToMessage={jumpToRepliedMessage}
          onOpenReactionPicker={() => openRowReactionPicker(item.value.id)}
          onReply={() => replyToRow(item.value)}
          onRetryFailed={() => retryFailedRowMessage(item.value)}
          onSelectionPressOut={() => finishRowSelectionPress({ type: "message", value: item.value })}
          onToggleReaction={(emoji) => toggleRowReaction(item.value.id, emoji)}
          onToggleSelection={() => toggleRowSelection({ type: "message", value: item.value })}
          currentUserId={myUsername || "me"}
          editing={editingMessageId === item.value.id}
          groupPosition={item.groupPosition}
          highlighted={highlightedMessageId === item.value.id}
          reactionPickerOpen={MEMORY_REACTIONS_ENABLED && !selectionMode && reactionPickerMessageId === item.value.id}
          reactions={MEMORY_REACTIONS_ENABLED ? reactions[item.value.id] ?? {} : {}}
          rowStyle={rowStyle}
          selected={selectedItemKeys.includes(`message:${item.value.id}`)}
          selectionMode={selectionMode}
          showSenderDetails={item.showSenderDetails}
        />
      );
    }

    if (item.type === "dish") {
      return (
        <DishTimelineCard
          dish={item.value}
          groupPosition={item.groupPosition}
          mine={item.mine}
          onLongPress={() => beginRowSelection({ type: "dish", value: item.value })}
          onOpenDish={() => openRowDish(item.value.id)}
          onPress={() => toggleRowSelection({ type: "dish", value: item.value })}
          onRateDish={(rating) => rateRowDish(item.value.id, rating)}
          rowStyle={rowStyle}
          selected={selectedItemKeys.includes(`dish:${item.value.id}`)}
          selectionMode={selectionMode}
          showSenderDetails={item.showSenderDetails}
        />
      );
    }

    return (
      <MediaBubble
        mine={item.mine}
        onBeginSelection={() => beginRowSelection({ type: "photo", value: item.value })}
        onOpenMedia={openRowMedia}
        onSelectionPressOut={() => finishRowSelectionPress({ type: "photo", value: item.value })}
        onToggleSelection={() => toggleRowSelection({ type: "photo", value: item.value })}
        photo={item.value}
        groupPosition={item.groupPosition}
        rowStyle={rowStyle}
        selected={selectedItemKeys.includes(`photo:${item.value.id}`)}
        selectionMode={selectionMode}
        showSenderDetails={item.showSenderDetails}
        uploaderDisplayName={participantNames.get(item.value.uploaderName) ?? item.value.uploaderName}
      />
    );
  }, [
    beginRowSelection,
    cancelFailedRowMessage,
    closeRowReactionPicker,
    editingMessageId,
    finishRowSelectionPress,
    highlightedMessageId,
    jumpToLatest,
    jumpToRepliedMessage,
    openRowDish,
    openRowMedia,
    openRowReactionPicker,
    participantNames,
    reactionPickerMessageId,
    reactions,
    rateRowDish,
    replyToRow,
    retryFailedRowMessage,
    selectedItemKeys,
    selectionMode,
    toggleRowReaction,
    toggleRowSelection
  ]);
  const chatViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 42,
    minimumViewTime: 90
  }).current;
  const chatViewabilityStateRef = useRef({
    invertedRowsLength: invertedRows.length,
    progressiveRowsUnlocked,
    renderedRowsLength: renderedRows.length
  });
  chatViewabilityStateRef.current = {
    invertedRowsLength: invertedRows.length,
    progressiveRowsUnlocked,
    renderedRowsLength: renderedRows.length
  };
  const handleChatViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length === 0) return;

    viewableItems.forEach((viewToken) => {
      const row = viewToken.item as ChatTimelineRow | undefined;
      if (row) prefetchTimelineRowMedia(row);
    });

    const state = chatViewabilityStateRef.current;
    if (state.progressiveRowsUnlocked || state.renderedRowsLength === state.invertedRowsLength) return;
    if (viewabilityDebounceRef.current) clearTimeout(viewabilityDebounceRef.current);
    viewabilityDebounceRef.current = setTimeout(() => {
      viewabilityDebounceRef.current = null;
      setProgressiveRowsUnlocked(true);
    }, 250);
  }).current;

  return (
    <View onLayout={onLayoutChange} style={[styles.chatTimelineWrap, hideUntilAnchored && styles.chatTimelineHidden]}>
      <FlatList
        data={renderedRows}
        ref={scrollRef}
        inverted
        contentContainerStyle={[
          styles.timelineContent,
          { paddingTop: bottomClearance },
          timelineRows.length === 0 && styles.timelineContentEmpty
        ]}
        initialNumToRender={CHAT_TIMELINE_INITIAL_RENDER_COUNT}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={timelineRows.length > 0 ? (
          // Inverted: the footer renders at the visual TOP (oldest end), where the
          // "load older history" affordance belongs. Counter-flip it so it's upright.
          <View style={styles.invertedListEdge}>
            <ChatHistoryHeader
              error={olderMessagesError}
              hasMore={hasOlderMessages}
              loading={loadingOlderMessages}
              onLoad={requestLoadOlderMessages}
            />
          </View>
        ) : null}
        ListHeaderComponent={typingVisible ? (
          <View style={styles.invertedListEdge}>
            <ChatTypingIndicator label="Updating memory" />
          </View>
        ) : null}
        onEndReached={() => {
          if (initialAnchorReadyRef.current && hasOlderMessages && !loadingOlderMessages) {
            requestLoadOlderMessages();
          }
        }}
        onEndReachedThreshold={0.4}
        maxToRenderPerBatch={CHAT_TIMELINE_MAX_RENDER_BATCH}
        onViewableItemsChanged={handleChatViewableItemsChanged}
        onScroll={(event) => {
          if (!active) return;
          const { contentOffset } = event.nativeEvent;
          // Inverted: the bottom (newest) is at offset 0.
          const distanceFromBottom = contentOffset.y;
          const isNearBottom = distanceFromBottom < 96;
          listNearBottomRef.current = isNearBottom;
          onNearBottomChange(isNearBottom);
          setLatestButtonVisible(distanceFromBottom > CHAT_LATEST_BUTTON_OFFSET_THRESHOLD || hasUnseenLatest);
          if (isNearBottom && hasUnseenLatest) setHasUnseenLatest(false);
          if (!isDraggingRef.current) {
            if (distanceFromBottom < 4) {
              followBottomRef.current = true;
            } else if (followBottomRef.current) {
              scrollToBottom(false);
            }
          }
        }}
        onScrollBeginDrag={() => {
          isDraggingRef.current = true;
          followBottomRef.current = false;
          onScrollBeginDrag();
        }}
        onScrollEndDrag={() => {
          isDraggingRef.current = false;
        }}
        onContentSizeChange={(_contentWidth, contentHeight) => {
          onContentHeightChange(contentHeight);
          const initialBottomScroll = !firstUnreadItemId && !didInitialBottomScrollRef.current;
          const shouldScrollToBottom = followBottomRef.current || listNearBottomRef.current || initialBottomScroll;
          if (shouldScrollToBottom) {
            didInitialBottomScrollRef.current = true;
            if (initialBottomScroll) followBottomRef.current = true;
            scrollToBottom(false);
            listNearBottomRef.current = true;
            if (active) onNearBottomChange(true);
          }
          if (!firstUnreadItemId) revealInitialAnchor();
        }}
        onScrollToIndexFailed={(info) => {
          const nearestMeasuredIndex = Math.max(0, Math.min(info.highestMeasuredFrameIndex, info.index));
          const estimatedOffset = Math.max(0, info.averageItemLength * info.index - 18);
          setTimeout(() => {
            if (info.highestMeasuredFrameIndex > 0) {
              scrollRef.current?.scrollToIndex({
                animated: false,
                index: nearestMeasuredIndex,
                viewPosition: 0.12
              });
              return;
            }
            scrollRef.current?.scrollToOffset({ animated: false, offset: estimatedOffset });
            revealInitialAnchor();
          }, 50);
          // The estimated offset mounts rows near the target; retry the exact index once
          // they exist so the entry never strands mid-history.
          [220, 520].forEach((delay) => setTimeout(() => {
            scrollRef.current?.scrollToIndex({
              animated: false,
              index: info.index,
              viewPosition: 0.12
            });
          }, delay));
        }}
        removeClippedSubviews={false}
        renderItem={renderTimelineRow}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.timelineList}
        updateCellsBatchingPeriod={50}
        viewabilityConfig={chatViewabilityConfig}
        windowSize={CHAT_TIMELINE_WINDOW_SIZE}
      />
      {showLatestButton && timelineRows.length > 0 ? (
        <Pressable
          accessibilityLabel={hasUnseenLatest ? "Jump to new memory activity" : "Jump to latest memory activity"}
          accessibilityRole="button"
          onPress={() => jumpToLatest(true)}
          style={[styles.chatLatestButton, { bottom: bottomClearance + 12 }]}
        >
          <Ionicons name="chevron-down" size={20} color={ROOM_COLORS.onCool} />
        </Pressable>
      ) : null}
      {timelineRows.length === 0 ? (
        // Rendered as a sibling (not ListEmptyComponent) so the inverted list's
        // flip never applies — otherwise the empty state shows upside down.
        <View pointerEvents="box-none" style={styles.emptyChatOverlay}>
          <View style={styles.emptyChat}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles-outline" size={26} color={ROOM_COLORS.cool} />
            </View>
            <Text style={styles.emptyTitle}>{themeCopy.emptyTitle}</Text>
            <Text style={styles.emptyText}>{themeCopy.emptyDescription}</Text>
            <View style={styles.emptyActionRow}>
              <MemoryQuickAction icon="camera-outline" label={themeCopy.mediaAction} onPress={onAddMedia} />
              <MemoryQuickAction icon="restaurant-outline" label="Dish" onPress={onAddDish} />
              <MemoryQuickAction icon="person-add-outline" label="Invite" onPress={onAddPeople} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const FoodChatWallpaper = memo(function FoodChatWallpaper() {
  return (
    <View
      pointerEvents="none"
      style={[styles.chatWallpaper, { backgroundColor: ROOM_COLORS.wallpaperBg }]}
    >
      {/* One pre-baked tile ships in the app: the theme tint (#D7CAB9) and its
          0.2 opacity are already painted into the tile's pixels, so there is no
          per-frame tintColor shader and no fade-in — it appears instantly on room
          entry. Rasterized once to a hardware texture so scroll/keyboard frames
          blit a cached bitmap instead of re-tiling. */}
      <View renderToHardwareTextureAndroid style={StyleSheet.absoluteFill}>
        <ImageBackground
          resizeMode="repeat"
          source={FOOD_WALLPAPER_TILE_SOURCE}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.chatWallpaperOverlay} />
      </View>
    </View>
  );
});

function UnreadDivider({
  onJumpToLatest
}: {
  onJumpToLatest?: () => void;
}) {
  return (
    <View style={styles.unreadDividerRow}>
      <View style={styles.unreadDividerLine} />
      <Text style={styles.unreadDividerText}>Unread messages</Text>
      {onJumpToLatest ? (
        <Pressable hitSlop={6} onPress={onJumpToLatest} style={styles.unreadDividerButton}>
          <Text style={styles.unreadDividerButtonText}>Latest</Text>
        </Pressable>
      ) : null}
      <View style={styles.unreadDividerLine} />
    </View>
  );
}

function DateDivider({ label }: { label: string }) {
  return (
    <View style={styles.dateDividerRow}>
      <Text style={styles.dateDividerText}>{label}</Text>
    </View>
  );
}

function MemoryQuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.quickAction}>
      <Ionicons name={icon} size={16} color={ROOM_COLORS.onSurface} />
      <Text numberOfLines={1} style={styles.quickActionText}>{label}</Text>
    </Pressable>
  );
}

function senderInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || "?").toUpperCase();
}

function senderAccent(name: string) {
  const total = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return CHAT_ACCENTS[total % CHAT_ACCENTS.length];
}


const VIDEO_THUMBNAIL_CACHE_LIMIT = 80;
const videoThumbnailCache = new Map<string, VideoThumbnailsResult>();
type VideoThumbnailImageSource = { uri: string };
const videoThumbnailSourceCache = new Map<string, VideoThumbnailImageSource>();
const videoThumbnailPending = new Map<string, Promise<VideoThumbnailsResult | null>>();

function cacheVideoThumbnail(cacheKey: string, thumbnail: VideoThumbnailsResult) {
  if (videoThumbnailCache.has(cacheKey)) {
    videoThumbnailCache.delete(cacheKey);
  }
  videoThumbnailCache.set(cacheKey, thumbnail);

  if (videoThumbnailCache.size > VIDEO_THUMBNAIL_CACHE_LIMIT) {
    const oldestCacheKey = videoThumbnailCache.keys().next().value;
    if (typeof oldestCacheKey === "string") {
      const oldestThumbnail = videoThumbnailCache.get(oldestCacheKey);
      if (oldestThumbnail) {
        videoThumbnailSourceCache.delete(oldestThumbnail.uri);
        void discardTemporaryAccountFile(oldestThumbnail.uri).catch(() => {});
      }
      videoThumbnailCache.delete(oldestCacheKey);
    }
  }
}

function invalidateVideoThumbnail(cacheKey: string) {
  const thumbnail = videoThumbnailCache.get(cacheKey);
  if (thumbnail) {
    videoThumbnailSourceCache.delete(thumbnail.uri);
    void discardTemporaryAccountFile(thumbnail.uri).catch(() => {});
  }
  videoThumbnailCache.delete(cacheKey);
  videoThumbnailPending.delete(cacheKey);
  prefetchedMemoryMediaKeys.delete(cacheKey);
}

function getVideoThumbnailImageSource(thumbnail: VideoThumbnailsResult) {
  const cachedSource = videoThumbnailSourceCache.get(thumbnail.uri);
  if (cachedSource) return cachedSource;
  const source = { uri: thumbnail.uri };
  videoThumbnailSourceCache.set(thumbnail.uri, source);
  return source;
}

function generateCachedVideoThumbnail(cacheKey: string, sourceUri: string) {
  const cachedThumbnail = videoThumbnailCache.get(cacheKey);
  if (cachedThumbnail) return Promise.resolve(cachedThumbnail);

  const pendingThumbnail = videoThumbnailPending.get(cacheKey);
  if (pendingThumbnail) return pendingThumbnail;

  const ownerGeneration = getActiveCacheGeneration();
  const promise = createLocalVideoPoster(sourceUri)
    .then(async (nextThumbnail) => {
      if (!nextThumbnail) return null;
      const scopedThumbnail = {
        ...nextThumbnail,
        uri: await stageAccountFile(nextThumbnail.uri, "memory-thumbnail")
      };
      if (!isCacheGenerationActive(ownerGeneration)) {
        await discardTemporaryAccountFile(scopedThumbnail.uri).catch(() => {});
        return null;
      }
      cacheVideoThumbnail(cacheKey, scopedThumbnail);
      return scopedThumbnail;
    })
    .catch(() => null)
    .finally(() => {
      videoThumbnailPending.delete(cacheKey);
    });

  videoThumbnailPending.set(cacheKey, promise);
  return promise;
}

function VideoThumbnailLayer({
  cacheKey,
  contentFit = "cover",
  posterUri,
  uri,
  // View identity, kept separate from `cacheKey`: that one keys the GENERATED
  // thumbnail cache and must follow the content, or a thumbnail extracted from
  // a local file could be served after that file is gone.
  viewKey
}: {
  cacheKey: string;
  contentFit?: "contain" | "cover";
  posterUri?: string | null;
  uri: string;
  viewKey?: string;
}) {
  // Keep the local preview mounted beneath the signed server poster during an
  // optimistic -> confirmed swap. The poster URL belongs to a different media
  // identity and may need a network/disk-cache read; removing the local frame
  // first made the video tile go blank and then reappear at upload completion.
  // This ref deliberately stops following `cacheKey` once a poster arrives.
  const localFallbackRef = useRef<{ cacheKey: string; uri: string } | null>(null);
  if (!posterUri) localFallbackRef.current = { cacheKey, uri };

  if (Platform.OS === "web") {
    return posterUri ? (
      <View style={styles.videoThumbnailLayer}>
        <Image
          alt="Video preview"
          cachePolicy="memory-disk"
          contentFit={contentFit}
          priority="high"
          recyclingKey={`${viewKey ?? cacheKey}:poster`}
          source={posterUri}
          style={styles.videoThumbnailImage}
        />
      </View>
    ) : <WebVideoThumbnailLayer contentFit={contentFit} uri={uri} />;
  }

  const localFallback = localFallbackRef.current;
  if (posterUri || localFallback) {
    return (
      <View style={styles.videoThumbnailLayer}>
        {localFallback ? (
          <NativeVideoThumbnailLayer
            cacheKey={localFallback.cacheKey}
            contentFit={contentFit}
            uri={localFallback.uri}
          />
        ) : null}
        {posterUri ? (
          <Image
            alt="Video preview"
            cachePolicy="memory-disk"
            contentFit={contentFit}
            priority="high"
            recyclingKey={`${viewKey ?? cacheKey}:poster`}
            source={posterUri}
            style={styles.videoThumbnailImage}
          />
        ) : null}
      </View>
    );
  }

  return <NativeVideoThumbnailLayer cacheKey={cacheKey} contentFit={contentFit} uri={uri} />;
}

function NativeVideoThumbnailLayer({
  cacheKey,
  contentFit = "cover",
  uri
}: {
  cacheKey: string;
  contentFit?: "contain" | "cover";
  uri: string;
}) {
  const [thumbnailState, setThumbnailState] = useState<{ cacheKey: string; thumbnail: VideoThumbnailsResult } | null>(() => {
    const cachedThumbnail = videoThumbnailCache.get(cacheKey);
    return cachedThumbnail ? { cacheKey, thumbnail: cachedThumbnail } : null;
  });
  const [displayedSourceState, setDisplayedSourceState] = useState<{ cacheKey: string; source: VideoThumbnailImageSource } | null>(() => {
    const cachedThumbnail = videoThumbnailCache.get(cacheKey);
    return cachedThumbnail ? { cacheKey, source: getVideoThumbnailImageSource(cachedThumbnail) } : null;
  });
  const thumbnailErrorRetryRef = useRef(0);
  const thumbnail = thumbnailState?.cacheKey === cacheKey ? thumbnailState.thumbnail : videoThumbnailCache.get(cacheKey) ?? null;
  const displayedSource = displayedSourceState?.cacheKey === cacheKey ? displayedSourceState.source : null;
  const thumbnailSource = thumbnail ? getVideoThumbnailImageSource(thumbnail) : null;

  useEffect(() => {
    thumbnailErrorRetryRef.current = 0;
    const cachedThumbnail = videoThumbnailCache.get(cacheKey);
    if (cachedThumbnail) {
      setThumbnailState({ cacheKey, thumbnail: cachedThumbnail });
      setDisplayedSourceState((current) => (
        current?.cacheKey === cacheKey
          ? current
          : { cacheKey, source: getVideoThumbnailImageSource(cachedThumbnail) }
      ));
      return undefined;
    }

    setThumbnailState((current) => (current?.cacheKey === cacheKey ? current : null));
    setDisplayedSourceState((current) => (current?.cacheKey === cacheKey ? current : null));

    let cancelled = false;

    void generateCachedVideoThumbnail(cacheKey, uri)
      .then((nextThumbnail) => {
        if (!cancelled) {
          setThumbnailState(nextThumbnail ? { cacheKey, thumbnail: nextThumbnail } : null);
          if (nextThumbnail) {
            setDisplayedSourceState((current) => (
              current?.cacheKey === cacheKey
                ? current
                : { cacheKey, source: getVideoThumbnailImageSource(nextThumbnail) }
            ));
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, uri]);

  if (!displayedSource && !thumbnailSource) return null;

  function handleThumbnailLoad() {
    if (!thumbnailSource) return;
    setDisplayedSourceState({ cacheKey, source: thumbnailSource });
  }

  function handleThumbnailError() {
    if (thumbnailErrorRetryRef.current >= 2) return;
    thumbnailErrorRetryRef.current += 1;
    invalidateVideoThumbnail(cacheKey);
    void generateCachedVideoThumbnail(cacheKey, uri)
      .then((nextThumbnail) => {
        if (!nextThumbnail) return;
        const nextSource = getVideoThumbnailImageSource(nextThumbnail);
        setThumbnailState({ cacheKey, thumbnail: nextThumbnail });
        setDisplayedSourceState({ cacheKey, source: nextSource });
      });
  }

  return (
    <View style={styles.videoThumbnailLayer}>
      {displayedSource ? (
        <Image
          cachePolicy="memory-disk"
          contentFit={contentFit}
          onError={handleThumbnailError}
          placeholder={displayedSource}
          placeholderContentFit={contentFit}
          priority="high"
          recyclingKey={cacheKey}
          source={displayedSource}
          transition={0}
          style={styles.videoThumbnailImage}
        />
      ) : null}
      {thumbnailSource && thumbnailSource !== displayedSource ? (
        <Image
          cachePolicy="memory-disk"
          contentFit={contentFit}
          onError={handleThumbnailError}
          onLoad={handleThumbnailLoad}
          placeholder={displayedSource ?? thumbnailSource}
          placeholderContentFit={contentFit}
          priority="high"
          recyclingKey={cacheKey}
          source={thumbnailSource}
          transition={0}
          style={styles.videoThumbnailImage}
        />
      ) : null}
    </View>
  );
}

function WebVideoThumbnailLayer({
  contentFit = "cover",
  uri
}: {
  contentFit?: "contain" | "cover";
  uri: string;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = true;
    instance.volume = 0;
  });

  return (
    <VideoView
      allowsFullscreen={false}
      allowsPictureInPicture={false}
      contentFit={contentFit}
      nativeControls={false}
      player={player}
      playsInline
      pointerEvents="none"
      style={styles.videoThumbnailImage}
    />
  );
}

function UploadProgressOverlay({
  progress,
  status
}: {
  progress?: number | null;
  status?: MemoryPhoto["processingStatus"];
}) {
  const normalizedProgress = Math.max(0, Math.min(progress ?? 0, 1));
  // mediaPipeline maps preparation/intent work to 0..0.18, the direct storage
  // PUT to 0.18..0.90 and worker polling to 0.90..1. Keep those stages visible
  // instead of calling the entire operation "uploading".
  const terminal = status === "failed" || status === "rejected" || status === "cancelled";
  const preparing = !terminal && (status === "local" || (!status && normalizedProgress < 0.18));
  const processing = !terminal && (
    status === "uploaded" || status === "processing" || normalizedProgress >= 0.9
  );
  const uploadFraction = preparing
    ? 0
    : Math.max(0, Math.min((normalizedProgress - 0.18) / 0.72, 1));
  const progressPercent = Math.round(uploadFraction * 100);
  const ringSize = 44;
  const ringStroke = 3;
  const ringRadius = (ringSize - ringStroke) / 2;
  const circumference = 2 * Math.PI * ringRadius;

  return (
    <View style={styles.mediaPendingOverlay}>
      <View style={styles.uploadProgressCircle}>
        <Svg height={ringSize} width={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`}>
          <Circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            fill="none"
            r={ringRadius}
            stroke={ROOM_COLORS.glass}
            strokeWidth={ringStroke}
          />
          <Circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            fill="none"
            r={ringRadius}
            stroke={ROOM_COLORS.cool}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - (processing ? 1 : uploadFraction))}
            strokeLinecap="round"
            strokeWidth={ringStroke}
            transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
          />
        </Svg>
        {terminal ? (
          <Ionicons color={ROOM_COLORS.white} name="alert" size={18} />
        ) : preparing || processing ? null : (
          <Text style={styles.uploadProgressText}>{progressPercent}%</Text>
        )}
      </View>
      <Text style={styles.mediaPendingText}>
        {terminal ? "Could not process" : preparing ? "Preparing" : processing ? "Processing" : "Uploading"}
      </Text>
    </View>
  );
}

function ReplyPreviewBlock({
  author,
  body,
  mine,
  onPress,
  style
}: {
  author: string;
  body: string;
  mine?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const content = (
    <>
      <Text numberOfLines={1} style={[styles.replyPreviewAuthor, mine && styles.replyPreviewAuthorMine]}>
        {author}
      </Text>
      <Text numberOfLines={2} style={[styles.replyPreviewText, mine && styles.replyPreviewTextMine]}>
        {body}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityLabel={`Jump to ${author}'s replied message`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.replyPreviewBlock,
          mine && styles.replyPreviewBlockMine,
          style,
          pressed && styles.replyPreviewBlockPressed
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.replyPreviewBlock, mine && styles.replyPreviewBlockMine, style]}>
      {content}
    </View>
  );
}

function SenderAvatar({ accentColor, name }: { accentColor: string; name: string }) {
  const initials = senderInitials(name);

  return (
    <View style={[styles.senderAvatar, { backgroundColor: accentColor }]}>
      <Text style={styles.senderInitial}>{initials}</Text>
    </View>
  );
}

function useMediaOpenGuard(onBeginSelection: () => void) {
  const ignoreOpenAfterLongPressRef = useRef(false);
  const ignoreOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (ignoreOpenTimeoutRef.current) clearTimeout(ignoreOpenTimeoutRef.current);
  }, []);

  function clearIgnoreOpenTimeout() {
    if (ignoreOpenTimeoutRef.current) clearTimeout(ignoreOpenTimeoutRef.current);
    ignoreOpenTimeoutRef.current = null;
  }

  function handleMediaPressIn() {
    clearIgnoreOpenTimeout();
    ignoreOpenAfterLongPressRef.current = false;
  }

  function handleMediaLongPress() {
    ignoreOpenAfterLongPressRef.current = true;
    clearIgnoreOpenTimeout();
    onBeginSelection();
  }

  function handleMediaPressOut() {
    if (!ignoreOpenAfterLongPressRef.current) return;
    clearIgnoreOpenTimeout();
    ignoreOpenTimeoutRef.current = setTimeout(() => {
      ignoreOpenAfterLongPressRef.current = false;
      ignoreOpenTimeoutRef.current = null;
    }, 700);
  }

  function shouldIgnoreMediaOpen() {
    if (!ignoreOpenAfterLongPressRef.current) return false;
    ignoreOpenAfterLongPressRef.current = false;
    clearIgnoreOpenTimeout();
    return true;
  }

  return { handleMediaLongPress, handleMediaPressIn, handleMediaPressOut, shouldIgnoreMediaOpen };
}

function getMessageTimestampLabel(message: MemoryMessage) {
  const time = formatDisplayTime(message.createdAt);
  return message.editedAt ? `Edited ${time}` : time;
}

function MessageRow({
  children,
  editing = false,
  highlighted = false,
  mine,
  onLayout,
  onPress,
  onPressIn,
  onPressOut,
  onLongPress,
  onSwipeRight,
  rowStyle,
  selected,
  senderName,
  showSenderDetails = true,
  swipeEnabled = true
}: {
  children: ReactNode;
  editing?: boolean;
  highlighted?: boolean;
  mine: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  onLongPress?: () => void;
  onSwipeRight?: () => void;
  rowStyle?: StyleProp<ViewStyle>;
  selected?: boolean;
  senderName: string;
  showSenderDetails?: boolean;
  swipeEnabled?: boolean;
}) {
  const accentColor = senderAccent(senderName);
  const replySwipeX = useSharedValue(0);
  const replySwipeProgress = useDerivedValue(() => (
    Math.min(1, Math.max(0, replySwipeX.value / REPLY_SWIPE_TRIGGER_DISTANCE))
  ));
  const replySwipeContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: replySwipeX.value }]
  }), [replySwipeX]);
  const triggerSwipeReply = useCallback(() => {
    if (swipeEnabled) onSwipeRight?.();
  }, [onSwipeRight, swipeEnabled]);
  const replySwipeGesture = useMemo(() => (
    Gesture.Pan()
      .enabled(Boolean(onSwipeRight && swipeEnabled))
      // A vertical list gets the gesture as soon as vertical intent is clear.
      // Reply activates only after a deliberate, horizontally dominant drag.
      .activeOffsetX(REPLY_SWIPE_ACTIVATION_DISTANCE)
      .failOffsetY([-REPLY_SWIPE_VERTICAL_TOLERANCE, REPLY_SWIPE_VERTICAL_TOLERANCE])
      .onUpdate((event) => {
        const horizontalDistance = Math.max(0, event.translationX);
        replySwipeX.value = Math.min(horizontalDistance, REPLY_SWIPE_MAX_TRANSLATE);
      })
      .onEnd((event) => {
        const isDeliberateReplySwipe = (
          event.translationX >= REPLY_SWIPE_TRIGGER_DISTANCE &&
          event.translationX > Math.abs(event.translationY) * 1.5
        );
        if (isDeliberateReplySwipe) runOnJS(triggerSwipeReply)();
      })
      .onFinalize(() => {
        replySwipeX.value = withTiming(0, {
          duration: 150,
          easing: ReanimatedEasing.out(ReanimatedEasing.cubic)
        });
      })
  ), [onSwipeRight, replySwipeX, swipeEnabled, triggerSwipeReply]);

  const rowContent = mine ? (
    <>
      {children}
    </>
  ) : (
    <>
      <View style={styles.senderAvatarSlot}>
        {showSenderDetails ? <SenderAvatar accentColor={accentColor} name={senderName} /> : null}
      </View>
      {children}
    </>
  );
  const resolvedRowStyle = [
    styles.chatMessageRow,
    rowStyle,
    mine && styles.chatMessageRowMine,
    highlighted && styles.chatMessageRowReplyHighlight,
    selected && styles.chatMessageRowSelected,
    editing && styles.chatMessageRowEditing
  ];

  const rowElement = onLongPress || onPress ? (
    <Pressable
      accessibilityLabel={onPress ? `${selected ? "Deselect" : "Select"} chat item` : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={onPress ? { selected: Boolean(selected) } : undefined}
      delayLongPress={280}
      onLayout={onLayout}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={resolvedRowStyle}
    >
      {rowContent}
    </Pressable>
  ) : (
    <View onLayout={onLayout} style={resolvedRowStyle}>
      {rowContent}
    </View>
  );

  if (onSwipeRight) {
    return (
      <View style={styles.swipeReplyWrap}>
        <ReplySwipeAction progress={replySwipeProgress} />
        <GestureDetector gesture={replySwipeGesture} touchAction="pan-y">
          <Reanimated.View style={[styles.swipeReplyContent, replySwipeContentStyle]}>
            {rowElement}
          </Reanimated.View>
        </GestureDetector>
      </View>
    );
  }

  return rowElement;
}

function ReplySwipeAction({ progress }: { progress: SharedValue<number> }) {
  const actionStyle = useAnimatedStyle(() => ({
    opacity: Math.min(progress.value, 1),
    transform: [{ scale: Math.min(Math.max(progress.value, 0.86), 1) }]
  }));

  return (
    <Reanimated.View style={styles.swipeReplyAction}>
      <Reanimated.View style={[styles.swipeReplyIndicator, actionStyle]}>
        <Ionicons name="arrow-undo-outline" size={17} color={ROOM_COLORS.cool} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

function groupedBubbleCornerStyle(mine: boolean, groupPosition: MessageGroupPosition) {
  if (groupPosition === "middle" || groupPosition === "last") {
    return mine ? styles.messageBubbleGroupedMine : styles.messageBubbleGroupedOther;
  }
  return null;
}

function MessageBubbleFrame({
  children,
  style
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.messageBubbleFrame, style]}>
      {children}
    </View>
  );
}

function MessageMeta({
  overlay = false,
  textStyle,
  time
}: {
  overlay?: boolean;
  textStyle?: StyleProp<TextStyle>;
  time: string;
}) {
  return (
    <Text style={[styles.inlineTimestampText, overlay && styles.mediaTimestampText, textStyle]}>
      {time}
    </Text>
  );
}

function SmartMessageTextContent({
  linkStyle,
  text,
  textStyle
}: {
  linkStyle?: StyleProp<TextStyle>;
  text: string;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <>
      {parseSmartTextSegments(text).map((segment, index) => {
        if (segment.type === "text") {
          return (
            <Text key={`text-${index}`} style={textStyle}>
              {segment.text}
            </Text>
          );
        }
        return (
          <Text
            key={`${segment.url}-${index}`}
            onPress={() => openSmartLink(segment.url)}
            style={[textStyle, linkStyle]}
          >
            {segment.text}
          </Text>
        );
      })}
    </>
  );
}

function StreamingCursor() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { duration: 420, toValue: 0.18, useNativeDriver: true }),
        Animated.timing(opacity, { duration: 420, toValue: 1, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.Text style={[styles.streamingCursor, { opacity }]}>
      |
    </Animated.Text>
  );
}

function MessageBubbleMeta({
  mine,
  status,
  time
}: {
  mine: boolean;
  status?: MemoryMessage["deliveryStatus"];
  time: string;
}) {
  const queued = status === "waiting_for_connection";
  const pending = queued || status === "sending" || status === "pending" || status === "retrying";
  const sent = mine && !pending && status !== "failed" && status !== "failed_retryable" && status !== "failed_permanent";

  return (
    <View style={[styles.messageMetaRow, mine && styles.messageMetaRowMine]}>
      <Text style={[styles.messageMetaTime, mine ? styles.messageMetaTimeMine : styles.messageMetaTimeOther]}>
        {queued ? `Queued · ${time}` : time}
      </Text>
      {mine ? (
        <Ionicons
          name={pending ? "time-outline" : sent ? "checkmark-done" : "checkmark"}
          size={12}
          color={mine ? ROOM_COLORS.sentTimestamp : ROOM_COLORS.timestamp}
        />
      ) : null}
    </View>
  );
}

function ChatTypingIndicator({ label }: { label: string }) {
  return (
    <View style={styles.typingIndicatorRow}>
      <View style={styles.typingIndicatorBubble}>
        <View style={styles.typingDots}>
          {[0, 1, 2].map((dot) => (
            <View key={dot} style={styles.typingDot} />
          ))}
        </View>
        <Text style={styles.typingIndicatorText}>{label}</Text>
      </View>
    </View>
  );
}

function MessageReactionPills({
  currentUserId,
  mine,
  onToggleReaction,
  reactions
}: {
  currentUserId: string | number;
  mine: boolean;
  onToggleReaction: (emoji: string) => void;
  reactions: Record<string, Array<string | number>>;
}) {
  const entries = Object.entries(reactions).filter(([, users]) => users.length > 0);
  if (entries.length === 0) return null;

  return (
    <View style={[styles.reactionPillRow, mine && styles.reactionPillRowMine]}>
      {entries.map(([emoji, users]) => {
        const active = users.includes(currentUserId);
        return (
          <Pressable
            accessibilityLabel={`React ${emoji}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={emoji}
            onPress={() => onToggleReaction(emoji)}
            style={[styles.reactionPill, active && styles.reactionPillActive]}
          >
            <Text style={styles.reactionPillEmoji}>{emoji}</Text>
            <Text style={styles.reactionPillCount}>{users.length}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MessageReactionPicker({
  mine,
  onDismiss,
  onMore,
  onToggleReaction
}: {
  mine: boolean;
  onDismiss: () => void;
  onMore: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  return (
    <View style={[styles.reactionPicker, mine && styles.reactionPickerMine]}>
      {MEMORY_REACTION_EMOJIS.map((emoji) => (
        <Pressable
          accessibilityLabel={`React with ${emoji}`}
          accessibilityRole="button"
          key={emoji}
          onPress={() => onToggleReaction(emoji)}
          style={styles.reactionPickerButton}
        >
          <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel="More message actions"
        accessibilityRole="button"
        onPress={() => {
          onDismiss();
          onMore();
        }}
        style={styles.reactionPickerMore}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={ROOM_COLORS.onSurface} />
      </Pressable>
      <Pressable accessibilityLabel="Close reactions" hitSlop={8} onPress={onDismiss} style={styles.reactionPickerClose}>
        <Ionicons name="close" size={14} color={ROOM_COLORS.muted} />
      </Pressable>
    </View>
  );
}

function MessageDeliveryState({
  mine,
  onCancel,
  onRetry,
  status
}: {
  mine: boolean;
  onCancel: () => void;
  onRetry: () => void;
  status?: MemoryMessage["deliveryStatus"];
}) {
  if (!hasMemoryDeliveryStrip(status)) return null;
  const label = status === "failed" || status === "failed_retryable"
    ? "Not sent"
    : status === "failed_permanent"
      ? "Could not send"
    : status === "processing_failed"
      ? "Processing failed"
      : "Media was not accepted";
  const retryable = canRetryMemoryDelivery(status);

  return (
    <View style={[styles.failedMessageActions, mine && styles.failedMessageActionsMine]}>
      <Text style={styles.failedMessageText}>{label}</Text>
      {retryable ? (
        <Pressable accessibilityRole="button" hitSlop={6} onPress={onRetry} style={styles.failedMessageButton}>
          <Text style={styles.failedMessageButtonText}>Retry</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" hitSlop={6} onPress={onCancel} style={styles.failedMessageButton}>
        <Text style={styles.failedMessageButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function InlineTimestampText({
  fill = false,
  minWidth,
  nativeAvailableWidth,
  text,
  textStyle,
  time,
  timeStyle
}: {
  fill?: boolean;
  minWidth?: number;
  nativeAvailableWidth?: number;
  text: string;
  textStyle?: StyleProp<TextStyle>;
  time: string;
  timeStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View
      style={[
        styles.inlineTimestampWrap,
        fill && styles.inlineTimestampWrapFill,
        Platform.OS !== "web" && fill && nativeAvailableWidth && nativeAvailableWidth > 0
          ? { width: nativeAvailableWidth }
          : null,
        minWidth && minWidth > 0 ? { minWidth } : null
      ]}
    >
      <Text
        accessibilityLabel={text}
        style={[styles.inlineTimestampMessageText, textStyle]}
      >
        <SmartMessageTextContent
          linkStyle={styles.messageLinkText}
          text={text}
          textStyle={textStyle}
        />
        <View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.inlineTimestampReserve,
            {
              width: memoryChatTimestampReservationWidth(time, {
                fontScale: PixelRatio.getFontScale(),
                fontSize: CHAT_TIME_FONT_SIZE,
                gap: CHAT_TIME_GAP
              })
            }
          ]}
        />
      </Text>
      <View pointerEvents="none" style={styles.inlineTimestampPinnedMeta}>
        <MessageMeta
          textStyle={timeStyle}
          time={time}
        />
      </View>
    </View>
  );
}

function MediaSenderHeader({ name }: { name: string }) {
  return (
    <View style={styles.mediaSenderHeader}>
      <Text numberOfLines={1} style={[styles.senderName, styles.mediaSenderName, { color: senderAccent(name) }]}>
        {name}
      </Text>
    </View>
  );
}

function MessageBubble({
  currentUserId,
  editing,
  groupPosition,
  highlighted,
  message,
  mine,
  onBeginSelection,
  onCancelFailed,
  onCloseReactionPicker,
  onJumpToMessage,
  onOpenMedia,
  onOpenReactionPicker,
  onReply,
  onRetryFailed,
  onSelectionPressOut,
  onToggleReaction,
  rowStyle,
  onToggleSelection,
  reactionPickerOpen,
  reactions,
  selected,
  selectionMode,
  showSenderDetails
}: {
  currentUserId: string | number;
  editing: boolean;
  groupPosition: MessageGroupPosition;
  highlighted: boolean;
  message: MemoryMessage;
  mine: boolean;
  onBeginSelection: () => void;
  onCancelFailed: () => void;
  onCloseReactionPicker: () => void;
  onJumpToMessage: (messageId: string) => void;
  onOpenMedia: OpenMediaHandler;
  onOpenReactionPicker: () => void;
  onReply: () => void;
  onRetryFailed: () => void;
  onSelectionPressOut: () => void;
  onToggleReaction: (emoji: string) => void;
  rowStyle?: StyleProp<ViewStyle>;
  onToggleSelection: () => void;
  reactionPickerOpen: boolean;
  reactions: Record<string, Array<string | number>>;
  selected: boolean;
  selectionMode: boolean;
  showSenderDetails: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const body = message.body.trim();
  const mediaCount = message.attachments.length;
  const hasText = body.length > 0;
  const hasMedia = mediaCount > 0;
  const isTextOnly = hasText && !hasMedia;
  const isSingleMedia = mediaCount === 1;
  const isMultiMedia = mediaCount >= 2;
  const isMediaOnly = hasMedia && !hasText;
  const isMediaWithCaption = hasMedia && hasText;
  const timestampLabel = getMessageTimestampLabel(message);
  const {
    handleMediaLongPress,
    handleMediaPressIn,
    handleMediaPressOut,
    shouldIgnoreMediaOpen
  } = useMediaOpenGuard(onBeginSelection);
  const bubbleCornerStyle = groupedBubbleCornerStyle(mine, groupPosition);

  function renderReplyPreview() {
    return message.replyToMessage ? (
      <ReplyPreviewBlock
        author={message.replyToMessage.authorDisplayName}
        body={message.replyToMessage.body || "Message"}
        mine={mine}
        onPress={!selectionMode ? () => onJumpToMessage(message.replyToMessage!.id) : undefined}
      />
    ) : null;
  }

  function renderDeliveryState() {
    return (
      <MessageDeliveryState
        mine={mine}
        onCancel={onCancelFailed}
        onRetry={onRetryFailed}
        status={message.deliveryStatus}
      />
    );
  }

  function renderBubbleWithDeliveryState(bubble: ReactNode) {
    const bubbleWithStatus = !hasMemoryDeliveryStrip(message.deliveryStatus)
      ? bubble
      : (
        <View style={[styles.messageStatusStack, mine && styles.messageStatusStackMine]}>
          {bubble}
          {renderDeliveryState()}
        </View>
      );

    return (
      <View style={[styles.messageBubbleStack, mine && styles.messageBubbleStackMine]}>
        {bubbleWithStatus}
        <MessageReactionPills
          currentUserId={currentUserId}
          mine={mine}
          onToggleReaction={onToggleReaction}
          reactions={reactions}
        />
        {reactionPickerOpen ? (
          <MessageReactionPicker
            mine={mine}
            onDismiss={onCloseReactionPicker}
            onMore={onBeginSelection}
            onToggleReaction={onToggleReaction}
          />
        ) : null}
      </View>
    );
  }

  function renderTextMessage() {
    const bubble = (
      <MessageBubbleFrame
        style={styles.textMessageFrame}
      >
        <View
          style={[
            styles.textMessageBubble,
            mine ? styles.textMessageBubbleMine : styles.textMessageBubbleOther,
            bubbleCornerStyle
          ]}
        >
          {!mine && showSenderDetails ? (
            <Text numberOfLines={1} style={[styles.senderName, { color: senderAccent(message.authorDisplayName) }]}>
              {message.authorDisplayName}
            </Text>
          ) : null}
          {renderReplyPreview()}
          <Text style={[styles.textOnlyBubbleText, mine ? styles.messageTextMine : styles.messageTextOther]}>
            <SmartMessageTextContent
              linkStyle={mine ? styles.messageLinkTextMine : styles.messageLinkText}
              text={body}
              textStyle={[styles.textOnlyBubbleText, mine ? styles.messageTextMine : styles.messageTextOther]}
            />
            {(
              message.deliveryStatus === "pending" ||
              message.deliveryStatus === "waiting_for_connection" ||
              message.deliveryStatus === "sending" ||
              message.deliveryStatus === "retrying" ||
              message.deliveryStatus === "uploading" ||
              message.deliveryStatus === "processing" ||
              message.deliveryStatus === "processing_delayed"
            ) ? <StreamingCursor /> : null}
          </Text>
          <MessageBubbleMeta mine={mine} status={message.deliveryStatus} time={timestampLabel} />
        </View>
      </MessageBubbleFrame>
    );
    return (
      <MessageRow
        editing={editing}
        highlighted={highlighted}
        mine={mine}
        onLongPress={!selectionMode ? onOpenReactionPicker : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onPressOut={onSelectionPressOut}
        onSwipeRight={onReply}
        rowStyle={rowStyle}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
        swipeEnabled={!selectionMode}
      >
        {renderBubbleWithDeliveryState(bubble)}
      </MessageRow>
    );
  }

  function renderSingleMediaMessage() {
    const media = message.attachments[0];
    const previewSize = getSingleMediaPreviewSize({
      imageHeight: media.imageHeight,
      imageWidth: media.imageWidth,
      screenWidth
    });

    function handleOpenMedia() {
      if (shouldIgnoreMediaOpen() || !memoryMediaHasVisual(media)) return;
      onOpenMedia(media, message.attachments);
    }

    const bubble = (
      <MessageBubbleFrame
        style={{ width: previewSize.width }}
      >
        <View
          style={[
            styles.singleMediaMessageCard,
            mine ? styles.mediaMessageCardMine : styles.mediaMessageCardOther,
            styles.messageMediaCardFill,
            bubbleCornerStyle
          ]}
        >
          {!mine && showSenderDetails ? <MediaSenderHeader name={message.authorDisplayName} /> : null}
          {isMediaOnly && message.replyToMessage ? (
            <View style={styles.mediaReplyHeader}>
              {renderReplyPreview()}
            </View>
          ) : null}
          <Pressable
            delayLongPress={280}
            disabled={selectionMode}
            onLongPress={!selectionMode ? handleMediaLongPress : undefined}
            onPress={handleOpenMedia}
            onPressIn={!selectionMode ? handleMediaPressIn : undefined}
            onPressOut={() => {
              handleMediaPressOut();
              onSelectionPressOut();
            }}
            style={styles.mediaMessageContent}
          >
            <SingleMediaPreview
              media={media}
              sizeOverride={previewSize}
              timestamp={isMediaOnly ? timestampLabel : undefined}
              timestampPlacement="bottom-right"
              viewKey={memoryMediaSlotViewKey(memoryChatRowKey(message), media, 0)}
            />
          </Pressable>
          {isMediaWithCaption ? (
            <View style={styles.mediaCaptionContainer}>
              {message.replyToMessage ? renderReplyPreview() : null}
              <InlineTimestampText
                fill
                nativeAvailableWidth={Math.max(0, previewSize.width - 24)}
                text={body}
                textStyle={[styles.mediaCaptionText, mine ? styles.messageTextMine : styles.messageTextOther]}
                time={timestampLabel}
                timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
              />
            </View>
          ) : null}
        </View>
      </MessageBubbleFrame>
    );

    return (
      <MessageRow
        editing={editing}
        highlighted={highlighted}
        mine={mine}
        onLongPress={!selectionMode ? handleMediaLongPress : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onPressIn={!selectionMode ? handleMediaPressIn : undefined}
        onPressOut={() => {
          handleMediaPressOut();
          onSelectionPressOut();
        }}
        onSwipeRight={onReply}
        rowStyle={[rowStyle, styles.chatMessageRowMedia]}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
        swipeEnabled={!selectionMode}
      >
        {renderBubbleWithDeliveryState(bubble)}
      </MessageRow>
    );
  }

  function renderMultiMediaMessage() {
    const multiMediaCardWidth = getMultiMediaGridWidth(screenWidth);

    const bubble = (
      <MessageBubbleFrame
        style={{ width: multiMediaCardWidth }}
      >
        <View
          style={[
            styles.multiMediaMessageCard,
            mine ? styles.mediaMessageCardMine : styles.mediaMessageCardOther,
            styles.messageMediaCardFill,
            bubbleCornerStyle
          ]}
        >
          {!mine && showSenderDetails ? <MediaSenderHeader name={message.authorDisplayName} /> : null}
          {isMediaOnly && message.replyToMessage ? (
            <View style={styles.mediaReplyHeader}>
              {renderReplyPreview()}
            </View>
          ) : null}
          <MediaAttachmentGrid
            gridWidth={multiMediaCardWidth}
            onMediaLongPress={handleMediaLongPress}
            onMediaPressIn={handleMediaPressIn}
            onMediaPressOut={() => {
              handleMediaPressOut();
              onSelectionPressOut();
            }}
            media={message.attachments}
            onOpenMedia={onOpenMedia}
            rowKey={memoryChatRowKey(message)}
            selectionMode={selectionMode}
            shouldIgnoreMediaOpen={shouldIgnoreMediaOpen}
            timestamp={isMediaOnly ? timestampLabel : undefined}
          />
          {isMediaWithCaption ? (
            <View style={styles.mediaCaptionContainer}>
              {message.replyToMessage ? renderReplyPreview() : null}
              <InlineTimestampText
                fill
                nativeAvailableWidth={Math.max(0, multiMediaCardWidth - 24)}
                text={body}
                textStyle={[styles.mediaCaptionText, mine ? styles.messageTextMine : styles.messageTextOther]}
                time={timestampLabel}
                timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
              />
            </View>
          ) : null}
        </View>
      </MessageBubbleFrame>
    );

    return (
      <MessageRow
        editing={editing}
        highlighted={highlighted}
        mine={mine}
        onLongPress={!selectionMode ? handleMediaLongPress : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onPressIn={!selectionMode ? handleMediaPressIn : undefined}
        onPressOut={() => {
          handleMediaPressOut();
          onSelectionPressOut();
        }}
        onSwipeRight={onReply}
        rowStyle={[rowStyle, styles.chatMessageRowMedia]}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
        swipeEnabled={!selectionMode}
      >
        {renderBubbleWithDeliveryState(bubble)}
      </MessageRow>
    );
  }

  if (isTextOnly) return renderTextMessage();
  if (isSingleMedia) return renderSingleMediaMessage();
  if (isMultiMedia) return renderMultiMediaMessage();

  return null;
}

// Dishes read as a WhatsApp-style inline poll: a question (the dish), a row of
// taps that cast/replace your single vote (your star rating) or leave it, an
// average summary, and a "who rated" link. The timestamp sits bottom-right like
// every other chat bubble. There is no per-rater note — voting is pure stars;
// `dish.note` is the adder's optional one-line description shown under the name.
function DishTimelineCard({
  dish,
  groupPosition,
  mine,
  onLongPress,
  onOpenDish,
  onPress,
  onRateDish,
  rowStyle,
  selected,
  selectionGestureOwnedByParent = false,
  selectionMode,
  showSenderDetails
}: {
  dish: MemoryDish;
  groupPosition: MessageGroupPosition;
  mine: boolean;
  onLongPress: () => void;
  onOpenDish: () => void;
  onPress?: () => void;
  onRateDish: (rating: number | null) => void;
  rowStyle?: StyleProp<ViewStyle>;
  selected: boolean;
  selectionGestureOwnedByParent?: boolean;
  selectionMode: boolean;
  showSenderDetails: boolean;
}) {
  const bubbleCornerStyle = groupedBubbleCornerStyle(mine, groupPosition);
  const { selectRating, visualRating } = useImmediateDishRating(dish.id, dish.myRating, onRateDish);
  const myRating = visualRating ?? 0;

  return (
    <MessageRow
      mine={mine}
      onLongPress={!selectionGestureOwnedByParent && !selectionMode ? onLongPress : undefined}
      onPress={!selectionGestureOwnedByParent && selectionMode ? onPress : undefined}
      rowStyle={rowStyle}
      selected={selected}
      senderName={dish.addedByDisplayName}
      showSenderDetails={showSenderDetails}
      swipeEnabled={false}
    >
      <MessageBubbleFrame style={styles.dishTimelineFrame}>
        <View
          style={[
            styles.dishTimelineBubble,
            mine ? styles.dishTimelineBubbleMine : styles.dishTimelineBubbleOther,
            bubbleCornerStyle
          ]}
        >
          {!mine && showSenderDetails ? (
            <Text numberOfLines={1} style={[styles.senderName, { color: senderAccent(dish.addedByDisplayName) }]}>
              {dish.addedByDisplayName}
            </Text>
          ) : null}

          <Text numberOfLines={2} style={[styles.dishTimelineName, mine && styles.messageTextMine]}>
            {dish.dishName}
          </Text>
          {dish.note ? (
            <Text numberOfLines={2} style={[styles.dishTimelineNote, mine && styles.dishTimelineNoteMine]}>
              {dish.note}
            </Text>
          ) : null}

          <View style={styles.dishTimelineStarsRow}>
            <View style={styles.dishTimelineStars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  accessibilityLabel={visualRating === star
                    ? `Remove your rating from ${dish.dishName}`
                    : `Rate ${dish.dishName} ${star} out of 5`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: selectionMode, selected: star <= myRating }}
                  delayLongPress={320}
                  disabled={selectionMode}
                  hitSlop={6}
                  key={star}
                  onLongPress={onLongPress}
                  onPress={() => selectRating(star)}
                  style={styles.dishTimelineStarButton}
                >
                  <Star
                    size={24}
                    color={ROOM_COLORS.gold}
                    fill={star <= myRating ? ROOM_COLORS.gold : "transparent"}
                    strokeWidth={1.7}
                  />
                </Pressable>
              ))}
            </View>
            {myRating ? null : (
              <Text numberOfLines={1} style={[styles.dishTimelineVoteHint, mine && styles.dishTimelineNoteMine]}>
                Tap to rate
              </Text>
            )}
          </View>

          <Pressable
            accessibilityHint="Opens dish details to see who rated"
            accessibilityLabel={`${dish.dishName}, ${dish.ratingCount === 0 ? "no ratings yet" : `rated ${formatMemoryDishRating(dish.averageRating)} by ${dish.ratingCount}`}`}
            accessibilityRole="button"
            delayLongPress={320}
            disabled={selectionMode}
            hitSlop={6}
            onLongPress={onLongPress}
            onPress={onOpenDish}
            style={styles.dishTimelineFooter}
          >
            <InlineTimestampText
              fill
              text="View table ratings ›"
              textStyle={[styles.dishTimelineRatersText, mine && styles.dishTimelineRatersTextMine]}
              time={formatDisplayTime(dish.createdAt)}
              timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
            />
          </Pressable>
        </View>
      </MessageBubbleFrame>
    </MessageRow>
  );
}

function MediaBubble({
  groupPosition,
  mine,
  onBeginSelection,
  onOpenMedia,
  onSelectionPressOut,
  rowStyle,
  onToggleSelection,
  photo,
  selected,
  selectionMode,
  showSenderDetails,
  uploaderDisplayName
}: {
  groupPosition: MessageGroupPosition;
  mine: boolean;
  onBeginSelection: () => void;
  onOpenMedia: OpenMediaHandler;
  onSelectionPressOut: () => void;
  rowStyle?: StyleProp<ViewStyle>;
  onToggleSelection: () => void;
  photo: MemoryPhoto;
  selected: boolean;
  selectionMode: boolean;
  showSenderDetails: boolean;
  uploaderDisplayName: string;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const singleMediaPreviewSize = getSingleMediaPreviewSize({
    imageHeight: photo.imageHeight,
    imageWidth: photo.imageWidth,
    screenWidth
  });
  const {
    handleMediaLongPress,
    handleMediaPressIn,
    handleMediaPressOut,
    shouldIgnoreMediaOpen
  } = useMediaOpenGuard(onBeginSelection);
  const bubbleCornerStyle = groupedBubbleCornerStyle(mine, groupPosition);

  function handleOpenMedia() {
    if (shouldIgnoreMediaOpen() || !memoryMediaHasVisual(photo)) return;
    onOpenMedia(photo, [photo]);
  }

  return (
    <MessageRow
      mine={mine}
      onLongPress={!selectionMode ? handleMediaLongPress : undefined}
      onPress={selectionMode ? onToggleSelection : undefined}
      onPressIn={!selectionMode ? handleMediaPressIn : undefined}
      onPressOut={() => {
        handleMediaPressOut();
        onSelectionPressOut();
      }}
      rowStyle={[rowStyle, styles.chatMessageRowMedia]}
      selected={selected}
      senderName={uploaderDisplayName}
      showSenderDetails={showSenderDetails}
    >
      <MessageBubbleFrame
        style={{ width: singleMediaPreviewSize.width }}
      >
        <View
          style={[
            styles.singleMediaMessageCard,
            mine ? styles.mediaMessageCardMine : styles.mediaMessageCardOther,
            styles.messageMediaCardFill,
            bubbleCornerStyle
          ]}
        >
          {!mine && showSenderDetails ? <MediaSenderHeader name={uploaderDisplayName} /> : null}
          <Pressable
            disabled={selectionMode}
            delayLongPress={280}
            onLongPress={!selectionMode ? handleMediaLongPress : undefined}
            onPress={handleOpenMedia}
            onPressIn={!selectionMode ? handleMediaPressIn : undefined}
            onPressOut={() => {
              handleMediaPressOut();
              onSelectionPressOut();
            }}
            style={styles.mediaMessageContent}
          >
            <SingleMediaPreview
              media={photo}
              sizeOverride={singleMediaPreviewSize}
              timestamp={formatDisplayTime(photo.createdAt)}
              timestampPlacement="bottom-right"
            />
          </Pressable>
        </View>
      </MessageBubbleFrame>
    </MessageRow>
  );
}

function MediaAttachmentGrid({
  gridWidth,
  media,
  onMediaLongPress,
  onMediaPressIn,
  onMediaPressOut,
  onOpenMedia,
  rowKey,
  selectionMode,
  shouldIgnoreMediaOpen,
  timestamp
}: {
  gridWidth: number;
  media: MemoryPhoto[];
  onMediaLongPress: () => void;
  onMediaPressIn?: () => void;
  onMediaPressOut?: () => void;
  onOpenMedia: OpenMediaHandler;
  rowKey?: string;
  selectionMode?: boolean;
  shouldIgnoreMediaOpen: () => boolean;
  timestamp?: string;
}) {
  const visible = media.slice(0, 4);
  const hiddenCount = Math.max(0, media.length - visible.length);
  // The photo id moves when the send confirms, so keying the tiles on it tears
  // them down and rebuilds them at exactly the moment the picture is swapped.
  // The slot the photo occupies does not move.
  const tileKey = (item: MemoryPhoto, index: number) => (
    rowKey ? memoryMediaSlotViewKey(rowKey, item, index) : item.id
  );

  function handleOpenMedia(item: MemoryPhoto) {
    if (shouldIgnoreMediaOpen() || !memoryMediaHasVisual(item)) return;
    onOpenMedia(item, media);
  }

  if (media.length === 2) {
    const tileWidth = Math.floor((gridWidth - MEDIA_GRID_GAP) / 2);
    const tileSize = { height: Platform.OS === "web" ? 140 : 168, width: tileWidth };

    return (
      <View style={[styles.attachmentGridFrame, { width: gridWidth }]}>
        <View style={[styles.multiMediaGrid, { width: gridWidth }]}>
          {visible.slice(0, 2).map((item, index) => (
            <MediaGridTile
              hiddenCount={0}
              key={tileKey(item, index)}
              media={item}
              viewKey={tileKey(item, index)}
              onLongPress={onMediaLongPress}
              onPress={() => handleOpenMedia(item)}
              onPressIn={onMediaPressIn}
              onPressOut={onMediaPressOut}
              selectionMode={selectionMode}
              style={tileSize}
            />
          ))}
        </View>
        {timestamp ? (
          <MediaTimestampOverlay
            placement={getMediaGridTimestampPlacement(media)}
            timestamp={timestamp}
          />
        ) : null}
      </View>
    );
  }

  if (media.length === 3) {
    const gridHeight = Platform.OS === "web" ? 190 : 220;
    const leftWidth = Math.round(gridWidth * 0.62);
    const rightWidth = gridWidth - leftWidth - MEDIA_GRID_GAP;
    const rightTileHeight = (gridHeight - MEDIA_GRID_GAP) / 2;

    return (
      <View style={[styles.attachmentGridFrame, { width: gridWidth }]}>
        <View style={[styles.multiMediaGrid, { height: gridHeight, width: gridWidth }]}>
          <MediaGridTile
            hiddenCount={0}
            key={tileKey(visible[0], 0)}
            media={visible[0]}
            viewKey={tileKey(visible[0], 0)}
            onLongPress={onMediaLongPress}
            onPress={() => handleOpenMedia(visible[0])}
            onPressIn={onMediaPressIn}
            onPressOut={onMediaPressOut}
            selectionMode={selectionMode}
            style={{ height: gridHeight, width: leftWidth }}
          />
          <View style={styles.mediaGridStack}>
            {visible.slice(1, 3).map((item, index) => (
              <MediaGridTile
                hiddenCount={0}
                key={tileKey(item, index + 1)}
                media={item}
                viewKey={tileKey(item, index + 1)}
                onLongPress={onMediaLongPress}
                onPress={() => handleOpenMedia(item)}
                onPressIn={onMediaPressIn}
                onPressOut={onMediaPressOut}
                selectionMode={selectionMode}
                style={{ height: rightTileHeight, width: rightWidth }}
              />
            ))}
          </View>
        </View>
        {timestamp ? (
          <MediaTimestampOverlay
            placement={getMediaGridTimestampPlacement(media)}
            timestamp={timestamp}
          />
        ) : null}
      </View>
    );
  }

  const tileWidth = Math.floor((gridWidth - MEDIA_GRID_GAP) / 2);
  const tileHeight = Platform.OS === "web" ? 130 : 150;

  return (
    <View style={[styles.attachmentGridFrame, { width: gridWidth }]}>
      <View style={[styles.multiMediaGrid, styles.multiMediaGridWrap, { width: gridWidth }]}>
        {visible.map((item, index) => {
          const showHiddenCount = index === visible.length - 1 && hiddenCount > 0;

          return (
            <MediaGridTile
              hiddenCount={showHiddenCount ? hiddenCount : 0}
              key={tileKey(item, index)}
              media={item}
              viewKey={tileKey(item, index)}
              onLongPress={onMediaLongPress}
              onPress={() => handleOpenMedia(item)}
              onPressIn={onMediaPressIn}
              onPressOut={onMediaPressOut}
              selectionMode={selectionMode}
              style={{ height: tileHeight, width: tileWidth }}
            />
          );
        })}
      </View>
      {timestamp ? (
        <MediaTimestampOverlay
          placement={getMediaGridTimestampPlacement(media)}
          timestamp={timestamp}
        />
      ) : null}
    </View>
  );
}

function getMediaGridTimestampPlacement(media: MemoryPhoto[]): MediaTimestampPlacement {
  const hasMoreOverlay = media.length > 4;
  if (hasMoreOverlay) return "bottom-left";
  return "bottom-right";
}

function MediaGridTile({
  hiddenCount,
  media,
  onLongPress,
  onPress,
  onPressIn,
  onPressOut,
  selectionMode,
  style,
  viewKey
}: {
  hiddenCount: number;
  media: MemoryPhoto;
  onLongPress: () => void;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  selectionMode?: boolean;
  style: MediaPreviewSize;
  viewKey?: string;
}) {
  const mediaLabel = memoryMediaOpenLabel(media);
  const accessibilityLabel = hiddenCount > 0 ? `${mediaLabel}, plus ${hiddenCount} more` : mediaLabel;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="imagebutton"
      delayLongPress={280}
      disabled={selectionMode}
      onLongPress={!selectionMode ? onLongPress : undefined}
      onPress={onPress}
      onPressIn={!selectionMode ? onPressIn : undefined}
      onPressOut={!selectionMode ? onPressOut : undefined}
      style={[styles.mediaGridTile, style]}
    >
      <GridMediaPreview media={media} viewKey={viewKey} />
      {hiddenCount > 0 ? (
        <View style={styles.attachmentMoreOverlay}>
          <Text style={styles.attachmentMoreText}>+{hiddenCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function GridMediaPreview({ media, viewKey }: { media: MemoryPhoto; viewKey?: string }) {
  useMemoryMediaRenderTelemetry(media, "chat");
  const uploading = memoryMediaNeedsStatusOverlay(media);
  const hasVisual = memoryMediaHasVisual(media);

  if (memoryMediaKind(media) === "audio") {
    return <AudioMediaPreview compact media={media} style={styles.gridMediaFill} />;
  }

  if (memoryMediaKind(media) === "video") {
    return (
      <View style={styles.gridVideoPreview}>
        {hasVisual ? (
          <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} contentFit="contain" posterUri={media.posterUrl} uri={media.publicUrl} viewKey={viewKey} />
        ) : null}
        <View pointerEvents="none" style={styles.videoThumbnailScrim} />
        <View style={styles.gridVideoOverlay}>
          {!uploading ? (
            <View style={styles.gridPlayBadge}>
              <Ionicons name="play" size={18} color={ROOM_COLORS.white} />
            </View>
          ) : null}
          <View style={styles.gridMediaTypeBadge}>
            <Ionicons name="videocam" size={11} color={ROOM_COLORS.white} />
            <Text style={styles.mediaTypeBadgeText}>Video</Text>
          </View>
          {uploading ? <UploadProgressOverlay progress={resolveMemoryUploadProgress(media)} status={media.processingStatus} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.gridMediaFill}>
      {hasVisual ? (
        <Image
          cachePolicy="memory-disk"
          contentFit="contain"
          recyclingKey={viewKey ?? memoryMediaCacheKey(media)}
          source={media.thumbnailUrl || media.publicUrl}
          style={styles.gridMediaFill}
        />
      ) : null}
      {uploading ? <UploadProgressOverlay progress={resolveMemoryUploadProgress(media)} status={media.processingStatus} /> : null}
    </View>
  );
}

function MediaGallery({
  error,
  hasMore,
  initialScrollOffset,
  journeySession,
  loading,
  loadingMore,
  onLoadMore,
  onOpenMedia,
  onScrollOffsetChange,
  photos,
  themeCopy
}: {
  error?: string;
  hasMore: boolean;
  initialScrollOffset: number;
  journeySession: MemoryRoomJourneySession;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenMedia: OpenMediaHandler;
  onScrollOffsetChange: (offset: number) => void;
  photos: MemoryPhoto[];
  themeCopy: OccasionTheme["copy"];
}) {
  useMemoryJourneySurfaceDiagnostics(journeySession, "media", "media");
  const scrollDiagnostics = useMemoryJourneyScrollDiagnostics(
    journeySession,
    "media",
    onScrollOffsetChange
  );
  const hasMedia = photos.length > 0;

  return (
    <FlatList
      columnWrapperStyle={styles.galleryRow}
      contentContainerStyle={[
        styles.galleryContent,
        hasMedia ? styles.galleryContentFilled : styles.galleryContentEmpty
      ]}
      data={photos}
      contentOffset={{ x: 0, y: initialScrollOffset }}
      initialNumToRender={MEDIA_GALLERY_INITIAL_RENDER_COUNT}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={loading ? (
        <RoomTabLoadingSkeleton mode="media" />
      ) : (
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="images-outline" size={26} color={ROOM_COLORS.cool} />
          </View>
          <Text style={styles.emptyTitle}>{themeCopy.emptyTitle}</Text>
          <Text style={styles.emptyText}>{themeCopy.emptyDescription}</Text>
        </View>
      )}
      ListFooterComponent={loadingMore ? (
        <View style={styles.galleryFooterStatus}>
          <Text style={styles.timelineHistoryText}>Loading more media...</Text>
        </View>
      ) : null}
      ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      numColumns={2}
      onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.6}
      onMomentumScrollBegin={scrollDiagnostics.begin}
      onMomentumScrollEnd={scrollDiagnostics.settle}
      onScroll={scrollDiagnostics.capture}
      onScrollBeginDrag={scrollDiagnostics.begin}
      onScrollEndDrag={scrollDiagnostics.settle}
      scrollEventThrottle={32}
      maxToRenderPerBatch={MEDIA_GALLERY_MAX_RENDER_BATCH}
      removeClippedSubviews={false}
      renderItem={({ index, item: photo }) => (
        <View
          style={[
            styles.galleryItem,
            index % 2 === 0 ? styles.galleryItemLeft : styles.galleryItemRight
          ]}
        >
          <MemoryJourneyRenderProbe
            journeySession={journeySession}
            surface="media_tile"
            tab="media"
          />
          <Pressable
            accessibilityLabel={memoryMediaOpenLabel(photo)}
            accessibilityRole="imagebutton"
            onPress={() => onOpenMedia(photo, photos)}
            style={styles.galleryMediaButton}
          >
            <MediaPreview contentFit="cover" media={photo} style={styles.galleryMediaPreview} telemetrySurface="media" />
          </Pressable>
        </View>
      )}
      showsVerticalScrollIndicator={false}
      style={styles.galleryList}
      updateCellsBatchingPeriod={50}
      windowSize={MEDIA_GALLERY_WINDOW_SIZE}
    />
  );
}

function formatMemoryDishRating(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(1).replace(/\.0$/, "");
}

function memoryDishRaterSummary(dish: MemoryDish) {
  const names = dish.ratings.map((rating) => rating.ratedByDisplayName);
  if (names.length === 0) return "No ratings yet";
  if (names.length === 1) return `Rated by ${names[0]}`;
  if (names.length === 2) return `Rated by ${names[0]} and ${names[1]}`;
  return `Rated by ${names[0]}, ${names[1]} +${names.length - 2}`;
}

function ItineraryPanel({
  activeStopActionId,
  initialScrollOffset,
  journeySession,
  onActivateStopActions,
  onDeleteStop,
  onDismissStopActions,
  onEditStop,
  onScrollOffsetChange,
  stops,
  topInset
}: {
  activeStopActionId: string | null;
  initialScrollOffset: number;
  journeySession: MemoryRoomJourneySession;
  onActivateStopActions: (stopId: string) => void;
  onDeleteStop: (stop: MemoryStop) => void;
  onDismissStopActions: () => void;
  onEditStop: (stop: MemoryStop) => void;
  onScrollOffsetChange: (offset: number) => void;
  stops: MemoryStop[];
  themeCopy: OccasionTheme["copy"];
  topInset?: number;
}) {
  useMemoryJourneySurfaceDiagnostics(journeySession, "overview", "table");
  const scrollDiagnostics = useMemoryJourneyScrollDiagnostics(
    journeySession,
    "overview",
    onScrollOffsetChange
  );
  const preserveActionsThroughTouchEndRef = useRef(false);
  const topPadding = topInset != null ? topInset + 10 : TABLE_HEADER_CLEARANCE;
  const bottomPadding = spacing.xl + 92;
  const isEmpty = stops.length === 0;
  // Newest place on top. The server hands these back by ascending `position`
  // (addMemoryStop assigns last + 1), which put a just-added place at the
  // bottom, out of sight. Display-only: the stored order is untouched, and the
  // rail's first/last connectors key off the RENDERED index, so they still
  // start and stop at the end markers.
  const orderedStops = useMemo(() => (
    [...stops].sort((first, second) => (
      second.position - first.position ||
      timeValue(second.createdAt) - timeValue(first.createdAt)
    ))
  ), [stops]);

  if (isEmpty) {
    return (
      <View
        style={[
          styles.itineraryEmptyContent,
          { paddingBottom: bottomPadding, paddingTop: topPadding }
        ]}
      >
        <View style={styles.itineraryEmptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="map-outline" size={26} color={ROOM_COLORS.cool} />
          </View>
          <Text style={styles.emptyTitle}>Plan your stops</Text>
          <Text style={styles.emptyText}>
            Tap + and choose Place to add each location from this occasion, in the order you visited.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={[styles.itineraryContent, { paddingBottom: bottomPadding, paddingTop: topPadding }]}
      contentOffset={{ x: 0, y: initialScrollOffset }}
      data={orderedStops}
      initialNumToRender={ITINERARY_INITIAL_RENDER_COUNT}
      keyExtractor={(stop) => stop.id}
      ListFooterComponent={activeStopActionId ? (
        <Pressable
          accessibilityLabel="Close place actions"
          onPress={onDismissStopActions}
          style={styles.stopActionsDismissArea}
        />
      ) : null}
      ListHeaderComponent={(
        <>
          <View style={styles.tablePostActionRow}>
            <Pressable
              accessibilityLabel="Post this table memory"
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              disabled
              style={styles.tablePostButton}
            >
              <Ionicons name="create-outline" size={16} color={ROOM_COLORS.onCool} />
              <Text style={styles.tablePostButtonText}>Post</Text>
            </Pressable>
          </View>
          <Text style={styles.itineraryHeading}>Places Visited</Text>
        </>
      )}
      maxToRenderPerBatch={ITINERARY_MAX_RENDER_BATCH}
      onMomentumScrollBegin={scrollDiagnostics.begin}
      onMomentumScrollEnd={scrollDiagnostics.settle}
      onScroll={scrollDiagnostics.capture}
      onScrollBeginDrag={() => {
        onDismissStopActions();
        scrollDiagnostics.begin();
      }}
      onScrollEndDrag={scrollDiagnostics.settle}
      onTouchEnd={() => {
        if (preserveActionsThroughTouchEndRef.current) {
          preserveActionsThroughTouchEndRef.current = false;
          return;
        }
        if (activeStopActionId) onDismissStopActions();
      }}
      removeClippedSubviews={Platform.OS === "android"}
      renderItem={({ index, item }) => (
        <ItineraryStopRow
          actionsVisible={activeStopActionId === item.id}
          isFirstStop={index === 0}
          isLastStop={index === orderedStops.length - 1}
          menuOpen={Boolean(activeStopActionId)}
          onActivateActions={() => {
            preserveActionsThroughTouchEndRef.current = true;
            onActivateStopActions(item.id);
          }}
          onDelete={() => onDeleteStop(item)}
          onDismissActions={onDismissStopActions}
          onEdit={() => onEditStop(item)}
          stop={item}
        />
      )}
      scrollEventThrottle={32}
      showsVerticalScrollIndicator={false}
      updateCellsBatchingPeriod={50}
      windowSize={ITINERARY_WINDOW_SIZE}
    />
  );
}

// The rail draws the timeline, so a row needs to know where it sits in the
// list: the top connector is omitted on the first stop and the bottom one on
// the last, which is what makes the line start and stop at the markers rather
// than running off both ends.
// The universal maps URL is used rather than a `geo:` intent because it hands
// off to the Google Maps app when it is installed and degrades to the browser
// when it is not, on both platforms.
//
// `query_place_id` pins the exact venue, but the API still requires `query` —
// it is the human-readable fallback and the text shown while the place
// resolves. Stops created before the place_id migration, and any stop named
// without picking a suggestion, have no id and stay a plain text search over
// the two display lines.
function openMemoryStopInMaps(stop: MemoryStop) {
  const query = [stop.name, stop.note].map((part) => part?.trim()).filter(Boolean).join(", ");
  if (!query) return;
  const params = new URLSearchParams({ api: "1", query });
  if (stop.placeId) params.set("query_place_id", stop.placeId);
  Linking.openURL(`https://www.google.com/maps/search/?${params.toString()}`).catch(() => {
    Alert.alert("Could not open Maps", "No app on this device can open map links.");
  });
}

const ItineraryStopRow = memo(function ItineraryStopRow({
  actionsVisible,
  isFirstStop,
  isLastStop,
  menuOpen,
  onActivateActions,
  onDelete,
  onDismissActions,
  onEdit,
  stop
}: {
  actionsVisible: boolean;
  isFirstStop: boolean;
  isLastStop: boolean;
  menuOpen: boolean;
  onActivateActions: () => void;
  onDelete: () => void;
  onDismissActions: () => void;
  onEdit: () => void;
  stop: MemoryStop;
}) {
  return (
    <View style={styles.stopTimelineRow}>
      <View pointerEvents="none" style={styles.stopTimelineRail}>
        {!isFirstStop ? <View style={styles.stopTimelineConnectorTop} /> : null}
        {!isLastStop ? <View style={styles.stopTimelineConnectorBottom} /> : null}
        <View style={styles.stopTimelineMarker}>
          <Ionicons name="location" size={16} color={ROOM_COLORS.onCool} />
        </View>
      </View>

      <Pressable
        accessibilityHint="Opens this place in Maps"
        accessibilityLabel={stop.note ? `${stop.name}, ${stop.note}` : stop.name}
        accessibilityRole="button"
        delayLongPress={320}
        onLongPress={onActivateActions}
        onPress={() => {
          if (menuOpen) {
            onDismissActions();
            return;
          }
          openMemoryStopInMaps(stop);
        }}
        style={({ pressed }) => [
          styles.stopCard,
          styles.stopTimelineCard,
          pressed && styles.stopCardPressed
        ]}
      >
        <View style={styles.stopHeaderRow}>
          <View style={styles.stopHeaderText}>
            <Text numberOfLines={1} style={styles.stopName}>{stop.name}</Text>
            {stop.note ? (
              <Text ellipsizeMode="tail" numberOfLines={1} style={styles.stopLocation}>
                {stop.note}
              </Text>
            ) : null}
          </View>
          {actionsVisible ? (
            <View accessibilityLabel="Place actions" style={styles.stopActions}>
              <Pressable
                accessibilityLabel={`Edit ${stop.name}`}
                accessibilityRole="button"
                hitSlop={5}
                onPress={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
                onTouchEnd={(event) => event.stopPropagation()}
                style={({ pressed }) => [styles.stopActionButton, pressed && styles.stopActionButtonPressed]}
              >
                <Ionicons color={ROOM_COLORS.cool} name="create-outline" size={16} />
                <Text style={styles.stopActionText}>Edit</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Delete ${stop.name}`}
                accessibilityRole="button"
                hitSlop={5}
                onPress={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                onTouchEnd={(event) => event.stopPropagation()}
                style={({ pressed }) => [styles.stopActionButton, pressed && styles.stopActionButtonPressed]}
              >
                <Ionicons color={ROOM_COLORS.danger} name="trash-outline" size={16} />
                <Text style={[styles.stopActionText, styles.stopActionDeleteText]}>Delete</Text>
              </Pressable>
            </View>
          ) : (
            <Ionicons
              color={ROOM_COLORS.muted}
              name="open-outline"
              size={16}
              style={styles.stopOpenIcon}
            />
          )}
        </View>
      </Pressable>
    </View>
  );
});

const DishesPanelRow = memo(function DishesPanelRow({
  dish,
  journeySession,
  onOpenDish,
  onRateDish
}: {
  dish: MemoryDish;
  journeySession: MemoryRoomJourneySession;
  onOpenDish: (dishId: string) => void;
  onRateDish: (dishId: string, rating: number | null) => void;
}) {
  const ratingValue = dish.averageRating;
  const raterAvatars = dish.ratings.slice(0, 4);
  const extraRaterCount = Math.max(0, dish.ratingCount - raterAvatars.length);
  const submitRating = useCallback((rating: number | null) => {
    onRateDish(dish.id, rating);
  }, [dish.id, onRateDish]);
  const { selectRating, visualRating } = useImmediateDishRating(dish.id, dish.myRating, submitRating);

  return (
    <View style={styles.dishCard}>
      <MemoryJourneyRenderProbe
        journeySession={journeySession}
        surface="dish_row"
        tab="dishes"
      />
      <View style={styles.dishCardTop}>
        <View style={[styles.dishIcon, { backgroundColor: senderAccent(dish.dishName) }]}>
          <Text style={styles.dishIconText}>{dish.dishName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.dishText}>
          <Text numberOfLines={1} style={styles.dishName}>{dish.dishName}</Text>
          <Text numberOfLines={1} style={styles.dishMeta}>Added by {dish.addedByDisplayName}</Text>
        </View>
        <View style={[styles.dishRatingPill, ratingValue === null && styles.dishRatingPillEmpty]}>
          <Ionicons name={ratingValue === null ? "star-outline" : "star"} size={11} color={ROOM_COLORS.gold} />
          <Text style={styles.dishRating}>{formatMemoryDishRating(ratingValue)}</Text>
        </View>
      </View>

      {dish.note ? <Text style={styles.dishNote}>{dish.note}</Text> : null}

      <View style={styles.dishRatingDetails}>
        <Pressable
          accessibilityHint="Opens dish details to see everyone who rated"
          accessibilityLabel={`${dish.dishName}, ${memoryDishRaterSummary(dish)}`}
          accessibilityRole="button"
          onPress={() => onOpenDish(dish.id)}
          style={styles.dishRaters}
        >
          {raterAvatars.length > 0 ? (
            <View style={styles.dishRaterAvatarStack}>
              {raterAvatars.map((rating, index) => (
                <View
                  key={rating.id}
                  style={[
                    styles.dishRaterAvatar,
                    { backgroundColor: senderAccent(rating.ratedByDisplayName) },
                    index > 0 && styles.dishRaterAvatarOverlap
                  ]}
                >
                  <Text style={styles.dishRaterInitial}>{senderInitials(rating.ratedByDisplayName)}</Text>
                </View>
              ))}
              {extraRaterCount > 0 ? (
                <View style={[styles.dishRaterAvatar, styles.dishRaterAvatarMore, styles.dishRaterAvatarOverlap]}>
                  <Text style={styles.dishRaterInitial}>+{extraRaterCount}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.dishNoRatersIcon}>
              <Ionicons name="star-outline" size={13} color={ROOM_COLORS.muted} />
            </View>
          )}
          <View style={styles.dishRaterCopy}>
            <Text numberOfLines={1} style={styles.dishRaterSummary}>{memoryDishRaterSummary(dish)}</Text>
            <Text style={styles.dishRaterCount}>
              {dish.ratingCount === 0 ? "Be the first to rate" : `${dish.ratingCount} rating${dish.ratingCount === 1 ? "" : "s"}`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={ROOM_COLORS.muted} />
        </Pressable>

        <View style={styles.dishYourRatingRow}>
          <Text style={styles.dishYourRatingLabel}>
            {visualRating ? `Your rating ${visualRating}/5` : "Your rating"}
          </Text>
          <View style={styles.dishYourStars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                accessibilityLabel={visualRating === star
                  ? `Remove your rating from ${dish.dishName}`
                  : `Rate ${dish.dishName} ${star} out of 5`}
                accessibilityRole="button"
                accessibilityState={{ selected: star <= (visualRating ?? 0) }}
                hitSlop={6}
                key={star}
                onPress={() => selectRating(star)}
                style={styles.dishYourStarButton}
              >
                <Star
                  size={19}
                  color={ROOM_COLORS.gold}
                  fill={star <= (visualRating ?? 0) ? ROOM_COLORS.gold : "transparent"}
                  strokeWidth={1.8}
                />
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
});

function DishesPanel({
  dishes,
  error,
  initialScrollOffset,
  journeySession,
  onOpenDish,
  onRateDish,
  onScrollOffsetChange,
  themeCopy
}: {
  dishes: MemoryDish[];
  error?: string;
  initialScrollOffset: number;
  journeySession: MemoryRoomJourneySession;
  onOpenDish: (dishId: string) => void;
  onRateDish: (dishId: string, rating: number | null) => void;
  onScrollOffsetChange: (offset: number) => void;
  themeCopy: OccasionTheme["copy"];
}) {
  useMemoryJourneySurfaceDiagnostics(journeySession, "dishes", "dishes");
  const scrollDiagnostics = useMemoryJourneyScrollDiagnostics(
    journeySession,
    "dishes",
    onScrollOffsetChange
  );
  const renderDish = useCallback(({ item: dish }: { item: MemoryDish }) => (
    <DishesPanelRow
      dish={dish}
      journeySession={journeySession}
      onOpenDish={onOpenDish}
      onRateDish={onRateDish}
    />
  ), [journeySession, onOpenDish, onRateDish]);

  return (
    <FlatList
      contentContainerStyle={styles.panelContent}
      contentOffset={{ x: 0, y: initialScrollOffset }}
      data={dishes}
      initialNumToRender={DISHES_INITIAL_RENDER_COUNT}
      keyExtractor={(dish) => dish.id}
      ListEmptyComponent={(
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="restaurant-outline" size={26} color={ROOM_COLORS.cool} />
          </View>
          <Text style={styles.emptyTitle}>{themeCopy.emptyTitle}</Text>
          <Text style={styles.emptyText}>{themeCopy.emptyDescription}</Text>
        </View>
      )}
      ListFooterComponent={error ? <Text style={styles.error}>{error}</Text> : null}
      maxToRenderPerBatch={DISHES_MAX_RENDER_BATCH}
      onMomentumScrollBegin={scrollDiagnostics.begin}
      onMomentumScrollEnd={scrollDiagnostics.settle}
      onScroll={scrollDiagnostics.capture}
      onScrollBeginDrag={scrollDiagnostics.begin}
      onScrollEndDrag={scrollDiagnostics.settle}
      removeClippedSubviews={Platform.OS === "android"}
      renderItem={renderDish}
      scrollEventThrottle={32}
      showsVerticalScrollIndicator={false}
      style={styles.dishesList}
      updateCellsBatchingPeriod={50}
      windowSize={DISHES_WINDOW_SIZE}
    />
  );
}

// Shared dish detail / "who rated" sheet. Opened by tapping a dish in the chat
// thread or the Dishes tab. Lets the viewer set their own rating (upsert, no
// re-adding) and lists everyone who rated with the exact stars they gave.
function DishDetailSheet({
  dish,
  error,
  myUsername,
  onClose,
  onRateDish
}: {
  dish: MemoryDish | null;
  error?: string;
  myUsername: string;
  onClose: () => void;
  onRateDish: (dishId: string, rating: number | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const visible = dish !== null;
  const [mounted, setMounted] = useState(visible);
  // Keep the last non-null dish so its content stays painted through the
  // slide-out (the parent clears the id immediately on close).
  const [renderedDish, setRenderedDish] = useState(dish);
  const slide = useSharedValue(visible ? 1 : 0);
  const sheetHeight = useSharedValue(0);

  useEffect(() => {
    if (dish) setRenderedDish(dish);
  }, [dish]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slide.value = withTiming(1, { duration: 260, easing: ReanimatedEasing.out(ReanimatedEasing.cubic) });
    } else {
      slide.value = withTiming(
        0,
        { duration: 220, easing: ReanimatedEasing.in(ReanimatedEasing.cubic) },
        (finished) => { if (finished) runOnJS(setMounted)(false); }
      );
    }
  }, [slide, visible]);

  useEffect(() => {
    if (!mounted) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [mounted, onClose]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: slide.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - slide.value) * (sheetHeight.value || ATTACH_SHEET_FALLBACK_HEIGHT) }]
  }));
  const renderedDishId = renderedDish?.id ?? "";
  const submitRating = useCallback((rating: number | null) => {
    if (renderedDish) onRateDish(renderedDish.id, rating);
  }, [onRateDish, renderedDish]);
  const { selectRating, visualRating } = useImmediateDishRating(
    renderedDishId,
    renderedDish?.myRating ?? null,
    submitRating
  );

  if (!mounted || !renderedDish) return null;

  const dishData = renderedDish;
  // Highest ratings first; the viewer's own rating is labelled "You" regardless.
  const sortedRatings = [...dishData.ratings].sort((a, b) => b.rating - a.rating);

  return (
    <View style={styles.attachOverlay}>
      <View style={styles.attachSheetKeyboard}>
        <Reanimated.View pointerEvents="none" style={[styles.attachSheetBackdrop, backdropStyle]} />
        <Pressable accessibilityLabel="Close dish details" onPress={onClose} style={StyleSheet.absoluteFill} />
        <Reanimated.View
          onLayout={(event) => { sheetHeight.value = event.nativeEvent.layout.height; }}
          style={[styles.dishSheet, { paddingBottom: Math.max(insets.bottom, spacing.base) }, sheetStyle]}
        >
          <View style={styles.dishSheetHandle} />

          <View style={styles.dishSheetHeader}>
            <View style={[styles.dishIcon, { backgroundColor: senderAccent(dishData.dishName) }]}>
              <Text style={styles.dishIconText}>{dishData.dishName.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.dishText}>
              <Text numberOfLines={2} style={styles.dishSheetTitle}>{dishData.dishName}</Text>
              <Text numberOfLines={1} style={styles.dishMeta}>Added by {dishData.addedByDisplayName}</Text>
            </View>
            <View style={[styles.dishRatingPill, dishData.averageRating === null && styles.dishRatingPillEmpty]}>
              <Ionicons name={dishData.averageRating === null ? "star-outline" : "star"} size={11} color={ROOM_COLORS.gold} />
              <Text style={styles.dishRating}>{formatMemoryDishRating(dishData.averageRating)}</Text>
            </View>
          </View>

          {dishData.note ? <Text style={styles.dishNote}>{dishData.note}</Text> : null}

          <View style={styles.dishSheetRateBlock}>
            <Text style={styles.dishSheetRateLabel}>
              {visualRating ? `Your rating · ${visualRating}/5` : "Tap to rate"}
            </Text>
            <View style={styles.dishSheetStars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  accessibilityLabel={visualRating === star
                    ? `Remove your rating from ${dishData.dishName}`
                    : `Rate ${dishData.dishName} ${star} out of 5`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: star <= (visualRating ?? 0) }}
                  hitSlop={6}
                  key={star}
                  onPress={() => selectRating(star)}
                  style={styles.dishSheetStarButton}
                >
                  <Star
                    size={30}
                    color={ROOM_COLORS.gold}
                    fill={star <= (visualRating ?? 0) ? ROOM_COLORS.gold : "transparent"}
                    strokeWidth={1.7}
                  />
                </Pressable>
              ))}
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.dishSheetSectionTitle}>
            {dishData.ratingCount === 0 ? "Who rated" : `Who rated (${dishData.ratingCount})`}
          </Text>
          {sortedRatings.length === 0 ? (
            <Text style={styles.dishSheetEmpty}>No one has rated yet — be the first.</Text>
          ) : (
            <ScrollView
              contentContainerStyle={styles.dishSheetRaterList}
              showsVerticalScrollIndicator={false}
              style={styles.dishSheetRaterScroll}
            >
              {sortedRatings.map((rating) => {
                const isMe = rating.ratedBy === myUsername;
                return (
                  <View key={rating.id} style={styles.dishSheetRaterRow}>
                    <View style={[styles.dishRaterAvatar, styles.dishSheetRaterAvatar, { backgroundColor: senderAccent(rating.ratedByDisplayName) }]}>
                      <Text style={styles.dishRaterInitial}>{senderInitials(rating.ratedByDisplayName)}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.dishSheetRaterName}>
                      {isMe ? "You" : rating.ratedByDisplayName}
                    </Text>
                    <View style={styles.dishSheetRaterStars}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          size={14}
                          color={ROOM_COLORS.gold}
                          fill={star <= rating.rating ? ROOM_COLORS.gold : "transparent"}
                          strokeWidth={1.6}
                        />
                      ))}
                      <Text style={styles.dishSheetRaterValue}>{rating.rating}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Reanimated.View>
      </View>
    </View>
  );
}

function PeoplePanel({
  addParticipantError,
  addParticipantPending,
  bottomInset,
  circleStatuses,
  closing,
  inputRef,
  myUsername,
  onBack,
  onChangeParticipant,
  onCloseAnimationEnd,
  onOpenProfile,
  onRemoveSelectedParticipant,
  onRequestCircle,
  onSelectParticipant,
  onSubmitParticipants,
  participantSearchError,
  participantValue,
  participants,
  participantsLoading,
  participantSuggestions,
  selectedParticipants,
  toastMessage
}: {
  addParticipantError?: string;
  addParticipantPending: boolean;
  bottomInset: number;
  circleStatuses: Record<string, MemberCircleStatus>;
  closing: boolean;
  inputRef: RefObject<TextInput | null>;
  myUsername: string;
  onBack: () => void;
  onChangeParticipant: (value: string) => void;
  onCloseAnimationEnd: () => void;
  onOpenProfile: (username: string) => void;
  onRemoveSelectedParticipant: (username: string) => void;
  onRequestCircle: (username: string) => void;
  onSelectParticipant: (person: UserSearchResult) => void;
  onSubmitParticipants: () => void;
  participantSearchError: string | null;
  participantValue: string;
  participants: MemoryParticipant[];
  participantsLoading: boolean;
  participantSuggestions: UserSearchResult[];
  selectedParticipants: UserSearchResult[];
  toastMessage: string;
}) {
  const canAdd = selectedParticipants.length > 0 && !addParticipantPending;
  const showSuggestions = participantsLoading || participantSuggestions.length > 0 || participantValue.trim().replace(/^@/, "").length >= 2;
  const { width: screenWidth } = useWindowDimensions();
  const enterProgress = useRef(new Animated.Value(0)).current;
  const panelTranslateX = enterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.min(screenWidth, ROOM_MAX_WIDTH), 0]
  });
  const panelOpacity = enterProgress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0.92, 1, 1]
  });

  useEffect(() => {
    Animated.timing(enterProgress, {
      duration: closing ? PEOPLE_PANEL_EXIT_DURATION : PEOPLE_PANEL_ENTER_DURATION,
      easing: closing ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      toValue: closing ? 0 : 1,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished && closing) onCloseAnimationEnd();
    });
  }, [closing, enterProgress, onCloseAnimationEnd]);

  return (
    <Animated.View
      pointerEvents={closing ? "none" : "auto"}
      style={[
        styles.peoplePanelMotion,
        {
          opacity: panelOpacity,
          transform: [{ translateX: panelTranslateX }]
        }
      ]}
    >
      <View style={[styles.header, styles.peopleScreenHeader]}>
        <View style={styles.headerTop}>
          <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={onBack} style={[styles.headerIconButton, styles.headerBackButton]}>
            <Ionicons name="arrow-back" size={20} color={ROOM_COLORS.onSurface} />
          </Pressable>
          <View style={styles.compactRoomTitleWrap}>
            <Text numberOfLines={1} style={[styles.compactRoomTitle, styles.membersCompactTitle]}>Members</Text>
          </View>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[styles.panelContent, styles.peoplePanelContent]}
        keyboardShouldPersistTaps="handled"
        style={styles.peoplePanelScroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.peopleAddWrap}>
          <View style={styles.peopleAddRow}>
            <View style={styles.peopleAddInputWrap}>
              <Ionicons name="search-outline" size={17} color={ROOM_COLORS.muted} />
              <TextInput
                autoCapitalize="none"
                onChangeText={onChangeParticipant}
                placeholder="Search or invite friends..."
                placeholderTextColor={ROOM_COLORS.muted}
                ref={inputRef}
                style={styles.peopleAddInput}
                value={participantValue}
              />
            </View>
            <Pressable
              disabled={addParticipantPending}
              onPress={canAdd ? onSubmitParticipants : () => inputRef.current?.focus()}
              style={[
                styles.peopleAddButton,
                canAdd && styles.peopleAddButtonReady,
                addParticipantPending && styles.peopleAddButtonDisabled
              ]}
            >
              <Ionicons name="person-add-outline" size={16} color={canAdd ? ROOM_COLORS.onCool : ROOM_COLORS.muted} />
              <Text style={[styles.peopleAddButtonText, canAdd ? styles.peopleAddButtonTextReady : styles.peopleAddButtonTextIdle]}>
                {addParticipantPending ? "Inviting" : "Invite"}
              </Text>
            </Pressable>
          </View>
          {addParticipantError ? <Text style={styles.error}>{addParticipantError}</Text> : null}
          {showSuggestions ? (
            <View style={styles.peopleSuggestions}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator={participantSuggestions.length > 3}
                style={styles.peopleSuggestionsScroll}
              >
                {participantsLoading ? (
                  <View style={styles.peopleSuggestionState}>
                    <Text style={styles.peopleSuggestionMuted}>Searching people</Text>
                  </View>
                ) : null}
                {!participantsLoading && participantSearchError ? (
                  <View style={styles.peopleSuggestionState}>
                    <Text style={styles.peopleSuggestionError}>Could not search people</Text>
                  </View>
                ) : null}
                {!participantsLoading && !participantSearchError && participantSuggestions.length === 0 ? (
                  <View style={styles.peopleSuggestionState}>
                    <Text style={styles.peopleSuggestionMuted}>No people found</Text>
                  </View>
                ) : null}
                {participantSuggestions.map((person) => (
                  <Pressable
                    accessibilityRole="button"
                    key={person.username}
                    onPress={() => onSelectParticipant(person)}
                    style={styles.peopleSuggestionRow}
                  >
                    <View style={[styles.peopleSuggestionAvatar, { backgroundColor: senderAccent(person.displayName) }]}>
                      <Text style={styles.peopleSuggestionInitial}>{senderInitials(person.displayName || person.username)}</Text>
                    </View>
                    <View style={styles.peopleSuggestionText}>
                      <Text numberOfLines={1} style={styles.peopleSuggestionName}>{person.displayName}</Text>
                      <Text numberOfLines={1} style={styles.peopleSuggestionUsername}>@{person.username}</Text>
                    </View>
                    <Ionicons name="add" size={19} color={ROOM_COLORS.muted} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
          {selectedParticipants.length > 0 ? (
            <>
              <View style={styles.selectedPeopleChips}>
                {selectedParticipants.map((person) => (
                  <Pressable key={person.username} onPress={() => onRemoveSelectedParticipant(person.username)} style={styles.selectedPeopleChip}>
                    <Text numberOfLines={1} style={styles.selectedPeopleChipText}>@{person.username}</Text>
                    <Ionicons name="close" size={12} color={ROOM_COLORS.muted} />
                  </Pressable>
                ))}
              </View>
              <Text style={styles.peopleSuggestionMuted}>Circle friends join now; everyone else receives an invite.</Text>
            </>
          ) : null}
        </View>

        <View style={styles.personList}>
          {participants.map((participant) => {
            const accentColor = senderAccent(participant.displayName);
            const isMe = participant.username.toLowerCase() === myUsername.toLowerCase();
            const circleStatus = circleStatuses[participant.username] ?? "idle";
            const showCircleRequest = Boolean(myUsername) && !isMe && circleStatus !== "joined";
            const circleRequestDisabled = circleStatus === "loading" || circleStatus === "pending";

            return (
              <View key={participant.id} style={styles.personRow}>
                <Pressable
                  accessibilityLabel={`Open ${participant.displayName} profile`}
                  accessibilityRole="button"
                  onPress={() => onOpenProfile(participant.username)}
                  style={styles.personProfilePress}
                >
                  <View style={[styles.personAvatar, { backgroundColor: accentColor }]}>
                    <Text style={styles.personInitial}>{senderInitials(participant.displayName)}</Text>
                  </View>
                  <View style={styles.personText}>
                    <Text numberOfLines={1} style={styles.personName}>{participant.displayName}</Text>
                    <Text numberOfLines={1} style={styles.personMeta}>@{participant.username}</Text>
                  </View>
                </Pressable>
                {showCircleRequest ? (
                  <Pressable
                    disabled={circleRequestDisabled}
                    hitSlop={8}
                    onPress={() => onRequestCircle(participant.username)}
                    style={[styles.personRequestButton, circleRequestDisabled && styles.personRequestButtonMuted]}
                  >
                    <Text style={styles.personRequestButtonText}>
                      {circleStatus === "loading" ? "Requesting" : circleStatus === "pending" ? "Requested" : "Request"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
      {toastMessage ? (
        <View pointerEvents="none" style={[styles.peopleToastLayer, { bottom: Math.max(18, bottomInset + 18) }]}>
          <View style={styles.peopleToast}>
            <Ionicons name="checkmark-circle" size={17} color={ROOM_COLORS.cool} />
            <Text numberOfLines={2} style={styles.peopleToastText}>{toastMessage}</Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

// Transparent gap the wrapper leaves between the sheet's bottom edge and the
// keyboard when open. Kept small because the sheet already carries its own
// paddingBottom below the button; a large value here reads as a big empty strip.
const ATTACH_SHEET_KEYBOARD_GAP = 6;
// Used for the slide travel before the sheet's real height is measured (first
// open). Generous enough that the sheet starts fully off-screen, then onLayout
// swaps in the exact height for every frame after.
const ATTACH_SHEET_FALLBACK_HEIGHT = 520;

// Lifts the bottom-anchored sheet above the keyboard, driven per-frame by
// react-native-keyboard-controller — the same root provider the chat composer
// uses (the sheet is an in-tree overlay, not a Modal, so no nested provider).
// A transparent full-screen Pressable behind the sheet closes it.
// `slide` (0 docked off-screen -> 1 open) drives both the sheet's translateY and
// a dedicated backdrop's opacity, so the dim grows in and out with the sheet —
// this is the only dimming layer for the sheet (the room scrim is for the + menu).
function KeyboardAwareSheetSurface({ onClose, drivenKeyboardHeight, keyboardProgress, slide, sheetHeight, children }: { onClose: () => void; drivenKeyboardHeight: SharedValue<number>; keyboardProgress: SharedValue<number>; slide: SharedValue<number>; sheetHeight: SharedValue<number>; children: ReactNode }) {
  const liveInsets = useSafeAreaInsets();
  // Freeze the closed baseline for this sheet mount. Edge-to-edge Android can
  // report bottom=0 as soon as the IME covers the gesture area; accepting that
  // live update would relayout the overlay while its keyboard transform is
  // moving and create a second visible correction at the end of the slide.
  const [frozenBottomInset] = useState(() => liveInsets.bottom);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: slide.value }));
  // Same model as the chat composer and the comments sheet, for the same
  // reasons — this surface previously broke all three of its rules at once:
  //
  // 1. It animated paddingBottom per frame. Per-frame LAYOUT of a sheet that
  //    contains TextInputs re-measures the whole subtree every frame; the
  //    comments sheet shipped exactly this first and visibly jittered. Motion
  //    has to be transform-only.
  // 2. It rode the RAW per-frame keyboard height. Frame-by-frame captures on
  //    this device proved every ride variant reads as wiggle, because the app
  //    render-freezes ~4 frames at slide start while the IME window keeps
  //    moving. The driven height PARKS instead: one pre-calculated move
  //    announced by onStart, stationary before the keyboard finishes.
  // 3. It blended two signals (`insets * (1 - progress)` against
  //    `keyboardOffset * progress`). Two channels can land on different frames,
  //    which snaps at the settle point — the "two-stop" feel.
  //
  // Now: static resting padding, and ONE monotonic signal with the safe-area
  // gap as a flat subtraction, folded into the SAME transform as the open/close
  // slide so the sheet can never move on two clocks. Mirrors
  // getChatKeyboardShift: closed -> 0, open -> rests ATTACH_SHEET_KEYBOARD_GAP
  // above the keyboard top.
  const sheetSlideStyle = useAnimatedStyle(() => {
    const slideOffset = (1 - slide.value) * (sheetHeight.value || ATTACH_SHEET_FALLBACK_HEIGHT);
    return {
      transform: [{ translateY: slideOffset }]
    };
  });
  // iOS fallback: use the same parked, monotonic height as Comments. Android
  // does not consume this style; NativeKeyboardInsetView owns every IME frame
  // on the native thread and the inner view owns only the sheet open/close
  // slide, so the two motions never compete in one JavaScript transform.
  const jsKeyboardSheetStyle = useAnimatedStyle(() => {
    const closedSafeAreaGap = Math.max(0, frozenBottomInset - ATTACH_SHEET_KEYBOARD_GAP);
    const keyboardLift = Math.max(0, drivenKeyboardHeight.value - closedSafeAreaGap);
    const slideOffset = (1 - slide.value) * (sheetHeight.value || ATTACH_SHEET_FALLBACK_HEIGHT);
    return {
      transform: [{ translateY: slideOffset - keyboardLift }]
    };
  }, [frozenBottomInset]);
  // The keyboard is tracked here (inside the modal's provider) reliably. Mirror
  // its per-frame openness (0 closed -> 1 open) into a room-owned shared value so
  // the room header can hide in exact lockstep with the keyboard — same motion,
  // no separate timing/easing to drift out of sync.
  useKeyboardHandler({
    onStart: (event) => { "worklet"; keyboardProgress.value = event.progress; },
    onMove: (event) => { "worklet"; keyboardProgress.value = event.progress; },
    onEnd: (event) => { "worklet"; keyboardProgress.value = event.progress; }
  }, []);
  const sheetBody = (
    <Reanimated.View
      onLayout={(event) => { sheetHeight.value = event.nativeEvent.layout.height; }}
      style={USE_NATIVE_KEYBOARD_INSET ? sheetSlideStyle : jsKeyboardSheetStyle}
    >
      {children}
    </Reanimated.View>
  );

  return (
    <View style={[styles.attachSheetKeyboard, { paddingBottom: frozenBottomInset }]}>
      <Reanimated.View pointerEvents="none" style={[styles.attachSheetBackdrop, backdropStyle]} />
      <Pressable accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
      {USE_NATIVE_KEYBOARD_INSET ? (
        <NativeKeyboardInsetView
          active
          closedGap={frozenBottomInset}
          openGap={ATTACH_SHEET_KEYBOARD_GAP}
          style={styles.attachSheetNativeKeyboardInset}
        >
          {sheetBody}
        </NativeKeyboardInsetView>
      ) : sheetBody}
    </View>
  );
}

function AttachmentOptionsSheet({
  dishError,
  dishName,
  drivenKeyboardHeight,
  dishNote,
  dishPending,
  dishRating,
  initialView,
  onChangeDishName,
  onChangeDishNote,
  onChangeDishRating,
  onCamera,
  onClose,
  onDishSubmit,
  onGallery,
  keyboardProgress,
  pending,
  visible
}: {
  dishError?: string;
  dishName: string;
  drivenKeyboardHeight: SharedValue<number>;
  dishNote: string;
  dishPending: boolean;
  dishRating: number;
  initialView: AttachmentSheetView;
  onChangeDishName: (value: string) => void;
  onChangeDishNote: (value: string) => void;
  onChangeDishRating: (value: number) => void;
  onCamera: () => void;
  onClose: () => void;
  onDishSubmit: () => void;
  onGallery: () => void;
  keyboardProgress: SharedValue<number>;
  pending: boolean;
  visible: boolean;
}) {
  const [view, setView] = useState<AttachmentSheetView>(initialView);
  const dishNoteRef = useRef<TextInput>(null);
  const canSubmitDish = Boolean(dishName.trim()) && !dishPending;

  // Keep the overlay mounted through the close so the slide-down is visible: the
  // parent flips `visible` -> false immediately, we animate `slide` to 0, then
  // unmount once the sheet has finished travelling off-screen.
  const [mounted, setMounted] = useState(visible);
  const slide = useSharedValue(visible ? 1 : 0); // 0 = docked off-screen, 1 = open
  const sheetHeight = useSharedValue(0);
  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      slide.value = withTiming(1, { duration: 260, easing: ReanimatedEasing.out(ReanimatedEasing.cubic) });
    } else {
      slide.value = withTiming(
        0,
        { duration: 220, easing: ReanimatedEasing.in(ReanimatedEasing.cubic) },
        (finished) => { if (finished) runOnJS(setMounted)(false); }
      );
    }
  }, [slide, visible]);

  useEffect(() => {
    if (visible) setView(initialView);
  }, [initialView, visible]);

  useEffect(() => {
    if (!visible) Keyboard.dismiss();
  }, [visible]);

  // The sheet is a plain in-tree overlay (not a RN Modal), so wire up Android's
  // hardware back ourselves to dismiss it while it's open.
  useEffect(() => {
    if (!mounted) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      dismissSheet();
      return true;
    });
    return () => subscription.remove();
  }, [dismissSheet, mounted]);

  const title = view === "dish" ? "Add dish" : view === "media" ? "Add media" : "Add to memory";
  // Back only makes sense when the sheet opened on the action list and the user
  // drilled into a sub-view (the chat flow). When opened straight into dish/media
  // (the speed-dial flow), there's nothing to go back to, so hide it.
  const showBack = view !== "actions" && initialView === "actions";

  if (!mounted) return null;

  return (
    // Plain in-tree overlay under the app's single root KeyboardProvider (NOT a RN
    // Modal with a nested provider). A nested provider both mis-measures the
    // keyboard height and corrupts the root provider's listeners, which broke the
    // chat composer's keyboard after this sheet was used. In-tree, the keyboard is
    // tracked exactly like the composer, so the sheet hugs the keys the same way.
    <View style={styles.attachOverlay}>
        <KeyboardAwareSheetSurface drivenKeyboardHeight={drivenKeyboardHeight} onClose={dismissSheet} keyboardProgress={keyboardProgress} slide={slide} sheetHeight={sheetHeight}>
          <Pressable style={styles.attachSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.attachSheetHeaderRow}>
              {showBack ? (
                <Pressable
                  accessibilityLabel="Back"
                  hitSlop={8}
                  onPress={() => {
                    Keyboard.dismiss();
                    setView("actions");
                  }}
                  style={[styles.attachSheetHeaderButton, styles.attachSheetHeaderBack]}
                >
                  <Ionicons name="chevron-back" size={18} color={ROOM_COLORS.cool} />
                </Pressable>
              ) : <View style={styles.attachSheetHeaderSpacer} />}
              <View style={styles.attachSheetHeaderText}>
                {view === "dish" ? null : <Text style={styles.attachSheetTitle}>{title}</Text>}
              </View>
              <Pressable accessibilityLabel="Close" hitSlop={8} onPress={dismissSheet} style={[styles.attachSheetHeaderButton, styles.attachSheetHeaderClose]}>
                <Ionicons name="close" size={18} color={ROOM_COLORS.muted} />
              </Pressable>
            </View>

            {view === "actions" ? (
              <View style={styles.attachActionGrid}>
                <Pressable disabled={pending} onPress={() => setView("media")} style={[styles.attachActionCard, pending && styles.attachActionCardDisabled]}>
                  <View style={styles.attachActionIcon}>
                    <Ionicons name="images-outline" size={22} color={ROOM_COLORS.cool} />
                  </View>
                  <Text style={styles.attachActionTitle}>Media</Text>
                  <Text numberOfLines={2} style={styles.attachActionSubtitle}>Photos and videos</Text>
                </Pressable>
                <Pressable disabled={dishPending} onPress={() => setView("dish")} style={[styles.attachActionCard, dishPending && styles.attachActionCardDisabled]}>
                  <View style={[styles.attachActionIcon, styles.attachActionIconDish]}>
                    <Ionicons name="restaurant-outline" size={22} color={ROOM_COLORS.gold} />
                  </View>
                  <Text style={styles.attachActionTitle}>Dish</Text>
                  <Text numberOfLines={2} style={styles.attachActionSubtitle}>Name, note and rating</Text>
                </Pressable>
              </View>
            ) : view === "media" ? (
              <View style={styles.attachSheetOptionList}>
                <Pressable disabled={pending} onPress={onCamera} style={[styles.attachSheetOption, pending && styles.attachActionCardDisabled]}>
                  <View style={styles.attachSheetIcon}>
                    <Ionicons name="camera-outline" size={20} color={ROOM_COLORS.cool} />
                  </View>
                  <View style={styles.attachSheetOptionCopy}>
                    <Text style={styles.attachSheetOptionText}>Camera</Text>
                    <Text style={styles.attachSheetOptionSubtext}>Take a new photo.</Text>
                  </View>
                </Pressable>
                <Pressable disabled={pending} onPress={onGallery} style={[styles.attachSheetOption, pending && styles.attachActionCardDisabled]}>
                  <View style={styles.attachSheetIcon}>
                    <Ionicons name="images-outline" size={20} color={ROOM_COLORS.cool} />
                  </View>
                  <View style={styles.attachSheetOptionCopy}>
                    <Text style={styles.attachSheetOptionText}>Gallery</Text>
                    <Text style={styles.attachSheetOptionSubtext}>Choose photos or videos.</Text>
                  </View>
                </Pressable>
              </View>
            ) : (
              <View style={styles.attachDishForm}>
                <View style={styles.attachDishCard}>
                  <View style={styles.attachDishNameRow}>
                    <View style={styles.attachDishIconSlot}>
                      <Utensils size={20} color={ROOM_COLORS.gold} strokeWidth={1.9} />
                    </View>
                    <TextInput
                      blurOnSubmit={false}
                      onChangeText={onChangeDishName}
                      onSubmitEditing={() => dishNoteRef.current?.focus()}
                      placeholder="Chicken Biriyani"
                      placeholderTextColor={ROOM_COLORS.muted}
                      returnKeyType="next"
                      style={styles.attachDishNameInput}
                      value={dishName}
                    />
                  </View>

                  <View style={styles.attachDishDivider} />

                  <View style={styles.attachDishNoteRow}>
                    <View style={[styles.attachDishIconSlot, styles.attachDishNoteIcon]}>
                      <PenLine size={16} color={ROOM_COLORS.muted} strokeWidth={1.9} />
                    </View>
                    <TextInput
                      ref={dishNoteRef}
                      multiline
                      numberOfLines={3}
                      onChangeText={onChangeDishNote}
                      placeholder="Note"
                      placeholderTextColor={ROOM_COLORS.muted}
                      style={[styles.attachDishInput, styles.attachDishNoteInput]}
                      textAlignVertical="top"
                      value={dishNote}
                    />
                  </View>

                  <View style={styles.attachDishDivider} />

                  <View style={styles.attachDishRatingRow}>
                    <Text style={styles.attachDishRatingLabel}>{dishRating ? `${dishRating}/5` : "Rate dish"}</Text>
                    <View style={styles.attachDishStars}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Pressable
                          accessibilityLabel={`Rate ${star} out of 5`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: star <= dishRating }}
                          key={star}
                          hitSlop={6}
                          onPress={() => onChangeDishRating(dishRating === star ? 0 : star)}
                          style={styles.attachDishStarButton}
                        >
                          <Star
                            size={18}
                            color={ROOM_COLORS.gold}
                            fill={star <= dishRating ? ROOM_COLORS.gold : "transparent"}
                            strokeWidth={1.8}
                          />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
                <Pressable
                  disabled={!canSubmitDish}
                  onPress={() => {
                    Keyboard.dismiss();
                    onDishSubmit();
                  }}
                  style={[styles.attachDishSubmit, !canSubmitDish && styles.attachDishSubmitDisabled]}
                >
                  <Text style={styles.attachDishSubmitText}>{dishPending ? "Adding..." : "Add dish"}</Text>
                </Pressable>
                {dishError ? <Text style={styles.error}>{dishError}</Text> : null}
              </View>
            )}
          </Pressable>
        </KeyboardAwareSheetSurface>
    </View>
  );
}

function RoomActionsSheet({
  leavePending,
  onClose,
  onLeave,
  visible
}: {
  leavePending: boolean;
  onClose: () => void;
  onLeave: () => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.roomActionsBackdrop}>
        <Pressable style={styles.roomActionsPopover} onPress={(event) => event.stopPropagation()}>
          <Pressable disabled={leavePending} onPress={onLeave} style={[styles.roomActionOption, leavePending && styles.roomActionDisabled]}>
            <View style={[styles.roomActionIcon, styles.roomActionIconDanger]}>
              <Ionicons name="exit-outline" size={19} color={ROOM_COLORS.danger} />
            </View>
            <View style={styles.roomActionText}>
              <Text style={[styles.roomActionTitle, styles.roomActionDangerText]}>{leavePending ? "Leaving..." : "Leave room"}</Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SelectionActionBar({
  canDelete,
  count,
  deleteError,
  deleting,
  editableMessage,
  insetStyle,
  onCancel,
  onDelete,
  onEdit,
  onLayoutChange
}: {
  canDelete: boolean;
  count: number;
  deleteError?: string;
  deleting: boolean;
  editableMessage: MemoryMessage | null;
  insetStyle: StyleProp<ViewStyle>;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: (message: MemoryMessage) => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
}) {
  return (
    <Reanimated.View style={[styles.composerWrap, insetStyle]}>
      <View onLayout={onLayoutChange} style={styles.composerContent}>
        {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
        <View style={styles.composer}>
          <View style={[styles.messageBox, styles.selectionMessageBox]}>
            <Pressable accessibilityLabel="Cancel selection" onPress={onCancel} style={styles.selectionInlineButton}>
              <Ionicons name="close" size={20} color={ROOM_COLORS.onSurface} />
            </Pressable>
            <Text numberOfLines={1} style={styles.selectionBarTitle}>
              {count} selected
            </Text>
          </View>
          {editableMessage ? (
            <Pressable
              accessibilityLabel="Edit selected message"
              disabled={deleting}
              onPress={() => onEdit(editableMessage)}
              style={[styles.selectionEditButton, deleting && styles.selectionDeleteButtonDisabled]}
            >
              <Ionicons name="create-outline" size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.onCool} />
            </Pressable>
          ) : null}
          {canDelete ? (
            <Pressable
              accessibilityLabel="Delete selected items"
              disabled={deleting || count === 0}
              onPress={onDelete}
              style={[styles.selectionDeleteButton, (deleting || count === 0) && styles.selectionDeleteButtonDisabled]}
            >
              <Ionicons name={deleting ? "hourglass-outline" : "trash-outline"} size={SELECTION_SECONDARY_ICON_SIZE} color={ROOM_COLORS.white} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Reanimated.View>
  );
}

function MediaViewer({
  journeySession,
  onClose,
  onMediaError,
  selection,
  tab
}: {
  journeySession: MemoryRoomJourneySession;
  onClose: () => void;
  onMediaError: () => void;
  selection: MediaViewerState | null;
  tab: RoomTabMode;
}) {
  const insets = useSafeAreaInsets();
  const viewerListRef = useRef<FlatList<MemoryPhoto>>(null);
  const firstFrameSelectionRef = useRef<MediaViewerState | null>(null);
  const [activeIndex, setActiveIndex] = useState(selection?.index ?? 0);
  const [carouselWidth, setCarouselWidth] = useState(0);

  useEffect(() => {
    if (!selection) return;
    setActiveIndex(selection.index);
  }, [selection]);

  useEffect(() => {
    if (!selection || carouselWidth <= 0) return;
    viewerListRef.current?.scrollToIndex({
      animated: false,
      index: Math.max(0, Math.min(selection.items.length - 1, selection.index))
    });
  }, [carouselWidth, selection]);

  if (!selection || selection.items.length === 0) return null;

  const items = selection.items;
  const safeActiveIndex = Math.max(0, Math.min(items.length - 1, activeIndex));
  const topInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.top + spacing.sm, spacing.lg);
  const bottomInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.bottom + spacing.md, spacing.lg);

  function handleViewerScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (carouselWidth <= 0) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / carouselWidth);
    setActiveIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
  }

  function selectViewerItem(index: number) {
    setActiveIndex(index);
    if (carouselWidth > 0) {
      viewerListRef.current?.scrollToIndex({ animated: true, index });
    }
  }

  const viewerExtraData = `${safeActiveIndex}:${carouselWidth}`;
  const renderViewerItem = ({ index, item: media }: { index: number; item: MemoryPhoto }) => (
    <View style={[styles.viewerSlide, carouselWidth > 0 && { width: carouselWidth }]}>
      {memoryMediaKind(media) === "audio" ? (
        <ViewerAudio journeySession={journeySession} media={media} tab={tab} />
      ) : memoryMediaKind(media) === "video" && index === safeActiveIndex ? (
        <ViewerVideo journeySession={journeySession} media={media} tab={tab} />
      ) : memoryMediaKind(media) === "video" ? (
        <View style={styles.viewerVideo}>
          <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} contentFit="contain" posterUri={media.posterUrl} uri={media.publicUrl} />
        </View>
      ) : (
        <Image
          cachePolicy="memory-disk"
          contentFit="contain"
          onError={onMediaError}
          recyclingKey={memoryMediaCacheKey(media)}
          source={media.publicUrl}
          style={styles.viewerImage}
        />
      )}
    </View>
  );

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.viewerBackdrop}>
        <StatusBar hidden />
        <View
          onLayout={(event) => {
            setCarouselWidth(event.nativeEvent.layout.width);
            if (firstFrameSelectionRef.current === selection) return;
            firstFrameSelectionRef.current = selection;
            recordMemoryRoomJourney(journeySession, "MEDIA_FIRST_FRAME", {
              contentHeight: event.nativeEvent.layout.height,
              contentWidth: event.nativeEvent.layout.width,
              screenState: "viewer",
              tab
            });
          }}
          style={styles.viewerBody}
        >
          <FlatList
            data={items}
            extraData={viewerExtraData}
            getItemLayout={carouselWidth > 0 ? (_data, index) => ({
              index,
              length: carouselWidth,
              offset: carouselWidth * index
            }) : undefined}
            horizontal
            initialNumToRender={1}
            keyExtractor={(item) => item.id}
            maxToRenderPerBatch={MEDIA_VIEWER_MAX_RENDER_BATCH}
            onMomentumScrollEnd={handleViewerScroll}
            onScrollToIndexFailed={(info) => {
              if (carouselWidth <= 0) return;
              setTimeout(() => {
                viewerListRef.current?.scrollToIndex({
                  animated: false,
                  index: Math.max(0, Math.min(items.length - 1, info.index))
                });
              }, 50);
            }}
            pagingEnabled
            ref={viewerListRef}
            removeClippedSubviews={false}
            renderItem={renderViewerItem}
            showsHorizontalScrollIndicator={false}
            style={styles.viewerCarousel}
            updateCellsBatchingPeriod={50}
            windowSize={MEDIA_VIEWER_WINDOW_SIZE}
          />
        </View>
        <Pressable
          accessibilityLabel="Close media viewer"
          hitSlop={8}
          onPress={onClose}
          style={[styles.viewerClose, { top: topInset }]}
        >
          <Ionicons name="close" size={22} color={ROOM_COLORS.white} />
        </Pressable>
        {items.length > 1 ? (
          <View pointerEvents="box-none" style={[styles.viewerFooter, { paddingBottom: bottomInset }]}>
            <Text style={styles.viewerCount}>{safeActiveIndex + 1} / {items.length}</Text>
            <ScrollView
              contentContainerStyle={styles.viewerThumbnails}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.viewerThumbnailScroller}
            >
              {items.map((media, index) => (
                <Pressable
                  key={media.id}
                  onPress={() => selectViewerItem(index)}
                  style={[
                    styles.viewerThumbnail,
                    index === safeActiveIndex && styles.viewerThumbnailActive
                  ]}
                >
                  {memoryMediaKind(media) === "audio" ? (
                    <View style={styles.viewerThumbnailAudio}>
                      <Ionicons name="mic-outline" size={16} color={ROOM_COLORS.white} />
                    </View>
                  ) : memoryMediaKind(media) === "video" ? (
                    <View style={styles.viewerThumbnailVideo}>
                      <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} posterUri={media.posterUrl} uri={media.publicUrl} />
                      <View pointerEvents="none" style={styles.videoThumbnailScrim} />
                      <Ionicons name="play" size={14} color={ROOM_COLORS.white} />
                    </View>
                  ) : (
                    <Image
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      recyclingKey={memoryMediaCacheKey(media)}
                      source={media.publicUrl}
                      style={styles.viewerThumbnailImage}
                    />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function ViewerAudio({
  journeySession,
  media,
  tab
}: {
  journeySession: MemoryRoomJourneySession;
  media: MemoryPhoto;
  tab: RoomTabMode;
}) {
  const player = useAudioPlayer(media.publicUrl, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const currentTime = status.currentTime;
  const duration = audioDurationSeconds(media, status.duration);
  const progress = duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0;

  useEffect(() => {
    const releasePlayerCounter = adjustMemoryRoomResourceCounter(
      "MemoryRoomActivePlayers",
      1
    );
    recordMemoryRoomJourney(journeySession, "PLAYER_CREATED", {
      playerKind: "audio",
      tab
    });
    return () => {
      pauseMediaPlayerQuietly(player);
      releasePlayerCounter();
      recordMemoryRoomJourney(journeySession, "PLAYER_RELEASED", {
        playerKind: "audio",
        tab
      });
    };
  }, [journeySession, player, tab]);

  function togglePlayback() {
    try {
      if (player.playing) {
        player.pause();
        return;
      }
      if (duration > 0 && player.currentTime >= duration - 0.25) {
        void player.seekTo(0).then(() => player.play());
        return;
      }
      player.play();
    } catch {
      console.warn("[memory-chat] Could not toggle viewer audio playback");
    }
  }

  return (
    <View style={styles.viewerAudio}>
      <Pressable
        accessibilityLabel={isPlaying ? "Pause audio" : "Play audio"}
        accessibilityRole="button"
        onPress={togglePlayback}
        style={styles.viewerAudioPlayButton}
      >
        <Ionicons name={isPlaying ? "pause" : "play"} size={32} color={ROOM_COLORS.white} />
      </Pressable>
      <Text style={styles.viewerAudioTitle}>Audio</Text>
      <View style={styles.viewerAudioTrack}>
        <View style={[styles.viewerAudioProgress, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.viewerAudioTime}>
        {formatAudioPlaybackTime(currentTime)} / {formatAudioPlaybackTime(duration)}
      </Text>
    </View>
  );
}

function ViewerVideo({
  journeySession,
  media,
  tab
}: {
  journeySession: MemoryRoomJourneySession;
  media: MemoryPhoto;
  tab: RoomTabMode;
}) {
  const runtime = useRuntimeActivity();
  const player = useVideoPlayer(media.publicUrl, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
  });

  useEffect(() => {
    const releasePlayerCounter = adjustMemoryRoomResourceCounter(
      "MemoryRoomActivePlayers",
      1
    );
    recordMemoryRoomJourney(journeySession, "PLAYER_CREATED", {
      playerKind: "video",
      tab
    });
    return () => {
      // useVideoPlayer owns the native release and registers its cleanup
      // before this effect. Touching the shared object here can race Expo's
      // release when a viewer cell or the modal unmounts.
      releasePlayerCounter();
      recordMemoryRoomJourney(journeySession, "PLAYER_RELEASED", {
        playerKind: "video",
        tab
      });
    };
  }, [journeySession, tab]);

  useEffect(() => {
    if (!runtime.isForeground) pauseMediaPlayerQuietly(player);
  }, [player, runtime.isForeground]);

  return (
    <View style={styles.viewerVideo}>
      <VideoView
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        player={player}
        style={styles.viewerVideoPlayer}
      />
    </View>
  );
}

function SingleMediaPreview({
  media,
  sizeOverride,
  timestamp,
  timestampPlacement = "bottom-right",
  viewKey
}: {
  media: MemoryPhoto;
  sizeOverride?: MediaPreviewSize;
  timestamp?: string;
  timestampPlacement?: MediaTimestampPlacement;
  viewKey?: string;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const previewSize = sizeOverride ?? getSingleMediaPreviewSize({
    imageHeight: media.imageHeight,
    imageWidth: media.imageWidth,
    screenWidth
  });
  // A chat image is already clipped by its outer media frame/card. Let the
  // fixed-size container and image host pass that clip through so Android does
  // not build two additional clipped layers while their common Chat ancestor
  // follows the keyboard. Video/audio retain their existing inner clipping.
  const imageClipPassthrough = memoryMediaKind(media) === "image"
    ? styles.singleImageClipPassthrough
    : undefined;

  return (
    <View style={[styles.singleMediaContainer, imageClipPassthrough, previewSize]}>
      <MediaPreview media={media} style={[styles.singleMediaFill, imageClipPassthrough]} telemetrySurface="chat" viewKey={viewKey} />
      {timestamp ? (
        <MediaTimestampOverlay
          placement={timestampPlacement}
          timestamp={timestamp}
        />
      ) : null}
    </View>
  );
}

function MediaTimestampOverlay({
  placement = "bottom-right",
  timestamp
}: {
  placement?: MediaTimestampPlacement;
  timestamp: string;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.mediaTimestampOverlay,
        placement === "bottom-left" ? styles.mediaTimestampOverlayLeft : styles.mediaTimestampOverlayRight
      ]}
    >
      <MessageMeta overlay time={timestamp} />
    </View>
  );
}

function AudioMediaPreview({
  compact = false,
  media,
  style
}: {
  compact?: boolean;
  media: MemoryPhoto;
  style?: StyleProp<ViewStyle>;
}) {
  const uploading = memoryMediaNeedsStatusOverlay(media);
  const duration = media.durationMs ? formatAudioPlaybackTime(media.durationMs / 1000) : "Audio";

  return (
    <View style={[styles.audioMediaPreview, compact && styles.audioMediaPreviewCompact, style as StyleProp<ViewStyle>]}>
      <View style={[styles.audioMediaIcon, compact && styles.audioMediaIconCompact]}>
        <Ionicons name="mic-outline" size={compact ? 18 : 24} color={ROOM_COLORS.cool} />
      </View>
      <Text numberOfLines={1} style={[styles.audioMediaTitle, compact && styles.audioMediaTitleCompact]}>
        Audio
      </Text>
      {!compact ? (
        <Text numberOfLines={1} style={styles.audioMediaDuration}>
          {duration}
        </Text>
      ) : null}
      {uploading ? <UploadProgressOverlay progress={resolveMemoryUploadProgress(media)} status={media.processingStatus} /> : null}
    </View>
  );
}

function MediaPreview({
  contentFit = "contain",
  media,
  style,
  telemetrySurface = "chat",
  viewKey
}: {
  contentFit?: "contain" | "cover";
  media: MemoryPhoto;
  style?: StyleProp<ViewStyle>;
  telemetrySurface?: "chat" | "media";
  viewKey?: string;
}) {
  useMemoryMediaRenderTelemetry(media, telemetrySurface);
  const uploading = memoryMediaNeedsStatusOverlay(media);
  const hasVisual = memoryMediaHasVisual(media);

  if (memoryMediaKind(media) === "audio") {
    return <AudioMediaPreview media={media} style={style} />;
  }

  if (memoryMediaKind(media) === "video") {
    return (
      <View style={[styles.videoPreview, style as StyleProp<ViewStyle>]}>
        {hasVisual ? (
          <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} contentFit={contentFit} posterUri={media.posterUrl} uri={media.publicUrl} viewKey={viewKey} />
        ) : null}
        <View pointerEvents="none" style={styles.videoThumbnailScrim} />
        <View style={styles.mediaTypeBadge}>
          <Ionicons name="videocam" size={11} color={ROOM_COLORS.white} />
          <Text style={styles.mediaTypeBadgeText}>Video</Text>
        </View>
        {!uploading ? (
          <View style={styles.playBadge}>
            <Ionicons name="play" size={18} color={ROOM_COLORS.white} />
          </View>
        ) : null}
        {uploading ? <UploadProgressOverlay progress={resolveMemoryUploadProgress(media)} status={media.processingStatus} /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.mediaImageWrap, style as StyleProp<ViewStyle>]}>
      {hasVisual ? (
        <Image
          cachePolicy="memory-disk"
          contentFit={contentFit}
        // Keyed on the SLOT where one is known, otherwise on identity — never
        // on the URL. An in-flight upload rewrites publicUrl underneath the same
        // photo, and confirmation replaces the photo outright; a changed
        // recyclingKey tells expo-image to reset the view, which is the image
        // visibly disappearing and coming back. See memoryMediaSlotViewKey.
          recyclingKey={viewKey ?? memoryMediaCacheKey(media)}
          source={media.thumbnailUrl || media.publicUrl}
          style={styles.mediaImage}
        />
      ) : null}
      {uploading ? <UploadProgressOverlay progress={resolveMemoryUploadProgress(media)} status={media.processingStatus} /> : null}
    </View>
  );
}

function createStyles(ROOM_COLORS: RoomColors) {
  return StyleSheet.create({
  keyboard: {
    flex: 1
  },
  screenContent: {
    overflow: "hidden",
    paddingBottom: 0,
    position: "relative"
  },
  roomLoadingHeader: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.header,
    borderBottomColor: ROOM_COLORS.border,
    borderBottomWidth: 1,
    height: ROOM_HEADER_EXPANDED_HEIGHT,
    left: 0,
    maxWidth: ROOM_MAX_WIDTH,
    paddingHorizontal: ROOM_HEADER_HORIZONTAL_PADDING,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
    zIndex: 20
  },
  roomLoadingTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 78
  },
  roomLoadingTitleBlock: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  roomLoadingTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 20,
    lineHeight: 27
  },
  roomLoadingSubtitle: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  roomLoadingHeaderSpacer: {
    width: ROOM_HEADER_CONTROL_SIZE - 8
  },
  roomLoadingTabs: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    bottom: 18,
    flexDirection: "row",
    gap: MODE_TABS_PADDING,
    left: ROOM_HEADER_HORIZONTAL_PADDING,
    padding: MODE_TABS_PADDING,
    position: "absolute",
    right: ROOM_HEADER_HORIZONTAL_PADDING
  },
  roomLoadingTab: {
    alignItems: "center",
    borderRadius: radius.pill,
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 39,
    paddingHorizontal: 5
  },
  roomLoadingTabActive: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1
  },
  roomLoadingTabText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14
  },
  roomLoadingTabTextActive: {
    color: ROOM_COLORS.onSurface
  },
  roomLoadingStage: {
    backgroundColor: ROOM_COLORS.bg,
    flex: 1,
    position: "relative"
  },
  roomLoadingContent: {
    alignSelf: "center",
    maxWidth: ROOM_MAX_WIDTH,
    paddingHorizontal: spacing.lg,
    paddingTop: ROOM_HEADER_EXPANDED_HEIGHT + spacing.xl,
    width: "100%"
  },
  roomSkeletonLineWide: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 11,
    width: "88%"
  },
  roomSkeletonLineMedium: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 11,
    width: "70%"
  },
  roomSkeletonLineShort: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 9,
    width: "44%"
  },
  roomSkeletonChat: {
    gap: spacing.base,
    paddingTop: spacing.md
  },
  roomSkeletonChatRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.s,
    width: "100%"
  },
  roomSkeletonChatRowMine: {
    justifyContent: "flex-end"
  },
  roomSkeletonAvatar: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 30,
    width: 30
  },
  roomSkeletonBubble: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    gap: 9,
    minHeight: 62,
    padding: spacing.md,
    width: "62%"
  },
  roomSkeletonBubbleMine: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 5,
    borderColor: ROOM_COLORS.coolBorder,
    width: "54%"
  },
  roomSkeletonBubbleWide: {
    width: "70%"
  },
  roomSkeletonMediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  roomSkeletonMediaTile: {
    aspectRatio: 1,
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    width: "49%"
  },
  roomSkeletonDishList: {
    gap: spacing.sm
  },
  roomSkeletonDishCard: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md
  },
  roomSkeletonDishIcon: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 38,
    width: 38
  },
  roomSkeletonDishCopy: {
    flex: 1,
    gap: 8,
    minWidth: 0
  },
  roomSkeletonRating: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 24,
    width: 48
  },
  roomSkeletonTable: {
    gap: spacing.sm
  },
  roomSkeletonPostButton: {
    alignSelf: "flex-end",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 36,
    width: 82
  },
  roomSkeletonSectionTitle: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    height: 10,
    marginBottom: 4,
    width: 104
  },
  roomSkeletonStopRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.sm
  },
  roomSkeletonStopRail: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: 32
  },
  roomSkeletonStopConnectorTop: {
    backgroundColor: ROOM_COLORS.coolBorder,
    bottom: "50%",
    left: 15,
    position: "absolute",
    top: -spacing.sm,
    width: 2
  },
  roomSkeletonStopConnectorBottom: {
    backgroundColor: ROOM_COLORS.coolBorder,
    bottom: -spacing.sm,
    left: 15,
    position: "absolute",
    top: "50%",
    width: 2
  },
  roomSkeletonStopMarker: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    width: 32,
    zIndex: 1
  },
  roomSkeletonStopCard: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 74,
    padding: spacing.base
  },
  roomSkeletonStopCopy: {
    flex: 1,
    gap: 8,
    minWidth: 0
  },
  roomStage: {
    flex: 1,
    position: "relative"
  },
  roomStageShift: {
    flex: 1
  },
  chatListShiftWrap: {
    flex: 1
  },
  roomStageTable: {
    backgroundColor: ROOM_COLORS.bg
  },
  roomStageChat: {
    backgroundColor: ROOM_COLORS.bg,
    overflow: "hidden"
  },
  chatKeyboardInsetContainer: {
    flex: 1
  },
  chatMainSurface: {
    backgroundColor: "transparent",
    flex: 1,
    position: "relative"
  },
  chatMainMessagesLayer: {
    flex: 1
  },
  chatMainMessagesLayerAnchoring: {
    opacity: 0
  },
  chatKeyboardBridge: {
    backgroundColor: ROOM_COLORS.panel,
    height: CHAT_KEYBOARD_BRIDGE_HEIGHT,
    left: 0,
    position: "absolute",
    right: 0,
    top: "100%",
    zIndex: 10
  },
  chatMainMessages: {
    backgroundColor: "transparent",
    flex: 1
  },
  chatMainListContent: {
    backgroundColor: "transparent",
    flexGrow: 1,
    paddingBottom: CHAT_HEADER_CLEARANCE,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingTop: 0
  },
  chatMainToolbarShell: {
    backgroundColor: ROOM_COLORS.panel,
    borderTopColor: ROOM_COLORS.border,
    borderTopWidth: CHAT_COMPOSER_LAYOUT_CONTRACT.toolbarBorderWidth,
    bottom: 0,
    gap: 6,
    left: 0,
    paddingBottom: COMPOSER_CLOSED_SAFE_GAP,
    paddingHorizontal: Platform.OS === "web" ? spacing.md : 12,
    paddingTop: CHAT_COMPOSER_LAYOUT_CONTRACT.toolbarPaddingTop,
    position: "absolute",
    right: 0,
    zIndex: 20
  },
  chatMainDraftContent: {
    gap: 6
  },
  chatMainDraftRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.sm
  },
  chatMainDraftReplyBanner: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 54,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  chatMainAccessory: {
    gap: 6
  },
  chatMainError: {
    ...fontStyles.bold,
    color: ROOM_COLORS.danger,
    fontSize: 12,
    lineHeight: 16
  },
  chatMainEditingBanner: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.sm
  },
  chatMainEditingIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderRadius: radius.pill,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  chatMainEditingText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0
  },
  chatMainEditingCancel: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 12,
    lineHeight: 16
  },
  chatMainQuickRail: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  chatMainQuickAction: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  chatMainQuickActionText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14
  },
  chatMainActionTouchable: {
    paddingBottom: 1,
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0
  },
  chatMainActionButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: COMPOSER_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: COMPOSER_ACTION_BUTTON_SIZE
  },
  chatMainVoiceCancelButton: {
    backgroundColor: ROOM_COLORS.panelRaised
  },
  chatMainVoiceButtonDisabled: {
    opacity: 0.55
  },
  chatMainDraftMessageBox: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    minHeight: COMPOSER_MESSAGE_BOX_MIN_HEIGHT,
    minWidth: 0,
    overflow: "hidden",
    position: "relative"
  },
  chatMainDraftMessageBoxNative: {
    backgroundColor: "transparent",
    borderWidth: 0,
    // The native input owns a fixed max-height canvas so it can grow without a
    // Fabric commit. Only its current EditText height is visible; clipping the
    // unused canvas here also clips its Android touch target. Leaving overflow
    // visible made that transparent canvas sit over the newest chat rows and
    // swallow their swipe-to-reply gestures.
    overflow: "hidden"
  },
  chatMainDraftInput: {
    ...fontStyles.medium,
    bottom: 0,
    color: ROOM_COLORS.onSurface,
    fontSize: COMPOSER_INPUT_FONT_SIZE,
    left: 0,
    lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    position: "absolute",
    right: 0,
    textAlignVertical: "top",
    top: 0
  },
  chatMainNativeDraftInput: {
    bottom: 0,
    height: COMPOSER_INPUT_MAX_HEIGHT,
    left: 0,
    position: "absolute",
    right: 0
  },
  chatMainSendContainer: {
    justifyContent: "flex-end"
  },
  chatMainSendTouchable: {
    alignItems: "center",
    justifyContent: "center"
  },
  chatMainSendButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: COMPOSER_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: COMPOSER_ACTION_BUTTON_SIZE
  },
  chatMainSendButtonDisabled: {
    backgroundColor: ROOM_COLORS.glassDim
  },
  // Both icons occupy the button so they can cross-fade in place; the button
  // already centres its children, so this just stacks them.
  chatMainSendIconLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  chatMainVoiceComposer: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: COMPOSER_MESSAGE_BOX_MIN_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 10 : 8
  },
  chatMainSelectionBox: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: COMPOSER_MESSAGE_BOX_MIN_HEIGHT,
    minWidth: 0,
    paddingHorizontal: spacing.md
  },
  chatMainVoiceDot: {
    backgroundColor: ROOM_COLORS.danger,
    borderRadius: radius.pill,
    height: 9,
    width: 9
  },
  chatMainVoiceDotSending: {
    backgroundColor: ROOM_COLORS.cool
  },
  chatMainVoiceCopy: {
    flex: 1,
    minWidth: 0
  },
  chatMainVoiceTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 13,
    lineHeight: 16
  },
  chatMainVoiceTime: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 1
  },
  // Width caps are applied at the Message-row level (chatMainRowText*/Media);
  // the bubble itself hugs its content, so no maxWidth here — nested
  // percentage caps inside content-sized views resolve unreliably on native.
  chatMainBubbleLeft: {
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderColor: ROOM_COLORS.border,
    borderWidth: 1,
    position: "relative"
  },
  chatMainBubbleRight: {
    backgroundColor: ROOM_COLORS.sentBubble,
    borderColor: ROOM_COLORS.sentBubbleBorder,
    borderWidth: 1,
    position: "relative"
  },
  // Squared corner behind the tail so the notch sits flush with the bubble.
  chatMainBubbleLeftWithTail: {
    borderTopLeftRadius: 2
  },
  chatMainBubbleRightWithTail: {
    borderTopRightRadius: 2
  },
  // SVG tail anchors: offsets are relative to the bubble's padding box, so
  // top -1 reaches the outer border edge; +/-8 lets the 11px-wide SVG overlap
  // ~4px into the bubble while the tip protrudes ~7px, WhatsApp-style.
  chatMainBubbleTailLeft: {
    left: -8,
    position: "absolute",
    top: -1
  },
  chatMainBubbleTail: {
    position: "absolute",
    right: -8,
    top: -1
  },
  chatMainTimeLeft: {
    color: ROOM_COLORS.timestamp
  },
  chatMainTimeRight: {
    color: ROOM_COLORS.sentTimestamp
  },
  chatMainTicks: {
    color: ROOM_COLORS.sentTimestamp,
    fontSize: 10,
    lineHeight: 12,
    marginLeft: 4
  },
  chatMainTicksPending: {
    color: ROOM_COLORS.sentTimestamp
  },
  chatMainFailedTicks: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginLeft: 5
  },
  // Overrides the vendor Message container's hardcoded 70% row cap. Text rows
  // cap WhatsApp-style; media rows span free since the media block width is
  // already clamped in JS (memoryChatMediaWidthBudget).
  chatMainRowTextMine: {
    maxWidth: CHAT_SENT_TEXT_ROW_MAX_WIDTH
  },
  chatMainRowTextOther: {
    maxWidth: CHAT_RECEIVED_TEXT_ROW_MAX_WIDTH
  },
  chatMainRowMedia: {
    maxWidth: "100%"
  },
  chatMainRowSelectionFrame: {
    marginHorizontal: -CHAT_ROW_SIDE_PADDING,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING
  },
  chatMainRowSelectedBackground: {
    backgroundColor: ROOM_COLORS.coolDim
  },
  chatMainIncomingRowEdge: {
    marginLeft: 0
  },
  chatMainGroupedRowGap: {
    marginBottom: CHAT_GROUPED_MESSAGE_GAP
  },
  chatMainRowBreakGap: {
    marginBottom: 10
  },
  chatMainFailedRow: {
    marginTop: CHAT_GROUPED_MESSAGE_GAP
  },
  liteChatRow: {
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    width: "100%"
  },
  liteChatRowMine: {
    alignItems: "flex-end"
  },
  liteChatRowOther: {
    alignItems: "flex-start"
  },
  liteChatRowGrouped: {
    marginBottom: CHAT_GROUPED_MESSAGE_GAP
  },
  liteChatRowBreak: {
    marginBottom: 10
  },
  liteChatBubble: {
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: CHAT_RECEIVED_TEXT_ROW_MAX_WIDTH,
    paddingBottom: 7,
    paddingHorizontal: 11,
    paddingTop: 7,
    position: "relative"
  },
  liteChatBubbleMine: {
    backgroundColor: ROOM_COLORS.sentBubble,
    borderColor: ROOM_COLORS.sentBubbleBorder,
    maxWidth: CHAT_SENT_TEXT_ROW_MAX_WIDTH
  },
  liteChatBubbleOther: {
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderColor: ROOM_COLORS.border
  },
  liteChatBubbleMineWithTail: {
    borderTopRightRadius: 3
  },
  liteChatBubbleOtherWithTail: {
    borderTopLeftRadius: 3
  },
  liteChatTail: {
    borderBottomWidth: 1,
    borderRightWidth: 1,
    height: 10,
    position: "absolute",
    top: -1,
    transform: [{ rotate: "45deg" }],
    width: 10
  },
  liteChatTailMine: {
    backgroundColor: ROOM_COLORS.sentBubble,
    borderBottomColor: ROOM_COLORS.sentBubbleBorder,
    borderRightColor: ROOM_COLORS.sentBubbleBorder,
    right: -5
  },
  liteChatTailOther: {
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderBottomColor: ROOM_COLORS.border,
    borderRightColor: ROOM_COLORS.border,
    left: -5,
    transform: [{ rotate: "225deg" }]
  },
  liteChatSender: {
    ...fontStyles.extraBold,
    fontSize: 12,
    lineHeight: 15,
    marginBottom: 3,
    maxWidth: "100%"
  },
  liteChatReplyPreview: {
    marginBottom: 5,
    marginHorizontal: 0,
    marginTop: 0
  },
  liteChatBody: {
    ...fontStyles.medium,
    flexShrink: 1,
    fontSize: 16,
    includeFontPadding: false,
    lineHeight: 22
  },
  liteChatInlineMeta: {
    ...fontStyles.semiBold,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 13
  },
  liteChatInlineMetaFailed: {
    color: ROOM_COLORS.danger
  },
  liteChatFailedRowMine: {
    alignItems: "flex-end"
  },
  liteChatSystemRow: {
    alignItems: "center",
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingVertical: 5,
    width: "100%"
  },
  liteChatSystemText: {
    ...fontStyles.semiBold,
    backgroundColor: ROOM_COLORS.glassDim,
    borderRadius: 12,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  chatMainAvatarImage: {
    borderRadius: CHAT_AVATAR_SIZE / 2,
    height: CHAT_AVATAR_SIZE,
    width: CHAT_AVATAR_SIZE
  },
  chatMainAvatarText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 11,
    lineHeight: 14
  },
  chatMainSenderHeader: {
    paddingHorizontal: 11,
    paddingTop: 7
  },
  chatMainSenderHeaderMedia: {
    paddingBottom: 2,
    paddingHorizontal: 12,
    paddingTop: 9
  },
  // paddingBottom leaves room for the pinned time's overhang
  // (CHAT_TIME_PINNED_DROP) plus ~5px clearance to the bubble edge.
  chatMainTextContainer: {
    paddingBottom: 8,
    paddingHorizontal: 11,
    paddingTop: 7
  },
  chatMainTextContainerWithSender: {
    paddingTop: 0
  },
  // Plain block holding the text (with its inline time spacer) and the
  // pinned time. Hugs content by default; see the `stretch` prop on
  // ChatMainBodyWithTime for why.
  chatMainBodyWithTime: {
    alignSelf: "flex-start",
    position: "relative"
  },
  chatMainBodyWithTimeStretch: {
    alignSelf: "stretch"
  },
  // Host Text for the body span + non-text timestamp spacer. Tiny font keeps
  // the host metric below the nested body/spacer metrics; all visible styling
  // lives on the body span and the one pinned timestamp.
  chatMainBodyHostText: {
    fontSize: 4,
    includeFontPadding: false
  },
  chatMainTimeSpacer: {
    height: CHAT_TIME_SPACER_HEIGHT
  },
  // Hangs below the text box just enough that the visible line under the
  // last text line cuts the time in half (the timestamp placement rule).
  chatMainTimePinned: {
    bottom: -CHAT_TIME_PINNED_DROP,
    position: "absolute",
    right: 0
  },
  chatMainAudioContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minWidth: 218,
    overflow: "hidden",
    paddingBottom: 8,
    paddingHorizontal: 11,
    paddingTop: 9,
    position: "relative"
  },
  chatMainAudioHiddenPlayer: {
    height: 1,
    opacity: 0,
    position: "absolute",
    width: 1
  },
  chatMainAudioButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  chatMainAudioButtonMine: {
    backgroundColor: ROOM_COLORS.sentReplyBackground,
    borderColor: ROOM_COLORS.sentReplyBorder
  },
  chatMainAudioButtonDisabled: {
    opacity: 0.55
  },
  chatMainAudioBody: {
    flex: 1,
    gap: 6,
    minWidth: 0
  },
  chatMainAudioHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5
  },
  chatMainAudioTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onReceivedBubble,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 16
  },
  chatMainAudioTitleMine: {
    color: ROOM_COLORS.onSentBubble
  },
  chatMainAudioTrack: {
    backgroundColor: ROOM_COLORS.glassDim,
    borderRadius: radius.pill,
    height: 4,
    overflow: "hidden"
  },
  chatMainAudioTrackMine: {
    backgroundColor: ROOM_COLORS.sentReplyBorder
  },
  chatMainAudioProgress: {
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: "100%"
  },
  chatMainAudioProgressMine: {
    backgroundColor: ROOM_COLORS.onSentBubble
  },
  chatMainAudioFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10
  },
  chatMainAudioTime: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.timestamp,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 13
  },
  chatMainAudioTimeMine: {
    color: ROOM_COLORS.sentTimestamp
  },
  chatMainReplyWrap: {
    paddingHorizontal: 5,
    paddingTop: 5
  },
  chatMainReplyBlock: {
    alignSelf: "stretch",
    marginBottom: 0
  },
  chatMainMediaFrame: {
    alignSelf: "flex-start",
    borderRadius: 13,
    margin: 3,
    overflow: "hidden"
  },
  chatMainDishSystem: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginVertical: 6,
    maxWidth: "84%",
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  chatMainDishIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderRadius: radius.pill,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  chatMainDishText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.onSurface,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0
  },
  chatMainDishRating: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3
  },
  chatMainDishRatingText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.gold,
    fontSize: 11,
    lineHeight: 14
  },
  chatMainLoadEarlier: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1
  },
  chatMainLoadEarlierText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.coolOnContainer,
    fontSize: 12,
    lineHeight: 16
  },
  chatHistoryRetryOverlay: {
    left: 0,
    position: "absolute",
    right: 0,
    top: CHAT_HEADER_CLEARANCE,
    zIndex: 6
  },
  chatMainEmpty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    transform: [{ scaleY: -1 }]
  },
  chatMainEmptyText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center"
  },
  chatMainReplyPreview: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1
  },
  chatMainReplyPreviewText: {
    color: ROOM_COLORS.onSurface
  },
  chatMainMessageReplyLeft: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border
  },
  chatMainMessageReplyRight: {
    backgroundColor: ROOM_COLORS.sentReplyBackground,
    borderColor: ROOM_COLORS.sentReplyBorder
  },
  chatMainMessageReplyText: {
    color: ROOM_COLORS.onSurface
  },
  chatMainReactionPicker: {
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.border,
    borderWidth: 1
  },
  chatMainReaction: {
    backgroundColor: ROOM_COLORS.glass,
    borderColor: ROOM_COLORS.border
  },
  chatMainReactionActive: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.cool
  },
  chatMainReactionText: {
    color: ROOM_COLORS.onSurface
  },
  header: {
    alignSelf: "center",
    height: ROOM_HEADER_EXPANDED_HEIGHT,
    left: 0,
    maxWidth: ROOM_MAX_WIDTH,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
    zIndex: 20
  },
  headerCompactSurface: {
    backgroundColor: ROOM_COLORS.header,
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    height: ROOM_HEADER_COMPACT_HEIGHT,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%"
  },
  headerExpansionSurface: {
    backgroundColor: ROOM_COLORS.header,
    borderBottomColor: ROOM_COLORS.border,
    borderBottomWidth: 1,
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    height: ROOM_HEADER_COLLAPSE_DISTANCE,
    left: 0,
    position: "absolute",
    right: 0,
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    top: ROOM_HEADER_COMPACT_HEIGHT,
    width: "100%"
  },
  headerTop: {
    alignItems: "center",
    flexDirection: "row",
    height: ROOM_HEADER_CONTROL_SIZE,
    justifyContent: "space-between",
    left: ROOM_HEADER_HORIZONTAL_PADDING,
    minHeight: ROOM_HEADER_CONTROL_SIZE,
    position: "absolute",
    right: ROOM_HEADER_HORIZONTAL_PADDING,
    top: spacing.sm,
    zIndex: 4
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    marginRight: -4
  },
  headerIconButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: radius.pill,
    height: ROOM_HEADER_CONTROL_SIZE,
    justifyContent: "center",
    width: ROOM_HEADER_CONTROL_SIZE
  },
  headerBackButton: {
    marginLeft: -8
  },
  headerAddFriendSlot: {
    height: ROOM_HEADER_CONTROL_SIZE,
    marginRight: spacing.sm,
    overflow: "hidden",
    width: ROOM_HEADER_CONTROL_SIZE
  },
  headerTopTitleSpacer: {
    flex: 1,
    marginHorizontal: spacing.sm,
    minWidth: 0
  },
  compactRoomTitleWrap: {
    flex: 1,
    marginHorizontal: spacing.sm,
    minWidth: 0
  },
  movingRoomTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 20,
    left: ROOM_HEADER_EXPANDED_TITLE_LEFT,
    lineHeight: 27,
    minWidth: 0,
    position: "absolute",
    right: ROOM_HEADER_COMPACT_TITLE_RIGHT + ROOM_HEADER_TITLE_TRANSLATE_X,
    top: ROOM_HEADER_EXPANDED_TITLE_TOP,
    zIndex: 3
  },
  compactRoomTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    flexShrink: 1,
    fontSize: 19,
    lineHeight: 25,
    minWidth: 0
  },
  membersCompactTitle: {
    fontSize: 19,
    lineHeight: 25
  },
  headerDetailsClip: {
    height: ROOM_HEADER_DETAILS_HEIGHT,
    left: ROOM_HEADER_HORIZONTAL_PADDING + ROOM_HEADER_CONTENT_INSET,
    overflow: "hidden",
    position: "absolute",
    right: ROOM_HEADER_HORIZONTAL_PADDING + ROOM_HEADER_CONTENT_INSET,
    top: ROOM_HEADER_DETAILS_TOP,
    zIndex: 3
  },
  headerDetails: {
    gap: ROOM_HEADER_SECTION_GAP
  },
  headerTabsPosition: {
    left: ROOM_HEADER_HORIZONTAL_PADDING,
    position: "absolute",
    right: ROOM_HEADER_HORIZONTAL_PADDING,
    top: ROOM_HEADER_TABS_TOP,
    zIndex: 3
  },
  roomMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.base,
    justifyContent: "flex-start",
    minWidth: 0
  },
  roomMetaGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0
  },
  roomMetaIconSlot: {
    alignItems: "center",
    justifyContent: "center",
    width: 16
  },
  roomMetaText: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  roomMetaDateText: {
    flexShrink: 1,
    minWidth: 0
  },
  roomFriendsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 0,
    minHeight: 30,
    minWidth: 0
  },
  roomFriendAvatars: {
    alignItems: "center",
    flexDirection: "row"
  },
  roomFriendAvatar: {
    alignItems: "center",
    borderColor: ROOM_COLORS.header,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  roomFriendAvatarOverlap: {
    marginLeft: -8
  },
  roomFriendMoreAvatar: {
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.coolBorder
  },
  roomFriendInitial: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 10,
    lineHeight: 13
  },
  roomFriendsText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0
  },
  modeTabsAnimated: {
    marginTop: ROOM_HEADER_SECTION_GAP,
    overflow: "hidden"
  },
  modeTabs: {
    backgroundColor: ROOM_COLORS.panel,
    borderRadius: radius.input,
    flexDirection: "row",
    marginHorizontal: ROOM_HEADER_CONTENT_INSET,
    overflow: "hidden",
    padding: MODE_TABS_PADDING,
    position: "relative"
  },
  modeTabIndicator: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.cool,
    borderRadius: radius.md,
    borderWidth: 1,
    bottom: MODE_TABS_PADDING,
    left: 0,
    position: "absolute",
    top: MODE_TABS_PADDING
  },
  modeButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    minHeight: 34,
    position: "relative",
    zIndex: 1
  },
  modeButtonActive: {
    backgroundColor: "transparent",
    borderColor: "transparent"
  },
  modeButtonPressed: {
    opacity: 0.55
  },
  modeButtonText: {
    ...fontStyles.extraBold,
    // Unselected colour only. The selected tint is applied by ModeButton's
    // animated style, which is composed after this one, so selection lands on
    // the UI thread with the indicator instead of on the React commit.
    color: ROOM_COLORS.muted,
    fontSize: 10,
    lineHeight: 13
  },
  modeButtonUnreadBadge: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderColor: ROOM_COLORS.panel,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 16,
    justifyContent: "center",
    marginLeft: 1,
    minWidth: 16,
    paddingHorizontal: 4
  },
  modeButtonUnreadText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onCool,
    fontSize: 8,
    lineHeight: 10
  },
  body: {
    alignSelf: "center",
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    flex: 1,
    maxWidth: ROOM_MAX_WIDTH,
    position: "relative",
    width: "100%",
    zIndex: 1
  },
  roomPager: {
    flex: 1,
    position: "relative"
  },
  roomPagerPage: {
    ...StyleSheet.absoluteFillObject,
    flex: 1
  },
  roomPagerPageActive: {
    opacity: 1,
    zIndex: 1
  },
  roomPagerPageInactive: {
    // display:none, not just opacity:0. A hidden-by-opacity pane still takes
    // part in layout and drawing, so every tab switch re-composited the whole
    // retained Chat subtree — measured 37.8% janky frames with ~29 rows mounted
    // against 5.4% with the chat content removed entirely, and 18.8% with this.
    // The pane stays MOUNTED either way, so retention and scroll position are
    // unaffected (verified on device across a tab round trip).
    display: "none",
    opacity: 0,
    zIndex: 0
  },
  chatBottomOverlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 6
  },
  floatingAddBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    zIndex: 30
  },
  floatingAddBackdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.scrimSoft
  },
  addMenuStack: {
    alignItems: "flex-end",
    gap: spacing.sm,
    position: "absolute",
    zIndex: 32
  },
  addMenuAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    minHeight: FLOATING_ADD_ACTION_ICON_SIZE
  },
  addMenuActionPressed: {
    opacity: 0.68
  },
  addMenuActionLabel: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.xs
  },
  addMenuActionText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 13,
    lineHeight: 17
  },
  addMenuActionIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: FLOATING_ADD_ACTION_ICON_SIZE,
    justifyContent: "center",
    width: FLOATING_ADD_ACTION_ICON_SIZE
  },
  addMenuActionGlyph: {
    height: 21,
    lineHeight: 21,
    textAlign: "center",
    width: 21
  },
  floatingAddButtonFrame: {
    position: "absolute",
    zIndex: 31
  },
  floatingAddButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    borderWidth: 0,
    height: FLOATING_ADD_BUTTON_SIZE,
    justifyContent: "center",
    width: FLOATING_ADD_BUTTON_SIZE,
    overflow: "hidden"
  },
  floatingAddIconWrap: {
    alignItems: "center",
    height: FLOATING_ADD_ICON_SIZE,
    justifyContent: "center",
    width: FLOATING_ADD_ICON_SIZE
  },
  floatingAddIcon: {
    height: FLOATING_ADD_ICON_SIZE,
    lineHeight: FLOATING_ADD_ICON_SIZE,
    textAlign: "center",
    width: FLOATING_ADD_ICON_SIZE
  },
  chatTimelineWrap: {
    backgroundColor: "transparent",
    flex: 1,
    overflow: "hidden"
  },
  chatTimelineHidden: {
    opacity: 0
  },
  // Icon-only and horizontally centred. `alignSelf` is what centres an
  // absolutely positioned child here, so it must NOT be paired with `right` —
  // an edge offset wins and pins the button back to the corner.
  chatLatestButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    position: "absolute",
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    width: 36,
    zIndex: 5
  },
  chatWallpaper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.wallpaperBg
  },
  chatWallpaperOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent"
  },
  timelineList: {
    backgroundColor: "transparent",
    flex: 1
  },
  timelineContent: {
    backgroundColor: "transparent",
    flexGrow: 1,
    gap: 0,
    // Inverted list: the container is flipped, so flex-start packs content to the
    // visual bottom (above the composer) and paddingBottom guards the visual top
    // (under the floating header). The composer clearance is applied inline as
    // paddingTop (the inline complement of this flip).
    justifyContent: "flex-start",
    paddingBottom: CHAT_HEADER_CLEARANCE
  },
  invertedListEdge: {
    // Counter-flip header/footer/empty content (inverted lists flip these upside down).
    transform: [{ scaleY: -1 }]
  },
  timelineContentEmpty: {
    flexGrow: 1
  },
  timelineHistoryStatus: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingVertical: 12
  },
  timelineHistoryText: {
    ...fontStyles.bold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center"
  },
  typingIndicatorRow: {
    alignItems: "flex-start",
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingVertical: 7,
    width: "100%"
  },
  typingIndicatorBubble: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderColor: ROOM_COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  typingDots: {
    flexDirection: "row",
    gap: 3
  },
  typingDot: {
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: 5,
    opacity: 0.82,
    width: 5
  },
  typingIndicatorText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14
  },
  dateDividerRow: {
    alignItems: "center",
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingVertical: 8,
    width: "100%"
  },
  dateDividerText: {
    ...fontStyles.extraBold,
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: ROOM_COLORS.muted,
    fontSize: 10,
    lineHeight: 12,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
    textTransform: "uppercase"
  },
  unreadDividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingBottom: 11,
    paddingTop: 5,
    width: "100%"
  },
  unreadDividerLine: {
    backgroundColor: ROOM_COLORS.coolBorder,
    flex: 1,
    height: 1
  },
  unreadDividerText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 13,
    lineHeight: 17
  },
  unreadDividerButton: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  unreadDividerButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 10,
    lineHeight: 12
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.input,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 8
  },
  quickActionText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14
  },
  emptyActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.base,
    width: "100%"
  },
  chatMessageRow: {
    alignItems: "flex-end",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    width: "100%"
  },
  chatMessageRowMedia: {
    alignItems: "flex-end"
  },
  // A dish card is returned before the vendor's Message wrapper, so it never
  // picks up that wrapper's 8dp side margin (container_left/container_right in
  // vendor/reactNativeChat/Message/styles.ts) the way every text and media
  // bubble does. Zeroing the row padding as well left the card flush with the
  // row container — measured on device at 34px from the screen edge against
  // 55px for a text bubble — so it visibly overhung every neighbour. Match the
  // vendor's inset rather than chatMessageRow's wider CHAT_ROW_SIDE_PADDING.
  chatMainDishPollRow: {
    marginBottom: 10,
    paddingHorizontal: CHAT_VENDOR_BUBBLE_SIDE_MARGIN
  },
  chatMessageRowAfterBreak: {
    marginTop: 0
  },
  chatMessageRowGroupStart: {
    marginTop: 7
  },
  chatMessageRowGrouped: {
    marginTop: 2
  },
  chatMessageRowMine: {
    justifyContent: "flex-end"
  },
  chatMessageRowReplyHighlight: {
    backgroundColor: ROOM_COLORS.selection,
    borderRadius: 0
  },
  chatMessageRowSelected: {
    backgroundColor: ROOM_COLORS.selection,
    borderRadius: 0
  },
  chatMessageRowEditing: {
    backgroundColor: ROOM_COLORS.goldDim,
    borderLeftColor: ROOM_COLORS.gold,
    borderLeftWidth: 3,
    paddingVertical: 3
  },
  swipeReplyWrap: {
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  swipeReplyContent: {
    width: "100%"
  },
  swipeReplyAction: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    paddingLeft: CHAT_ROW_SIDE_PADDING,
    position: "absolute",
    top: 0,
    width: REPLY_SWIPE_MAX_TRANSLATE
  },
  swipeReplyIndicator: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1,
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    width: 32
  },
  messageBubbleFrame: {
    flexShrink: 1,
    position: "relative"
  },
  messageBubbleStack: {
    alignItems: "flex-start",
    flexShrink: 1,
    gap: 4
  },
  messageBubbleStackMine: {
    alignItems: "flex-end"
  },
  messageStatusStack: {
    alignItems: "flex-start",
    flexShrink: 1,
    gap: CHAT_GROUPED_MESSAGE_GAP
  },
  messageStatusStackMine: {
    alignItems: "flex-end"
  },
  failedMessageActions: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.danger,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginHorizontal: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5
  },
  failedMessageActionsMine: {
    alignSelf: "flex-end"
  },
  failedMessageText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.danger,
    fontSize: 11,
    lineHeight: 14
  },
  failedMessageButton: {
    borderRadius: radius.pill,
    paddingHorizontal: 3,
    paddingVertical: 1
  },
  failedMessageButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 11,
    lineHeight: 14
  },
  textMessageFrame: {
    maxWidth: Platform.OS === "web" ? "68%" : "73%"
  },
  textMessageBubble: {
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderColor: ROOM_COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: "100%",
    overflow: "hidden",
    paddingBottom: 6,
    paddingHorizontal: 11,
    paddingTop: 7,
    position: "relative",
    zIndex: 1
  },
  textMessageBubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: ROOM_COLORS.sentBubble,
    borderColor: ROOM_COLORS.sentBubbleBorder,
    minWidth: 64
  },
  textMessageBubbleOther: {
    alignSelf: "flex-start",
    minWidth: 88
  },
  messageMetaRow: {
    alignItems: "center",
    alignSelf: "flex-end",
    flexDirection: "row",
    gap: 4,
    marginTop: 4
  },
  messageMetaRowMine: {
    alignSelf: "flex-end"
  },
  messageMetaTime: {
    ...fontStyles.semiBold,
    fontSize: 10,
    includeFontPadding: false,
    lineHeight: 12
  },
  messageMetaTimeMine: {
    color: ROOM_COLORS.sentTimestamp
  },
  messageMetaTimeOther: {
    color: ROOM_COLORS.timestamp
  },
  messageLinkText: {
    color: ROOM_COLORS.cool,
    textDecorationLine: "underline"
  },
  messageLinkTextMine: {
    color: ROOM_COLORS.white,
    textDecorationLine: "underline"
  },
  streamingCursor: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.coolOnContainer,
    fontSize: 16,
    includeFontPadding: false,
    lineHeight: 20
  },
  dishTimelineFrame: {
    maxWidth: Platform.OS === "web" ? "74%" : "78%"
  },
  dishTimelineBubble: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    maxWidth: "100%",
    overflow: "hidden",
    // Bottom padding matches the text bubble (paddingBottom: 6) so the gap under
    // the pinned timestamp is identical in both; top stays roomier for content.
    paddingBottom: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
    position: "relative",
    zIndex: 1
  },
  dishTimelineBubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: ROOM_COLORS.sentBubble,
    borderColor: ROOM_COLORS.sentBubbleBorder,
    minWidth: 230
  },
  dishTimelineBubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderColor: ROOM_COLORS.border,
    minWidth: 240
  },
  dishTimelineName: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 15,
    lineHeight: 19
  },
  dishTimelineNote: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  dishTimelineNoteMine: {
    color: ROOM_COLORS.sentReplyText
  },
  dishTimelineStarsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginTop: 2
  },
  dishTimelineStars: {
    flexDirection: "row",
    gap: 2
  },
  dishTimelineStarButton: {
    paddingVertical: 2
  },
  dishTimelineVoteHint: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14
  },
  dishTimelineFooter: {
    alignSelf: "stretch",
    borderTopColor: ROOM_COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
    paddingTop: 7
  },
  dishTimelineRatersText: {
    ...fontStyles.regular,
    color: ROOM_COLORS.onSurface,
    flexShrink: 1,
    fontSize: 12,
    // Tall line box (matching a text-message body line) so the bottom-pinned
    // timestamp drops below the label baseline exactly like a text bubble,
    // instead of sitting level with the label on a short line.
    lineHeight: 22,
    minWidth: 0
  },
  dishTimelineRatersTextMine: {
    color: ROOM_COLORS.onSentBubble
  },
  messageBubbleGroupedMine: {
    borderTopRightRadius: 7
  },
  messageBubbleGroupedOther: {
    borderTopLeftRadius: 7
  },
  singleMediaMessageCard: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    padding: 0,
    position: "relative",
    zIndex: 1
  },
  multiMediaMessageCard: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    padding: 0,
    position: "relative",
    zIndex: 1
  },
  mediaMessageCardMine: {
    backgroundColor: ROOM_COLORS.sentBubble,
    borderColor: ROOM_COLORS.sentBubbleBorder
  },
  mediaMessageCardOther: {
    backgroundColor: ROOM_COLORS.receivedBubble,
    borderColor: ROOM_COLORS.border
  },
  messageMediaCardFill: {
    width: "100%"
  },
  replyPreviewBlock: {
    alignSelf: "flex-start",
    backgroundColor: ROOM_COLORS.coolDim,
    borderLeftColor: ROOM_COLORS.cool,
    borderLeftWidth: 3,
    borderRadius: 9,
    marginBottom: 7,
    maxWidth: "100%",
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  replyPreviewBlockMine: {
    backgroundColor: ROOM_COLORS.sentReplyBackground,
    borderLeftColor: ROOM_COLORS.sentReplyBorder
  },
  replyPreviewBlockPressed: {
    opacity: 0.72
  },
  replyPreviewAuthor: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 11,
    lineHeight: 14
  },
  replyPreviewAuthorMine: {
    color: ROOM_COLORS.onSentBubble
  },
  replyPreviewText: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  replyPreviewTextMine: {
    color: ROOM_COLORS.sentReplyText
  },
  reactionPillRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    maxWidth: Platform.OS === "web" ? 320 : 280,
    paddingHorizontal: 4
  },
  reactionPillRowMine: {
    justifyContent: "flex-end"
  },
  reactionPill: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
    minHeight: 25,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  reactionPillActive: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder
  },
  reactionPillEmoji: {
    fontSize: 13,
    lineHeight: 16
  },
  reactionPillCount: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.muted,
    fontSize: 10,
    lineHeight: 12
  },
  reactionPicker: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    padding: 4,
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 16
  },
  reactionPickerMine: {
    alignSelf: "flex-end"
  },
  reactionPickerButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  reactionPickerEmoji: {
    fontSize: 18,
    lineHeight: 22
  },
  reactionPickerMore: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.glassDim,
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  reactionPickerClose: {
    alignItems: "center",
    height: 26,
    justifyContent: "center",
    width: 24
  },
  senderAvatar: {
    alignItems: "center",
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: CHAT_AVATAR_SIZE,
    justifyContent: "center",
    width: CHAT_AVATAR_SIZE
  },
  senderAvatarSlot: {
    alignSelf: "flex-start",
    flexShrink: 0,
    height: CHAT_AVATAR_SIZE,
    width: CHAT_AVATAR_SIZE
  },
  senderInitial: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 10,
    lineHeight: 12
  },
  senderName: {
    ...fontStyles.extraBold,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 15,
    marginBottom: 4,
    maxWidth: "100%"
  },
  mediaSenderHeader: {
    backgroundColor: ROOM_COLORS.receivedBubble,
    paddingBottom: 7,
    paddingHorizontal: 12,
    paddingTop: 10,
    width: "100%"
  },
  mediaSenderName: {
    marginBottom: 0
  },
  mediaReplyHeader: {
    paddingBottom: 3,
    paddingHorizontal: 12,
    paddingTop: 9,
    width: "100%"
  },
  inlineTimestampWrap: {
    alignSelf: "flex-start",
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    position: "relative"
  },
  inlineTimestampWrapFill: {
    alignSelf: "stretch",
    width: "100%"
  },
  inlineTimestampMessageText: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    flexShrink: 1,
    flexWrap: "wrap",
    includeFontPadding: false,
    minWidth: 0
  },
  inlineTimestampText: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.timestamp,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 13
  },
  inlineTimestampMine: {
    color: ROOM_COLORS.sentTimestamp
  },
  inlineTimestampOther: {
    color: ROOM_COLORS.timestamp
  },
  inlineTimestampReserve: {
    height: 5
  },
  inlineTimestampPinnedMeta: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    position: "absolute",
    right: 0
  },
  // No maxWidth: "100%" here — inside content-sized bubbles that percentage
  // is circular (parent width derives from this text) and Yoga resolves it
  // inconsistently across layout passes. Text wraps against the available
  // width Yoga propagates from the capped message row.
  textOnlyBubbleText: {
    flexShrink: 1,
    flexWrap: "wrap",
    fontSize: 16,
    includeFontPadding: false,
    lineHeight: 22
  },
  messageTextMine: {
    color: ROOM_COLORS.onSentBubble
  },
  messageTextOther: {
    color: ROOM_COLORS.onReceivedBubble
  },
  singleMediaContainer: {
    alignSelf: "flex-start",
    borderRadius: 0,
    overflow: "hidden",
    position: "relative"
  },
  singleMediaFill: {
    aspectRatio: undefined,
    borderRadius: 0,
    height: "100%",
    width: "100%"
  },
  singleImageClipPassthrough: {
    borderRadius: 0,
    overflow: "visible"
  },
  mediaCaptionContainer: {
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 9,
    width: "100%"
  },
  // Like textOnlyBubbleText: no circular maxWidth percentage.
  mediaCaptionText: {
    flexShrink: 1,
    flexWrap: "wrap",
    fontSize: 14,
    includeFontPadding: false,
    lineHeight: 20,
    marginTop: 0
  },
  attachmentGridFrame: {
    alignSelf: "flex-start",
    minWidth: 0,
    overflow: "hidden",
    position: "relative"
  },
  multiMediaGrid: {
    flexDirection: "row",
    gap: MEDIA_GRID_GAP,
    overflow: "hidden",
    position: "relative"
  },
  multiMediaGridWrap: {
    flexWrap: "wrap"
  },
  mediaGridStack: {
    gap: MEDIA_GRID_GAP
  },
  mediaGridTile: {
    backgroundColor: ROOM_COLORS.mediaPanel,
    position: "relative",
    overflow: "hidden"
  },
  gridMediaFill: {
    ...StyleSheet.absoluteFillObject,
    height: "100%",
    width: "100%"
  },
  gridVideoPreview: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.mediaPanel,
    height: "100%",
    overflow: "hidden",
    width: "100%"
  },
  audioMediaPreview: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.mediaPanel,
    gap: 7,
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 12,
    width: "100%"
  },
  audioMediaPreviewCompact: {
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  audioMediaIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  audioMediaIconCompact: {
    height: 34,
    width: 34
  },
  audioMediaTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 13,
    lineHeight: 16
  },
  audioMediaTitleCompact: {
    fontSize: 11,
    lineHeight: 14
  },
  audioMediaDuration: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14
  },
  videoThumbnailLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.mediaPanel,
    height: "100%",
    overflow: "hidden",
    width: "100%"
  },
  videoThumbnailImage: {
    ...StyleSheet.absoluteFillObject,
    height: "100%",
    width: "100%"
  },
  videoThumbnailScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.scrimSoft
  },
  gridVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  gridPlayBadge: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.glass,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  gridMediaTypeBadge: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.scrim,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 4,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    position: "absolute",
    top: 8
  },
  mediaTimestampOverlay: {
    backgroundColor: ROOM_COLORS.scrimMedium,
    borderRadius: 10,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: "absolute",
    zIndex: 3
  },
  mediaTimestampOverlayLeft: {
    left: 8
  },
  mediaTimestampOverlayRight: {
    right: 8
  },
  mediaTimestampText: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.mediaTimestamp,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 13
  },
  attachmentMoreOverlay: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.scrim,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  attachmentMoreText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 18,
    lineHeight: 23
  },
  mediaMessageContent: {
    borderRadius: 0,
    overflow: "hidden"
  },
  mediaImageWrap: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  mediaImage: {
    height: "100%",
    width: "100%"
  },
  mediaFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 0,
    height: undefined,
    width: undefined
  },
  mediaPreviewFlush: {
    borderRadius: 0
  },
  videoPreview: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.black,
    borderRadius: radius.md,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  mediaPendingOverlay: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.scrimMedium,
    bottom: 0,
    gap: 6,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  uploadProgressCircle: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  uploadProgressText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 10,
    includeFontPadding: false,
    lineHeight: 12,
    position: "absolute",
    textAlign: "center"
  },
  mediaPendingText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 11,
    lineHeight: 14
  },
  mediaTypeBadge: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.scrim,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 4,
    left: 9,
    paddingHorizontal: 8,
    paddingVertical: 5,
    position: "absolute",
    top: 9
  },
  mediaTypeBadgeText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 10,
    lineHeight: 12
  },
  playBadge: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.glass,
    borderRadius: radius.pill,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  attachOverlay: {
    // Full-screen in-tree overlay (replaces the RN Modal). Sits above the
    // speed-dial scrim (zIndex 6) and its action stack (zIndex 7).
    ...StyleSheet.absoluteFillObject,
    zIndex: 20
  },
  attachSheetKeyboard: {
    // Bottom-anchored. Resting bottom padding is applied statically by
    // KeyboardAwareSheetSurface; the keyboard lift is a transform on the sheet
    // itself, never layout. The dim is the attachSheetBackdrop below, faded
    // in/out with the sheet's slide.
    flex: 1,
    justifyContent: "flex-end"
  },
  attachSheetNativeKeyboardInset: {
    alignSelf: "stretch"
  },
  attachSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.scrim
  },
  attachSheet: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: spacing.md,
    maxWidth: ROOM_MAX_WIDTH,
    paddingHorizontal: spacing.base,
    // Fixed, symmetric vertical padding in every state (not tied to the
    // home-indicator inset). paddingBottom here also sets the button-to-edge gap.
    paddingBottom: spacing.base,
    paddingTop: spacing.md,
    width: "100%"
  },
  attachSheetHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  attachSheetHeaderButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  attachSheetHeaderBack: {
    // Pull the icon to the left edge so it lines up with the content below.
    alignItems: "flex-start"
  },
  attachSheetHeaderClose: {
    // Pull the X to the right edge so it lines up with the line ends below.
    alignItems: "flex-end"
  },
  attachSheetHeaderSpacer: {
    height: 32,
    width: 32
  },
  attachSheetHeaderText: {
    flex: 1,
    minWidth: 0
  },
  attachSheetTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center"
  },
  attachSheetSubtitle: {
    ...fontStyles.medium,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  attachActionGrid: {
    flexDirection: "row",
    gap: spacing.sm
  },
  attachActionCard: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    minHeight: 112,
    padding: spacing.md
  },
  attachActionCardDisabled: {
    opacity: 0.45
  },
  attachActionIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 42
  },
  attachActionIconDish: {
    backgroundColor: ROOM_COLORS.goldDim,
    borderColor: ROOM_COLORS.goldBorder
  },
  attachActionTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 14,
    lineHeight: 18
  },
  attachActionSubtitle: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3
  },
  attachSheetOptionList: {
    gap: spacing.sm
  },
  attachSheetOption: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.md
  },
  attachSheetIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  deleteSheetIcon: {
    backgroundColor: ROOM_COLORS.dangerDim,
    borderColor: ROOM_COLORS.dangerBorder,
    borderWidth: 1
  },
  attachSheetOptionText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 14,
    lineHeight: 18
  },
  attachSheetOptionCopy: {
    flex: 1,
    minWidth: 0
  },
  attachSheetOptionSubtext: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2
  },
  deleteSheetText: {
    color: ROOM_COLORS.danger
  },
  attachDishForm: {
    // Fixed gap above the Add dish button; matches the sheet's paddingBottom
    // below it so the button is symmetric top/bottom in every state.
    gap: spacing.base
  },
  attachDishCard: {
    // No box — name, note and rating are just stacked and split by lines.
    gap: spacing.md
  },
  attachDishDivider: {
    backgroundColor: ROOM_COLORS.border,
    height: 1
  },
  attachDishNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  attachDishNameInput: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 15,
    includeFontPadding: false,
    lineHeight: 20,
    minHeight: 24,
    padding: 0,
    paddingVertical: Platform.OS === "web" ? 4 : 0
  },
  attachDishIconSlot: {
    alignItems: "center",
    width: 22
  },
  attachDishNoteRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64
  },
  attachDishNoteIcon: {
    marginTop: 2
  },
  attachDishInput: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    minWidth: 0,
    padding: 0,
    paddingVertical: Platform.OS === "web" ? 8 : 0
  },
  attachDishNoteInput: {
    minHeight: 56,
    paddingTop: 0
  },
  attachDishRatingRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  attachDishRatingLabel: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14
  },
  attachDishStars: {
    flexDirection: "row",
    gap: 5
  },
  attachDishStarButton: {
    padding: 2
  },
  attachDishSubmit: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  attachDishSubmitDisabled: {
    opacity: 0.45
  },
  attachDishSubmitText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onCool,
    fontSize: 14,
    lineHeight: 18
  },
  roomActionsBackdrop: {
    backgroundColor: ROOM_COLORS.scrim,
    flex: 1
  },
  roomActionsPopover: {
    alignSelf: "flex-end",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.input,
    borderWidth: 1,
    marginRight: Platform.OS === "web" ? spacing.lg : spacing.md,
    marginTop: Platform.OS === "web" ? 58 : 54,
    padding: 4,
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    width: 150,
    elevation: 10
  },
  roomActionOption: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  roomActionDisabled: {
    opacity: 0.55
  },
  roomActionIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  roomActionIconCool: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1
  },
  roomActionIconDanger: {
    backgroundColor: ROOM_COLORS.dangerDim,
    borderColor: ROOM_COLORS.dangerBorder,
    borderWidth: 1
  },
  roomActionText: {
    flex: 1,
    minWidth: 0
  },
  roomActionTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 12,
    lineHeight: 16
  },
  roomActionDangerText: {
    color: ROOM_COLORS.danger
  },
  selectionMessageBox: {
    alignItems: "center",
    gap: spacing.sm
  },
  selectionInlineButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.glassDim,
    borderRadius: radius.pill,
    height: SELECTION_INLINE_BUTTON_SIZE,
    justifyContent: "center",
    width: SELECTION_INLINE_BUTTON_SIZE
  },
  selectionBarTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    minWidth: 0,
    textAlign: "left"
  },
  selectionDeleteButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.danger,
    borderRadius: radius.pill,
    height: COMPOSER_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: COMPOSER_ACTION_BUTTON_SIZE
  },
  selectionEditButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: COMPOSER_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: COMPOSER_ACTION_BUTTON_SIZE
  },
  // Neutral so the accent stays on Edit and the danger colour stays unique to
  // Delete: four filled buttons in a row would read as four equal warnings.
  selectionActionButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: COMPOSER_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: COMPOSER_ACTION_BUTTON_SIZE
  },
  selectionDeleteButtonDisabled: {
    opacity: 0.5
  },
  viewerBackdrop: {
    backgroundColor: ROOM_COLORS.black,
    flex: 1
  },
  viewerClose: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.48)",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: spacing.lg,
    zIndex: 2,
    width: 40
  },
  viewerBody: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  viewerCarousel: {
    flex: 1,
    width: "100%"
  },
  viewerSlide: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  viewerImage: {
    height: "100%",
    width: "100%"
  },
  viewerVideo: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    width: "100%"
  },
  viewerAudio: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    width: "100%"
  },
  viewerAudioPlayButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: 72,
    justifyContent: "center",
    width: 72
  },
  viewerAudioTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 18,
    lineHeight: 24
  },
  viewerAudioTrack: {
    backgroundColor: ROOM_COLORS.scrimMedium,
    borderRadius: radius.pill,
    height: 5,
    maxWidth: 360,
    overflow: "hidden",
    width: "82%"
  },
  viewerAudioProgress: {
    backgroundColor: ROOM_COLORS.white,
    borderRadius: radius.pill,
    height: "100%"
  },
  viewerAudioTime: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.white,
    fontSize: 13,
    lineHeight: 17
  },
  viewerVideoPlayer: {
    height: "100%",
    width: "100%"
  },
  viewerFooter: {
    alignItems: "center",
    bottom: 0,
    gap: spacing.sm,
    left: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    position: "absolute",
    right: 0,
    zIndex: 2
  },
  viewerCount: {
    ...fontStyles.extraBold,
    backgroundColor: "rgba(0, 0, 0, 0.52)",
    borderRadius: radius.pill,
    color: ROOM_COLORS.white,
    fontSize: 12,
    lineHeight: 16,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    textAlign: "center"
  },
  viewerThumbnailScroller: {
    maxHeight: 58,
    width: "100%"
  },
  viewerThumbnails: {
    gap: spacing.sm,
    justifyContent: "center",
    minWidth: "100%",
    paddingHorizontal: 2
  },
  viewerThumbnail: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: 10,
    borderWidth: 1,
    height: 54,
    overflow: "hidden",
    width: 54
  },
  viewerThumbnailActive: {
    borderColor: ROOM_COLORS.cool,
    borderWidth: 2
  },
  viewerThumbnailImage: {
    height: "100%",
    width: "100%"
  },
  viewerThumbnailAudio: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    height: "100%",
    justifyContent: "center",
    width: "100%"
  },
  viewerThumbnailVideo: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.black,
    height: "100%",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  galleryList: {
    flex: 1
  },
  galleryContent: {
    paddingTop: CHAT_HEADER_CLEARANCE,
    paddingBottom: spacing.xl + 92
  },
  galleryContentEmpty: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  galleryContentFilled: {
    gap: 0,
    paddingHorizontal: 0,
    paddingTop: MEDIA_GALLERY_TOP_CLEARANCE
  },
  galleryFooterStatus: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md
  },
  galleryRow: {
    gap: 0
  },
  panelContent: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: CHAT_HEADER_CLEARANCE,
    paddingBottom: spacing.xl + 92
  },
  dishesList: {
    flex: 1
  },
  itineraryContent: {
    gap: 10,
    padding: spacing.lg,
    paddingTop: TABLE_HEADER_CLEARANCE,
    paddingBottom: spacing.xl + 92
  },
  itineraryEmptyContent: {
    flex: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  tablePostActionRow: {
    alignItems: "flex-end"
  },
  tablePostButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.base
  },
  tablePostButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onCool,
    fontSize: 13,
    lineHeight: 16
  },
  itineraryHeading: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 2,
    textTransform: "uppercase"
  },
  stopCard: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.base
  },
  stopTimelineRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.sm
  },
  stopTimelineRail: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: 32
  },
  stopTimelineConnectorTop: {
    backgroundColor: ROOM_COLORS.coolBorder,
    bottom: "50%",
    left: 15,
    position: "absolute",
    top: -spacing.sm,
    width: 2
  },
  stopTimelineConnectorBottom: {
    backgroundColor: ROOM_COLORS.coolBorder,
    bottom: -spacing.sm,
    left: 15,
    position: "absolute",
    top: "50%",
    width: 2
  },
  stopTimelineMarker: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
    zIndex: 1
  },
  stopTimelineCard: {
    flex: 1,
    minWidth: 0
  },
  stopCardPressed: {
    opacity: 0.72
  },
  stopHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.s
  },
  stopOpenIcon: {
    flexShrink: 0
  },
  stopActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4
  },
  stopActionButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 8
  },
  stopActionButtonPressed: {
    opacity: 0.68
  },
  stopActionText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 11
  },
  stopActionDeleteText: {
    color: ROOM_COLORS.danger
  },
  stopActionsDismissArea: {
    minHeight: 92
  },
  stopHeaderText: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  stopName: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 15
  },
  stopLocation: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  peoplePanelContent: {
    gap: 0,
    paddingTop: MEMBERS_HEADER_CLEARANCE + spacing.lg
  },
  peoplePanelMotion: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.bg,
    zIndex: 20
  },
  peopleScreenHeader: {
    // Members header has only the title row, so balance the padding evenly
    // (8+14 -> 11+11) to vertically center "Members". Total height is
    // unchanged, so MEMBERS_HEADER_CLEARANCE stays valid.
    paddingBottom: 11,
    paddingTop: 11,
    zIndex: 1
  },
  peoplePanelScroll: {
    alignSelf: "center",
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    flex: 1,
    maxWidth: ROOM_MAX_WIDTH,
    width: "100%"
  },
  peopleToastLayer: {
    alignItems: "center",
    left: 0,
    paddingHorizontal: spacing.lg,
    position: "absolute",
    right: 0,
    zIndex: 4
  },
  peopleToast: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    maxWidth: ROOM_MAX_WIDTH - spacing.lg * 2,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    width: "100%"
  },
  peopleToastText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0,
    textAlign: "center"
  },
  peopleAddWrap: {
    gap: spacing.sm,
    marginBottom: 0
  },
  peopleAddRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  peopleAddInputWrap: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 46,
    paddingHorizontal: 13
  },
  peopleAddInput: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 13,
    includeFontPadding: false,
    minWidth: 0,
    padding: 0
  },
  peopleAddButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: 6,
    height: 46,
    justifyContent: "center",
    minWidth: 88,
    paddingHorizontal: 13
  },
  peopleAddButtonReady: {
    backgroundColor: ROOM_COLORS.cool,
    borderColor: ROOM_COLORS.glassDim
  },
  peopleAddButtonDisabled: {
    opacity: 0.45
  },
  peopleAddButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 13
  },
  peopleAddButtonTextReady: {
    color: ROOM_COLORS.onCool
  },
  peopleAddButtonTextIdle: {
    color: ROOM_COLORS.muted
  },
  peopleSuggestions: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden"
  },
  peopleSuggestionsScroll: {
    maxHeight: 244
  },
  peopleSuggestionState: {
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  peopleSuggestionMuted: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16
  },
  peopleSuggestionError: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.danger,
    fontSize: 12,
    lineHeight: 16
  },
  peopleSuggestionRow: {
    alignItems: "center",
    borderBottomColor: ROOM_COLORS.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  peopleSuggestionAvatar: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  peopleSuggestionInitial: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 12,
    lineHeight: 16
  },
  peopleSuggestionText: {
    flex: 1,
    minWidth: 0
  },
  peopleSuggestionName: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 14,
    lineHeight: 18
  },
  peopleSuggestionUsername: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1
  },
  selectedPeopleChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  selectedPeopleChip: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: spacing.md,
    paddingVertical: 7
  },
  selectedPeopleChipText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 12,
    lineHeight: 15
  },
  dishCard: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md
  },
  dishCardTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minWidth: 0
  },
  dishIcon: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  dishIconText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 13,
    lineHeight: 16
  },
  dishText: {
    flex: 1,
    minWidth: 0
  },
  dishName: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 15,
    lineHeight: 19
  },
  dishRatingPill: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.goldDim,
    borderColor: ROOM_COLORS.goldBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  dishRatingPillEmpty: {
    backgroundColor: ROOM_COLORS.glassDim,
    borderColor: ROOM_COLORS.border
  },
  dishRating: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.gold,
    fontSize: 12,
    lineHeight: 15
  },
  dishMeta: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  dishNote: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    fontSize: 13,
    lineHeight: 18,
    opacity: 0.9
  },
  dishRatingDetails: {
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md
  },
  dishRaters: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  dishRaterAvatarStack: {
    flexDirection: "row",
    flexShrink: 0,
    minWidth: 34
  },
  dishRaterAvatar: {
    alignItems: "center",
    borderColor: ROOM_COLORS.panelRaised,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  dishRaterAvatarOverlap: {
    marginLeft: -9
  },
  dishRaterAvatarMore: {
    backgroundColor: ROOM_COLORS.surfaceHigh
  },
  dishRaterInitial: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 9,
    lineHeight: 11
  },
  dishNoRatersIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.glassDim,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  dishRaterCopy: {
    flex: 1,
    minWidth: 0
  },
  dishRaterSummary: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 12,
    lineHeight: 15
  },
  dishRaterCount: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 1
  },
  dishYourRatingRow: {
    alignItems: "center",
    borderTopColor: ROOM_COLORS.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.sm
  },
  dishYourRatingLabel: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14
  },
  dishYourStars: {
    flexDirection: "row",
    gap: 5
  },
  dishYourStarButton: {
    padding: 2
  },
  dishYourStarButtonDisabled: {
    opacity: 0.45
  },
  dishSheet: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: spacing.md,
    maxWidth: ROOM_MAX_WIDTH,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    width: "100%"
  },
  dishSheetHandle: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.border,
    borderRadius: radius.pill,
    height: 4,
    width: 38
  },
  dishSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minWidth: 0
  },
  dishSheetTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 17,
    lineHeight: 21
  },
  dishSheetRateBlock: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  dishSheetRateLabel: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 15
  },
  dishSheetStars: {
    flexDirection: "row",
    gap: spacing.sm
  },
  dishSheetStarButton: {
    padding: 3
  },
  dishSheetSectionTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 13,
    lineHeight: 16
  },
  dishSheetEmpty: {
    ...fontStyles.medium,
    color: ROOM_COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    paddingBottom: spacing.sm
  },
  dishSheetRaterScroll: {
    maxHeight: 240
  },
  dishSheetRaterList: {
    gap: spacing.sm
  },
  dishSheetRaterRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0
  },
  dishSheetRaterAvatar: {
    borderColor: ROOM_COLORS.panel
  },
  dishSheetRaterName: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 13,
    lineHeight: 16,
    minWidth: 0
  },
  dishSheetRaterStars: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 2
  },
  dishSheetRaterValue: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.gold,
    fontSize: 12,
    lineHeight: 15,
    marginLeft: 4
  },
  personRow: {
    alignItems: "center",
    borderBottomColor: ROOM_COLORS.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 76,
    paddingHorizontal: 2,
    paddingVertical: 0
  },
  personList: {
    borderTopColor: ROOM_COLORS.border,
    borderTopWidth: 1,
    marginTop: spacing.lg
  },
  personProfilePress: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 75,
    minWidth: 0
  },
  personAvatar: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  personInitial: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 12,
    lineHeight: 15
  },
  personText: {
    flex: 1,
    minWidth: 0
  },
  personName: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 15,
    lineHeight: 19
  },
  personMeta: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  personRequestButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 30,
    minWidth: 76,
    paddingHorizontal: 10
  },
  personRequestButtonMuted: {
    opacity: 0.72
  },
  personRequestButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 11,
    lineHeight: 14
  },
  galleryItem: {
    paddingVertical: MEDIA_GALLERY_HALF_GAP,
    width: "50%"
  },
  galleryItemLeft: {
    paddingRight: MEDIA_GALLERY_HALF_GAP
  },
  galleryItemRight: {
    paddingLeft: MEDIA_GALLERY_HALF_GAP
  },
  galleryMediaButton: {
    borderRadius: 0,
    overflow: "hidden"
  },
  galleryMediaPreview: {
    aspectRatio: 1,
    borderRadius: 0,
    width: "100%"
  },
  emptyChatOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyChat: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl
  },
  emptyPanel: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl
  },
  itineraryEmptyPanel: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderRadius: radius.pill,
    height: 58,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: 58
  },
  emptyTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 18,
    lineHeight: 23,
    textAlign: "center"
  },
  emptyText: {
    ...fontStyles.regular,
    color: ROOM_COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: "center"
  },
  composerWrap: {
    alignSelf: "center",
    backgroundColor: "transparent",
    borderTopColor: ROOM_COLORS.border,
    borderTopWidth: 0,
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    maxWidth: ROOM_MAX_WIDTH,
    paddingHorizontal: Platform.OS === "web" ? spacing.md : spacing.lg,
    width: "100%"
  },
  composerContent: {
    gap: 6,
    paddingTop: COMPOSER_TOP_GAP,
    position: "relative"
  },
  composer: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.sm
  },
  editingBanner: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  editingBannerText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 12,
    lineHeight: 15
  },
  editingCancelText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 12,
    lineHeight: 15
  },
  replyComposerBanner: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderTopColor: ROOM_COLORS.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginHorizontal: -2,
    minHeight: 54,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  replyComposerAccent: {
    alignSelf: "stretch",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    width: 3
  },
  replyComposerIcon: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  replyComposerCopy: {
    flex: 1,
    minWidth: 0
  },
  replyComposerLabel: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 12,
    lineHeight: 15
  },
  replyComposerPreview: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  replyComposerClose: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.glassDim,
    borderRadius: radius.pill,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  messageBox: {
    alignItems: "flex-end",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    minHeight: COMPOSER_MESSAGE_BOX_MIN_HEIGHT,
    paddingHorizontal: Platform.OS === "web" ? 12 : 13,
    paddingVertical: Platform.OS === "web" ? 2 : 3
  },
  composerInput: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: COMPOSER_INPUT_FONT_SIZE,
    includeFontPadding: false,
    lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    paddingHorizontal: 2,
    textAlignVertical: "top"
  },
  composerInputNative: {
    paddingBottom: 6,
    paddingTop: 6
  },
  composerInputWeb: {
    paddingBottom: 6,
    paddingTop: 6
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: COMPOSER_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: COMPOSER_ACTION_BUTTON_SIZE
  },
  sendButtonDisabled: {
    opacity: 0.45
  },
  error: {
    ...fontStyles.regular,
    color: ROOM_COLORS.danger,
    fontSize: 12,
    lineHeight: 17
  }
});
}

let styles = createStyles(ROOM_COLORS);
const ROOM_THEME_CACHE = new Map<string, { colors: RoomColors; styles: ReturnType<typeof createStyles> }>();

registerSensitiveResourceCleanup(async () => {
  const thumbnailUris = Array.from(videoThumbnailCache.values(), (thumbnail) => thumbnail.uri);
  videoThumbnailCache.clear();
  videoThumbnailSourceCache.clear();
  videoThumbnailPending.clear();
  prefetchedMemoryMediaKeys.clear();
  ROOM_THEME_CACHE.clear();
  await Promise.allSettled(thumbnailUris.map((uri) => discardTemporaryAccountFile(uri)));
});

function roomThemeFor(resolvedTheme: keyof typeof memoryRoomTokens, occasionType: OccasionType) {
  const key = `${resolvedTheme}:${occasionType}`;
  const cached = ROOM_THEME_CACHE.get(key);
  if (cached) return cached;

  const tokens = occasionThemeToMemoryRoomTokens(memoryRoomTokens[resolvedTheme], occasionType);
  const colors = createRoomColors(tokens);
  const next = { colors, styles: createStyles(colors) };
  ROOM_THEME_CACHE.set(key, next);
  return next;
}

function applyRoomTheme(resolvedTheme: keyof typeof memoryRoomTokens, occasionType: OccasionType) {
  const theme = roomThemeFor(resolvedTheme, occasionType);
  ROOM_COLORS = theme.colors;
  styles = theme.styles;
}
