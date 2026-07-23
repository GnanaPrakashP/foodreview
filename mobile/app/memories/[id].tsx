import Ionicons from "@expo/vector-icons/Ionicons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions
} from "expo-audio";
import { BlurView } from "expo-blur";
import * as Clipboard from "expo-clipboard";
import { PenLine, Star, Utensils } from "lucide-react-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { getThumbnailAsync, type VideoThumbnailsResult } from "expo-video-thumbnails";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { memo, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type TextLayoutEventData,
  Modal,
  Platform,
  Pressable,
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
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
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
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { discardTemporaryAccountFile, stageAccountFile } from "@/services/accountFileStore";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import {
  getOccasionTheme,
  occasionThemeToMemoryRoomTokens,
  type OccasionTheme
} from "@/features/occasions/occasionThemes";
import type { OccasionType } from "@/features/occasions/occasionTypes";
import {
  FOOD_WALLPAPER_TILE_SIZE,
} from "@/components/memories/foodWallpaperPattern";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from "react-native-svg";
import {
  MEMORY_ROOM_TABS as ROOM_TABS,
  MEMORY_ROOM_TAB_TIMING,
  useMemoryRoomController,
  type MemoryRoomMode as RoomMode,
  type MemoryRoomTabMode as RoomTabMode
} from "@/features/memories/room/useMemoryRoomController";
import {
  Bubble as ChatMainBubble,
  Chat as ChatMain,
  Message as ChatMainMessageRow
} from "@/vendor/reactNativeChat";
import type { BubbleProps as ChatMainBubbleProps } from "@/vendor/reactNativeChat/Bubble";
import type { MessageProps as ChatMainMessageRowProps } from "@/vendor/reactNativeChat/Message";
import type { MessageTextProps as ChatMainMessageTextProps } from "@/vendor/reactNativeChat/MessageText";
import type { AnimatedList as ChatMainAnimatedList } from "@/vendor/reactNativeChat/MessagesContainer";
import type { IMessage as ChatMainMessage, MessageAudioProps as ChatMainMessageAudioProps, MessageReaction as ChatMainMessageReaction, ReplyMessage as ChatMainReplyMessage } from "@/vendor/reactNativeChat/Models";
import type { ReactionPickerProps as ChatMainReactionPickerProps } from "@/vendor/reactNativeChat/Reactions/types";
import { useCircleAccessStatusesQuery } from "@/hooks/useCircle";
import { useRequestCircleAccessMutation } from "@/hooks/useEngagement";
import { useUserProfileSearch } from "@/hooks/useUserProfileSearch";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryDishMutation,
  useAddMemoryPhotoMutation,
  useCreateMemoryStopMutation,
  useDeleteMemoryItemsMutation,
  useDeleteMemoryStopMutation,
  useDismissFailedMemoryMessage,
  useEditMemoryMessageMutation,
  useLeaveMemoryRoomMutation,
  useMarkMemoryRoomReadMutation,
  useMemoryMediaPagesQuery,
  useMemoryMessagePagesQuery,
  useMemoryRoomQuery,
  useMemoryRoomRealtime,
  memoryRoomSummariesFromPages,
  memoryKeys,
  useSetMemoryDishRatingMutation
} from "@/hooks/useMemories";
import type { CircleAccessStatus } from "@/services/circle";
import {
  pickMemoryMediaFromCamera,
  pickMemoryMediaFromGallery,
  type MemoryMediaPickerResult
} from "@/services/mediaPicker";
import { saveMemoryCapture } from "@/services/memoryCaptureSession";
import { validateMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { MEMORY_CHAT_PRELOAD_LIMIT, type AddMemoryMediaAsset, type MemoryRoomsPage } from "@/services/memories";
import { MEMORY_AUDIO_MAX_DURATION_MS } from "@/constants/memoryMediaPolicy";
import { MEMORY_TEXT_MAX_LENGTH } from "@/constants/memoryLimits";
import type { UserSearchResult } from "@/services/profiles";
import { useSessionStore } from "@/stores/sessionStore";
import { avatarAccents, fontStyles, memoryRoomTokens, radius, spacing, type MemoryRoomTokens } from "@/theme";
import type { MemoryDish, MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom, MemoryStop, MemoryStopType } from "@/types/models";
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
type MemoryActionTarget =
  | { type: "message"; value: MemoryMessage }
  | { type: "photo"; value: MemoryPhoto };
type MemoryReactionState = Record<string, Record<string, Array<string | number>>>;
type MemoryCaptureAsset = {
  duration?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mimeType?: string | null;
  type?: string | null;
  uri: string;
  width?: number | null;
};
type MemoryChatMainMessage = ChatMainMessage & {
  kind: "dish" | "media" | "message" | "unread";
  memoryDish?: MemoryDish;
  memoryMessage?: MemoryMessage;
  memoryPhoto?: MemoryPhoto;
  extraAttachments?: MemoryPhoto[];
  showSenderDetails?: boolean;
};
const FOOD_WALLPAPER_TILE_SOURCE = require("../../assets/memories/food-wallpaper-tile.png");
const ROOM_MAX_WIDTH = 640;
// Stop types shown on the itinerary. `canHaveDishes` gates the per-stop
// "Add dish" affordance — a movie or bowling stop just holds a note/photos.
const MEMORY_STOP_META: Record<MemoryStopType, { emoji: string; label: string; canHaveDishes: boolean }> = {
  restaurant: { emoji: "🍽️", label: "Restaurant", canHaveDishes: true },
  cafe: { emoji: "☕", label: "Café", canHaveDishes: true },
  bar: { emoji: "🍸", label: "Bar", canHaveDishes: true },
  bowling: { emoji: "🎳", label: "Bowling", canHaveDishes: false },
  movie: { emoji: "🎬", label: "Movie", canHaveDishes: false },
  activity: { emoji: "🎯", label: "Activity", canHaveDishes: false },
  other: { emoji: "📍", label: "Other", canHaveDishes: true }
};

const MEMORY_STOP_ORDER: MemoryStopType[] = ["restaurant", "cafe", "bar", "bowling", "movie", "activity", "other"];
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
// Chat bubbles: own carries the memory-room purple identity, other sits on a
// neutral raised surface so both read clearly above the doodle wallpaper.
let CHAT_OWN_BUBBLE_COLOR = ROOM_COLORS.sentBubble;
let CHAT_OTHER_BUBBLE_COLOR = ROOM_COLORS.receivedBubble;
const CHAT_ACCENTS = avatarAccents;
const COMPOSER_TOP_GAP = 8;
// Matches COMPOSER_TOP_GAP so the message box sits with an equal gap above (to the
// composer's opaque top edge) and below (to the keyboard) when the keyboard is open.
const COMPOSER_KEYBOARD_OPEN_GAP = 8;
// Yoga reports layout in density-independent pixels. A real multiline/reply/edit
// height change is many pixels; one pixel or less is measurement noise and must
// not create a settle-time React render or list-clearance reconciliation.
const COMPOSER_HEIGHT_COMMIT_THRESHOLD = 1;
const COMPOSER_CLOSED_SAFE_GAP = 6;
const ANDROID_EDGE_TO_EDGE_MIN_VERSION = 30;
const IS_ANDROID_EDGE_TO_EDGE = Platform.OS === "android" && Number(Platform.Version) >= ANDROID_EDGE_TO_EDGE_MIN_VERSION;
const COMPOSER_STANDARD_BOTTOM_GAP = spacing.md;
const COMPOSER_EDGE_TO_EDGE_BOTTOM_GAP = spacing.lg;
const MEDIA_GRID_GAP = 4;
const CHAT_ROW_SIDE_PADDING = Platform.OS === "web" ? spacing.base : spacing.md;
const CHAT_SENT_TEXT_ROW_MAX_WIDTH = "80%";
const CHAT_RECEIVED_TEXT_ROW_MAX_WIDTH = "74%";
const CHAT_GROUPED_MESSAGE_GAP = 3;
const CHAT_AVATAR_SIZE = 30;
const COMPOSER_INPUT_FONT_SIZE = Platform.OS === "web" ? 14 : 15;
const COMPOSER_INPUT_LINE_HEIGHT = Platform.OS === "web" ? 20 : 21;
const COMPOSER_INPUT_VERTICAL_PADDING = Platform.OS === "ios" ? 20 : 16;
const COMPOSER_INPUT_BORDER_HEIGHT = 2;
const COMPOSER_INPUT_MIN_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING + COMPOSER_INPUT_BORDER_HEIGHT;
const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT * 5 + COMPOSER_INPUT_VERTICAL_PADDING + COMPOSER_INPUT_BORDER_HEIGHT;
const COMPOSER_MESSAGE_BOX_MIN_HEIGHT = Platform.OS === "web" ? COMPOSER_INPUT_MIN_HEIGHT : Math.max(42, COMPOSER_INPUT_MIN_HEIGHT);
const COMPOSER_ACTION_BUTTON_SIZE = Platform.OS === "web" ? 36 : 40;
const VOICE_MESSAGE_MIN_DURATION_MS = 700;
const VOICE_MESSAGE_SEND_MIN_DURATION_MS = Platform.OS === "android" ? 1500 : VOICE_MESSAGE_MIN_DURATION_MS;
const VOICE_MESSAGE_MIME_TYPE = "audio/mp4";
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
const CHAT_COMPOSER_CLEARANCE = 88;
const CHAT_KEYBOARD_BRIDGE_HEIGHT = 1000;

const MEDIA_GALLERY_GAP = 2;
const MEDIA_GALLERY_HALF_GAP = MEDIA_GALLERY_GAP / 2;
const COMPACT_ROOM_HEADER_HEIGHT = 106;
const MEMBERS_HEADER_CLEARANCE = spacing.sm + 34 + 14 + 1;
const MEDIA_GALLERY_TOP_CLEARANCE = COMPACT_ROOM_HEADER_HEIGHT + MEDIA_GALLERY_HALF_GAP;
const PEOPLE_PANEL_ENTER_DURATION = 230;
const PEOPLE_PANEL_EXIT_DURATION = 190;
const ROOM_PANE_TRANSLATE_Y = 5;
const CHAT_MAIN_INITIAL_RENDER_COUNT = 10;
const CHAT_MAIN_MAX_RENDER_BATCH = 8;
const CHAT_MAIN_WINDOW_SIZE = 7;
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
// Minimum horizontal gap between the end of the last text line and the time.
const CHAT_TIME_GAP = 8;
// Height of the invisible width-reserving spacer. When it wraps to its own
// line it adds exactly the room the pinned time (13px, dropped 3px) needs —
// tighter than a normal 22px text line, per the placement rule.
const CHAT_TIME_SPACER_HEIGHT = 13 - CHAT_TIME_PINNED_DROP;
const MEMORY_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😋", "👏"] as const;
const MEDIA_GALLERY_INITIAL_RENDER_COUNT = 8;
const MEDIA_GALLERY_MAX_RENDER_BATCH = 8;
const MEDIA_GALLERY_PREFETCH_COUNT = 12;
const MEDIA_GALLERY_WINDOW_SIZE = 7;
const MEDIA_VIEWER_MAX_RENDER_BATCH = 2;
const MEDIA_VIEWER_WINDOW_SIZE = 3;
type MediaPreviewSize = { height: number; width: number };
type MediaTimestampPlacement = "bottom-left" | "bottom-right";
type MessageGroupPosition = "single" | "first" | "middle" | "last";

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

function effectiveRoomOccasionType(room: Pick<MemoryRoom, "occasionConfidence" | "occasionConfirmedByUser" | "occasionType">): OccasionType {
  if (room.occasionConfirmedByUser || room.occasionConfidence >= 0.85) return room.occasionType;
  return "unknown";
}

type AttachmentSheetView = "actions" | "dish" | "media";

function memoryActionKey(target: MemoryActionTarget) {
  return `${target.type}:${target.value.id}`;
}

function findMemoryActionTarget(data: MemoryRoom, key: string): MemoryActionTarget | null {
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
    .sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt))
    .find((message) => (
      timeValue(message.createdAt) > lastReadTime &&
      !sameUsername(message.authorName, myUsername)
    ))?.id ?? null;
}

function mergeMemoryMessages(...groups: MemoryMessage[][]) {
  const byId = new Map<string, MemoryMessage>();
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => timeValue(a.createdAt) - timeValue(b.createdAt));
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

function memoryChatActionTarget(message: MemoryChatMainMessage | undefined): MemoryActionTarget | null {
  if (!message) return null;
  if (message.memoryMessage) return { type: "message", value: message.memoryMessage };
  if (message.memoryPhoto) return { type: "photo", value: message.memoryPhoto };
  return null;
}

function canEditMemoryMessage(message: MemoryMessage, myUsername: string) {
  return (
    message.authorName === myUsername &&
    message.body.trim().length > 0 &&
    message.attachments.length === 0 &&
    message.deliveryStatus !== "pending" &&
    message.deliveryStatus !== "failed"
  );
}

function canDeleteMemoryActionTarget(target: MemoryActionTarget, myUsername: string) {
  if (target.type === "message") {
    return (
      target.value.authorName === myUsername &&
      target.value.deliveryStatus !== "pending" &&
      target.value.deliveryStatus !== "failed"
    );
  }
  return target.value.uploaderName === myUsername;
}

// Same grouping rule the vendor uses for corner rounding: consecutive
// messages from the same user on the same day form one visual run.
function memoryChatIsGroupedToPrevious(
  current: MemoryChatMainMessage | undefined,
  previous: MemoryChatMainMessage | undefined
) {
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
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt))
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
        const message = item.value;
        const primaryAudio = memoryChatPrimaryAudio(message);
        const primaryMedia = memoryChatPrimaryVisualMedia(message);
        const primaryAudioUrl = memoryChatMediaUrl(primaryAudio);
        const primaryMediaUrl = memoryChatMediaUrl(primaryMedia);

        return {
          _id: message.id,
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
              user: memoryChatUser(message.replyToMessage.authorDisplayName, message.replyToMessage.authorDisplayName)
            }
            : undefined,
          showSenderDetails,
          streaming: message.deliveryStatus === "pending",
          text: message.body.trim(),
          user: memoryChatUser(message.authorName, message.authorDisplayName),
          video: memoryMediaKind(primaryMedia) === "video" ? primaryMediaUrl : undefined
        };
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

function MemoryChatMainSurface({
  active,
  bottomClearance,
  canLoadOlderMessages,
  data,
  loadingOlderMessages,
  message,
  myUsername,
  inputRef,
  listRef,
  canDeleteSelected,
  deleteError,
  deletePending,
  editableSelectedMessage,
  editingMessage,
  selectedItemKeys,
  onBeginSelection,
  onCancelReply,
  onCancelEdit,
  onCancelSelection,
  onChangeMessage,
  onDeleteTarget,
  onDeleteSelected,
  onEditMessage,
  onInputToolbarLayout,
  onLoadOlderMessages,
  onNearBottomChange,
  onOpenDish,
  onOpenMedia,
  onRateDish,
  onReplyMessage,
  onSend,
  onSendAudio,
  scrollToBottom,
  onToggleSelection,
  onToggleReaction,
  pendingDishId,
  reactions,
  replyingToMessage,
  resolvedTheme,
  surfaceKeyboardStyle,
  toolbarInsetStyle,
  typingVisible
}: {
  active: boolean;
  bottomClearance: number;
  canLoadOlderMessages: boolean;
  data: MemoryRoom;
  loadingOlderMessages: boolean;
  message: string;
  myUsername: string;
  inputRef: RefObject<TextInput | null>;
  listRef: RefObject<ChatMainAnimatedList<MemoryChatMainMessage> | null>;
  canDeleteSelected: boolean;
  deleteError?: string;
  deletePending: boolean;
  editableSelectedMessage: MemoryMessage | null;
  editingMessage: MemoryMessage | null;
  selectedItemKeys: string[];
  onBeginSelection: (target: MemoryActionTarget) => void;
  onCancelReply: () => void;
  onCancelEdit: () => void;
  onCancelSelection: () => void;
  onChangeMessage: (value: string) => void;
  onDeleteTarget: (target: MemoryActionTarget) => void;
  onDeleteSelected: () => void;
  onEditMessage: (message: MemoryMessage) => void;
  onInputToolbarLayout: (event: LayoutChangeEvent) => void;
  onLoadOlderMessages: () => void;
  onNearBottomChange: (isNearBottom: boolean) => void;
  onOpenDish: (dishId: string) => void;
  onOpenMedia: OpenMediaHandler;
  onRateDish: (dishId: string, rating: number) => void;
  onReplyMessage: (message: MemoryMessage) => void;
  onSend: (draft?: string) => void;
  onSendAudio: (asset: AddMemoryMediaAsset) => Promise<void>;
  scrollToBottom: (animated: boolean) => void;
  onToggleSelection: (target: MemoryActionTarget) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  pendingDishId?: string | null;
  reactions: MemoryReactionState;
  replyingToMessage: MemoryMessage | null;
  resolvedTheme: "dark" | "light";
  surfaceKeyboardStyle: StyleProp<ViewStyle>;
  toolbarInsetStyle: StyleProp<ViewStyle>;
  typingVisible: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const unreadAnchorMessageIdRef = useRef<string | null>(
    active ? firstUnreadMemoryMessageId(data.messages, data.lastReadAt, myUsername) : null
  );
  const unreadAnchorVisitRef = useRef({ active, roomId: data.id });
  if (unreadAnchorVisitRef.current.active !== active || unreadAnchorVisitRef.current.roomId !== data.id) {
    unreadAnchorVisitRef.current = { active, roomId: data.id };
    unreadAnchorMessageIdRef.current = active
      ? firstUnreadMemoryMessageId(data.messages, data.lastReadAt, myUsername)
      : null;
  }
  const unreadAnchorMessageId = active ? unreadAnchorMessageIdRef.current : null;
  const chatMessages = useMemo(() => (
    buildMemoryChatMainMessages({ data, myUsername, reactions, unreadAnchorMessageId })
  ), [data, myUsername, reactions, unreadAnchorMessageId]);
  const currentUser = useMemo(() => memoryChatUser(myUsername, myUsername || "You"), [myUsername]);
  const latestChatMessage = chatMessages[0] ?? null;
  const latestChatMessageId = latestChatMessage?._id != null ? String(latestChatMessage._id) : null;
  const latestChatMessageMine = latestChatMessage
    ? String(latestChatMessage.user?._id ?? "") === String(currentUser._id ?? "")
    : false;
  const selectionMode = selectedItemKeys.length > 0;
  const chatMainNearBottomRef = useRef(true);
  const chatMainFollowBottomRef = useRef(true);
  const chatMainDraggingRef = useRef(false);
  const latestChatMessageIdRef = useRef(latestChatMessageId);
  const voiceRecorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const voiceRecorderState = useAudioRecorderState(voiceRecorder, 200);
  const [voiceMode, setVoiceMode] = useState<"idle" | "recording" | "sending">("idle");
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
    try {
      if (voiceRecorder.isRecording || voiceRecorderState.isRecording) {
        await voiceRecorder.stop();
      }
    } catch {
      // Cancelling should be quiet; a stale native recorder can already be stopped.
    } finally {
      await discardTemporaryAccountFile(voiceRecorder.uri ?? voiceRecorderState.url).catch(() => {});
      await resetVoiceAudioMode();
    }
  }, [resetVoiceAudioMode, voiceRecorder, voiceRecorderState.isRecording, voiceRecorderState.url]);

  const startVoiceRecording = useCallback(async () => {
    if (voiceModeRef.current !== "idle" || message.trim().length > 0) return;
    if (Platform.OS === "web") {
      Alert.alert("Voice notes are mobile-only", "Use the mobile app to record audio messages.");
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone access needed", "Allow microphone access to record an audio message.");
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "duckOthers",
        playsInSilentMode: true
      });
      await voiceRecorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
      voiceRecorder.record();
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
  }, [message, resetVoiceAudioMode, voiceRecorder]);

  const finishAndSendVoiceRecording = useCallback(async () => {
    if (voiceModeRef.current !== "recording") return;
    const durationBeforeStopMs = Math.max(
      voiceRecorderState.durationMillis ?? 0,
      voiceRecordingStartedAtRef.current ? Date.now() - voiceRecordingStartedAtRef.current : 0
    );
    if (durationBeforeStopMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS) return;
    voiceModeRef.current = "sending";
    setVoiceMode("sending");

    try {
      if (voiceRecorder.isRecording || voiceRecorderState.isRecording) {
        try {
          await voiceRecorder.stop();
        } catch (error) {
          if (durationBeforeStopMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS + 500) {
            Alert.alert("Audio is too short", "Record for a moment longer before sending.");
            return;
          }
          throw error;
        }
      }
      const status = voiceRecorder.getStatus();
      const durationMs = Math.max(durationBeforeStopMs, status.durationMillis ?? 0);
      const uri = voiceRecorder.uri ?? status.url ?? voiceRecorderState.url;
      if (!uri) throw new Error("voice_recording_missing_uri");
      if (durationMs < VOICE_MESSAGE_SEND_MIN_DURATION_MS) {
        Alert.alert("Audio is too short", "Record for at least a moment before sending.");
        return;
      }
      if (durationMs > MEMORY_AUDIO_MAX_DURATION_MS + 250) {
        Alert.alert("Audio is too long", "Audio messages must be 60 seconds or less.");
        return;
      }
      await onSendAudio({
        duration: durationMs,
        fileSize: null,
        imageHeight: null,
        imageWidth: null,
        mediaMimeType: VOICE_MESSAGE_MIME_TYPE,
        mediaType: "audio",
        mediaUri: uri
      });
    } catch (error) {
      console.warn("[memory-chat] Could not send audio");
      Alert.alert("Could not send audio", error instanceof Error ? error.message : "Please try recording again.");
    } finally {
      await discardTemporaryAccountFile(voiceRecorder.uri ?? voiceRecorderState.url).catch(() => {});
      voiceRecordingStartedAtRef.current = null;
      voiceModeRef.current = "idle";
      setVoiceMode("idle");
      await resetVoiceAudioMode();
    }
  }, [onSendAudio, resetVoiceAudioMode, voiceRecorder, voiceRecorderState.durationMillis, voiceRecorderState.isRecording, voiceRecorderState.url]);

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
    void voiceRecorder.stop().catch(() => undefined);
    void resetVoiceAudioMode();
  }, [resetVoiceAudioMode, voiceRecorder]);

  useEffect(() => {
    chatMainNearBottomRef.current = true;
    chatMainFollowBottomRef.current = true;
    latestChatMessageIdRef.current = latestChatMessageId;
    // Room switches reset the anchor baseline; new-message changes are handled
    // by the follow-bottom effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id]);

  useEffect(() => {
    const previousLatestMessageId = latestChatMessageIdRef.current;
    latestChatMessageIdRef.current = latestChatMessageId;
    if (!active || !latestChatMessageId || previousLatestMessageId === latestChatMessageId) return;
    if (!latestChatMessageMine && !chatMainNearBottomRef.current && !chatMainFollowBottomRef.current) return;
    chatMainFollowBottomRef.current = true;
    chatMainNearBottomRef.current = true;
    onNearBottomChange(true);
    const timeout = setTimeout(() => scrollToBottom(false), 0);
    return () => clearTimeout(timeout);
  }, [active, latestChatMessageId, latestChatMessageMine, onNearBottomChange, scrollToBottom]);

  const handleChatMainScroll = useCallback((event: ScrollEvent) => {
    if (!active) return;
    const distanceFromBottom = event.contentOffset.y;
    const isNearBottom = distanceFromBottom < 96;
    chatMainNearBottomRef.current = isNearBottom;
    onNearBottomChange(isNearBottom);
    if (!chatMainDraggingRef.current) {
      if (distanceFromBottom < 4) {
        chatMainFollowBottomRef.current = true;
      } else if (chatMainFollowBottomRef.current) {
        scrollToBottom(false);
      }
    }
  }, [active, onNearBottomChange, scrollToBottom]);

  const handleChatMainScrollBeginDrag = useCallback(() => {
    chatMainDraggingRef.current = true;
    chatMainFollowBottomRef.current = false;
  }, []);

  const handleChatMainScrollEndDrag = useCallback(() => {
    chatMainDraggingRef.current = false;
  }, []);

  const handleChatMainContentSizeChange = useCallback(() => {
    if (!active) return;
    if (!chatMainFollowBottomRef.current && !chatMainNearBottomRef.current) return;
    chatMainFollowBottomRef.current = true;
    chatMainNearBottomRef.current = true;
    scrollToBottom(false);
    onNearBottomChange(true);
  }, [active, onNearBottomChange, scrollToBottom]);

  const buildMenuActions = useCallback((target: MemoryChatMainMessage | undefined): MemoryChatMenuAction[] => {
    const actionTarget = memoryChatActionTarget(target);
    if (!actionTarget) return [];

    const actions: MemoryChatMenuAction[] = [];

    if (actionTarget.type === "message") {
      const targetMessage = actionTarget.value;
      const body = targetMessage.body.trim();
      actions.push({
        icon: "arrow-undo-outline",
        key: "reply",
        label: "Reply",
        onPress: () => onReplyMessage(targetMessage)
      });

      if (body.length > 0) {
        actions.push({
          icon: "copy-outline",
          key: "copy",
          label: "Copy",
          onPress: () => {
            void Clipboard.setStringAsync(targetMessage.body);
          }
        });
      }

      if (canEditMemoryMessage(targetMessage, myUsername)) {
        actions.push({
          icon: "create-outline",
          key: "edit",
          label: "Edit",
          onPress: () => onEditMessage(targetMessage)
        });
      }

      if (canDeleteMemoryActionTarget(actionTarget, myUsername)) {
        actions.push({
          destructive: true,
          icon: "trash-outline",
          key: "delete",
          label: "Delete",
          onPress: () => onDeleteTarget(actionTarget)
        });
      }
    } else if (canDeleteMemoryActionTarget(actionTarget, myUsername)) {
      actions.push({
        destructive: true,
        icon: "trash-outline",
        key: "delete",
        label: "Delete",
        onPress: () => onDeleteTarget(actionTarget)
      });
    }

    actions.push({
      icon: "checkmark-circle-outline",
      key: "select",
      label: "Select",
      onPress: () => onBeginSelection(actionTarget)
    });

    return actions;
  }, [myUsername, onBeginSelection, onDeleteTarget, onEditMessage, onReplyMessage]);

  const chatMainListContentStyle = useMemo(() => [
    styles.chatMainListContent,
    { paddingTop: bottomClearance }
  ], [bottomClearance]);
  const sendToolbarMessage = useCallback((
    outgoingMessages: Partial<MemoryChatMainMessage> | Partial<MemoryChatMainMessage>[]
  ) => {
    const firstMessage = Array.isArray(outgoingMessages) ? outgoingMessages[0] : outgoingMessages;
    onSend(firstMessage?.text ?? "");
  }, [onSend]);

  const renderInputToolbar = useCallback(() => null, []);

  const composerToolbar = selectionMode ? (
    <MemoryChatMainSelectionToolbar
      canDelete={canDeleteSelected}
      count={selectedItemKeys.length}
      deleteError={deleteError}
      deleting={deletePending}
      editableMessage={editableSelectedMessage}
      onCancel={onCancelSelection}
      onDelete={onDeleteSelected}
      onEdit={onEditMessage}
      onInputToolbarLayout={onInputToolbarLayout}
      toolbarInsetStyle={toolbarInsetStyle}
    />
  ) : (
    <MemoryChatMainInputToolbar
      editingMessage={editingMessage}
      inputRef={inputRef}
      myUsername={myUsername}
      onCancelEdit={onCancelEdit}
      onCancelVoice={() => { void cancelVoiceRecording(); }}
      onClearReply={onCancelReply}
      onInputToolbarLayout={onInputToolbarLayout}
      onSend={sendToolbarMessage}
      onSendAudio={() => { void finishAndSendVoiceRecording(); }}
      onStartAudio={() => { void startVoiceRecording(); }}
      replyMessage={replyingToMessage ? memoryChatReplyMessage(replyingToMessage) : null}
      text={message}
      textInputProps={{
        maxLength: MEMORY_TEXT_MAX_LENGTH,
        onChangeText: onChangeMessage
      }}
      themeMode={resolvedTheme}
      toolbarInsetStyle={toolbarInsetStyle}
      voiceActive={voiceActive}
      voiceDisabled={voiceSendDisabled}
      voiceDurationMs={voiceDurationMs}
      voiceSending={voiceSending}
    />
  );

  const handlePressMessage = useCallback((_context: unknown, target: MemoryChatMainMessage) => {
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
      return (
        <DishTimelineCard
          dish={dish}
          groupPosition="single"
          mine={mine}
          onOpenDish={() => onOpenDish(dish.id)}
          onRateDish={(rating) => onRateDish(dish.id, rating)}
          pending={pendingDishId === dish.id}
          rowStyle={styles.chatMainDishPollRow}
          showSenderDetails={Boolean(messageProps.currentMessage?.showSenderDetails)}
        />
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
    return (
      <View style={[styles.chatMainRowSelectionFrame, selected && styles.chatMainRowSelectedBackground]}>
        <ChatMainMessageRow<MemoryChatMainMessage>
          {...messageProps}
          containerStyle={{
            left: [rowStyle, styles.chatMainIncomingRowEdge, groupedGapStyle],
            right: [rowStyle, groupedGapStyle]
          }}
        />
      </View>
    );
  }, [onOpenDish, onRateDish, pendingDishId, selectedItemKeys]);

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
        bottomContainerStyle={{
          left: styles.chatMainBubbleBottomHidden,
          right: styles.chatMainBubbleBottomHidden
        }}
      />
    );
  }, []);

  const renderMessageText = useCallback((textProps: ChatMainMessageTextProps<MemoryChatMainMessage>) => {
    const { currentMessage, position = "left" } = textProps;
    const body = currentMessage.text?.trim() ?? "";
    if (!body) return null;

    const mine = position === "right";
    const time = memoryChatTimestampLabel(currentMessage);
    const hasMedia = memoryChatMessageAttachments(currentMessage).length > 0;
    const senderVisible = !hasMedia && !mine && Boolean(currentMessage.showSenderDetails);
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
          linkStyle={mine ? styles.messageLinkTextMine : styles.messageLinkText}
          // Stretch whenever a sibling can out-width the text (media block,
          // reply card, or the sender-name header on received group starts),
          // so the time pins to the bubble's right edge instead of hugging
          // the text mid-bubble.
          stretch={hasMedia || Boolean(currentMessage.replyMessage) || senderVisible}
          text={body}
          time={time}
          timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
        />
      </View>
    );
  }, []);

  const renderMessageMedia = useCallback((props: { currentMessage: MemoryChatMainMessage }) => {
    const attachments = memoryChatMessageAttachments(props.currentMessage);
    if (attachments.length === 0) return null;

    // Media-only messages stamp the time on the media itself; captioned media
    // gets the inline timestamp at the end of the caption instead.
    const hasCaption = Boolean(props.currentMessage.text?.trim());
    const timestamp = hasCaption ? undefined : memoryChatTimestampLabel(props.currentMessage);

    if (attachments.length === 1) {
      const media = attachments[0];
      return (
        <Pressable
          accessibilityRole="imagebutton"
          onPress={() => onOpenMedia(media, attachments)}
          style={styles.chatMainMediaFrame}
        >
          <SingleMediaPreview
            media={media}
            sizeOverride={memoryChatSingleMediaSize(media, screenWidth)}
            timestamp={timestamp}
            timestampPlacement="bottom-right"
          />
        </Pressable>
      );
    }

    return (
      <View style={styles.chatMainMediaFrame}>
        <MediaAttachmentGrid
          gridWidth={memoryChatGridWidth(screenWidth)}
          media={attachments}
          onMediaLongPress={() => undefined}
          onOpenMedia={onOpenMedia}
          shouldIgnoreMediaOpen={() => false}
          timestamp={timestamp}
        />
      </View>
    );
  }, [onOpenMedia, screenWidth]);

  const renderMessageAudio = useCallback((audioProps: ChatMainMessageAudioProps<MemoryChatMainMessage>) => (
    <ChatMainAudioMessage {...audioProps} />
  ), []);

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
    if (props.currentMessage?.kind === "unread") return <UnreadDivider />;
    const dish = props.currentMessage?.memoryDish;
    if (!dish) return null;
    return <MemoryChatMainDishSystemMessage dish={dish} onOpenDish={onOpenDish} />;
  }, [onOpenDish]);

  const renderReactionPicker = useCallback((pickerProps: ChatMainReactionPickerProps<MemoryChatMainMessage>) => {
    if (selectionMode) return null;

    const target = pickerProps.message;
    const targetMessage = target?.memoryMessage;
    const showEmojis = Boolean(
      targetMessage &&
      targetMessage.deliveryStatus !== "pending" &&
      targetMessage.deliveryStatus !== "failed"
    );

    return (
      <MemoryChatMessageMenu
        {...pickerProps}
        actions={buildMenuActions(target)}
        showEmojis={showEmojis}
      />
    );
  }, [buildMenuActions, selectionMode]);

  return (
    <Reanimated.View
      pointerEvents={active ? "auto" : "none"}
      style={[styles.chatMainSurface, surfaceKeyboardStyle]}
    >
      <View style={styles.chatMainMessagesLayer}>
        <ChatMain<MemoryChatMainMessage>
          colorScheme={resolvedTheme}
          disableKeyboardProvider
          provideSafeAreaContext={false}
          isDayAnimationEnabled
          isScrollToBottomEnabled
          isTyping={typingVisible || voiceSending}
          isAvatarOnTop
          isUserAvatarVisible={false}
          avatarImageStyle={{ left: styles.chatMainAvatarImage }}
          avatarTextStyle={styles.chatMainAvatarText}
          keyboardAvoidingViewProps={{ enabled: false }}
          listProps={{
            contentContainerStyle: chatMainListContentStyle,
            extraData: selectedItemKeys.join("|"),
            initialNumToRender: CHAT_MAIN_INITIAL_RENDER_COUNT,
            maxToRenderPerBatch: CHAT_MAIN_MAX_RENDER_BATCH,
            onContentSizeChange: handleChatMainContentSizeChange,
            onScroll: handleChatMainScroll,
            onScrollBeginDrag: handleChatMainScrollBeginDrag,
            onScrollEndDrag: handleChatMainScrollEndDrag,
            removeClippedSubviews: false,
            updateCellsBatchingPeriod: 50,
            windowSize: CHAT_MAIN_WINDOW_SIZE
          }}
          loadEarlierMessagesProps={{
            isAvailable: canLoadOlderMessages,
            isInfiniteScrollEnabled: true,
            isLoading: loadingOlderMessages,
            onPress: onLoadOlderMessages
          }}
          messageTextProps={{
            hashtag: true,
            customTextStyle: styles.textOnlyBubbleText,
            linkStyle: {
              left: styles.messageLinkText,
              right: styles.messageLinkTextMine
            },
            mention: true,
            onPress: (_message, url) => {
              void Linking.openURL(url);
            },
            stripPrefix: false,
            textStyle: {
              left: styles.messageTextOther,
              right: styles.messageTextMine
            }
          }}
          messages={chatMessages}
          messagesContainerRef={listRef as RefObject<ChatMainAnimatedList<MemoryChatMainMessage>>}
          messagesContainerStyle={styles.chatMainMessages}
          onQuickReply={(replies) => {
            replies.forEach((reply) => {
              const value = (reply.value || reply.title || "").trim();
              if (value) onSend(value);
            });
          }}
          onSend={(outgoingMessages) => {
            const outgoingText = outgoingMessages[0]?.text ?? "";
            onSend(outgoingText);
          }}
          onPressMessage={handlePressMessage}
          renderBubble={renderBubble}
          renderCustomView={renderCustomView}
          renderInputToolbar={renderInputToolbar}
          renderMessage={renderMessage}
          renderMessageAudio={renderMessageAudio}
          renderMessageImage={renderMessageMedia}
          renderMessageText={renderMessageText}
          renderMessageVideo={renderMessageMedia}
          renderSystemMessage={renderSystemMessage}
          reply={{
            message: replyingToMessage ? memoryChatReplyMessage(replyingToMessage) : null,
            onClear: onCancelReply,
            renderMessageReply: (replyProps) => {
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
              direction: "right",
              isEnabled: true,
              onSwipe: (target) => {
                if (target.memoryMessage) onReplyMessage(target.memoryMessage);
              }
            }
          }}
          reactions={{
            emojis: [...MEMORY_REACTION_EMOJIS],
            isEnabled: true,
            onReactionPress: (target, emoji) => {
              if (selectionMode) return;
              if (target.memoryMessage) onToggleReaction(target.memoryMessage.id, emoji);
            },
            renderReactionPicker
          }}
          text={message}
          textInputProps={{
            maxLength: MEMORY_TEXT_MAX_LENGTH,
            onChangeText: onChangeMessage
          }}
          user={currentUser}
        />
      </View>
      <View pointerEvents="none" style={styles.chatKeyboardBridge} />
      {composerToolbar}
    </Reanimated.View>
  );
}

// Timestamp placement rule: the bottom edge of the last text line must cut
// the single time element in half (half beside the text, half hanging into
// the bubble's bottom padding). The space the time needs is reserved by an
// invisible block-level spacer that flows after the text in a wrapping row,
// so Yoga itself decides whether the time fits beside the last line (bubble
// grows to hold it) or wraps onto its own tight line \u2014 no hand-computed
// width estimates. The visible time is pinned at the wrapper's bottom-right,
// which is exactly where the spacer reserved room. The only measured inputs
// are the time's own width and (as a pure optimization) the text's line
// layout: multi-line texts whose last line already leaves a gap wide enough
// for the time skip the spacer so the bubble doesn't grow a needless extra
// line. Every unmeasured/fallback state renders the spacer \u2014 worst case is
// a slightly taller bubble, never an overlap or a missing time.
function ChatMainBodyWithTime({
  bodyStyle,
  linkStyle,
  stretch = false,
  text,
  time,
  timeStyle
}: {
  bodyStyle: StyleProp<TextStyle>;
  linkStyle: StyleProp<TextStyle>;
  // Stretch only when a sibling (media block, reply card) defines the bubble
  // width independently, so the time can pin to the bubble's right edge.
  // Default hugs content: stretching inside a bubble whose width comes FROM
  // this wrapper is circular sizing, which Yoga resolves differently across
  // layout passes — bubbles visibly oscillated between the two answers.
  stretch?: boolean;
  text: string;
  time: string;
  timeStyle: StyleProp<TextStyle>;
}) {
  // Reserve a conservative width immediately so the timestamp is visible in
  // the same first frame as the message body. Native measurement then replaces
  // that estimate once and becomes a monotonic latch, protecting later Android
  // relayouts from transient zero/under-reported widths.
  const estimatedTimeWidth = estimateChatTimestampWidth(time);
  const [measuredTime, setMeasuredTime] = useState<{
    label: string;
    native: boolean;
    width: number;
  }>({ label: time, native: false, width: estimatedTimeWidth });
  const timeWidth = measuredTime.label === time ? measuredTime.width : estimatedTimeWidth;
  const spacerWidth = timeWidth + CHAT_TIME_GAP;

  // Android quirks measured on-device (see git history for the logs):
  // 1. Android intermittently re-measures the text against the bubble's
  //    stale (narrower) width, transiently wrapping the spacer; relayouts
  //    relax the constraint and the layout self-heals — so no decision may
  //    ever freeze a state that only exists mid-recovery.
  // 2. A multiline Text fills the full available width instead of hugging
  //    its longest line, leaving dead space right of shorter lines (long
  //    unbreakable words). Handled by the hug width below.
  // 3. The lines report appends a phantom trailing "line" for an inline
  //    view even when it visually shares the last text line; telling a real
  //    wrapped-spacer line from the phantom needs the element height from
  //    the SAME pass.
  // Layout decisions are evaluated on BOTH measurement events (line report
  // and element layout) via shared refs — evaluating in only one of them
  // goes blind when the other is the sole event a pass emits (a spacer-width
  // change can re-flow lines without changing the element's outer size, so
  // onLayout never re-fires). A ref value from the "other" event is valid
  // whenever no size change is in flight, and if one IS in flight its own
  // event lands right after and re-evaluates — so the non-latching outputs
  // (margin, ownLine) self-correct. The latching hug width additionally
  // requires CONFIRMATION: a candidate is applied only when a re-evaluation
  // ~100ms later (after any in-flight corrective layout has landed) computes
  // the same value, so a transient mismatched pairing can never be frozen.
  const linesRef = useRef<{ lines: Array<{ height: number; width: number; y: number }>; timeW: number } | null>(null);
  const boxRef = useRef<{ height: number; width: number } | null>(null);
  const pendingHugRef = useRef<{ timeW: number; width: number } | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layoutDecision, setLayoutDecision] = useState<{
    hugWidth: number; // 0 = no explicit width
    margin: number; // ≤ 0
    ownLine: boolean;
    timeW: number;
  } | null>(null);

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, []);

  const evaluateMeasurements = useCallback(() => {
    const snapshot = linesRef.current;
    const box = boxRef.current;
    if (!snapshot || !box || snapshot.lines.length === 0) return;

    const { lines } = snapshot;
    const snapshotSpacerWidth = snapshot.timeW + CHAT_TIME_GAP;
    const last = lines[lines.length - 1];
    const lastIsSpacerOnly = last.width <= snapshotSpacerWidth + 2;
    // The lines report appends a phantom trailing "line" for an inline view
    // even when it visually shares the last text line; a REAL wrapped-spacer
    // line starts a line-height above the element's bottom edge, a phantom
    // one starts at (or past) it.
    const ownLine = lastIsSpacerOnly && box.height - last.y > 4;
    const margin = ownLine ? -Math.min(14, Math.max(0, box.height - last.y - 11)) : 0;
    // Hug: a multiline bubble's width should be its longest TEXT line — the
    // WhatsApp rule. Android's fill-width behavior leaves the element wider
    // (long unbreakable words), and an inline spacer at the end of the last
    // line can widen that line beyond every text line; both leave a dead
    // band right of the text. Shrink to the longest text line (spacer
    // contribution excluded — if the time then has no room it wraps to its
    // own line, which is correct), floored at the spacer width so a bubble
    // is never narrower than its own timestamp. Only when the element is
    // meaningfully wider than that text width (a settled-state signature,
    // never a mid-recovery narrow one) and there are at least two real text
    // lines, so a one-line message can never be hugged at all. Latched per
    // spacer epoch after confirmation, never removed within the epoch.
    const realLineCount = lines.length - (lastIsSpacerOnly ? 1 : 0);
    const textLineWidths = [
      ...lines.slice(0, -1).map((line) => line.width),
      ...(lastIsSpacerOnly ? [] : [Math.max(0, last.width - snapshotSpacerWidth)])
    ];
    const maxTextLineWidth = textLineWidths.length > 0 ? Math.max(...textLineWidths) : 0;
    // +2px slack: line widths are reported rounded while real glyph runs are
    // fractional — constraining the text to EXACTLY its measured widest line
    // makes that line overflow by a subpixel and re-break, orphaning its
    // last character onto its own line (observed on device: "Sbdjdbdk" at
    // width 70 became "Sbdjdbd" + a 9px "k" line, adding dead height).
    // Hug applies in stretch mode too: stretch makes the WRAPPER reach the
    // bubble's edge (so the time pins there), hug keeps the TEXT element
    // from claiming the full row — they're orthogonal. Gating hug on
    // !stretch left received group-start bubbles (sender header → stretch)
    // permanently un-hugged and full-width.
    const hugCandidate = snapshot.timeW > 0 && realLineCount >= 2 &&
      maxTextLineWidth > 0 && box.width - maxTextLineWidth > 12
      ? Math.max(maxTextLineWidth, snapshotSpacerWidth) + 2
      : 0;

    let confirmedHug = 0;
    const pending = pendingHugRef.current;
    if (hugCandidate > 0) {
      if (pending && pending.timeW === snapshot.timeW && Math.abs(pending.width - hugCandidate) <= 2) {
        confirmedHug = hugCandidate;
      } else {
        pendingHugRef.current = { timeW: snapshot.timeW, width: hugCandidate };
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = setTimeout(evaluateMeasurements, 100);
      }
    } else {
      pendingHugRef.current = null;
    }

    setLayoutDecision((previous) => {
      const sameEpoch = previous && previous.timeW === snapshot.timeW;
      const hugWidth = sameEpoch && previous.hugWidth > 0 ? previous.hugWidth : confirmedHug;
      const next = { hugWidth, margin, ownLine, timeW: snapshot.timeW };
      return sameEpoch &&
        previous.hugWidth === next.hugWidth &&
        previous.margin === next.margin &&
        previous.ownLine === next.ownLine
        ? previous
        : next;
    });
  }, [text.length]);

  const handleTextLayout = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const eventLines = event.nativeEvent.lines;
    if (!eventLines || eventLines.length === 0) return;
    linesRef.current = {
      lines: eventLines.map((line) => ({
        height: Math.round(line.height),
        width: Math.ceil(line.width),
        y: Math.round(line.y)
      })),
      timeW: timeWidth
    };
    evaluateMeasurements();
  }, [timeWidth, evaluateMeasurements]);

  const handleTextBoxLayout = useCallback((event: LayoutChangeEvent) => {
    boxRef.current = {
      height: Math.round(event.nativeEvent.layout.height),
      width: Math.round(event.nativeEvent.layout.width)
    };
    evaluateMeasurements();
  }, [evaluateMeasurements]);

  const activeDecision = layoutDecision && layoutDecision.timeW === timeWidth ? layoutDecision : null;
  const hugTextWidth = activeDecision && activeDecision.hugWidth > 0 ? activeDecision.hugWidth : undefined;
  const textMarginStyle = activeDecision && activeDecision.margin < 0
    ? { marginBottom: activeDecision.margin }
    : null;

  return (
    <View style={[styles.chatMainBodyWithTime, stretch && styles.chatMainBodyWithTimeStretch]}>
      {/* The spacer is an inline view INSIDE the Text, so the text engine's
          own line-breaker places it: end of the last line when it fits (even
          in a multi-line trailing gap), wrapped onto its own line when it
          doesn't. The text is measured as a plain block — no flex siblings
          that could squeeze it. textBreakStrategy "simple" (greedy) keeps
          Android's balanced breaker from wrapping the spacer early to
          even out ragged lines. */}
      <Text
        android_hyphenationFrequency="none"
        onLayout={handleTextBoxLayout}
        onTextLayout={handleTextLayout}
        style={[
          styles.chatMainBodyHostText,
          hugTextWidth !== undefined && { width: hugTextWidth },
          textMarginStyle
        ]}
        textBreakStrategy="simple"
      >
        <SmartMessageTextContent
          linkStyle={linkStyle}
          text={text}
          textStyle={bodyStyle}
        />
        <View style={[styles.chatMainTimeSpacer, { width: spacerWidth }]} />
      </Text>
      <View
        pointerEvents="none"
        style={styles.chatMainTimePinned}
      >
        <Text
          numberOfLines={1}
          onLayout={(event) => {
            const next = Math.ceil(event.nativeEvent.layout.width);
            setMeasuredTime((previous) => {
              if (previous.label !== time || !previous.native) {
                return { label: time, native: true, width: next };
              }
              return next > previous.width ? { label: time, native: true, width: next } : previous;
            });
          }}
          style={[styles.inlineTimestampText, timeStyle]}
        >
          {time}
        </Text>
      </View>
    </View>
  );
}

function estimateChatTimestampWidth(label: string) {
  const estimated = Array.from(label).reduce((width, character) => {
    if (character === ":") return width + 3.5;
    if (character === " ") return width + 3;
    if (/\d/.test(character)) return width + 6.25;
    return width + 6;
  }, 2);
  return Math.max(42, Math.ceil(estimated));
}

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
  position = "left"
}: ChatMainMessageAudioProps<MemoryChatMainMessage> & { position?: "left" | "right" }) {
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

  useEffect(() => () => {
    pauseMediaPlayerQuietly(player);
  }, [player]);

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
        accessibilityState={{ disabled: isError }}
        disabled={isError}
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
  editingMessage: MemoryMessage | null;
  inputRef: RefObject<TextInput | null>;
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
  toolbarInsetStyle: StyleProp<ViewStyle>;
  themeMode: "dark" | "light";
  voiceActive: boolean;
  voiceDisabled: boolean;
  voiceDurationMs: number;
  voiceSending: boolean;
};

function MemoryChatMainInputToolbar({
  editingMessage,
  inputRef,
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
  themeMode,
  toolbarInsetStyle,
  voiceActive,
  voiceDisabled,
  voiceDurationMs,
  voiceSending
}: MemoryChatMainToolbarProps) {
  const [draft, setDraft] = useState(text ?? "");
  const draftRef = useRef(draft);
  const latestExternalTextRef = useRef(text ?? "");
  const ignoreExternalTextUntilResetRef = useRef(false);
  const trimmedText = draft.trim();
  const hasText = trimmedText.length > 0;
  const disabled = voiceActive && voiceDisabled;
  const icon = voiceActive ? (voiceSending ? "hourglass-outline" : "send") : hasText ? "send" : "mic-outline";
  const label = voiceActive ? "Send audio message" : hasText ? "Send message" : "Record audio message";
  const editingBody = editingMessage?.body.trim() ?? "";
  const replyAuthorId = String(replyMessage?.user?._id ?? "");
  const replyAuthor = replyAuthorId && replyAuthorId === myUsername ? "You" : replyMessage?.user?.name || "Unknown";
  const replyBody = replyMessage?.text || (replyMessage?.image ? "Photo" : replyMessage?.audio ? "Audio" : "Message");
  const measuredDraft = draft.length > 0 ? `${draft}\n​` : "​";

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
    setDraft(externalText);
  }, [text]);

  function handleChangeText(value: string) {
    draftRef.current = value;
    latestExternalTextRef.current = value;
    setDraft(value);
    textInputProps?.onChangeText?.(value);
  }

  function handlePress() {
    if (voiceActive) {
      if (!voiceDisabled) onSendAudio();
      return;
    }
    if (hasText) {
      const outgoingText = trimmedText;
      draftRef.current = "";
      ignoreExternalTextUntilResetRef.current = true;
      latestExternalTextRef.current = "";
      inputRef.current?.clear();
      setDraft("");
      onSend?.({ text: outgoingText } as Partial<MemoryChatMainMessage>, true);
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
            <View style={styles.chatMainDraftMessageBox}>
              <Text
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.chatMainDraftMeasureText}
              >
                {measuredDraft}
              </Text>
              <TextInput
                accessible
                accessibilityLabel="Type a message"
                autoCapitalize="sentences"
                blurOnSubmit={false}
                disableFullscreenUI
                enablesReturnKeyAutomatically
                keyboardAppearance={themeMode === "dark" ? "dark" : "default"}
                maxLength={MEMORY_TEXT_MAX_LENGTH}
                multiline
                onChangeText={handleChangeText}
                placeholder="Type a message"
                placeholderTextColor={ROOM_COLORS.muted}
                ref={inputRef}
                scrollEnabled
                smartInsertDelete={false}
                style={styles.chatMainDraftInput}
                submitBehavior="newline"
                textContentType="none"
                underlineColorAndroid="transparent"
                value={draft}
              />
            </View>
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
                <Ionicons name={icon} size={19} color={ROOM_COLORS.onCool} />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Reanimated.View>
  );
}

function MemoryChatMainSelectionToolbar({
  canDelete,
  count,
  deleteError,
  deleting,
  editableMessage,
  onCancel,
  onDelete,
  onEdit,
  onInputToolbarLayout,
  toolbarInsetStyle
}: {
  canDelete: boolean;
  count: number;
  deleteError?: string;
  deleting: boolean;
  editableMessage: MemoryMessage | null;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: (message: MemoryMessage) => void;
  onInputToolbarLayout: (event: LayoutChangeEvent) => void;
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

type MemoryChatMenuAction = {
  destructive?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
  label: string;
  onPress: () => void;
};

const CHAT_MENU_EMOJI_SIZE = 44;
const CHAT_MENU_EMOJI_ROW_HEIGHT = 54;
const CHAT_MENU_ACTION_HEIGHT = 44;
const CHAT_MENU_PADDING = 6;
const CHAT_MENU_OFFSET = 8;
const CHAT_MENU_MIN_WIDTH = 216;

// Anchored long-press menu for chat bubbles: quick-react emoji row on top,
// message actions below. Replaces the library's emoji-only ReactionPicker via
// the reactions.renderReactionPicker override.
function MemoryChatMessageMenu({
  actions,
  showEmojis,
  ...pickerProps
}: ChatMainReactionPickerProps<MemoryChatMainMessage> & {
  actions: MemoryChatMenuAction[];
  showEmojis: boolean;
}) {
  const {
    visible,
    emojis,
    onSelect,
    onDismiss,
    position,
    pageX = 0,
    pageY = 0,
    bubbleWidth = 0,
    bubbleHeight = 0
  } = pickerProps;
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();

  if (!visible || (!showEmojis && actions.length === 0)) return null;

  const emojiRowWidth = emojis.length * CHAT_MENU_EMOJI_SIZE + CHAT_MENU_PADDING * 2;
  const menuWidth = Math.min(
    screenWidth - 16,
    Math.max(CHAT_MENU_MIN_WIDTH, showEmojis ? emojiRowWidth : CHAT_MENU_MIN_WIDTH)
  );
  const menuHeight =
    (showEmojis ? CHAT_MENU_EMOJI_ROW_HEIGHT + (actions.length > 0 ? 1 : 0) : 0) +
    actions.length * CHAT_MENU_ACTION_HEIGHT +
    CHAT_MENU_PADDING * 2;

  const showAbove = pageY >= menuHeight + CHAT_MENU_OFFSET;
  let menuTop = showAbove
    ? pageY - menuHeight - CHAT_MENU_OFFSET
    : pageY + bubbleHeight + CHAT_MENU_OFFSET;
  menuTop = Math.max(8, Math.min(menuTop, screenHeight - menuHeight - 8));

  let menuLeft = position === "right" ? pageX + bubbleWidth - menuWidth : pageX;
  menuLeft = Math.max(8, Math.min(menuLeft, screenWidth - menuWidth - 8));

  function runAction(action: MemoryChatMenuAction) {
    onDismiss();
    // Let the modal finish dismissing before follow-up UI (Alert, composer
    // focus) presents — iOS drops alerts shown over a dismissing modal.
    setTimeout(action.onPress, Platform.OS === "ios" ? 180 : 0);
  }

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} statusBarTranslucent transparent visible={visible}>
      <Pressable onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={[styles.chatMainMenu, { left: menuLeft, top: menuTop, width: menuWidth }]}>
        {showEmojis ? (
          <View style={styles.chatMainMenuEmojiRow}>
            {emojis.map((emoji) => (
              <Pressable
                accessibilityLabel={`React with ${emoji}`}
                accessibilityRole="button"
                key={emoji}
                onPress={() => {
                  onSelect(emoji);
                  onDismiss();
                }}
                style={({ pressed }) => [styles.chatMainMenuEmojiButton, pressed && styles.chatMainMenuEmojiButtonPressed]}
              >
                <Text style={styles.chatMainMenuEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {showEmojis && actions.length > 0 ? <View style={styles.chatMainMenuDivider} /> : null}
        {actions.map((action) => (
          <Pressable
            accessibilityLabel={action.label}
            accessibilityRole="button"
            key={action.key}
            onPress={() => runAction(action)}
            style={({ pressed }) => [styles.chatMainMenuAction, pressed && styles.chatMainMenuActionPressed]}
          >
            <Ionicons
              name={action.icon}
              size={17}
              color={action.destructive ? ROOM_COLORS.danger : ROOM_COLORS.onSurface}
            />
            <Text style={[styles.chatMainMenuActionLabel, action.destructive && styles.chatMainMenuActionLabelDestructive]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
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

function getComposerClosedBottomPadding(bottomInset: number) {
  const hasBottomSafeArea = bottomInset > 0;
  // Mattermost-style edge-to-edge policy: trust OS safe-area when present, but keep
  // a tokenized minimum for Android layouts that can report 0 while drawing edge-to-edge.
  const usesEdgeToEdgeBottom = IS_ANDROID_EDGE_TO_EDGE || (Platform.OS === "ios" && hasBottomSafeArea);
  const fallbackGap = usesEdgeToEdgeBottom ? COMPOSER_EDGE_TO_EDGE_BOTTOM_GAP : COMPOSER_STANDARD_BOTTOM_GAP;

  return Math.max(bottomInset + COMPOSER_CLOSED_SAFE_GAP, fallbackGap);
}

function getChatKeyboardShift(
  keyboardOffset: number,
  keyboardProgress: number,
  closedComposerBottomPadding: number
) {
  "worklet";
  // Geometry:
  // - closed: keyboardOffset=0, progress=0, so shift=0 and the existing
  //   safe-area/navigation padding is preserved;
  // - open: keyboardOffset=-keyboardHeight, progress=1, so the closed gap is
  //   reduced exactly once to COMPOSER_KEYBOARD_OPEN_GAP.
  // Blending that gap reduction with the native progress removes the old clamp
  // dead zone while keeping the keyboard frame as the only motion authority.
  const closedComposerBottomGap = closedComposerBottomPadding;
  const openComposerBottomGap = COMPOSER_KEYBOARD_OPEN_GAP;
  const animatedGapReduction = (closedComposerBottomGap - openComposerBottomGap) * keyboardProgress;
  return keyboardOffset + animatedGapReduction;
}

function hasMeaningfulComposerHeightChange(nextHeight: number, committedHeight: number) {
  return Math.abs(nextHeight - committedHeight) > COMPOSER_HEIGHT_COMMIT_THRESHOLD;
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

// Memoized pane wrappers over the hoisted pane components below. Their handler
// props are stabilized (useStableHandler / already-stable setters) so these skip
// re-rendering when the room screen re-renders for unrelated reasons — chat
// keystrokes, realtime ticks, tab switches. Itinerary / Media / Dishes receive
// no `active` prop, so once mounted they re-render only when their own data
// changes; the chat surface still re-renders on its own prop changes (draft,
// selection, new messages) but no longer on churn from the other panes.
const ItineraryPanelPane = memo(ItineraryPanel);
const MemoryChatMainSurfacePane = memo(MemoryChatMainSurface);
const MediaGalleryPane = memo(MediaGallery);
const DishesPanelPane = memo(DishesPanel);

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const roomId = params.id ?? "";
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  // Keep the chat composer's closed-state baseline stable while the IME covers
  // the gesture area. Edge-to-edge Android can report bottom=0 mid-transition;
  // accepting that live inset would add a React layout correction on top of
  // the UI-thread keyboard transform.
  const [frozenComposerBottomInset] = useState(() => insets.bottom);
  const { resolvedTheme } = useThemePreference();
  applyRoomTheme(resolvedTheme, "unknown");
  const room = useMemoryRoomQuery(roomId);
  useMemoryRoomRealtime(roomId);
  const addParticipant = useAddMemoryParticipantMutation(roomId);
  const addMessage = useAddMemoryMessageMutation(roomId);
  const addDish = useAddMemoryDishMutation(roomId);
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const rateDish = useSetMemoryDishRatingMutation(roomId);
  const createStop = useCreateMemoryStopMutation(roomId);
  const deleteStop = useDeleteMemoryStopMutation(roomId);
  const editMessage = useEditMemoryMessageMutation(roomId);
  const deleteItems = useDeleteMemoryItemsMutation(roomId);
  const dismissFailedMessage = useDismissFailedMemoryMessage(roomId);
  const markRead = useMarkMemoryRoomReadMutation(roomId);
  const leaveRoom = useLeaveMemoryRoomMutation(roomId);
  const requestCircleAccess = useRequestCircleAccessMutation();
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");
  const addMessageMutateAsyncRef = useRef(addMessage.mutateAsync);
  addMessageMutateAsyncRef.current = addMessage.mutateAsync;
  const peopleInputRef = useRef<TextInput>(null);
  const messageInputRef = useRef<TextInput>(null);
  const chatMainListRef = useRef<ChatMainAnimatedList<MemoryChatMainMessage>>(null);
  const keyboardVisibleRef = useRef(false);
  const nearBottomRef = useRef(false);
  const composerHeightRef = useRef(0);
  const pendingComposerHeightRef = useRef<number | null>(null);
  const reconcileChatAfterKeyboardSettleRef = useRef<() => void>(() => {});
  const reconcileChatAfterKeyboardSettle = useCallback(() => {
    reconcileChatAfterKeyboardSettleRef.current();
  }, []);
  // Active chat uses the vendored inverted AnimatedFlatList (newest at offset 0).
  // Keep bottom-follow wired to that live list, not the inactive ChatTimeline.
  const scrollChatToBottom = useCallback((animated: boolean) => {
    chatMainListRef.current?.scrollToOffset({ animated, offset: 0 });
  }, []);
  const readMarkerRef = useRef<string | null>(null);
  const markReadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatOpenMarkedRef = useRef(false);
  const deletingItemKeysRef = useRef<Set<string>>(new Set());
  const selectedItemKeysRef = useRef<string[]>([]);
  const sendSequenceRef = useRef(0);
  const suppressSelectionToggleRef = useRef<string | null>(null);
  const suppressSelectionToggleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peopleToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    mode,
    pagerPosition,
    paneTabMode,
    requestRoomMode
  } = useMemoryRoomController(params.tab);
  const [peopleClosing, setPeopleClosing] = useState(false);
  const [participant, setParticipant] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<UserSearchResult[]>([]);
  const [peopleToastMessage, setPeopleToastMessage] = useState("");
  const [dishName, setDishName] = useState("");
  const [dishNote, setDishNote] = useState("");
  const [dishRating, setDishRating] = useState(0);
  // Dish whose detail / "who rated" sheet is open (null = closed). Held by id so
  // realtime rating updates flow into the open sheet via the live `data.dishes`.
  const [detailDishId, setDetailDishId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const messageDraftRef = useRef("");
  const [editingMessage, setEditingMessage] = useState<MemoryMessage | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<MemoryMessage | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [messageReactions, setMessageReactions] = useState<MemoryReactionState>({});
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [cameraOpening, setCameraOpening] = useState(false);
  const [attachmentOptionsVisible, setAttachmentOptionsVisible] = useState(false);
  const [stopComposerVisible, setStopComposerVisible] = useState(false);
  const [dishTargetStopId, setDishTargetStopId] = useState<string | null>(null);
  const [attachmentInitialView, setAttachmentInitialView] = useState<AttachmentSheetView>("actions");
  const [attachmentOriginMode, setAttachmentOriginMode] = useState<RoomMode>("overview");
  const [floatingAddMenuOpen, setFloatingAddMenuOpen] = useState(false);
  // When an option is launched from the speed-dial, re-open the speed-dial if
  // that sub-flow is cancelled (so the user can pick the other option).
  const [reopenAddMenuOnCancel, setReopenAddMenuOnCancel] = useState(false);
  // Per-frame openness (0 closed -> 1 open) of the dish/media sheet's keyboard,
  // written from inside the modal. Drives the header hide in exact lockstep.
  const dishKeyboardProgress = useSharedValue(0);
  const [roomActionsVisible, setRoomActionsVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaViewerState | null>(null);
  const [chatBottomClearance, setChatBottomClearance] = useState(CHAT_COMPOSER_CLEARANCE);
  const [memberCircleStatusOverrides, setMemberCircleStatusOverrides] = useState<Record<string, MemberCircleStatus>>({});
  const floatingAddMenuProgress = useRef(new Animated.Value(0)).current;
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
  function updateMessageDraft(value: string) {
    messageDraftRef.current = value;
    setMessage(value);
  }

  const finishPeopleClose = useCallback(() => {
    setPeopleClosing(false);
    requestRoomMode("overview");
  }, [requestRoomMode]);

  useEffect(() => {
    if (!room.data) return;
    setSelectedMedia((current) => {
      if (!current) return current;
      const latestPhotos = mergeMemoryPhotos(room.data.photos, photosFromMessages(room.data.messages));
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

  // Safety: if the sheet closes before the keyboard finishes dismissing, snap the
  // header back.
  useEffect(() => {
    if (!attachmentOptionsVisible) dishKeyboardProgress.value = 0;
  }, [attachmentOptionsVisible, dishKeyboardProgress]);

  useEffect(() => () => {
    if (peopleToastTimeoutRef.current) clearTimeout(peopleToastTimeoutRef.current);
    if (suppressSelectionToggleTimeoutRef.current) clearTimeout(suppressSelectionToggleTimeoutRef.current);
  }, []);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

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

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedMedia) {
        setSelectedMedia(null);
        return true;
      }

      if (roomActionsVisible) {
        setRoomActionsVisible(false);
        return true;
      }

      if (attachmentOptionsVisible) {
        setAttachmentOptionsVisible(false);
        if (reopenAddMenuOnCancel) {
          setReopenAddMenuOnCancel(false);
          setFloatingAddMenuOpen(true);
        }
        return true;
      }

      if (stopComposerVisible) {
        setStopComposerVisible(false);
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

      router.dismissTo({ pathname: "/profile", params: { tab: "memories" } });
      return true;
    });

    return () => subscription.remove();
  }, [
    attachmentOptionsVisible,
    detailDishId,
    editingMessage,
    floatingAddMenuOpen,
    mode,
    peopleClosing,
    reactionPickerMessageId,
    reopenAddMenuOnCancel,
    replyingToMessage,
    roomActionsVisible,
    router,
    selectedItemKeys.length,
    selectedMedia,
    stopComposerVisible
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

  useEffect(() => () => {
    if (!markReadTimeoutRef.current) return;
    clearTimeout(markReadTimeoutRef.current);
    markReadTimeoutRef.current = null;
    markRead.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening the chat tab counts as reading the room, no matter where the list is
  // anchored. Requiring "near bottom" here left rooms permanently unread whenever the
  // entry anchored at the unread divider, so every entry re-anchored to stale unread.
  useEffect(() => {
    if (mode !== "chat") {
      chatOpenMarkedRef.current = false;
      return;
    }
    if (chatOpenMarkedRef.current) return;
    chatOpenMarkedRef.current = true;
    markLatestRoomRead();
  }, [markRead, mode, roomId]);

  useEffect(() => {
    if (mode !== "chat" || !nearBottomRef.current) return;
    markLatestRoomRead();
  }, [markRead, mode, room.data, roomId]);

  // Keyboard handling: one common surface carries the composer, message list,
  // and panel-coloured bridge using the root provider's native keyboard frame.
  // The children have no keyboard transform or settle-time padding handoff, so
  // their relative coordinates cannot diverge during the IME transition. The
  // closed safe-area/navigation gap is blended down to the open keyboard gap
  // over the native progress.
  const keyboardMotion = useKeyboardMotion();
  const isChatMode = mode === "chat";
  const closedComposerBottomPadding = getComposerClosedBottomPadding(frozenComposerBottomInset);
  const chatKeyboardShift = useDerivedValue(() => {
    if (!isChatMode) return 0;
    return getChatKeyboardShift(
      keyboardMotion.offset.value,
      keyboardMotion.progress.value,
      closedComposerBottomPadding
    );
  }, [closedComposerBottomPadding, isChatMode]);
  const chatMainSurfaceKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: chatKeyboardShift.value }]
  }), []);
  const composerBottomInsetStyle = useMemo<ViewStyle>(() => ({
    paddingBottom: closedComposerBottomPadding
  }), [closedComposerBottomPadding]);

  function repinChatToBottom() {
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => scrollChatToBottom(false));
  }

  function isChatKeyboardTransitioning() {
    if (!isChatMode) return false;
    const progress = keyboardMotion.progress.value;
    return progress > 0.001 && progress < 0.999;
  }

  function commitComposerHeight(nextHeight: number, repin = true) {
    if (!hasMeaningfulComposerHeightChange(nextHeight, composerHeightRef.current)) return false;
    composerHeightRef.current = nextHeight;
    setChatBottomClearance(nextHeight);
    if (repin) repinChatToBottom();
    return true;
  }

  function handleComposerLayout(event: LayoutChangeEvent) {
    const nextHeight = event.nativeEvent.layout.height;
    if (!hasMeaningfulComposerHeightChange(nextHeight, composerHeightRef.current)) {
      pendingComposerHeightRef.current = null;
      return;
    }
    if (isChatKeyboardTransitioning()) {
      pendingComposerHeightRef.current = nextHeight;
      return;
    }
    pendingComposerHeightRef.current = null;
    commitComposerHeight(nextHeight);
  }

  function handleChatNearBottomChange(isNearBottom: boolean) {
    nearBottomRef.current = isNearBottom;
    if (isNearBottom) markLatestRoomRead();
  }

  reconcileChatAfterKeyboardSettleRef.current = () => {
    if (!isChatMode) return;
    const pendingHeight = pendingComposerHeightRef.current;
    pendingComposerHeightRef.current = null;
    if (pendingHeight == null) return;
    if (!hasMeaningfulComposerHeightChange(pendingHeight, composerHeightRef.current)) return;
    if (!commitComposerHeight(pendingHeight, false)) return;
    // Reconcile only when real composer content changed during the transition.
    // An ordinary keyboard open/close performs no scroll or React layout work.
    repinChatToBottom();
  };

  useAnimatedReaction(
    () => keyboardMotion.progress.value,
    (currentProgress, previousProgress) => {
      const currentBoundary = currentProgress <= 0.001 ? 0 : currentProgress >= 0.999 ? 1 : -1;
      const previousBoundary = previousProgress == null
        ? currentBoundary
        : previousProgress <= 0.001
          ? 0
          : previousProgress >= 0.999
            ? 1
            : -1;
      if (currentBoundary < 0 || currentBoundary === previousBoundary) return;
      runOnJS(reconcileChatAfterKeyboardSettle)();
    },
    [keyboardMotion.progress, reconcileChatAfterKeyboardSettle]
  );

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

  async function submitMessage(draftOverride?: string) {
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
        const clientId = `text:${Date.now()}:${sendSequenceRef.current}`;
        sendSequenceRef.current += 1;
        // WhatsApp-style: the message just appears at the bottom (optimistic),
        // no entry animation. Clear the input and pin to the newest message.
        updateMessageDraft("");
        setReplyingToMessage(null);
        void addMessageMutateAsyncRef.current({
          body: outgoingBody,
          clientId,
          replyToMessageId: outgoingReply?.id ?? null
        }).catch(() => {
          // The failed optimistic row stays visible with retry/cancel actions.
        });
        // The active vendored list pins from MemoryChatMainSurface after the new
        // row/layout exists, so avoid a second stale-height scroll here.
        requestAnimationFrame(() => {
          messageInputRef.current?.focus();
        });
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
    if (target.deliveryStatus !== "failed") return;
    const clientId = `retry:${Date.now()}:${sendSequenceRef.current}`;
    sendSequenceRef.current += 1;
    void addMessageMutateAsyncRef.current({
      body: target.body,
      clientId,
      replacesMessageId: target.id,
      replyToMessageId: target.replyToMessageId
    }).catch(() => {
      // The replacement optimistic row is marked failed by the mutation hook.
    });
    requestRoomMode("chat");
  }

  function cancelFailedMessage(target: MemoryMessage) {
    if (target.deliveryStatus !== "failed") return;
    dismissFailedMessage(target.id);
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
    requestRoomMode("chat");
    requestAnimationFrame(() => {
      setTimeout(() => messageInputRef.current?.focus(), 80);
    });
  }

  function cancelEditMessage() {
    setEditingMessage(null);
    updateMessageDraft("");
  }

  function cancelReplyMessage() {
    setReplyingToMessage(null);
  }

  function beginSelection(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    setReactionPickerMessageId(null);
    setEditingMessage(null);
    setReplyingToMessage(null);
    updateMessageDraft("");
    selectedItemKeysRef.current = [key];
    setSelectedItemKeys([key]);
    suppressSelectionToggleRef.current = key;
    if (suppressSelectionToggleTimeoutRef.current) clearTimeout(suppressSelectionToggleTimeoutRef.current);
    suppressSelectionToggleTimeoutRef.current = null;
    requestRoomMode("chat");
  }

  function finishSelectionPress(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    if (suppressSelectionToggleRef.current !== key) return;
    if (suppressSelectionToggleTimeoutRef.current) clearTimeout(suppressSelectionToggleTimeoutRef.current);
    suppressSelectionToggleTimeoutRef.current = setTimeout(() => {
      if (suppressSelectionToggleRef.current === key) suppressSelectionToggleRef.current = null;
      suppressSelectionToggleTimeoutRef.current = null;
    }, 700);
  }

  function toggleSelectedItem(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    if (suppressSelectionToggleRef.current === key) {
      suppressSelectionToggleRef.current = null;
      if (suppressSelectionToggleTimeoutRef.current) {
        clearTimeout(suppressSelectionToggleTimeoutRef.current);
        suppressSelectionToggleTimeoutRef.current = null;
      }
      return;
    }
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

    try {
      if (editingMessage && messageIds.includes(editingMessage.id)) cancelEditMessage();
      if (replyingToMessage && messageIds.includes(replyingToMessage.id)) setReplyingToMessage(null);
      if (clearSelection) {
        selectedItemKeysRef.current = [];
        setSelectedItemKeys([]);
      }
      void deleteItems.mutateAsync({ messageIds, photoIds }).catch((error) => {
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

  function deleteChatTarget(target: MemoryActionTarget) {
    const label = target.type === "message" ? "message" : "media";
    confirmDeleteMemoryItemKeys([memoryActionKey(target)], {
      clearSelection: false,
      title: `Delete ${label}?`
    });
  }

  function removeSelectedItems() {
    const keysToDelete = selectedItemKeysRef.current.length > 0 ? selectedItemKeysRef.current : selectedItemKeys;
    const queuedKeys = keysToDelete.filter((key) => !deletingItemKeysRef.current.has(key));
    if (queuedKeys.length === 0) return;
    const messageCount = queuedKeys.filter((key) => key.startsWith("message:")).length;
    const photoCount = queuedKeys.filter((key) => key.startsWith("photo:")).length;
    const title = queuedKeys.length === 1
      ? `Delete ${messageCount === 1 ? "message" : "media"}?`
      : `Delete ${messageCount + photoCount} items?`;
    confirmDeleteMemoryItemKeys(queuedKeys, {
      clearSelection: true,
      title
    });
  }

  async function sendMediaAssets(selectedAssets: MemoryCaptureAsset[]) {
    setMediaError("");
    if (selectedAssets.length === 0) return;
    const validationError = validateMemoryMediaAssets(selectedAssets.map((asset) => ({
      duration: asset.duration,
      fileSize: asset.fileSize,
      mediaMimeType: asset.mimeType,
      mediaType: asset.type,
      mediaUri: asset.uri
    })));
    if (validationError) {
      setMediaError(validationError);
      return;
    }

    try {
      await addPhoto.mutateAsync({
        assets: selectedAssets.map((asset) => ({
          duration: asset.duration ?? null,
          fileSize: asset.fileSize ?? null,
          imageHeight: asset.height ?? null,
          imageWidth: asset.width ?? null,
          mediaMimeType: asset.mimeType,
          mediaType: asset.type === "video" || asset.mimeType?.startsWith("video/") ? "video" : "image",
          mediaUri: asset.uri
        })),
        body: message.trim() || undefined,
        replyToMessageId: replyingToMessage?.id ?? null,
        roomId
      });
      updateMessageDraft("");
      setReplyingToMessage(null);
      const nextMode = attachmentOriginMode === "chat" ? "chat" : "media";
      requestRoomMode(nextMode);
      if (nextMode === "chat") requestAnimationFrame(() => scrollChatToBottom(true));
    } catch {
      // Rendered from mutation state.
    }
  }

  async function sendAudioMessage(asset: AddMemoryMediaAsset) {
    setMediaError("");
    if (editingMessage) throw new Error("Finish editing before sending audio.");
    const validationError = validateMemoryMediaAssets([asset]);
    if (validationError) {
      setMediaError(validationError);
      throw new Error(validationError);
    }

    try {
      await addPhoto.mutateAsync({
        assets: [asset],
        replyToMessageId: replyingToMessage?.id ?? null,
        roomId
      });
      updateMessageDraft("");
      setReplyingToMessage(null);
      requestRoomMode("chat");
      requestAnimationFrame(() => scrollChatToBottom(true));
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : "Could not send audio.");
      throw error;
    }
  }

  async function submitMedia(picker: () => Promise<MemoryMediaPickerResult>) {
    setAttachmentOptionsVisible(false);
    setMediaError("");
    const result = await picker();
    if (result.error) {
      setMediaError(result.error);
      return;
    }
    await sendMediaAssets(result.assets ?? (result.asset ? [result.asset] : []));
  }

  async function submitDish() {
    try {
      await addDish.mutateAsync({
        dishName,
        note: dishNote,
        rating: dishRating || null,
        stopId: dishTargetStopId
      });
      setDishName("");
      setDishNote("");
      setDishRating(0);
      setDishTargetStopId(null);
      return true;
    } catch {
      // Rendered from mutation state.
      return false;
    }
  }

  function openStopComposer() {
    setFloatingAddMenuOpen(false);
    setStopComposerVisible(true);
  }

  async function submitStop(input: { stopType: MemoryStopType; name: string; note?: string }) {
    try {
      await createStop.mutateAsync(input);
      setStopComposerVisible(false);
      return true;
    } catch {
      // Rendered from mutation state.
      return false;
    }
  }

  function addDishToStop(stopId: string) {
    setDishTargetStopId(stopId);
    setFloatingAddMenuOpen(false);
    setReopenAddMenuOnCancel(false);
    openAttachmentOptions("dish");
  }

  function removeStop(stopId: string) {
    deleteStop.mutate(stopId);
  }

  async function submitDishFromAttachment() {
    const didAdd = await submitDish();
    if (!didAdd) return;
    setAttachmentOptionsVisible(false);
    requestRoomMode("chat");
    requestAnimationFrame(() => scrollChatToBottom(true));
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
    setSelectedMedia({ index, items: group });
    void room.refetch();
  }

  function refreshSelectedMedia() {
    void room.refetch();
  }

  function openAttachmentOptions(initialView: AttachmentSheetView = "actions") {
    setAttachmentOriginMode(mode);
    setAttachmentInitialView(initialView);
    setAttachmentOptionsVisible(true);
  }

  // Cancel path for the attachment sheet. A successful dish add closes the sheet
  // directly (and switches mode), so it never routes through here — only a real
  // dismiss does, which is where we restore the speed-dial.
  function cancelAttachmentOptions() {
    setAttachmentOptionsVisible(false);
    if (reopenAddMenuOnCancel) {
      setReopenAddMenuOnCancel(false);
      setFloatingAddMenuOpen(true);
    }
  }

  function closeFloatingAddMenu() {
    setFloatingAddMenuOpen(false);
  }

  function openFloatingAddMedia() {
    setFloatingAddMenuOpen(false);
    setAttachmentOptionsVisible(false);
    router.push({
      pathname: "/memories/[id]/camera",
      params: { id: roomId }
    });
  }

  function openFloatingAddDish() {
    setDishTargetStopId(null);
    setFloatingAddMenuOpen(false);
    setReopenAddMenuOnCancel(true);
    openAttachmentOptions("dish");
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

  async function openNativeCameraForMemory() {
    if (cameraOpening) return;
    setCameraOpening(true);
    setMediaError("");
    try {
      const result = await pickMemoryMediaFromCamera();
      if (result.error) {
        setMediaError(result.error);
        Alert.alert("Could not open camera", result.error);
        return;
      }
      const asset = result.asset;
      if (!asset?.uri) return;
      const mediaType = asset.type === "video" || asset.mimeType?.startsWith("video/") ? "video" : "image";
      const capture = saveMemoryCapture({
        duration: asset.duration ?? null,
        fileSize: asset.fileSize ?? null,
        height: asset.height ?? null,
        mediaType,
        mimeType: asset.mimeType ?? null,
        source: "camera",
        uri: asset.uri,
        width: asset.width ?? null
      });
      router.push({
        pathname: "/memories/[id]/preview",
        params: { captureId: capture.id, id: roomId }
      });
    } catch {
      setMediaError("Could not open camera.");
      Alert.alert("Could not open camera", "Try again.");
    } finally {
      setCameraOpening(false);
    }
  }

  function openCamera() {
    setAttachmentOptionsVisible(false);
    void openNativeCameraForMemory();
  }

  function goBackToMemories() {
    router.dismissTo({ pathname: "/profile", params: { tab: "memories" } });
  }

  const olderMessagesCursor = room.data?.messages[0]?.createdAt ?? null;
  const olderMessages = useMemoryMessagePagesQuery(roomId, olderMessagesCursor);
  const olderMessageItems = useMemo(() => (
    olderMessages.data?.pages.flatMap((page) => page.messages) ?? []
  ), [olderMessages.data]);
  const mergedRoomData = useMemo(() => (
    room.data ? mergeRoomMessages(room.data, olderMessageItems) : null
  ), [olderMessageItems, room.data]);
  const mediaPages = useMemoryMediaPagesQuery(roomId, mode === "media");
  const pagedMediaPhotos = useMemo(() => (
    mediaPages.data?.pages.flatMap((page) => page.photos) ?? []
  ), [mediaPages.data]);
  const galleryPhotos = useMemo(() => (
    mergedRoomData ? mergeMemoryPhotos(pagedMediaPhotos, mergedRoomData.photos) : []
  ), [mergedRoomData, pagedMediaPhotos]);
  useEffect(() => {
    if (mode !== "media") return;
    const prefetchTask = InteractionManager.runAfterInteractions(() => {
      galleryPhotos.slice(0, MEDIA_GALLERY_PREFETCH_COUNT).forEach(prefetchMemoryMedia);
    });
    return () => prefetchTask.cancel();
  }, [galleryPhotos, mode]);
  const hasLoadedOlderMessagePages = Boolean(olderMessages.data?.pages.length);
  const initialMessageSliceMayHaveOlder = (room.data?.messages.length ?? 0) >= MEMORY_CHAT_PRELOAD_LIMIT;
  const canLoadOlderMessages = initialMessageSliceMayHaveOlder && Boolean(olderMessagesCursor) && (
    !hasLoadedOlderMessagePages || Boolean(olderMessages.hasNextPage)
  );
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
  const stableRateDish = useStableHandler((dishId: string, rating: number) => rateDish.mutate({ dishId, rating }));
  const stableAddDishToStop = useStableHandler(addDishToStop);
  const stableRemoveStop = useStableHandler(removeStop);
  const stableBeginSelection = useStableHandler(beginSelection);
  const stableToggleSelection = useStableHandler(toggleSelectedItem);
  const stableCancelSelection = useStableHandler(cancelSelection);
  const stableDeleteSelected = useStableHandler(removeSelectedItems);
  const stableDeleteTarget = useStableHandler(deleteChatTarget);
  const stableEditMessage = useStableHandler(beginEditMessage);
  const stableCancelEdit = useStableHandler(cancelEditMessage);
  const stableReplyMessage = useStableHandler(beginReplyMessage);
  const stableCancelReply = useStableHandler(cancelReplyMessage);
  const stableChangeMessage = useStableHandler(updateMessageDraft);
  const stableSend = useStableHandler(submitMessage);
  const stableSendAudio = useStableHandler(sendAudioMessage);
  const stableToggleReaction = useStableHandler(toggleMessageReaction);
  const stableInputToolbarLayout = useStableHandler(handleComposerLayout);
  const stableNearBottomChange = useStableHandler(handleChatNearBottomChange);

  if (room.isLoading) {
    return (
      <Screen>
        <MemoryCenterState loading />
      </Screen>
    );
  }

  if (room.isError || !room.data) {
    return (
      <Screen>
        <MemoryCenterState
          body={room.error?.message ?? "Table memory not found"}
          buttonLabel="Go back"
          onPress={goBackToMemories}
          title="Could not load memory"
        />
      </Screen>
    );
  }

  const data = mergedRoomData ?? room.data;
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
  const editableSelectedMessage =
    selectedTargets.length === 1 &&
    selectedTargets[0].type === "message" &&
    canEditMemoryMessage(selectedTargets[0].value, myUsername)
      ? selectedTargets[0].value
      : null;
  const floatingAddAvailable = !attachmentOptionsVisible && !selectedMedia;
  const floatingAddVisible = mode === "overview" && floatingAddAvailable;
  const headerMode = mode === "people" ? "overview" : mode;
  const summaryUnreadChatCount = memoryRoomSummariesFromPages(
    queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
  ).find((memory) => memory.id === data.id)?.unreadCount;
  const unreadChatCount = summaryUnreadChatCount ?? unreadChatMessageCount(data, myUsername);

  return (
    <Screen padded={false} style={styles.screenContent}>
      <RoomHeader
        data={data}
        displayRestaurantName={displayRestaurantName}
        keyboardProgress={dishKeyboardProgress}
        mode={headerMode}
        myUsername={myUsername}
        pagerPosition={pagerPosition}
        onAddPeople={openPeopleAdd}
        onBack={mode === "people" ? closePeopleScreen : goBackToMemories}
        onChangeMode={requestRoomMode}
        onOpenActions={openRoomActions}
        onViewPeople={openPeopleList}
        transitioning={mode === "people"}
        unreadChatCount={unreadChatCount}
      />
      <RoomKeyboardContainer chatMode={mode === "chat"}>
        <View
          style={[
            styles.roomStage,
            headerMode === "overview" && styles.roomStageTable,
            mode === "chat" && styles.roomStageChat
          ]}
        >
          <FoodChatWallpaper patternKey={roomOccasionTheme.backgroundPattern} themeKey={`${resolvedTheme}-${roomOccasionTheme.id}`} visible />
          <View style={styles.roomStageShift}>
            <View style={styles.body}>
              <View style={styles.roomPager}>
                <RoomPane active={paneTabMode === "overview"} motion="fade">
                  <ItineraryPanelPane
                    dishes={data.dishes}
                    error={createStop.error?.message ?? deleteStop.error?.message}
                    onAddDishToStop={stableAddDishToStop}
                    onOpenDish={setDetailDishId}
                    onRemoveStop={stableRemoveStop}
                    removingStopId={deleteStop.isPending ? deleteStop.variables ?? null : null}
                    stops={data.stops}
                    themeCopy={roomOccasionTheme.copy}
                    topInset={TABLE_HEADER_CLEARANCE}
                  />
                </RoomPane>
                <RoomPane active={paneTabMode === "chat"}>
                  <MemoryChatMainSurfacePane
                    active={paneTabMode === "chat"}
                    bottomClearance={chatBottomClearance}
                    canDeleteSelected={canDeleteSelected}
                    canLoadOlderMessages={canLoadOlderMessages}
                    data={data}
                    deleteError={errorMessage(deleteItems.error)}
                    deletePending={deleteItems.isPending}
                    editableSelectedMessage={editableSelectedMessage}
                    editingMessage={editingMessage}
                    inputRef={messageInputRef}
                    listRef={chatMainListRef}
                    loadingOlderMessages={olderMessages.isFetchingNextPage}
                    message={message}
                    myUsername={myUsername}
                    selectedItemKeys={selectedItemKeys}
                    onBeginSelection={stableBeginSelection}
                    onCancelEdit={stableCancelEdit}
                    onCancelReply={stableCancelReply}
                    onCancelSelection={stableCancelSelection}
                    onChangeMessage={stableChangeMessage}
                    onDeleteSelected={stableDeleteSelected}
                    onDeleteTarget={stableDeleteTarget}
                    onEditMessage={stableEditMessage}
                    onInputToolbarLayout={stableInputToolbarLayout}
                    onLoadOlderMessages={loadOlderMessages}
                    onNearBottomChange={stableNearBottomChange}
                    onOpenDish={setDetailDishId}
                    onOpenMedia={stableOpenMedia}
                    onRateDish={stableRateDish}
                    onReplyMessage={stableReplyMessage}
                    onSend={stableSend}
                    onSendAudio={stableSendAudio}
                    onToggleSelection={stableToggleSelection}
                    onToggleReaction={stableToggleReaction}
                    pendingDishId={rateDish.isPending ? rateDish.variables?.dishId ?? null : null}
                    reactions={messageReactions}
                    replyingToMessage={replyingToMessage}
                    resolvedTheme={resolvedTheme}
                    scrollToBottom={scrollChatToBottom}
                    surfaceKeyboardStyle={chatMainSurfaceKeyboardStyle}
                    toolbarInsetStyle={composerBottomInsetStyle}
                    typingVisible={addMessage.isPending || addPhoto.isPending}
                  />
                </RoomPane>
                <RoomPane active={paneTabMode === "media"}>
                  <MediaGalleryPane
                    error={mediaError || addPhoto.error?.message || errorMessage(mediaPages.error)}
                    hasMore={Boolean(mediaPages.hasNextPage)}
                    loading={mediaPages.isLoading && galleryPhotos.length === 0}
                    loadingMore={mediaPages.isFetchingNextPage}
                    onLoadMore={loadMoreMedia}
                    onOpenMedia={stableOpenMedia}
                    photos={galleryPhotos}
                    themeCopy={roomOccasionTheme.copy}
                  />
                </RoomPane>
                <RoomPane active={paneTabMode === "dishes"}>
                  <DishesPanelPane
                    dishes={data.dishes}
                    error={rateDish.error?.message}
                    onOpenDish={setDetailDishId}
                    onRateDish={stableRateDish}
                    pendingDishId={rateDish.isPending ? rateDish.variables?.dishId ?? null : null}
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
        <MediaViewer
          onClose={() => setSelectedMedia(null)}
          onMediaError={refreshSelectedMedia}
          selection={selectedMedia}
        />
      </RoomKeyboardContainer>
      {/* Scrim for the speed-dial only. The dish/media sheet carries its own
          backdrop (attachSheetBackdrop) that fades in/out with its slide, so we
          don't dim here for it — that would stack a second, abrupt black layer. */}
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
          onStop={openStopComposer}
          open={floatingAddMenuOpen}
          progress={floatingAddMenuProgress}
        />
      ) : null}
      {/* Screen-level so the overlay covers the full screen (RN anchors absolute
          children to their immediate parent); rendered after the speed-dial so it
          stacks above the scrim. */}
      <AttachmentOptionsSheet
        dishError={addDish.error?.message}
        dishName={dishName}
        dishNote={dishNote}
        dishPending={addDish.isPending}
        dishRating={dishRating}
        initialView={attachmentInitialView}
        onChangeDishName={setDishName}
        onChangeDishNote={setDishNote}
        onChangeDishRating={setDishRating}
        onCamera={openCamera}
        onClose={cancelAttachmentOptions}
        onDishSubmit={submitDishFromAttachment}
        onGallery={() => submitMedia(pickMemoryMediaFromGallery)}
        keyboardProgress={dishKeyboardProgress}
        pending={addPhoto.isPending || cameraOpening}
        visible={attachmentOptionsVisible}
      />
      <StopComposerSheet
        error={createStop.error?.message}
        onClose={() => setStopComposerVisible(false)}
        onSubmit={submitStop}
        pending={createStop.isPending}
        visible={stopComposerVisible}
      />
      <DishDetailSheet
        dish={detailDish}
        error={rateDish.error?.message}
        myUsername={myUsername}
        onClose={() => setDetailDishId(null)}
        onRateDish={(dishId, rating) => rateDish.mutate({ dishId, rating })}
        pending={rateDish.isPending && rateDish.variables?.dishId === detailDishId}
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
  unreadChatCount
}: {
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
          mode={visualTabMode}
          onChangeMode={onChangeMode}
          pagerPosition={pagerPosition}
          unreadChatCount={unreadChatCount}
        />
      </Reanimated.View>
    </Reanimated.View>
  );
}

function RoomModeTabs({
  mode,
  onChangeMode,
  pagerPosition,
  unreadChatCount
}: {
  mode: RoomTabMode;
  onChangeMode: (mode: RoomMode) => void;
  pagerPosition: SharedValue<number>;
  unreadChatCount: number;
}) {
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const tabTrackWidth = Math.max(0, tabBarWidth - 4);
  const tabWidth = tabTrackWidth > 0 ? tabTrackWidth / ROOM_TABS.length : 0;
  const tabIndicatorStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: 2 + tabWidth * Math.min(Math.max(pagerPosition.value, 0), ROOM_TABS.length - 1) }
    ]
  }));

  return (
    <View style={styles.modeTabsAnimated}>
      <View
        onLayout={(event) => setTabBarWidth(event.nativeEvent.layout.width)}
        style={styles.modeTabs}
      >
        {tabWidth > 0 ? (
          <Reanimated.View
            pointerEvents="none"
            style={[
              styles.modeTabIndicator,
              { width: tabWidth },
              tabIndicatorStyle
            ]}
          />
        ) : null}
        {ROOM_TABS.map((tab) => (
          <ModeButton
            active={mode === tab.mode}
            icon={tab.icon}
            key={tab.mode}
            label={tab.label}
            onPress={() => onChangeMode(tab.mode)}
            unreadCount={tab.mode === "chat" ? unreadChatCount : 0}
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
  active,
  icon,
  label,
  onPress,
  unreadCount
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  unreadCount?: number;
}) {
  const iconColor = active ? ROOM_COLORS.onSurface : ROOM_COLORS.muted;
  const hasUnread = Boolean(unreadCount && unreadCount > 0);
  const accessibilityLabel = hasUnread ? `${label}, ${unreadCount} unread` : label;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        pressed && !active && styles.modeButtonPressed
      ]}
    >
      <Ionicons name={icon} size={15} color={iconColor} />
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
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
  lazy = true,
  motion = "lift"
}: {
  active: boolean;
  children: ReactNode;
  lazy?: boolean;
  motion?: "fade" | "lift";
}) {
  const [hasMounted, setHasMounted] = useState(active || !lazy);
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    if (active) setHasMounted(true);
  }, [active]);

  // Cross-fade the content on the SAME timing (MEMORY_ROOM_TAB_TIMING) as the
  // header collapse + tab indicator, started in the same commit, so the whole
  // room moves as one unit. No enter delay, and warmed panes fade in WITH the
  // header instead of snapping ahead of it (the old instant-snap was the desync).
  // Reanimated's withTiming also interrupts gracefully from the current value,
  // so rapid tab switches no longer hard-cut.
  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, MEMORY_ROOM_TAB_TIMING);
  }, [active, progress]);

  const liftOffset = motion === "lift" ? ROOM_PANE_TRANSLATE_Y : 0;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: liftOffset * (1 - progress.value) }]
  }));

  if (lazy && !hasMounted) return null;

  return (
    <Reanimated.View
      accessibilityElementsHidden={!active}
      collapsable={false}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={[styles.roomPagerPage, { zIndex: active ? 2 : 1 }, animatedStyle]}
    >
      {children}
    </Reanimated.View>
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
  visible,
  open,
  progress
}: {
  bottomInset: number;
  onToggle: () => void;
  visible: boolean;
  open: boolean;
  progress: Animated.Value;
}) {
  const visibilityProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const buttonBottom = Math.max(FLOATING_ADD_EDGE_OFFSET, bottomInset + 6);
  const iconRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "45deg"]
  });
  const buttonOpacity = visibilityProgress;
  const buttonTranslateX = visibilityProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [86, 0]
  });
  const buttonScale = visibilityProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1]
  });

  useEffect(() => {
    Animated.timing(visibilityProgress, {
      duration: visible ? 180 : 150,
      easing: Easing.out(Easing.cubic),
      toValue: visible ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [visibilityProgress, visible]);

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.floatingAddButtonFrame,
        {
          bottom: buttonBottom,
          opacity: buttonOpacity,
          right: FLOATING_ADD_EDGE_OFFSET,
          transform: [{ translateX: buttonTranslateX }, { scale: buttonScale }]
        }
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
    </Animated.View>
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
      <AddMenuAction icon="location-outline" label="Place" onPress={onStop} progress={progress} stackIndexFromBottom={2} />
      <AddMenuAction icon="restaurant-outline" label="Dish" onPress={onDish} progress={progress} stackIndexFromBottom={1} />
      <AddMenuAction icon="camera-outline" label="Media" onPress={onMedia} progress={progress} stackIndexFromBottom={0} />
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
        <Text style={styles.timelineHistoryText}>Could not load earlier messages</Text>
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

function memoryMediaCacheKey(media: MemoryPhoto) {
  return media.storagePath || media.id || media.publicUrl;
}

function prefetchMemoryMedia(media: MemoryPhoto) {
  const cacheKey = memoryMediaCacheKey(media);
  if (!media.publicUrl || prefetchedMemoryMediaKeys.has(cacheKey)) return;
  prefetchedMemoryMediaKeys.add(cacheKey);
  if (media.mediaType === "video") {
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
  pendingDishId,
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
  onRateDish: (dishId: string, rating: number) => void;
  onCancelFailedMessage: (message: MemoryMessage) => void;
  onReplyMessage: (message: MemoryMessage) => void;
  onRetryFailedMessage: (message: MemoryMessage) => void;
  onScrollBeginDrag: () => void;
  onSelectionPressOut: (target: MemoryActionTarget) => void;
  onToggleSelection: (target: MemoryActionTarget) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  lastReadAt: string | null;
  olderMessagesError?: string;
  pendingDishId?: string | null;
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
    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
      if (row.type === "message") byId.set(row.value.id, index);
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
  const rateRowDish = useCallback((dishId: string, rating: number) => rowHandlersRef.current.onRateDish(dishId, rating), []);
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
          reactionPickerOpen={!selectionMode && reactionPickerMessageId === item.value.id}
          reactions={reactions[item.value.id] ?? {}}
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
          onOpenDish={() => openRowDish(item.value.id)}
          onRateDish={(rating) => rateRowDish(item.value.id, rating)}
          pending={pendingDishId === item.value.id}
          rowStyle={rowStyle}
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
    pendingDishId,
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
          <Ionicons name="chevron-down" size={15} color={ROOM_COLORS.onCool} />
          <Text style={styles.chatLatestButtonText}>{hasUnseenLatest ? "New" : "Latest"}</Text>
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

const ROMANTIC_WALLPAPER_PLACEMENTS = [
  { transform: "translate(28 30) scale(0.55)", strokeWidth: 2 },
  { transform: "translate(124 96) scale(0.48)", strokeWidth: 2 },
  { transform: "translate(198 38) scale(0.42)", strokeWidth: 2 }
] as const;
const ROMANTIC_HEART_PATH = "M12 21s-7-4.4-9.3-8.2C.8 9.7 1.6 6 4.7 5.2c1.8-.5 3.5.2 4.5 1.6 1-1.4 2.7-2.1 4.5-1.6 3.1.8 3.9 4.5 2 7.6C19 16.6 12 21 12 21Z";

const FoodChatWallpaper = memo(function FoodChatWallpaper({
  patternKey,
  themeKey,
  visible
}: {
  patternKey: string;
  themeKey: string;
  visible: boolean;
}) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const patternId = `foodChatDoodlePattern-${themeKey}`;
  const romantic = patternKey === "romantic-food-pattern";

  useEffect(() => {
    Animated.timing(opacity, {
      duration: visible ? 180 : 120,
      easing: Easing.out(Easing.cubic),
      toValue: visible ? 1 : 0,
      useNativeDriver: true
    }).start();
  }, [opacity, visible]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.chatWallpaper, { backgroundColor: ROOM_COLORS.wallpaperBg, opacity }]}
    >
      <ImageBackground
        imageStyle={{ opacity: ROOM_COLORS.wallpaperOpacity, tintColor: ROOM_COLORS.wallpaperLine }}
        resizeMode="repeat"
        source={FOOD_WALLPAPER_TILE_SOURCE}
        style={StyleSheet.absoluteFill}
      />
      {romantic ? (
        <Svg height="100%" style={StyleSheet.absoluteFill} width="100%">
          <Defs>
            <Pattern
              height={FOOD_WALLPAPER_TILE_SIZE}
              id={patternId}
              patternUnits="userSpaceOnUse"
              width={FOOD_WALLPAPER_TILE_SIZE}
              x={0}
              y={0}
            >
              <G
                fill="none"
                opacity={ROOM_COLORS.wallpaperOpacity}
                stroke={ROOM_COLORS.wallpaperLine}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ROMANTIC_WALLPAPER_PLACEMENTS.map((placement, index) => (
                  <Path key={`heart-${index}`} d={ROMANTIC_HEART_PATH} strokeWidth={placement.strokeWidth} transform={placement.transform} />
                ))}
              </G>
            </Pattern>
          </Defs>
          <Rect fill={`url(#${patternId})`} height="100%" width="100%" x={0} y={0} />
        </Svg>
      ) : null}
      <View style={styles.chatWallpaperOverlay} />
    </Animated.View>
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

function isOptimisticMemoryMedia(media: MemoryPhoto) {
  return media.id.startsWith("optimistic-media:");
}

const VIDEO_THUMBNAIL_TIME_MS = 100;
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
  const promise = getThumbnailAsync(sourceUri, {
    quality: 0.82,
    time: VIDEO_THUMBNAIL_TIME_MS
  })
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
  uri
}: {
  cacheKey: string;
  contentFit?: "contain" | "cover";
  uri: string;
}) {
  if (Platform.OS === "web") {
    return <WebVideoThumbnailLayer contentFit={contentFit} uri={uri} />;
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

function UploadProgressOverlay({ progress }: { progress?: number | null }) {
  const normalizedProgress = Math.max(0, Math.min(progress ?? 0, 1));
  const progressPercent = Math.round(normalizedProgress * 100);
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
            strokeDashoffset={circumference * (1 - normalizedProgress)}
            strokeLinecap="round"
            strokeWidth={ringStroke}
            transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
          />
        </Svg>
        <Text style={styles.uploadProgressText}>{progressPercent}%</Text>
      </View>
      <Text style={styles.mediaPendingText}>Uploading</Text>
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
  const swipeableRef = useRef<SwipeableMethods>(null);

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
    const renderLeftActions = (progress: SharedValue<number>) => (
      <ReplySwipeAction progress={progress} />
    );
    const handleSwipeableWillOpen = () => {
      if (swipeEnabled) onSwipeRight();
    };
    const handleSwipeableOpen = () => {
      swipeableRef.current?.close();
    };

    return (
      <ReanimatedSwipeable
        ref={swipeableRef}
        containerStyle={styles.swipeReplyWrap}
        dragOffsetFromLeftEdge={8}
        enabled={swipeEnabled}
        friction={1.35}
        leftThreshold={REPLY_SWIPE_TRIGGER_DISTANCE}
        onSwipeableOpen={handleSwipeableOpen}
        onSwipeableWillOpen={handleSwipeableWillOpen}
        overshootLeft={false}
        renderLeftActions={renderLeftActions}
      >
        <View style={styles.swipeReplyContent}>
          {rowElement}
        </View>
      </ReanimatedSwipeable>
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
  const pending = status === "pending";
  const sent = mine && !pending && status !== "failed";

  return (
    <View style={[styles.messageMetaRow, mine && styles.messageMetaRowMine]}>
      <Text style={[styles.messageMetaTime, mine ? styles.messageMetaTimeMine : styles.messageMetaTimeOther]}>
        {time}
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
  if (status !== "failed") return null;

  return (
    <View style={[styles.failedMessageActions, mine && styles.failedMessageActionsMine]}>
      <Text style={styles.failedMessageText}>Not sent</Text>
      <Pressable accessibilityRole="button" hitSlop={6} onPress={onRetry} style={styles.failedMessageButton}>
        <Text style={styles.failedMessageButtonText}>Retry</Text>
      </Pressable>
      <Pressable accessibilityRole="button" hitSlop={6} onPress={onCancel} style={styles.failedMessageButton}>
        <Text style={styles.failedMessageButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function timestampReservePlaceholder(time: string) {
  const reserveUnits = Array.from(time).reduce((total, character) => {
    if (character === ":") return total + 0.35;
    if (character === " ") return total + 0.25;
    return total + 0.9;
  }, 0);

  return `\u2009${"\u2007".repeat(Math.max(4, Math.ceil(reserveUnits)))}`;
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
      <Text style={[styles.inlineTimestampMessageText, textStyle]}>
        <SmartMessageTextContent
          linkStyle={styles.messageLinkText}
          text={text}
          textStyle={textStyle}
        />
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[timeStyle, styles.inlineTimestampReserve]}
        >
          {timestampReservePlaceholder(time)}
        </Text>
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
    const bubbleWithStatus = message.deliveryStatus !== "failed"
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
            {message.deliveryStatus === "pending" ? <StreamingCursor /> : null}
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
      if (shouldIgnoreMediaOpen()) return;
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
  onOpenDish,
  onRateDish,
  pending,
  rowStyle,
  showSenderDetails
}: {
  dish: MemoryDish;
  groupPosition: MessageGroupPosition;
  mine: boolean;
  onOpenDish: () => void;
  onRateDish: (rating: number) => void;
  pending: boolean;
  rowStyle?: StyleProp<ViewStyle>;
  showSenderDetails: boolean;
}) {
  const bubbleCornerStyle = groupedBubbleCornerStyle(mine, groupPosition);
  const myRating = dish.myRating ?? 0;

  return (
    <MessageRow
      mine={mine}
      rowStyle={rowStyle}
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
                  accessibilityLabel={`Rate ${dish.dishName} ${star} out of 5`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending, selected: star <= myRating }}
                  disabled={pending}
                  hitSlop={6}
                  key={star}
                  onPress={() => onRateDish(star)}
                  style={[styles.dishTimelineStarButton, pending && styles.dishYourStarButtonDisabled]}
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
            hitSlop={6}
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
    if (shouldIgnoreMediaOpen()) return;
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
  selectionMode?: boolean;
  shouldIgnoreMediaOpen: () => boolean;
  timestamp?: string;
}) {
  const visible = media.slice(0, 4);
  const hiddenCount = Math.max(0, media.length - visible.length);

  function handleOpenMedia(item: MemoryPhoto) {
    if (shouldIgnoreMediaOpen()) return;
    onOpenMedia(item, media);
  }

  if (media.length === 2) {
    const tileWidth = Math.floor((gridWidth - MEDIA_GRID_GAP) / 2);
    const tileSize = { height: Platform.OS === "web" ? 140 : 168, width: tileWidth };

    return (
      <View style={[styles.attachmentGridFrame, { width: gridWidth }]}>
        <View style={[styles.multiMediaGrid, { width: gridWidth }]}>
          {visible.slice(0, 2).map((item) => (
            <MediaGridTile
              hiddenCount={0}
              key={item.id}
              media={item}
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
            media={visible[0]}
            onLongPress={onMediaLongPress}
            onPress={() => handleOpenMedia(visible[0])}
            onPressIn={onMediaPressIn}
            onPressOut={onMediaPressOut}
            selectionMode={selectionMode}
            style={{ height: gridHeight, width: leftWidth }}
          />
          <View style={styles.mediaGridStack}>
            {visible.slice(1, 3).map((item) => (
              <MediaGridTile
                hiddenCount={0}
                key={item.id}
                media={item}
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
              key={item.id}
              media={item}
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
  style
}: {
  hiddenCount: number;
  media: MemoryPhoto;
  onLongPress: () => void;
  onPress: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  selectionMode?: boolean;
  style: MediaPreviewSize;
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
      <GridMediaPreview media={media} />
      {hiddenCount > 0 ? (
        <View style={styles.attachmentMoreOverlay}>
          <Text style={styles.attachmentMoreText}>+{hiddenCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function GridMediaPreview({ media }: { media: MemoryPhoto }) {
  const uploading = isOptimisticMemoryMedia(media);

  if (memoryMediaKind(media) === "audio") {
    return <AudioMediaPreview compact media={media} style={styles.gridMediaFill} />;
  }

  if (memoryMediaKind(media) === "video") {
    return (
      <View style={styles.gridVideoPreview}>
        <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} contentFit="contain" uri={media.publicUrl} />
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
          {uploading ? <UploadProgressOverlay progress={media.uploadProgress} /> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.gridMediaFill}>
      <Image
        cachePolicy="memory-disk"
        contentFit="contain"
        recyclingKey={media.storagePath || media.publicUrl}
        source={media.publicUrl}
        style={styles.gridMediaFill}
      />
      {uploading ? <UploadProgressOverlay progress={media.uploadProgress} /> : null}
    </View>
  );
}

function MediaGallery({
  error,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
  onOpenMedia,
  photos,
  themeCopy
}: {
  error?: string;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenMedia: OpenMediaHandler;
  photos: MemoryPhoto[];
  themeCopy: OccasionTheme["copy"];
}) {
  const hasMedia = photos.length > 0;

  return (
    <FlatList
      columnWrapperStyle={styles.galleryRow}
      contentContainerStyle={[
        styles.galleryContent,
        hasMedia ? styles.galleryContentFilled : styles.galleryContentEmpty
      ]}
      data={photos}
      initialNumToRender={MEDIA_GALLERY_INITIAL_RENDER_COUNT}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={(
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name={loading ? "hourglass-outline" : "images-outline"} size={26} color={ROOM_COLORS.cool} />
          </View>
          <Text style={styles.emptyTitle}>{loading ? "Loading media" : themeCopy.emptyTitle}</Text>
          <Text style={styles.emptyText}>
            {loading ? "Fetching photos and videos from this table." : themeCopy.emptyDescription}
          </Text>
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
      maxToRenderPerBatch={MEDIA_GALLERY_MAX_RENDER_BATCH}
      removeClippedSubviews={false}
      renderItem={({ index, item: photo }) => (
        <View
          style={[
            styles.galleryItem,
            index % 2 === 0 ? styles.galleryItemLeft : styles.galleryItemRight
          ]}
        >
          <Pressable
            accessibilityLabel={memoryMediaOpenLabel(photo)}
            accessibilityRole="imagebutton"
            onPress={() => onOpenMedia(photo, [photo])}
            style={styles.galleryMediaButton}
          >
            <MediaPreview contentFit="cover" media={photo} style={styles.galleryMediaPreview} />
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
  dishes,
  error,
  onAddDishToStop,
  onOpenDish,
  onRemoveStop,
  removingStopId,
  stops,
  topInset
}: {
  dishes: MemoryDish[];
  error?: string;
  onAddDishToStop: (stopId: string) => void;
  onOpenDish: (dishId: string) => void;
  onRemoveStop: (stopId: string) => void;
  removingStopId?: string | null;
  stops: MemoryStop[];
  themeCopy: OccasionTheme["copy"];
  topInset?: number;
}) {
  const topPadding = topInset != null ? topInset + spacing.sm : TABLE_HEADER_CLEARANCE;
  const bottomPadding = spacing.xl + 92;
  const dishesByStop = dishes.reduce<Record<string, MemoryDish[]>>((groups, dish) => {
    if (!dish.stopId) return groups;
    groups[dish.stopId] = [...(groups[dish.stopId] ?? []), dish];
    return groups;
  }, {});
  const unassignedDishes = dishes.filter((dish) => !dish.stopId);
  const isEmpty = stops.length === 0 && unassignedDishes.length === 0;

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
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.itineraryContent, { paddingBottom: bottomPadding, paddingTop: topPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.itineraryHeading}>Itinerary</Text>
      {stops.map((stop, index) => {
        const meta = MEMORY_STOP_META[stop.stopType];
        const stopDishes = dishesByStop[stop.id] ?? [];
        const removing = removingStopId === stop.id;
        return (
          <View key={stop.id} style={[styles.stopCard, removing && styles.stopCardRemoving]}>
            <View style={styles.stopHeaderRow}>
              <View style={styles.stopEmojiWrap}>
                <Text style={styles.stopEmoji}>{meta.emoji}</Text>
              </View>
              <View style={styles.stopHeaderText}>
                <Text numberOfLines={1} style={styles.stopName}>{stop.name}</Text>
                <Text style={styles.stopTypeLabel}>{`Stop ${index + 1} · ${meta.label}`}</Text>
              </View>
              <Pressable
                accessibilityLabel={`Remove ${stop.name}`}
                accessibilityRole="button"
                disabled={removing}
                hitSlop={8}
                onPress={() => onRemoveStop(stop.id)}
                style={styles.stopRemoveButton}
              >
                <Ionicons name="close" size={16} color={ROOM_COLORS.muted} />
              </Pressable>
            </View>
            {stop.note ? <Text style={styles.stopNote}>{stop.note}</Text> : null}
            {stopDishes.length > 0 ? (
              <View style={styles.stopDishList}>
                {stopDishes.map((dish) => (
                  <StopDishRow dish={dish} key={dish.id} onPress={() => onOpenDish(dish.id)} />
                ))}
              </View>
            ) : null}
            {meta.canHaveDishes ? (
              <Pressable accessibilityRole="button" onPress={() => onAddDishToStop(stop.id)} style={styles.stopAddDishButton}>
                <Ionicons name="add" size={15} color={ROOM_COLORS.cool} />
                <Text style={styles.stopAddDishText}>Add dish</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}

      {unassignedDishes.length > 0 ? (
        <View style={styles.stopCard}>
          <View style={styles.stopHeaderRow}>
            <View style={styles.stopEmojiWrap}>
              <Text style={styles.stopEmoji}>🍽️</Text>
            </View>
            <View style={styles.stopHeaderText}>
              <Text style={styles.stopName}>Other dishes</Text>
              <Text style={styles.stopTypeLabel}>Not tied to a stop</Text>
            </View>
          </View>
          <View style={styles.stopDishList}>
            {unassignedDishes.map((dish) => (
              <StopDishRow dish={dish} key={dish.id} onPress={() => onOpenDish(dish.id)} />
            ))}
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

function StopDishRow({ dish, onPress }: { dish: MemoryDish; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.stopDishRow}>
      <View style={[styles.stopDishIcon, { backgroundColor: senderAccent(dish.dishName) }]}>
        <Text style={styles.stopDishIconText}>{dish.dishName.slice(0, 1).toUpperCase()}</Text>
      </View>
      <Text numberOfLines={1} style={styles.stopDishName}>{dish.dishName}</Text>
      <View style={[styles.dishRatingPill, dish.averageRating === null && styles.dishRatingPillEmpty]}>
        <Ionicons name={dish.averageRating === null ? "star-outline" : "star"} size={11} color={ROOM_COLORS.gold} />
        <Text style={styles.dishRating}>{formatMemoryDishRating(dish.averageRating)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={ROOM_COLORS.muted} />
    </Pressable>
  );
}

function StopComposerSheet({
  error,
  onClose,
  onSubmit,
  pending,
  visible
}: {
  error?: string;
  onClose: () => void;
  onSubmit: (input: { stopType: MemoryStopType; name: string; note?: string }) => Promise<boolean> | boolean;
  pending: boolean;
  visible: boolean;
}) {
  const [stopType, setStopType] = useState<MemoryStopType>("restaurant");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!visible) return;
    setStopType("restaurant");
    setName("");
    setNote("");
  }, [visible]);

  const canSubmit = name.trim().length > 0 && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    await onSubmit({ stopType, name: name.trim(), note: note.trim() || undefined });
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.stopSheetRoot}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.stopSheetBackdrop} />
        <View style={styles.stopSheet}>
          <View style={styles.stopSheetHandle} />
          <Text style={styles.stopSheetTitle}>Add a stop</Text>
          <Text style={styles.stopSheetSubtitle}>Where did the occasion take you?</Text>

          <View style={styles.stopTypeGrid}>
            {MEMORY_STOP_ORDER.map((type) => {
              const meta = MEMORY_STOP_META[type];
              const active = stopType === type;
              return (
                <Pressable
                  accessibilityLabel={meta.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={type}
                  onPress={() => setStopType(type)}
                  style={[styles.stopTypeChip, active && styles.stopTypeChipActive]}
                >
                  <Text style={styles.stopTypeChipEmoji}>{meta.emoji}</Text>
                  <Text style={[styles.stopTypeChipLabel, active && styles.stopTypeChipLabelActive]}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            autoFocus
            onChangeText={setName}
            placeholder="Name this stop (e.g. Blue Tokai)"
            placeholderTextColor={ROOM_COLORS.muted}
            returnKeyType="done"
            style={styles.stopInput}
            value={name}
          />
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="Add a note (optional)"
            placeholderTextColor={ROOM_COLORS.muted}
            style={[styles.stopInput, styles.stopNoteInput]}
            value={note}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={[styles.stopSubmitButton, !canSubmit && styles.stopSubmitButtonDisabled]}
          >
            <Text style={styles.stopSubmitText}>{pending ? "Adding…" : "Add stop"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function DishesPanel({
  dishes,
  error,
  onOpenDish,
  onRateDish,
  pendingDishId,
  themeCopy
}: {
  dishes: MemoryDish[];
  error?: string;
  onOpenDish: (dishId: string) => void;
  onRateDish: (dishId: string, rating: number) => void;
  pendingDishId?: string | null;
  themeCopy: OccasionTheme["copy"];
}) {
  return (
    <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
      {dishes.length === 0 ? (
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="restaurant-outline" size={26} color={ROOM_COLORS.cool} />
          </View>
          <Text style={styles.emptyTitle}>{themeCopy.emptyTitle}</Text>
          <Text style={styles.emptyText}>{themeCopy.emptyDescription}</Text>
        </View>
      ) : (
        dishes.map((dish) => {
          const pending = pendingDishId === dish.id;
          const ratingValue = dish.averageRating;
          const raterAvatars = dish.ratings.slice(0, 4);
          const extraRaterCount = Math.max(0, dish.ratingCount - raterAvatars.length);

          return (
            <View key={dish.id} style={styles.dishCard}>
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
                    {dish.myRating ? `Your rating ${dish.myRating}/5` : "Your rating"}
                  </Text>
                  <View style={styles.dishYourStars}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Pressable
                        accessibilityLabel={`Rate ${dish.dishName} ${star} out of 5`}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: pending, selected: star <= (dish.myRating ?? 0) }}
                        disabled={pending}
                        hitSlop={6}
                        key={star}
                        onPress={() => onRateDish(dish.id, star)}
                        style={[styles.dishYourStarButton, pending && styles.dishYourStarButtonDisabled]}
                      >
                        <Star
                          size={19}
                          color={ROOM_COLORS.gold}
                          fill={star <= (dish.myRating ?? 0) ? ROOM_COLORS.gold : "transparent"}
                          strokeWidth={1.8}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          );
        })
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
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
  onRateDish,
  pending
}: {
  dish: MemoryDish | null;
  error?: string;
  myUsername: string;
  onClose: () => void;
  onRateDish: (dishId: string, rating: number) => void;
  pending: boolean;
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
              {dishData.myRating ? `Your rating · ${dishData.myRating}/5` : "Tap to rate"}
            </Text>
            <View style={styles.dishSheetStars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable
                  accessibilityLabel={`Rate ${dishData.dishName} ${star} out of 5`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending, selected: star <= (dishData.myRating ?? 0) }}
                  disabled={pending}
                  hitSlop={6}
                  key={star}
                  onPress={() => onRateDish(dishData.id, star)}
                  style={[styles.dishSheetStarButton, pending && styles.dishYourStarButtonDisabled]}
                >
                  <Star
                    size={30}
                    color={ROOM_COLORS.gold}
                    fill={star <= (dishData.myRating ?? 0) ? ROOM_COLORS.gold : "transparent"}
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
function KeyboardAwareSheetSurface({ onClose, keyboardProgress, slide, sheetHeight, children }: { onClose: () => void; keyboardProgress: SharedValue<number>; slide: SharedValue<number>; sheetHeight: SharedValue<number>; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  // Smoothed offset (0 -> -keyboardHeight) so the dish/media sheet hugs the keys
  // without the Gboard emoji-height bounce the chat composer used to show.
  const keyboardOffset = useSmoothedKeyboardOffset();
  // Keyboard closed -> float the sheet above the gesture-nav / home-indicator
  // inset, so the sheet's own bottom padding stays visible instead of being
  // tucked under the system nav. Keyboard open -> hug the keyboard with a small
  // gap. Blended along the keyboard curve so the transition is smooth.
  const insetStyle = useAnimatedStyle(() => {
    const open = keyboardProgress.value;
    return {
      paddingBottom: insets.bottom * (1 - open) + (-keyboardOffset.value + ATTACH_SHEET_KEYBOARD_GAP) * open
    };
  }, [insets.bottom]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: slide.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - slide.value) * (sheetHeight.value || ATTACH_SHEET_FALLBACK_HEIGHT) }]
  }));
  // The keyboard is tracked here (inside the modal's provider) reliably. Mirror
  // its per-frame openness (0 closed -> 1 open) into a room-owned shared value so
  // the room header can hide in exact lockstep with the keyboard — same motion,
  // no separate timing/easing to drift out of sync.
  useKeyboardHandler({
    onStart: (event) => { "worklet"; keyboardProgress.value = event.progress; },
    onMove: (event) => { "worklet"; keyboardProgress.value = event.progress; },
    onEnd: (event) => { "worklet"; keyboardProgress.value = event.progress; }
  }, []);
  return (
    <Reanimated.View style={[styles.attachSheetKeyboard, insetStyle]}>
      <Reanimated.View pointerEvents="none" style={[styles.attachSheetBackdrop, backdropStyle]} />
      <Pressable accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
      <Reanimated.View
        onLayout={(event) => { sheetHeight.value = event.nativeEvent.layout.height; }}
        style={sheetStyle}
      >
        {children}
      </Reanimated.View>
    </Reanimated.View>
  );
}

function AttachmentOptionsSheet({
  dishError,
  dishName,
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

  // The sheet is a plain in-tree overlay (not a RN Modal), so wire up Android's
  // hardware back ourselves to dismiss it while it's open.
  useEffect(() => {
    if (!mounted) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [mounted, onClose]);

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
        <KeyboardAwareSheetSurface onClose={onClose} keyboardProgress={keyboardProgress} slide={slide} sheetHeight={sheetHeight}>
          <Pressable style={styles.attachSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.attachSheetHeaderRow}>
              {showBack ? (
                <Pressable accessibilityLabel="Back" hitSlop={8} onPress={() => setView("actions")} style={[styles.attachSheetHeaderButton, styles.attachSheetHeaderBack]}>
                  <Ionicons name="chevron-back" size={18} color={ROOM_COLORS.cool} />
                </Pressable>
              ) : <View style={styles.attachSheetHeaderSpacer} />}
              <View style={styles.attachSheetHeaderText}>
                {view === "dish" ? null : <Text style={styles.attachSheetTitle}>{title}</Text>}
              </View>
              <Pressable accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={[styles.attachSheetHeaderButton, styles.attachSheetHeaderClose]}>
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
                <Pressable disabled={!canSubmitDish} onPress={onDishSubmit} style={[styles.attachDishSubmit, !canSubmitDish && styles.attachDishSubmitDisabled]}>
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
  onClose,
  onMediaError,
  selection
}: {
  onClose: () => void;
  onMediaError: () => void;
  selection: MediaViewerState | null;
}) {
  const insets = useSafeAreaInsets();
  const viewerListRef = useRef<FlatList<MemoryPhoto>>(null);
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
        <ViewerAudio media={media} />
      ) : memoryMediaKind(media) === "video" && index === safeActiveIndex ? (
        <ViewerVideo media={media} />
      ) : memoryMediaKind(media) === "video" ? (
        <View style={styles.viewerVideo}>
          <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} contentFit="contain" uri={media.publicUrl} />
        </View>
      ) : (
        <Image
          cachePolicy="memory-disk"
          contentFit="contain"
          onError={onMediaError}
          recyclingKey={media.storagePath || media.publicUrl}
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
          onLayout={(event) => setCarouselWidth(event.nativeEvent.layout.width)}
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
                      <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} uri={media.publicUrl} />
                      <View pointerEvents="none" style={styles.videoThumbnailScrim} />
                      <Ionicons name="play" size={14} color={ROOM_COLORS.white} />
                    </View>
                  ) : (
                    <Image
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      recyclingKey={media.storagePath || media.publicUrl}
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

function ViewerAudio({ media }: { media: MemoryPhoto }) {
  const player = useAudioPlayer(media.publicUrl, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const currentTime = status.currentTime;
  const duration = audioDurationSeconds(media, status.duration);
  const progress = duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0;

  useEffect(() => () => {
    pauseMediaPlayerQuietly(player);
  }, [player]);

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

function ViewerVideo({ media }: { media: MemoryPhoto }) {
  const runtime = useRuntimeActivity();
  const player = useVideoPlayer(media.publicUrl, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
  });

  useEffect(() => {
    if (!runtime.isForeground) player.pause();
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
  timestampPlacement = "bottom-right"
}: {
  media: MemoryPhoto;
  sizeOverride?: MediaPreviewSize;
  timestamp?: string;
  timestampPlacement?: MediaTimestampPlacement;
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
      <MediaPreview media={media} style={[styles.singleMediaFill, imageClipPassthrough]} />
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
  const uploading = isOptimisticMemoryMedia(media);
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
      {uploading ? <UploadProgressOverlay progress={media.uploadProgress} /> : null}
    </View>
  );
}

function MediaPreview({
  contentFit = "contain",
  media,
  style
}: {
  contentFit?: "contain" | "cover";
  media: MemoryPhoto;
  style?: StyleProp<ViewStyle>;
}) {
  const uploading = isOptimisticMemoryMedia(media);

  if (memoryMediaKind(media) === "audio") {
    return <AudioMediaPreview media={media} style={style} />;
  }

  if (memoryMediaKind(media) === "video") {
    return (
      <View style={[styles.videoPreview, style as StyleProp<ViewStyle>]}>
        <VideoThumbnailLayer cacheKey={memoryMediaCacheKey(media)} contentFit={contentFit} uri={media.publicUrl} />
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
        {uploading ? <UploadProgressOverlay progress={media.uploadProgress} /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.mediaImageWrap, style as StyleProp<ViewStyle>]}>
      <Image
        cachePolicy="memory-disk"
        contentFit={contentFit}
        recyclingKey={media.storagePath || media.publicUrl}
        source={media.publicUrl}
        style={styles.mediaImage}
      />
      {uploading ? <UploadProgressOverlay progress={media.uploadProgress} /> : null}
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
  chatMainSurface: {
    backgroundColor: "transparent",
    flex: 1,
    position: "relative"
  },
  chatMainMessagesLayer: {
    flex: 1
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
    borderTopWidth: 1,
    bottom: 0,
    gap: 6,
    left: 0,
    paddingBottom: Platform.OS === "android" ? 7 : 8,
    paddingHorizontal: Platform.OS === "web" ? spacing.md : 12,
    paddingTop: 7,
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
  chatMainDraftMeasureText: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    fontSize: COMPOSER_INPUT_FONT_SIZE,
    lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
    opacity: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    textAlignVertical: "top"
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
  chatMainBubbleBottomHidden: {
    height: 0,
    minHeight: 0,
    overflow: "hidden",
    paddingBottom: 0,
    paddingHorizontal: 0
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
  // Inline spacer inside the Text reserving the time's width; when it wraps
  // it adds only this much height — tighter than a normal 22px text line.
  chatMainTimeSpacer: {
    height: CHAT_TIME_SPACER_HEIGHT
  },
  // Host Text for the body spans + inline spacer. Tiny font so the metric
  // floor it imposes on every line stays below the spacer height; all real
  // text styling lives on the nested spans.
  chatMainBodyHostText: {
    fontSize: 4,
    includeFontPadding: false
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
  chatMainMenu: {
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 8,
    padding: CHAT_MENU_PADDING,
    position: "absolute",
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12
  },
  chatMainMenuEmojiRow: {
    alignItems: "center",
    flexDirection: "row",
    height: CHAT_MENU_EMOJI_ROW_HEIGHT,
    justifyContent: "space-between"
  },
  chatMainMenuEmojiButton: {
    alignItems: "center",
    borderRadius: CHAT_MENU_EMOJI_SIZE / 2,
    height: CHAT_MENU_EMOJI_SIZE,
    justifyContent: "center",
    width: CHAT_MENU_EMOJI_SIZE
  },
  chatMainMenuEmojiButtonPressed: {
    backgroundColor: ROOM_COLORS.glass,
    transform: [{ scale: 1.15 }]
  },
  chatMainMenuEmoji: {
    fontSize: 24,
    lineHeight: 30
  },
  chatMainMenuDivider: {
    backgroundColor: ROOM_COLORS.border,
    height: 1,
    marginVertical: 0
  },
  chatMainMenuAction: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    height: CHAT_MENU_ACTION_HEIGHT,
    paddingHorizontal: 10
  },
  chatMainMenuActionPressed: {
    backgroundColor: ROOM_COLORS.glass
  },
  chatMainMenuActionLabel: {
    ...fontStyles.medium,
    color: ROOM_COLORS.onSurface,
    fontSize: 14
  },
  chatMainMenuActionLabelDestructive: {
    color: ROOM_COLORS.danger
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
    padding: 2,
    position: "relative"
  },
  modeTabIndicator: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.cool,
    borderRadius: radius.md,
    borderWidth: 1,
    bottom: 2,
    left: 0,
    position: "absolute",
    top: 2
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
    color: ROOM_COLORS.muted,
    fontSize: 10,
    lineHeight: 13
  },
  modeButtonTextActive: {
    color: ROOM_COLORS.onSurface
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
  chatLatestButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 34,
    paddingHorizontal: spacing.base,
    position: "absolute",
    right: spacing.lg,
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    zIndex: 5
  },
  chatLatestButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onCool,
    fontSize: 12,
    lineHeight: 15
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
    backgroundColor: CHAT_OTHER_BUBBLE_COLOR,
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
  chatMainDishPollRow: {
    marginBottom: 10,
    paddingHorizontal: 0
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
    justifyContent: "center",
    paddingLeft: CHAT_ROW_SIDE_PADDING,
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
    gap: 4
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
    backgroundColor: CHAT_OTHER_BUBBLE_COLOR,
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
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
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
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
    borderColor: ROOM_COLORS.sentBubbleBorder,
    minWidth: 230
  },
  dishTimelineBubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: CHAT_OTHER_BUBBLE_COLOR,
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
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
    borderColor: ROOM_COLORS.sentBubbleBorder
  },
  mediaMessageCardOther: {
    backgroundColor: CHAT_OTHER_BUBBLE_COLOR,
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
    backgroundColor: CHAT_OTHER_BUBBLE_COLOR,
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
    ...fontStyles.semiBold,
    color: "transparent",
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 5,
    opacity: 0
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
    // Bottom-anchored; the animated paddingBottom (KeyboardAwareSheetSurface)
    // lifts the sheet above the keyboard. The dim is the attachSheetBackdrop
    // below, faded in/out with the sheet's slide.
    flex: 1,
    justifyContent: "flex-end"
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
  itineraryContent: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: TABLE_HEADER_CLEARANCE,
    paddingBottom: spacing.xl + 92
  },
  itineraryEmptyContent: {
    flex: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
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
  stopCardRemoving: {
    opacity: 0.5
  },
  stopHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.s
  },
  stopEmojiWrap: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  stopEmoji: {
    fontSize: 20
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
  stopTypeLabel: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12
  },
  stopRemoveButton: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 28
  },
  stopNote: {
    ...fontStyles.regular,
    color: ROOM_COLORS.muted,
    fontSize: 13,
    lineHeight: 18
  },
  stopDishList: {
    gap: 6
  },
  stopDishRow: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.bg,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.s,
    paddingHorizontal: spacing.s,
    paddingVertical: 8
  },
  stopDishIcon: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  stopDishIconText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.white,
    fontSize: 12
  },
  stopDishName: {
    ...fontStyles.bold,
    color: ROOM_COLORS.onSurface,
    flex: 1,
    fontSize: 14,
    minWidth: 0
  },
  stopAddDishButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    paddingVertical: 2
  },
  stopAddDishText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 13
  },
  stopSheetRoot: {
    flex: 1,
    justifyContent: "flex-end"
  },
  stopSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.scrim
  },
  stopSheet: {
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md
  },
  stopSheetHandle: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.pill,
    height: 4,
    width: 40
  },
  stopSheetTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 18
  },
  stopSheetSubtitle: {
    ...fontStyles.regular,
    color: ROOM_COLORS.muted,
    fontSize: 13,
    marginTop: -6
  },
  stopTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  stopTypeChip: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  stopTypeChipActive: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.cool
  },
  stopTypeChipEmoji: {
    fontSize: 15
  },
  stopTypeChipLabel: {
    ...fontStyles.bold,
    color: ROOM_COLORS.muted,
    fontSize: 13
  },
  stopTypeChipLabelActive: {
    color: ROOM_COLORS.cool
  },
  stopInput: {
    ...fontStyles.medium,
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    color: ROOM_COLORS.onSurface,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  stopNoteInput: {
    minHeight: 64,
    textAlignVertical: "top"
  },
  stopSubmitButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.input,
    justifyContent: "center",
    minHeight: 50
  },
  stopSubmitButtonDisabled: {
    opacity: 0.5
  },
  stopSubmitText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onCool,
    fontSize: 15
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
  CHAT_OWN_BUBBLE_COLOR = theme.colors.sentBubble;
  CHAT_OTHER_BUBBLE_COLOR = theme.colors.receivedBubble;
  styles = theme.styles;
}
