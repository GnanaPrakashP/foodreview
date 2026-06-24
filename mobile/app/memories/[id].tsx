import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { PenLine, Star, Utensils } from "lucide-react-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView, type VideoThumbnail } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Reanimated, {
  Easing as ReanimatedEasing,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming
} from "react-native-reanimated";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import {
  getOccasionTheme,
  occasionThemeToMemoryRoomTokens,
  type OccasionTheme
} from "@/features/occasions/occasionThemes";
import { type OccasionType } from "@/features/occasions/occasionTypes";
import {
  FOOD_WALLPAPER_TILE_SIZE,
  buildFoodWallpaperPlacements,
  type DoodlePrimitive
} from "@/components/memories/foodWallpaperPattern";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, Pattern, Rect } from "react-native-svg";
import { MEMORY_TEXT_MAX_LENGTH } from "@/constants/memoryLimits";
import { useCircleAccessStatusesQuery } from "@/hooks/useCircle";
import { useRequestCircleAccessMutation } from "@/hooks/useEngagement";
import { useUserProfileSearch } from "@/hooks/useUserProfileSearch";
import { useThemePreference } from "@/hooks/useThemePreference";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryDishMutation,
  useAddMemoryPhotoMutation,
  useCreateMemoryStopMutation,
  useDeleteMemoryItemsMutation,
  useDeleteMemoryStopMutation,
  useEditMemoryMessageMutation,
  useLeaveMemoryRoomMutation,
  useMarkMemoryRoomReadMutation,
  useMemoryMediaPagesQuery,
  useMemoryMessagePagesQuery,
  useMemoryRoomQuery,
  useMemoryRoomRealtime,
  useSetMemoryDishRatingMutation
} from "@/hooks/useMemories";
import type { CircleAccessStatus } from "@/services/circle";
import {
  pickMemoryMediaFromCamera,
  pickMemoryMediaFromGallery,
  type MemoryMediaPickerResult
} from "@/services/mediaPicker";
import { consumeMemoryCapturePost, removeMemoryCapture, saveMemoryCapture } from "@/services/memoryCaptureSession";
import { validateMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { MEMORY_CHAT_PRELOAD_LIMIT } from "@/services/memories";
import type { UserSearchResult } from "@/services/profiles";
import { useSessionStore } from "@/stores/sessionStore";
import { avatarAccents, fontStyles, memoryRoomTokens, radius, spacing, type MemoryRoomTokens } from "@/theme";
import type { MemoryDish, MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom, MemoryStop, MemoryStopType } from "@/types/models";
import { formatDisplayDate, formatDisplayTime } from "@/utils/datetime";

type RoomMode = "overview" | "chat" | "media" | "dishes" | "people";
type RoomTabMode = Exclude<RoomMode, "people">;
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
type MemoryCaptureAsset = {
  duration?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mimeType?: string | null;
  type?: string | null;
  uri: string;
  width?: number | null;
};
const ROOM_MAX_WIDTH = 640;
const ROOM_TABS: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; mode: RoomTabMode }> = [
  { icon: "journal-outline", label: "Table", mode: "overview" },
  { icon: "chatbubble-ellipses-outline", label: "Chat", mode: "chat" },
  { icon: "images-outline", label: "Media", mode: "media" },
  { icon: "restaurant-outline", label: "Dishes", mode: "dishes" }
];

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
const COMPOSER_CLOSED_SAFE_GAP = 6;
const MEDIA_GRID_GAP = 4;
const CHAT_ROW_SIDE_PADDING = Platform.OS === "web" ? spacing.base : spacing.lg;
const COMPOSER_INPUT_FONT_SIZE = Platform.OS === "web" ? 14 : 15;
const COMPOSER_INPUT_LINE_HEIGHT = Platform.OS === "web" ? 20 : 21;
const COMPOSER_INPUT_VERTICAL_PADDING = 12;
const COMPOSER_INPUT_MIN_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING;
const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT * 5 + COMPOSER_INPUT_VERTICAL_PADDING;
const COMPOSER_MESSAGE_BOX_MIN_HEIGHT = Platform.OS === "web" ? 38 : 42;
const COMPOSER_ACTION_BUTTON_SIZE = Platform.OS === "web" ? 36 : 40;
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
const CHAT_HEADER_CLEARANCE = 112;
// The overview header is taller than the compact one: it also shows the expanded
// identity block (date + members) above the tabs, so the itinerary needs to clear
// roughly that extra height.
const TABLE_HEADER_CLEARANCE = CHAT_HEADER_CLEARANCE + 96;
const CHAT_COMPOSER_CLEARANCE = 88;
const MEDIA_GALLERY_GAP = 2;
const MEDIA_GALLERY_HALF_GAP = MEDIA_GALLERY_GAP / 2;
const COMPACT_ROOM_HEADER_HEIGHT = 106;
const MEMBERS_HEADER_CLEARANCE = spacing.sm + 34 + 14 + 1;
const MEDIA_GALLERY_TOP_CLEARANCE = COMPACT_ROOM_HEADER_HEIGHT + MEDIA_GALLERY_HALF_GAP;
const PEOPLE_PANEL_ENTER_DURATION = 230;
const PEOPLE_PANEL_EXIT_DURATION = 190;
const HEADER_MODE_TRANSITION_DURATION = 220;
const CHAT_TIMELINE_INITIAL_RENDER_COUNT = 18;
const CHAT_TIMELINE_MAX_RENDER_BATCH = 12;
const CHAT_TIMELINE_WINDOW_SIZE = 9;
const MEDIA_GALLERY_INITIAL_RENDER_COUNT = 8;
const MEDIA_GALLERY_MAX_RENDER_BATCH = 8;
const MEDIA_GALLERY_WINDOW_SIZE = 7;
const MEDIA_VIEWER_MAX_RENDER_BATCH = 2;
const MEDIA_VIEWER_WINDOW_SIZE = 3;
type MediaPreviewSize = { height: number; width: number };
type MediaTimestampPlacement = "bottom-left" | "bottom-right";
type MessageGroupPosition = "single" | "first" | "middle" | "last";

function effectiveRoomOccasionType(room: Pick<MemoryRoom, "occasionConfidence" | "occasionConfirmedByUser" | "occasionType">): OccasionType {
  if (room.occasionConfirmedByUser || room.occasionConfidence >= 0.85) return room.occasionType;
  return "unknown";
}
type AttachmentSheetView = "actions" | "dish" | "media";

function roomModeFromTabParam(tab?: string | string[] | null): RoomTabMode | null {
  const value = Array.isArray(tab) ? tab[0] : tab;
  if (value === "table" || value === "overview") return "overview";
  if (value === "chat" || value === "media" || value === "dishes") return value;
  return null;
}

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

// How long (ms) after a fresh open we keep clamping the keyboard height to the
// default (alphabet) height. Long enough to cover Gboard's stage-2 correction
// animation (emoji-height -> alphabet-height) on reopen.
const KEYBOARD_OPEN_SETTLE_MS = 320;

// Smoothed keyboard offset (0 closed -> -keyboardHeight open) that is immune to
// Gboard's two-stage reopen animation on Android.
//
// Binding straight to useReanimatedKeyboardAnimation's raw height faithfully
// echoes whatever the IME reports each frame. The nasty case: after the emoji
// panel has grown the keyboard, you collapse it and reopen. Gboard does NOT
// animate straight to the alphabet height — it first animates up to the cached
// EMOJI height (stage 1), then runs a SECOND animation back down to the real
// alphabet height (stage 2). Anything anchored to the raw height therefore
// shoots up to the old emoji level and drops back down.
//
// The fix has three moving parts:
//   1. On a closed -> open rise, aim the projected curve at the DEFAULT keyboard
//      height (the smallest settled height we've seen, i.e. the alphabet
//      keyboard) rather than the last-seen height (which may be the tall emoji).
//   2. For ~KEYBOARD_OPEN_SETTLE_MS after that open settles, clamp the height to
//      the default so stage 2's emoji-height transient can't drag the bar up.
//   3. Once settled past that window, follow the raw height again so a
//      DELIBERATE emoji expansion (or any genuine resize) still tracks smoothly.
// Closing always projects from the current settled height so an emoji-height
// keyboard slides down from where it actually was.
function useSmoothedKeyboardOffset(): SharedValue<number> {
  const { height, progress } = useReanimatedKeyboardAnimation();
  // Last non-zero height the keyboard settled at (alphabet OR emoji).
  const settledOpenHeight = useSharedValue(0);
  // Smallest non-zero settled height seen == the plain alphabet keyboard, used as
  // the destination for a fresh open so we never overshoot toward an emoji height.
  const defaultOpenHeight = useSharedValue(0);
  // 1 while we're inside a closed -> open transition (set when fully closed,
  // cleared once that open's animation ends). Lets us pick the right destination
  // and only arm the settle-clamp for genuine opens, not emoji resizes.
  const openingFromClosed = useSharedValue(0);
  // 1 immediately after a fresh open settles, eased to 0 over the settle window;
  // while > 0 we clamp the height to the default to swallow stage 2's overshoot.
  const settleClamp = useSharedValue(0);

  // Mark the start of a fresh open the moment the keyboard is fully closed.
  useAnimatedReaction(
    () => progress.value,
    (p) => { if (p < 0.01) openingFromClosed.value = 1; }
  );

  useKeyboardHandler({
    onEnd: (event) => {
      "worklet";
      if (event.height <= 0) return; // a close settling; nothing to record
      settledOpenHeight.value = event.height;
      defaultOpenHeight.value = defaultOpenHeight.value === 0
        ? event.height
        : Math.min(defaultOpenHeight.value, event.height);
      // Only arm the settle-clamp for an open that came from fully closed — NOT
      // for an in-place emoji resize (which must be free to grow immediately).
      if (openingFromClosed.value === 1) {
        openingFromClosed.value = 0;
        settleClamp.value = 1;
        settleClamp.value = withTiming(0, { duration: KEYBOARD_OPEN_SETTLE_MS });
      }
    }
  }, []);

  return useDerivedValue(() => {
    const raw = Math.max(0, -height.value);
    const base = defaultOpenHeight.value || settledOpenHeight.value || raw;
    if (progress.value < 0.999) {
      // Opening or closing. Opening aims at the default (alphabet) height;
      // closing slides down from wherever the keyboard actually was.
      const destination = openingFromClosed.value === 1 ? base : (settledOpenHeight.value || base);
      return -(destination * progress.value);
    }
    // Settled. During the post-open window, hold at the default so Gboard's
    // stage-2 emoji-height transient can't bounce the bar; otherwise track raw.
    if (settleClamp.value > 0) return -Math.min(raw, base);
    return -raw;
  });
}

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; postCaptureId?: string; tab?: string }>();
  const roomId = params.id ?? "";
  const postCaptureId = typeof params.postCaptureId === "string" ? params.postCaptureId : "";
  const insets = useSafeAreaInsets();
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
  const markRead = useMarkMemoryRoomReadMutation(roomId);
  const leaveRoom = useLeaveMemoryRoomMutation(roomId);
  const requestCircleAccess = useRequestCircleAccessMutation();
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");
  const addMessageMutateAsyncRef = useRef(addMessage.mutateAsync);
  addMessageMutateAsyncRef.current = addMessage.mutateAsync;
  const peopleInputRef = useRef<TextInput>(null);
  const messageInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<FlatList<ChatTimelineRow>>(null);
  const startedCapturePostsRef = useRef(new Set<string>());
  const nearBottomRef = useRef(false);
  const composerHeightRef = useRef(0);
  const chatTimelineHeightRef = useRef(0);
  const chatContentHeightRef = useRef(0);
  // While a just-sent message settles in, animate the bottom pin so the existing
  // chat glides up to make room instead of snapping.
  // The chat list is inverted (bottom-anchored), so the newest message lives at
  // scroll offset 0. Scrolling there is exact and never lands short of a padding.
  const scrollChatToBottom = useCallback((animated: boolean) => {
    scrollRef.current?.scrollToOffset({ animated, offset: 0 });
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
  const initialMode = roomModeFromTabParam(params.tab) ?? "overview";
  const [mode, setMode] = useState<RoomMode>(initialMode);
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
  const [editingMessage, setEditingMessage] = useState<MemoryMessage | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<MemoryMessage | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [cameraOpening, setCameraOpening] = useState(false);
  const [attachmentOptionsVisible, setAttachmentOptionsVisible] = useState(false);
  const [stopComposerVisible, setStopComposerVisible] = useState(false);
  const [dishTargetStopId, setDishTargetStopId] = useState<string | null>(null);
  // Measured overview-header height so the itinerary clears the (taller) expanded
  // header instead of tucking under it. Falls back to the static estimate.
  const [tableHeaderHeight, setTableHeaderHeight] = useState(TABLE_HEADER_CLEARANCE);
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
  const finishPeopleClose = useCallback(() => {
    setPeopleClosing(false);
    setMode("overview");
  }, []);

  useEffect(() => {
    const nextMode = roomModeFromTabParam(params.tab);
    if (nextMode) setMode(nextMode);
  }, [params.tab]);

  useEffect(() => {
    if (!postCaptureId || startedCapturePostsRef.current.has(postCaptureId)) return;
    if (!room.data) return;
    const pendingPost = consumeMemoryCapturePost(postCaptureId);
    if (!pendingPost) return;

    startedCapturePostsRef.current.add(postCaptureId);
    setMode("chat");

    const { asset } = pendingPost;
    const mimeType = asset.mimeType ?? (asset.mediaType === "video" ? "video/mp4" : "image/jpeg");
    addPhoto.mutate({
      assets: [{
        duration: asset.duration ?? null,
        fileSize: asset.fileSize ?? null,
        imageHeight: asset.height ?? null,
        imageWidth: asset.width ?? null,
        mediaMimeType: mimeType,
        mediaType: asset.mediaType,
        mediaUri: asset.uri
      }],
      body: pendingPost.caption,
      roomId
    }, {
      onError: (error) => {
        Alert.alert("Could not post media", errorMessage(error) ?? "Try again.");
      },
      onSettled: () => {
        removeMemoryCapture(asset.id);
      },
      onSuccess: () => {
        if (!pendingPost.dishName) return;
        void addDish.mutateAsync({ dishName: pendingPost.dishName }).catch(() => undefined);
      }
    });
  }, [addDish, addPhoto, postCaptureId, room.data, roomId]);

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

  const previousModeRef = useRef<RoomMode>("overview");
  const paneTabMode: RoomTabMode = mode === "people" ? "overview" : mode;
  const previousTabIndex = ROOM_TABS.findIndex((tab) => tab.mode === previousModeRef.current);
  const activePaneTabIndex = ROOM_TABS.findIndex((tab) => tab.mode === paneTabMode);
  const paneDirection = previousTabIndex >= 0 && activePaneTabIndex >= 0
    ? Math.sign(activePaneTabIndex - previousTabIndex)
    : 0;

  useEffect(() => {
    if (mode !== "people") previousModeRef.current = mode;
  }, [mode]);

  useEffect(() => () => {
    if (peopleToastTimeoutRef.current) clearTimeout(peopleToastTimeoutRef.current);
    if (suppressSelectionToggleTimeoutRef.current) clearTimeout(suppressSelectionToggleTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (mode !== "people") return undefined;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!peopleClosing) setPeopleClosing(true);
      return true;
    });

    return () => subscription.remove();
  }, [mode, peopleClosing]);

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

  // Keyboard handling is driven per-frame by react-native-keyboard-controller's
  // native animation values — synced with the OS keyboard animation, including
  // emoji-panel height changes and interactive dismissal — instead of discrete
  // show/hide events with a separate hand-rolled animation.
  // keyboardOffset runs 0 → -keyboardHeight, ready for translateY. Smoothed so
  // Gboard's stale emoji-height frame on reopen never bounces the composer.
  const keyboardOffset = useSmoothedKeyboardOffset();
  const isChatMode = mode === "chat";
  // The whole chat stage (list + composer overlay) rides the keyboard as one
  // transform, so the input bar and the pinned latest message move together
  // frame-by-frame with zero per-frame relayout. The stage clips the overflow.
  // Clamped at 0 so a glitched positive keyboard value (seen after back-button
  // dismiss on misconfigured Android) can never push the bar below its rest spot.
  const stageKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: isChatMode ? Math.min(0, keyboardOffset.value) : 0 }]
  }), [isChatMode]);
  const closedComposerBottomPadding = Math.max(insets.bottom + COMPOSER_CLOSED_SAFE_GAP, 12);
  // Single source of truth for the bar's bottom offset, per-frame:
  //   keyboard open   → keyboardHeight + COMPOSER_KEYBOARD_OPEN_GAP
  //   keyboard closed → bottom safe-area inset + COMPOSER_CLOSED_SAFE_GAP
  // (the stage translate supplies keyboardHeight; this padding supplies the gap,
  // blending between the two ends so every transition follows the keyboard curve)
  const composerInsetStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(
      closedComposerBottomPadding + keyboardOffset.value,
      COMPOSER_KEYBOARD_OPEN_GAP
    )
  }), [closedComposerBottomPadding]);
  // The list's bottom clearance is frozen at the closed-state bar height (it is NOT
  // re-measured during keyboard transitions). As the bar's safe-area padding melts
  // away, this shifts the list down by exactly the amount the bar shrank — same
  // shared value, same frame — so the last message keeps its 8px gap with no
  // JS-lagged re-measure/repin bounce when the keyboard collapses.
  const chatListKeyboardStyle = useAnimatedStyle(() => {
    const keyboardHeight = Math.max(0, -keyboardOffset.value);
    const barShrink = Math.min(keyboardHeight, closedComposerBottomPadding - COMPOSER_KEYBOARD_OPEN_GAP);
    return {
      transform: [{ translateY: isChatMode ? barShrink : 0 }]
    };
  }, [closedComposerBottomPadding, isChatMode]);

  function repinChatToBottom() {
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => scrollChatToBottom(false));
  }

  function handleComposerLayout(event: LayoutChangeEvent) {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (Math.abs(nextHeight - composerHeightRef.current) < 1) return;
    composerHeightRef.current = nextHeight;
    // nextHeight is the bar's CONTENT height (excludes the animated safe-area
    // padding), so this only changes for real content growth (multiline input,
    // banners) — never during keyboard transitions. Closed-state padding is added
    // statically; the open-state difference is compensated by chatListKeyboardStyle.
    setChatBottomClearance(nextHeight + closedComposerBottomPadding);
    repinChatToBottom();
  }

  function handleChatTimelineLayout(event: LayoutChangeEvent) {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (Math.abs(nextHeight - chatTimelineHeightRef.current) < 1) return;
    chatTimelineHeightRef.current = nextHeight;
    repinChatToBottom();
  }

  function handleChatNearBottomChange(isNearBottom: boolean) {
    nearBottomRef.current = isNearBottom;
    if (isNearBottom) markLatestRoomRead();
  }

  function handleChatScrollBeginDrag() {
    // Bottom-follow release is handled inside ChatTimeline's drag handler.
  }

  function handleComposerFocus() {
    repinChatToBottom();
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

  async function submitMessage() {
    try {
      if (editingMessage) {
        await editMessage.mutateAsync({ body: message, messageId: editingMessage.id });
        setEditingMessage(null);
      } else {
        const outgoingBody = message;
        const trimmedBody = outgoingBody.trim();
        if (!trimmedBody) return;
        const outgoingReply = replyingToMessage;
        const clientId = `text:${Date.now()}:${sendSequenceRef.current}`;
        sendSequenceRef.current += 1;
        // WhatsApp-style: the message just appears at the bottom (optimistic),
        // no entry animation. Clear the input and pin to the newest message.
        setMessage("");
        setReplyingToMessage(null);
        void addMessageMutateAsyncRef.current({
          body: outgoingBody,
          clientId,
          replyToMessageId: outgoingReply?.id ?? null
        }).catch(() => {
          setMessage((current) => (current.trim().length > 0 ? current : outgoingBody));
          setReplyingToMessage((current) => current ?? outgoingReply);
        });
        // The list pins to the new message from onContentSizeChange (which has the
        // correct post-layout height) — scrolling here too would use a stale height
        // and make the bubble appear low, then jump up.
        requestAnimationFrame(() => {
          messageInputRef.current?.focus();
        });
        return;
      }
      setMessage("");
      setReplyingToMessage(null);
      requestAnimationFrame(() => scrollChatToBottom(true));
    } catch {
      // Rendered from mutation state.
    }
  }

  function beginEditMessage(target: MemoryMessage) {
    selectedItemKeysRef.current = [];
    setSelectedItemKeys([]);
    setReplyingToMessage(null);
    setEditingMessage(target);
    setMessage(target.body);
    setMode("chat");
  }

  function beginReplyMessage(target: MemoryMessage) {
    selectedItemKeysRef.current = [];
    setSelectedItemKeys([]);
    setEditingMessage(null);
    setReplyingToMessage(target);
    setMode("chat");
    requestAnimationFrame(() => {
      setTimeout(() => messageInputRef.current?.focus(), 80);
    });
  }

  function cancelEditMessage() {
    setEditingMessage(null);
    setMessage("");
  }

  function cancelReplyMessage() {
    setReplyingToMessage(null);
  }

  function beginSelection(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    setEditingMessage(null);
    setReplyingToMessage(null);
    setMessage("");
    selectedItemKeysRef.current = [key];
    setSelectedItemKeys([key]);
    suppressSelectionToggleRef.current = key;
    if (suppressSelectionToggleTimeoutRef.current) clearTimeout(suppressSelectionToggleTimeoutRef.current);
    suppressSelectionToggleTimeoutRef.current = null;
    setMode("chat");
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

  function removeSelectedItems() {
    const keysToDelete = selectedItemKeysRef.current.length > 0 ? selectedItemKeysRef.current : selectedItemKeys;
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
      selectedItemKeysRef.current = [];
      setSelectedItemKeys([]);
      void deleteItems.mutateAsync({ messageIds, photoIds }).catch((error) => {
        if (selectedItemKeysRef.current.length === 0) {
          selectedItemKeysRef.current = queuedKeys;
          setSelectedItemKeys(queuedKeys);
        }
        Alert.alert("Could not delete", errorMessage(error) ?? "The selected items were restored. Try again.");
      }).finally(() => {
        queuedKeys.forEach((key) => deletingItemKeysRef.current.delete(key));
      });
    } catch (error) {
      queuedKeys.forEach((key) => deletingItemKeysRef.current.delete(key));
      Alert.alert("Could not delete", errorMessage(error) ?? "Try again.");
    }
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
      setMessage("");
      setReplyingToMessage(null);
      const nextMode = attachmentOriginMode === "chat" ? "chat" : "media";
      setMode(nextMode);
      if (nextMode === "chat") requestAnimationFrame(() => scrollChatToBottom(true));
    } catch {
      // Rendered from mutation state.
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
    setMode("chat");
    requestAnimationFrame(() => scrollChatToBottom(true));
  }

  function openPeopleAdd() {
    setPeopleClosing(false);
    setMode("people");
  }

  function openPeopleList() {
    setPeopleClosing(false);
    setMode("people");
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

  function openAttachmentActions() {
    setReopenAddMenuOnCancel(false);
    openAttachmentOptions("actions");
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
  const selectedHasForeignItem = selectedTargets.some((target) => (
    target.type === "message"
      ? target.value.authorName !== myUsername
      : target.value.uploaderName !== myUsername
  ));
  const canDeleteSelected = selectedTargets.length > 0 && !selectedHasForeignItem;
  const editableSelectedMessage =
    selectedTargets.length === 1 &&
    selectedTargets[0].type === "message" &&
    selectedTargets[0].value.authorName === myUsername &&
    selectedTargets[0].value.body.trim().length > 0 &&
    selectedTargets[0].value.attachments.length === 0
      ? selectedTargets[0].value
      : null;
  const floatingAddAvailable = !attachmentOptionsVisible && !selectedMedia;
  const floatingAddVisible = mode === "overview" && floatingAddAvailable;
  const headerMode = mode === "people" ? "overview" : mode;

  return (
    <Screen padded={false} style={styles.screenContent}>
      <RoomHeader
        data={data}
        displayRestaurantName={displayRestaurantName}
        keyboardProgress={dishKeyboardProgress}
        mode={headerMode}
        myUsername={myUsername}
        onAddPeople={openPeopleAdd}
        onBack={mode === "people" ? closePeopleScreen : goBackToMemories}
        onChangeMode={setMode}
        onHeightChange={(height) => {
          if (headerMode === "overview" && height > 0) setTableHeaderHeight(height);
        }}
        onOpenActions={openRoomActions}
        onViewPeople={openPeopleList}
        transitioning={mode === "people"}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" && mode !== "chat" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={styles.keyboard}
      >
        <View
          style={[
            styles.roomStage,
            headerMode === "overview" && styles.roomStageTable,
            mode === "chat" && styles.roomStageChat
          ]}
        >
          <FoodChatWallpaper patternKey={roomOccasionTheme.backgroundPattern} themeKey={`${resolvedTheme}-${roomOccasionTheme.id}`} visible />
          <Reanimated.View style={[styles.roomStageShift, stageKeyboardStyle]}>
          <View style={styles.body}>
            <PaneReveal
              active={mode === "chat"}
              pointerEvents={mode === "chat" ? "auto" : "none"}
              style={mode === "chat" ? styles.roomPaneActive : styles.roomPaneHidden}
            >
              <Reanimated.View style={[styles.chatListShiftWrap, chatListKeyboardStyle]}>
              <ChatTimeline
                active={mode === "chat"}
                bottomClearance={chatBottomClearance}
                data={data}
                hasOlderMessages={canLoadOlderMessages}
                loadingOlderMessages={olderMessages.isFetchingNextPage}
                myUsername={myUsername}
                onAddDish={() => setMode("dishes")}
                onAddMedia={openAttachmentActions}
                onAddPeople={openPeopleAdd}
                onBeginSelection={beginSelection}
                onContentHeightChange={(height) => {
                  chatContentHeightRef.current = height;
                }}
                onLayoutChange={handleChatTimelineLayout}
                onLoadOlderMessages={loadOlderMessages}
                onNearBottomChange={handleChatNearBottomChange}
                onOpenDish={(dishId) => router.push(`/memories/${roomId}/dish/${dishId}`)}
                onOpenMedia={openMediaViewer}
                onRateDish={(dishId, rating) => rateDish.mutate({ dishId, rating })}
                onReplyMessage={beginReplyMessage}
                onScrollBeginDrag={handleChatScrollBeginDrag}
                onSelectionPressOut={finishSelectionPress}
                onToggleSelection={toggleSelectedItem}
                pendingDishId={rateDish.isPending ? rateDish.variables?.dishId ?? null : null}
                scrollToBottom={scrollChatToBottom}
                editingMessageId={editingMessage?.id ?? null}
                lastReadAt={data.lastReadAt}
                olderMessagesError={errorMessage(olderMessages.error)}
                scrollRef={scrollRef}
                selectedItemKeys={selectedItemKeys}
                selectionMode={selectedItemKeys.length > 0}
                themeCopy={roomOccasionTheme.copy}
              />
              </Reanimated.View>
            </PaneReveal>
            {mode === "media" ? (
              <RoomPane direction={paneDirection} key="media">
                <MediaGallery
                  error={mediaError || addPhoto.error?.message || errorMessage(mediaPages.error)}
                  hasMore={Boolean(mediaPages.hasNextPage)}
                  loading={mediaPages.isLoading && galleryPhotos.length === 0}
                  loadingMore={mediaPages.isFetchingNextPage}
                  onLoadMore={loadMoreMedia}
                  onOpenMedia={openMediaViewer}
                  photos={galleryPhotos}
                  themeCopy={roomOccasionTheme.copy}
                />
              </RoomPane>
            ) : mode === "dishes" ? (
              <RoomPane direction={paneDirection} key="dishes">
                <DishesPanel
                  dishes={data.dishes}
                  error={rateDish.error?.message}
                  onOpenDish={setDetailDishId}
                  onRateDish={(dishId, rating) => rateDish.mutate({ dishId, rating })}
                  pendingDishId={rateDish.isPending ? rateDish.variables?.dishId ?? null : null}
                  themeCopy={roomOccasionTheme.copy}
                />
              </RoomPane>
            ) : mode === "overview" ? (
              <RoomPane direction={paneDirection} key="overview">
                <ItineraryPanel
                  dishes={data.dishes}
                  error={createStop.error?.message ?? deleteStop.error?.message}
                  onAddDishToStop={addDishToStop}
                  onOpenDish={setDetailDishId}
                  onRemoveStop={removeStop}
                  removingStopId={deleteStop.isPending ? deleteStop.variables ?? null : null}
                  stops={data.stops}
                  themeCopy={roomOccasionTheme.copy}
                  topInset={tableHeaderHeight}
                />
              </RoomPane>
            ) : null}
          </View>

          <PaneReveal
            active={mode === "chat"}
            pointerEvents={mode === "chat" ? "auto" : "none"}
            style={styles.chatBottomOverlay}
          >
              {selectedItemKeys.length > 0 ? (
                <SelectionActionBar
                  canDelete={canDeleteSelected}
                  count={selectedItemKeys.length}
                  insetStyle={composerInsetStyle}
                  deleting={false}
                  editableMessage={editableSelectedMessage}
                  onCancel={cancelSelection}
                  onDelete={removeSelectedItems}
                  onEdit={beginEditMessage}
                  onLayoutChange={handleComposerLayout}
                />
              ) : (
                <Composer
                  mediaError={mediaError}
                  mediaPending={addPhoto.isPending}
                  mediaMutationError={addPhoto.error?.message}
                  message={message}
                  messageError={addMessage.error?.message || editMessage.error?.message}
                  messagePending={addMessage.isPending || editMessage.isPending}
                  editingLabel={editingMessage ? `Editing message` : undefined}
                  insetStyle={composerInsetStyle}
                  inputRef={messageInputRef}
                  onCancelEdit={cancelEditMessage}
                  onCancelReply={cancelReplyMessage}
                  onChangeMessage={setMessage}
                  onLayoutChange={handleComposerLayout}
                  onInputFocus={handleComposerFocus}
                  replyingToMessage={replyingToMessage}
                  onSend={submitMessage}
                  themeCopy={roomOccasionTheme.copy}
                />
              )}
          </PaneReveal>
          </Reanimated.View>
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
      </KeyboardAvoidingView>
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

function RoomHeader({
  data,
  displayRestaurantName,
  keyboardProgress,
  mode,
  myUsername,
  onAddPeople,
  onBack,
  onChangeMode,
  onHeightChange,
  onOpenActions,
  onViewPeople,
  transitioning
}: {
  data: MemoryRoom;
  displayRestaurantName: string;
  keyboardProgress: SharedValue<number>;
  mode: RoomMode;
  myUsername: string;
  onAddPeople: () => void;
  onBack: () => void;
  onChangeMode: (mode: RoomMode) => void;
  onHeightChange?: (height: number) => void;
  onOpenActions: () => void;
  onViewPeople: () => void;
  transitioning: boolean;
}) {
  const roomTitle = data.title?.trim() || displayRestaurantName;
  const roomDateLabel = formatDisplayDate(data.visitDate ?? data.createdAt);
  const isMembersArea = mode === "people";
  const isCompactHeader = mode !== "overview";
  const compactTitle = isMembersArea ? "Members" : roomTitle;
  const visualTabMode: RoomTabMode = isMembersArea ? "overview" : mode;
  const activeTabIndex = ROOM_TABS.findIndex((tab) => tab.mode === visualTabMode);
  const hasActiveTab = activeTabIndex >= 0;
  const tabIndicatorProgress = useRef(new Animated.Value(Math.max(0, activeTabIndex))).current;
  // Collapse runs through Reanimated so the layout props (maxHeight, margins, width)
  // animate on the UI thread, in lockstep with the tab indicator, even when the JS
  // thread is busy mounting the chat timeline.
  const collapseProgress = useSharedValue(isCompactHeader ? 1 : 0);
  // Fully fades + slides the whole header out of the way while the dish/media
  // sheet's keyboard is up, in exact lockstep with the keyboard (no own timing).
  const headerHideStyle = useAnimatedStyle(() => ({
    opacity: 1 - keyboardProgress.value,
    transform: [{ translateY: -24 * keyboardProgress.value }]
  }));
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const tabTrackWidth = Math.max(0, tabBarWidth - 4);
  const tabWidth = tabTrackWidth > 0 ? tabTrackWidth / ROOM_TABS.length : 0;
  const tabIndicatorTranslateX = tabIndicatorProgress.interpolate({
    inputRange: ROOM_TABS.map((_, index) => index),
    outputRange: ROOM_TABS.map((_, index) => 2 + tabWidth * index)
  });
  const titleStyle = useAnimatedStyle(() => ({
    fontSize: interpolate(collapseProgress.value, [0, 1], [20, 19]),
    left: interpolate(collapseProgress.value, [0, 1], [26, 56]),
    lineHeight: interpolate(collapseProgress.value, [0, 1], [27, 25]),
    right: interpolate(collapseProgress.value, [0, 1], [26, 58]),
    top: interpolate(collapseProgress.value, [0, 1], [44, 12])
  }));
  const expandedDetailsStyle = useAnimatedStyle(() => ({
    marginTop: interpolate(collapseProgress.value, [0, 1], [34, 0]),
    maxHeight: interpolate(collapseProgress.value, [0, 1], [78, 0]),
    opacity: interpolate(collapseProgress.value, [0, 0.45, 1], [1, 0.12, 0]),
    transform: [{ translateY: interpolate(collapseProgress.value, [0, 1], [0, -10]) }]
  }));
  const addFriendSlotStyle = useAnimatedStyle(() => ({
    marginRight: interpolate(collapseProgress.value, [0, 1], [spacing.sm, 0]),
    opacity: interpolate(collapseProgress.value, [0, 0.7, 1], [1, 0.15, 0]),
    transform: [{ translateX: interpolate(collapseProgress.value, [0, 1], [0, 24]) }],
    width: interpolate(collapseProgress.value, [0, 1], [34, 0])
  }));
  const tabBarStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(collapseProgress.value, [0, 1], [0, -4]) }]
  }));
  const orderedParticipants = [...data.participants].sort((first, second) => {
    const firstIsMe = first.username.toLowerCase() === myUsername.toLowerCase();
    const secondIsMe = second.username.toLowerCase() === myUsername.toLowerCase();
    if (firstIsMe === secondIsMe) return 0;
    return firstIsMe ? -1 : 1;
  });
  const visibleAvatars = orderedParticipants.slice(0, 4);
  const hiddenAvatarCount = Math.max(0, orderedParticipants.length - visibleAvatars.length);
  const friendNames = orderedParticipants.map((participant) => friendSummaryName(participant, myUsername));
  const friendsLabel = friendNames.length > 0
    ? friendNames.join(", ")
    : "No friends yet";

  useEffect(() => {
    if (!hasActiveTab) return;
    Animated.timing(tabIndicatorProgress, {
      duration: HEADER_MODE_TRANSITION_DURATION,
      easing: Easing.out(Easing.cubic),
      toValue: activeTabIndex,
      useNativeDriver: true
    }).start();
  }, [activeTabIndex, hasActiveTab, tabIndicatorProgress]);

  useEffect(() => {
    collapseProgress.value = withTiming(isCompactHeader ? 1 : 0, {
      duration: HEADER_MODE_TRANSITION_DURATION,
      easing: ReanimatedEasing.out(ReanimatedEasing.cubic)
    });
  }, [collapseProgress, isCompactHeader]);


  return (
    <Reanimated.View
      aria-hidden={transitioning ? true : undefined}
      accessibilityElementsHidden={transitioning}
      importantForAccessibility={transitioning ? "no-hide-descendants" : "auto"}
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      pointerEvents={transitioning ? "none" : "auto"}
      style={[styles.header, headerHideStyle]}
    >
      <View pointerEvents="none" style={styles.sharedRoomTitleLayer}>
        <Reanimated.Text
          adjustsFontSizeToFit
          maxFontSizeMultiplier={1}
          minimumFontScale={0.78}
          numberOfLines={1}
          style={[styles.sharedRoomTitle, titleStyle]}
        >
          {compactTitle}
        </Reanimated.Text>
      </View>
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
        <View pointerEvents="none" style={styles.compactRoomTitleWrap} />
        {isMembersArea ? null : (
          <View style={styles.headerActions}>
            <Reanimated.View
              pointerEvents={isCompactHeader ? "none" : "auto"}
              style={[styles.headerAddFriendSlot, addFriendSlotStyle]}
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
        )}
      </View>

      <Reanimated.View
        pointerEvents={isCompactHeader ? "none" : "auto"}
        style={[styles.roomIdentityAnimated, expandedDetailsStyle]}
      >
        <View style={styles.roomIdentity}>
          <View style={styles.roomMetaRow}>
            <View style={[styles.roomMetaGroup, styles.roomMetaLocationGroup]}>
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
        </View>
      </Reanimated.View>

      <Reanimated.View
        pointerEvents={isMembersArea ? "none" : "auto"}
        style={[styles.modeTabsAnimated, tabBarStyle]}
      >
        <View
          onLayout={(event) => setTabBarWidth(event.nativeEvent.layout.width)}
          style={styles.modeTabs}
        >
          {tabWidth > 0 && hasActiveTab ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.modeTabIndicator,
                {
                  transform: [{ translateX: tabIndicatorTranslateX }],
                  width: tabWidth
                }
              ]}
            />
          ) : null}
          {ROOM_TABS.map((tab) => (
            <ModeButton
              active={visualTabMode === tab.mode}
              icon={tab.icon}
              key={tab.mode}
              label={tab.label}
              onPress={() => onChangeMode(tab.mode)}
            />
          ))}
        </View>
      </Reanimated.View>
    </Reanimated.View>
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
  onPress
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const iconColor = active ? ROOM_COLORS.onSurface : ROOM_COLORS.muted;

  return (
    <Pressable
      accessibilityLabel={label}
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
    </Pressable>
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
      duration: active ? 180 : 120,
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

function RoomPane({
  children,
  direction,
  style
}: {
  children: ReactNode;
  direction: number;
  style?: StyleProp<ViewStyle>;
}) {
  const directionRef = useRef(direction);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true
    }).start();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [directionRef.current * 26, 0]
  });

  return (
    <Animated.View style={[style ?? styles.roomPane, { opacity: progress, transform: [{ translateX }] }]}>
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
  onContentHeightChange,
  onLayoutChange,
  onLoadOlderMessages,
  onNearBottomChange,
  onOpenDish,
  onOpenMedia,
  onRateDish,
  onReplyMessage,
  onScrollBeginDrag,
  onSelectionPressOut,
  onToggleSelection,
  lastReadAt,
  olderMessagesError,
  pendingDishId,
  scrollRef,
  scrollToBottom,
  selectedItemKeys,
  selectionMode,
  themeCopy
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
  onContentHeightChange: (height: number) => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
  onLoadOlderMessages: () => void;
  onNearBottomChange: (isNearBottom: boolean) => void;
  onOpenDish: (dishId: string) => void;
  onOpenMedia: OpenMediaHandler;
  onRateDish: (dishId: string, rating: number) => void;
  onReplyMessage: (message: MemoryMessage) => void;
  onScrollBeginDrag: () => void;
  onSelectionPressOut: (target: MemoryActionTarget) => void;
  onToggleSelection: (target: MemoryActionTarget) => void;
  lastReadAt: string | null;
  olderMessagesError?: string;
  pendingDishId?: string | null;
  scrollRef: React.RefObject<FlatList<ChatTimelineRow> | null>;
  scrollToBottom: (animated: boolean) => void;
  selectedItemKeys: string[];
  selectionMode: boolean;
  themeCopy: OccasionTheme["copy"];
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
    setInitialAnchorReady(false);
  }, [data.id]);

  const revealInitialAnchor = useCallback(() => {
    if (initialAnchorReadyRef.current) return;
    initialAnchorReadyRef.current = true;
    requestAnimationFrame(() => setInitialAnchorReady(true));
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
  }, []);

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
  }, [highlightMessage, messageRowIndexById, onNearBottomChange, scrollRef]);

  const jumpToRepliedMessage = useCallback((messageId: string) => {
    if (scrollToMessage(messageId, true)) return;
    pendingReplyJumpRef.current = messageId;
    if (hasOlderMessages && !loadingOlderMessages) onLoadOlderMessages();
  }, [hasOlderMessages, loadingOlderMessages, onLoadOlderMessages, scrollToMessage]);

  useEffect(() => {
    const pendingMessageId = pendingReplyJumpRef.current;
    if (!pendingMessageId) return;
    if (scrollToMessage(pendingMessageId, true)) {
      pendingReplyJumpRef.current = null;
      return;
    }
    if (hasOlderMessages && !loadingOlderMessages) {
      onLoadOlderMessages();
      return;
    }
    if (!hasOlderMessages && !loadingOlderMessages) {
      pendingReplyJumpRef.current = null;
    }
  }, [hasOlderMessages, loadingOlderMessages, onLoadOlderMessages, scrollToMessage, timelineRows.length]);

  useEffect(() => {
    if (!active || !listNearBottomRef.current) return;
    onNearBottomChange(true);
  }, [active, onNearBottomChange]);

  useEffect(() => {
    const previousLatestId = latestTimelineItemIdRef.current;
    latestTimelineItemIdRef.current = latestTimelineItemId;
    if (!active || !latestTimelineItemId || previousLatestId === latestTimelineItemId) return undefined;
    if (!latestTimelineItemMine && !listNearBottomRef.current && !followBottomRef.current) return undefined;

    // The primary scroll is done by onContentSizeChange, which fires once the new
    // row has laid out and so uses the correct content height — scrolling here with
    // a stale height is what parked the message below the composer then jumped it
    // up. We only set the follow flags, plus one deferred safety-net scroll (next
    // tick, after the height ref is fresh) for the case the user had scrolled up.
    followBottomRef.current = true;
    listNearBottomRef.current = true;
    onNearBottomChange(true);
    const timeout = setTimeout(() => scrollToBottom(false), 0);
    return () => clearTimeout(timeout);
  }, [
    active,
    latestTimelineItemId,
    latestTimelineItemMine,
    onNearBottomChange,
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

  const rowHandlersRef = useRef({ onBeginSelection, onOpenDish, onOpenMedia, onRateDish, onReplyMessage, onSelectionPressOut, onToggleSelection });
  rowHandlersRef.current = { onBeginSelection, onOpenDish, onOpenMedia, onRateDish, onReplyMessage, onSelectionPressOut, onToggleSelection };
  const beginRowSelection = useCallback((target: MemoryActionTarget) => rowHandlersRef.current.onBeginSelection(target), []);
  const finishRowSelectionPress = useCallback((target: MemoryActionTarget) => rowHandlersRef.current.onSelectionPressOut(target), []);
  const openRowDish = useCallback((dishId: string) => rowHandlersRef.current.onOpenDish(dishId), []);
  const rateRowDish = useCallback((dishId: string, rating: number) => rowHandlersRef.current.onRateDish(dishId, rating), []);
  const openRowMedia = useCallback<OpenMediaHandler>((media, group) => rowHandlersRef.current.onOpenMedia(media, group), []);
  const replyToRow = useCallback((message: MemoryMessage) => rowHandlersRef.current.onReplyMessage(message), []);
  const toggleRowSelection = useCallback((target: MemoryActionTarget) => rowHandlersRef.current.onToggleSelection(target), []);

  const renderTimelineRow = useCallback(({ item }: { item: ChatTimelineRow }) => {
    if (item.type === "date") return <DateDivider label={item.label} />;

    if (item.type === "unread") {
      return (
        <UnreadDivider
          onJumpToLatest={() => scrollToBottom(true)}
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
          onOpenMedia={openRowMedia}
          onJumpToMessage={jumpToRepliedMessage}
          onReply={() => replyToRow(item.value)}
          onSelectionPressOut={() => finishRowSelectionPress({ type: "message", value: item.value })}
          onToggleSelection={() => toggleRowSelection({ type: "message", value: item.value })}
          editing={editingMessageId === item.value.id}
          groupPosition={item.groupPosition}
          highlighted={highlightedMessageId === item.value.id}
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
    editingMessageId,
    finishRowSelectionPress,
    highlightedMessageId,
    jumpToRepliedMessage,
    openRowDish,
    openRowMedia,
    participantNames,
    pendingDishId,
    rateRowDish,
    replyToRow,
    scrollToBottom,
    selectedItemKeys,
    selectionMode,
    toggleRowSelection
  ]);

  return (
    <View onLayout={onLayoutChange} style={[styles.chatTimelineWrap, hideUntilAnchored && styles.chatTimelineHidden]}>
      <FlatList
        data={invertedRows}
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
              onLoad={onLoadOlderMessages}
            />
          </View>
        ) : null}
        onEndReached={() => {
          if (initialAnchorReadyRef.current && hasOlderMessages && !loadingOlderMessages) {
            onLoadOlderMessages();
          }
        }}
        onEndReachedThreshold={0.4}
        maxToRenderPerBatch={CHAT_TIMELINE_MAX_RENDER_BATCH}
        onScroll={(event) => {
          if (!active) return;
          const { contentOffset } = event.nativeEvent;
          // Inverted: the bottom (newest) is at offset 0.
          const distanceFromBottom = contentOffset.y;
          const isNearBottom = distanceFromBottom < 96;
          listNearBottomRef.current = isNearBottom;
          onNearBottomChange(isNearBottom);
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
          const offset = Math.max(0, info.averageItemLength * info.index - 18);
          setTimeout(() => {
            scrollRef.current?.scrollToOffset({ animated: false, offset });
            revealInitialAnchor();
          }, 50);
          // The estimated offset mounts rows near the target; retry the exact index once
          // they exist so the entry never strands mid-history.
          setTimeout(() => {
            scrollRef.current?.scrollToIndex({
              animated: false,
              index: info.index,
              viewPosition: 0.12
            });
          }, 220);
        }}
        removeClippedSubviews={Platform.OS === "android"}
        renderItem={renderTimelineRow}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.timelineList}
        updateCellsBatchingPeriod={50}
        windowSize={CHAT_TIMELINE_WINDOW_SIZE}
      />
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

const FOOD_WALLPAPER_PLACEMENTS = buildFoodWallpaperPlacements();
const ROMANTIC_WALLPAPER_PLACEMENTS = [
  { transform: "translate(28 30) scale(0.55)", strokeWidth: 2 },
  { transform: "translate(124 96) scale(0.48)", strokeWidth: 2 },
  { transform: "translate(198 38) scale(0.42)", strokeWidth: 2 }
] as const;
const ROMANTIC_HEART_PATH = "M12 21s-7-4.4-9.3-8.2C.8 9.7 1.6 6 4.7 5.2c1.8-.5 3.5.2 4.5 1.6 1-1.4 2.7-2.1 4.5-1.6 3.1.8 3.9 4.5 2 7.6C19 16.6 12 21 12 21Z";

function WallpaperPrimitive({ primitive }: { primitive: DoodlePrimitive }) {
  switch (primitive.type) {
    case "path":
      return <Path d={primitive.d} />;
    case "circle":
      return <Circle cx={primitive.cx} cy={primitive.cy} r={primitive.r} />;
    case "ellipse":
      return <Ellipse cx={primitive.cx} cy={primitive.cy} rx={primitive.rx} ry={primitive.ry} />;
    case "line":
      return <Line x1={primitive.x1} x2={primitive.x2} y1={primitive.y1} y2={primitive.y2} />;
  }
}

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
    <Animated.View pointerEvents="none" style={[styles.chatWallpaper, { opacity }]}>
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
            <Rect fill={ROOM_COLORS.wallpaperBg} height={FOOD_WALLPAPER_TILE_SIZE} width={FOOD_WALLPAPER_TILE_SIZE} x={0} y={0} />
            <G
              fill="none"
              opacity={ROOM_COLORS.wallpaperOpacity}
              stroke={ROOM_COLORS.wallpaperLine}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {FOOD_WALLPAPER_PLACEMENTS.map((placement, placementIndex) => (
                <G key={placementIndex} strokeWidth={placement.strokeWidth} transform={placement.transform}>
                  {placement.shape.primitives.map((primitive, primitiveIndex) => (
                    <WallpaperPrimitive key={primitiveIndex} primitive={primitive} />
                  ))}
                </G>
              ))}
              {romantic ? ROMANTIC_WALLPAPER_PLACEMENTS.map((placement, index) => (
                <Path key={`heart-${index}`} d={ROMANTIC_HEART_PATH} strokeWidth={placement.strokeWidth} transform={placement.transform} />
              )) : null}
            </G>
          </Pattern>
        </Defs>
        <Rect fill={ROOM_COLORS.wallpaperBg} height="100%" width="100%" x={0} y={0} />
        <Rect fill={`url(#${patternId})`} height="100%" width="100%" x={0} y={0} />
      </Svg>
      <View style={styles.chatWallpaperOverlay} />
    </Animated.View>
  );
});

function UnreadDivider({
  onJumpToLatest
}: {
  onJumpToLatest: () => void;
}) {
  return (
    <View style={styles.unreadDividerRow}>
      <View style={styles.unreadDividerLine} />
      <Text style={styles.unreadDividerText}>New messages</Text>
      <Pressable hitSlop={6} onPress={onJumpToLatest} style={styles.unreadDividerButton}>
        <Text style={styles.unreadDividerButtonText}>Latest</Text>
      </Pressable>
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

const VIDEO_THUMBNAIL_TIME_SECONDS = 0.1;
const VIDEO_THUMBNAIL_MAX_WIDTH = 720;
const VIDEO_THUMBNAIL_CACHE_LIMIT = 80;
const videoThumbnailCache = new Map<string, VideoThumbnail>();

function cacheVideoThumbnail(uri: string, thumbnail: VideoThumbnail) {
  if (videoThumbnailCache.has(uri)) {
    videoThumbnailCache.delete(uri);
  }
  videoThumbnailCache.set(uri, thumbnail);

  if (videoThumbnailCache.size > VIDEO_THUMBNAIL_CACHE_LIMIT) {
    const oldestUri = videoThumbnailCache.keys().next().value;
    if (typeof oldestUri === "string") {
      videoThumbnailCache.delete(oldestUri);
    }
  }
}

function VideoThumbnailLayer({
  contentFit = "cover",
  uri
}: {
  contentFit?: "contain" | "cover";
  uri: string;
}) {
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(() => videoThumbnailCache.get(uri) ?? null);
  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = true;
    instance.volume = 0;
  });

  useEffect(() => {
    const cachedThumbnail = videoThumbnailCache.get(uri);
    if (cachedThumbnail) {
      setThumbnail(cachedThumbnail);
      return undefined;
    }

    setThumbnail(null);

    if (Platform.OS === "web") {
      return undefined;
    }

    let cancelled = false;

    void player
      .generateThumbnailsAsync(VIDEO_THUMBNAIL_TIME_SECONDS, { maxWidth: VIDEO_THUMBNAIL_MAX_WIDTH })
      .then((thumbnails) => {
        const nextThumbnail = thumbnails[0] ?? null;
        if (nextThumbnail) {
          cacheVideoThumbnail(uri, nextThumbnail);
        }
        if (!cancelled) {
          setThumbnail(nextThumbnail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setThumbnail(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [player, uri]);

  if (Platform.OS === "web") {
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

  if (!thumbnail) return null;

  return (
    <Image
      cachePolicy="memory-disk"
      contentFit={contentFit}
      recyclingKey={uri}
      source={thumbnail}
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

function memoryMessageReplyPreview(message: Pick<MemoryMessage, "attachments" | "body">) {
  const body = message.body.trim();
  if (body) return body;
  return message.attachments.length > 0 ? "Media" : "Message";
}

function ReplyPreviewBlock({
  author,
  body,
  mine,
  onPress
}: {
  author: string;
  body: string;
  mine?: boolean;
  onPress?: () => void;
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
          pressed && styles.replyPreviewBlockPressed
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.replyPreviewBlock, mine && styles.replyPreviewBlockMine]}>
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
  return message.editedAt ? `edited ${time}` : time;
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
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeIndicatorOpacity = swipeTranslateX.interpolate({
    inputRange: [0, REPLY_SWIPE_TRIGGER_DISTANCE],
    outputRange: [0, 1],
    extrapolate: "clamp"
  });
  const swipeIndicatorScale = swipeTranslateX.interpolate({
    inputRange: [0, REPLY_SWIPE_TRIGGER_DISTANCE],
    outputRange: [0.86, 1],
    extrapolate: "clamp"
  });
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      swipeEnabled &&
      Boolean(onSwipeRight) &&
      gesture.dx > 8 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35
    ),
    onPanResponderMove: (_event, gesture) => {
      if (!swipeEnabled || !onSwipeRight) return;
      swipeTranslateX.setValue(Math.min(REPLY_SWIPE_MAX_TRANSLATE, Math.max(0, gesture.dx)));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (
        swipeEnabled &&
        onSwipeRight &&
        gesture.dx >= REPLY_SWIPE_TRIGGER_DISTANCE &&
        Math.abs(gesture.dy) < 42
      ) {
        onSwipeRight();
      }
      Animated.spring(swipeTranslateX, {
        bounciness: 0,
        speed: 22,
        toValue: 0,
        useNativeDriver: true
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(swipeTranslateX, {
        bounciness: 0,
        speed: 22,
        toValue: 0,
        useNativeDriver: true
      }).start();
    }
  }), [onSwipeRight, swipeEnabled, swipeTranslateX]);

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
        <Animated.View style={[
          styles.swipeReplyIndicator,
          {
            opacity: swipeIndicatorOpacity,
            transform: [{ scale: swipeIndicatorScale }]
          }
        ]}>
          <Ionicons name="arrow-undo-outline" size={17} color={ROOM_COLORS.cool} />
        </Animated.View>
        <Animated.View
          {...panResponder.panHandlers}
          style={[styles.swipeReplyContent, { transform: [{ translateX: swipeTranslateX }] }]}
        >
          {rowElement}
        </Animated.View>
      </View>
    );
  }

  return rowElement;
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

function InlineTimestampText({
  fill = false,
  minWidth,
  nativeAvailableWidth,
  reserveTextColor,
  text,
  textStyle,
  time,
  timeStyle
}: {
  fill?: boolean;
  minWidth?: number;
  nativeAvailableWidth?: number;
  reserveTextColor?: string;
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
        {text}
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[timeStyle, styles.inlineTimestampReserve, reserveTextColor ? { color: reserveTextColor } : null]}
        >
          {`  ${time}`}
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
  editing,
  groupPosition,
  highlighted,
  message,
  mine,
  onBeginSelection,
  onJumpToMessage,
  onOpenMedia,
  onReply,
  onSelectionPressOut,
  rowStyle,
  onToggleSelection,
  selected,
  selectionMode,
  showSenderDetails
}: {
  editing: boolean;
  groupPosition: MessageGroupPosition;
  highlighted: boolean;
  message: MemoryMessage;
  mine: boolean;
  onBeginSelection: () => void;
  onJumpToMessage: (messageId: string) => void;
  onOpenMedia: OpenMediaHandler;
  onReply: () => void;
  onSelectionPressOut: () => void;
  rowStyle?: StyleProp<ViewStyle>;
  onToggleSelection: () => void;
  selected: boolean;
  selectionMode: boolean;
  showSenderDetails: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [textBubbleWidth, setTextBubbleWidth] = useState(0);
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
  const textBubbleContentMinWidth = Math.max(0, (mine ? 64 : 88) - 22);
  const textBubbleMeasuredContentWidth = textBubbleWidth > 0 ? Math.max(0, textBubbleWidth - 22) : undefined;
  const shouldFillTextTimestamp = Boolean(
    message.replyToMessage && (Platform.OS === "web" || textBubbleMeasuredContentWidth)
  );

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

  function handleTextBubbleLayout(event: LayoutChangeEvent) {
    const nextWidth = Math.floor(event.nativeEvent.layout.width);
    if (nextWidth > 0 && Math.abs(nextWidth - textBubbleWidth) > 1) {
      setTextBubbleWidth(nextWidth);
    }
  }

  function renderTextMessage() {
    const bubble = (
      <MessageBubbleFrame
        style={styles.textMessageFrame}
      >
        <View
          onLayout={message.replyToMessage ? handleTextBubbleLayout : undefined}
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
          <InlineTimestampText
            fill={shouldFillTextTimestamp}
            minWidth={message.replyToMessage ? undefined : textBubbleContentMinWidth}
            nativeAvailableWidth={shouldFillTextTimestamp ? textBubbleMeasuredContentWidth : undefined}
            reserveTextColor={mine ? CHAT_OWN_BUBBLE_COLOR : CHAT_OTHER_BUBBLE_COLOR}
            text={body}
            textStyle={[styles.textOnlyBubbleText, mine ? styles.messageTextMine : styles.messageTextOther]}
            time={timestampLabel}
            timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
          />
        </View>
      </MessageBubbleFrame>
    );
    return (
      <MessageRow
        editing={editing}
        highlighted={highlighted}
        mine={mine}
        onLongPress={!selectionMode ? onBeginSelection : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onPressOut={onSelectionPressOut}
        onSwipeRight={onReply}
        rowStyle={rowStyle}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
        swipeEnabled={!selectionMode}
      >
        {bubble}
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
                  reserveTextColor={mine ? CHAT_OWN_BUBBLE_COLOR : CHAT_OTHER_BUBBLE_COLOR}
                  text={body}
                  textStyle={[styles.mediaCaptionText, mine ? styles.messageTextMine : styles.messageTextOther]}
                  time={timestampLabel}
                  timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
                />
              </View>
            ) : null}
          </View>
        </MessageBubbleFrame>
      </MessageRow>
    );
  }

  function renderMultiMediaMessage() {
    const multiMediaCardWidth = getMultiMediaGridWidth(screenWidth);

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
                  reserveTextColor={mine ? CHAT_OWN_BUBBLE_COLOR : CHAT_OTHER_BUBBLE_COLOR}
                  text={body}
                  textStyle={[styles.mediaCaptionText, mine ? styles.messageTextMine : styles.messageTextOther]}
                  time={timestampLabel}
                  timeStyle={mine ? styles.inlineTimestampMine : styles.inlineTimestampOther}
                />
              </View>
            ) : null}
          </View>
        </MessageBubbleFrame>
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
              reserveTextColor={mine ? CHAT_OWN_BUBBLE_COLOR : CHAT_OTHER_BUBBLE_COLOR}
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
  const mediaLabel = media.mediaType === "video" ? "Open video" : "Open photo";
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

  if (media.mediaType === "video") {
    return (
      <View style={styles.gridVideoPreview}>
        <VideoThumbnailLayer contentFit="contain" uri={media.publicUrl} />
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
      removeClippedSubviews={Platform.OS !== "web"}
      renderItem={({ index, item: photo }) => (
        <View
          style={[
            styles.galleryItem,
            index % 2 === 0 ? styles.galleryItemLeft : styles.galleryItemRight
          ]}
        >
          <Pressable
            accessibilityLabel={photo.mediaType === "video" ? "Open video" : "Open photo"}
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
  const { height: screenHeight } = useWindowDimensions();
  const topPadding = topInset != null ? topInset + spacing.sm : TABLE_HEADER_CLEARANCE;
  const bottomPadding = spacing.xl + 92;
  const emptyPanelMinHeight = Math.max(260, screenHeight - topPadding - bottomPadding);
  const dishesByStop = dishes.reduce<Record<string, MemoryDish[]>>((groups, dish) => {
    if (!dish.stopId) return groups;
    groups[dish.stopId] = [...(groups[dish.stopId] ?? []), dish];
    return groups;
  }, {});
  const unassignedDishes = dishes.filter((dish) => !dish.stopId);
  const isEmpty = stops.length === 0 && unassignedDishes.length === 0;

  return (
    <ScrollView
      contentContainerStyle={[styles.itineraryContent, { paddingBottom: bottomPadding, paddingTop: topPadding }]}
      showsVerticalScrollIndicator={false}
    >
      {isEmpty ? (
        <View style={[styles.itineraryEmptyPanel, { minHeight: emptyPanelMinHeight }]}>
          <View style={styles.emptyIcon}>
            <Ionicons name="map-outline" size={26} color={ROOM_COLORS.cool} />
          </View>
          <Text style={styles.emptyTitle}>Plan your stops</Text>
          <Text style={styles.emptyText}>Tap the + button and choose Place to add each spot the occasion took you — dinner, drinks, a movie.</Text>
        </View>
      ) : (
        <>
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
        </>
      )}

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
            <View style={styles.selectedPeopleChips}>
              {selectedParticipants.map((person) => (
                <Pressable key={person.username} onPress={() => onRemoveSelectedParticipant(person.username)} style={styles.selectedPeopleChip}>
                  <Text numberOfLines={1} style={styles.selectedPeopleChipText}>@{person.username}</Text>
                  <Ionicons name="close" size={12} color={ROOM_COLORS.muted} />
                </Pressable>
              ))}
            </View>
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

  const renderViewerItem = ({ item: media }: { item: MemoryPhoto }) => (
    <View style={[styles.viewerSlide, carouselWidth > 0 && { width: carouselWidth }]}>
      {media.mediaType === "video" ? (
        <ViewerVideo media={media} />
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
            extraData={carouselWidth}
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
            removeClippedSubviews={Platform.OS !== "web"}
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
                  {media.mediaType === "video" ? (
                    <View style={styles.viewerThumbnailVideo}>
                      <VideoThumbnailLayer uri={media.publicUrl} />
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

function ViewerVideo({ media }: { media: MemoryPhoto }) {
  const player = useVideoPlayer(media.publicUrl, (instance) => {
    instance.loop = false;
  });

  return (
    <View style={styles.viewerVideo}>
      <VideoView
        allowsFullscreen
        allowsPictureInPicture
        contentFit="contain"
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

  return (
    <View style={[styles.singleMediaContainer, previewSize]}>
      <MediaPreview media={media} style={styles.singleMediaFill} />
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

  if (media.mediaType === "video") {
    return (
      <View style={[styles.videoPreview, style as StyleProp<ViewStyle>]}>
        <VideoThumbnailLayer contentFit={contentFit} uri={media.publicUrl} />
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

function Composer({
  editingLabel,
  insetStyle,
  inputRef,
  mediaError,
  mediaMutationError,
  mediaPending,
  message,
  messageError,
  messagePending,
  onCancelEdit,
  onCancelReply,
  onChangeMessage,
  onLayoutChange,
  onInputFocus,
  replyingToMessage,
  onSend,
  themeCopy
}: {
  editingLabel?: string;
  insetStyle: StyleProp<ViewStyle>;
  inputRef: RefObject<TextInput | null>;
  mediaError?: string;
  mediaMutationError?: string;
  mediaPending: boolean;
  message: string;
  messageError?: string;
  messagePending: boolean;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
  onChangeMessage: (value: string) => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
  onInputFocus: () => void;
  replyingToMessage?: MemoryMessage | null;
  onSend: () => void;
  themeCopy: OccasionTheme["copy"];
}) {
  const canSend = Boolean(message.trim()) && !messagePending && !mediaPending;
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const composerCanScroll = composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT;

  useEffect(() => {
    if (message.length === 0 && composerInputHeight !== COMPOSER_INPUT_MIN_HEIGHT) {
      setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    }
  }, [composerInputHeight, message]);

  function handleComposerContentSizeChange(event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) {
    const nextHeight = Math.max(
      COMPOSER_INPUT_MIN_HEIGHT,
      Math.min(COMPOSER_INPUT_MAX_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height))
    );
    setComposerInputHeight(nextHeight);
  }

  return (
    <Reanimated.View style={[styles.composerWrap, insetStyle]}>
      <View onLayout={onLayoutChange} style={styles.composerContent}>
        {messageError || mediaError || mediaMutationError ? (
          <Text style={styles.error}>{messageError || mediaError || mediaMutationError}</Text>
        ) : null}
        {editingLabel ? (
          <View style={styles.editingBanner}>
            <Text style={styles.editingBannerText}>{editingLabel}</Text>
            <Pressable hitSlop={8} onPress={onCancelEdit}>
              <Text style={styles.editingCancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {!editingLabel && replyingToMessage ? (
          <View style={styles.replyComposerBanner}>
            <View style={styles.replyComposerAccent} />
            <View style={styles.replyComposerIcon}>
              <Ionicons name="arrow-undo-outline" size={14} color={ROOM_COLORS.cool} />
            </View>
            <View style={styles.replyComposerCopy}>
              <Text numberOfLines={1} style={styles.replyComposerLabel}>{replyingToMessage.authorDisplayName}</Text>
              <Text numberOfLines={2} style={styles.replyComposerPreview}>
                {memoryMessageReplyPreview(replyingToMessage)}
              </Text>
            </View>
            <Pressable accessibilityLabel="Cancel reply" hitSlop={8} onPress={onCancelReply} style={styles.replyComposerClose}>
              <Ionicons name="close" size={15} color={ROOM_COLORS.muted} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composer}>
          <View style={styles.messageBox}>
            <TextInput
              maxLength={MEMORY_TEXT_MAX_LENGTH}
              multiline
              onContentSizeChange={handleComposerContentSizeChange}
              onChangeText={onChangeMessage}
              onFocus={onInputFocus}
              placeholder={themeCopy.composerPlaceholder}
              placeholderTextColor={ROOM_COLORS.muted}
              scrollEnabled={composerCanScroll}
              style={[
                styles.composerInput,
                Platform.OS === "web" ? styles.composerInputWeb : styles.composerInputNative,
                { height: composerInputHeight }
              ]}
              ref={inputRef}
              value={message}
            />
          </View>
          <Pressable
            accessibilityLabel={editingLabel ? "Save message" : "Send message"}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={onSend}
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
          >
            <Ionicons name={editingLabel ? "checkmark" : "send"} size={Platform.OS === "web" ? 15 : 17} color={ROOM_COLORS.onCool} />
          </Pressable>
        </View>
      </View>
    </Reanimated.View>
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
  header: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.header,
    borderBottomColor: ROOM_COLORS.border,
    borderBottomWidth: 1,
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    left: 0,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: 10,
    paddingHorizontal: 18,
    paddingTop: spacing.sm,
    position: "absolute",
    right: 0,
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 6, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    top: 0,
    width: "100%",
    zIndex: 20
  },
  headerTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 34,
    zIndex: 2
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
    height: 34,
    justifyContent: "center",
    width: 34
  },
  headerBackButton: {
    marginLeft: -8
  },
  headerAddFriendSlot: {
    overflow: "hidden"
  },
  compactRoomTitleWrap: {
    flex: 1,
    marginHorizontal: spacing.sm,
    minWidth: 0
  },
  sharedRoomTitleLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1
  },
  sharedRoomTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    position: "absolute"
  },
  compactRoomTitle: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.onSurface,
    fontSize: 19,
    lineHeight: 25
  },
  membersCompactTitle: {
    fontSize: 19,
    lineHeight: 25
  },
  roomIdentityAnimated: {
    overflow: "hidden"
  },
  roomIdentity: {
    gap: ROOM_HEADER_SECTION_GAP,
    paddingHorizontal: 8
  },
  roomMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.base,
    justifyContent: "space-between",
    minWidth: 0
  },
  roomMetaGroup: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0
  },
  roomMetaLocationGroup: {
    flexShrink: 1
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
    marginHorizontal: 8,
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
    fontSize: 10
  },
  modeButtonTextActive: {
    color: ROOM_COLORS.onSurface
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
  roomPaneActive: {
    flex: 1,
    zIndex: 1
  },
  roomPaneHidden: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    zIndex: 0
  },
  roomPane: {
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
    paddingVertical: 3,
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
    fontSize: 11,
    lineHeight: 14
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
  swipeReplyIndicator: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.surfaceHigh,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1,
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    left: CHAT_ROW_SIDE_PADDING,
    marginTop: -16,
    position: "absolute",
    shadowColor: ROOM_COLORS.black,
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    top: "50%",
    width: 32
  },
  messageBubbleFrame: {
    flexShrink: 1,
    position: "relative"
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
  senderAvatar: {
    alignItems: "center",
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  senderAvatarSlot: {
    alignSelf: "flex-start",
    flexShrink: 0,
    height: 32,
    width: 32
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
    fontSize: 11,
    lineHeight: 14,
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
    includeFontPadding: false
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
    lineHeight: 13,
    opacity: 0
  },
  inlineTimestampPinnedMeta: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    position: "absolute",
    right: 0
  },
  textOnlyBubbleText: {
    flexShrink: 1,
    flexWrap: "wrap",
    fontSize: 16,
    includeFontPadding: false,
    lineHeight: 22,
    maxWidth: "100%"
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
  mediaCaptionContainer: {
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: 9,
    width: "100%"
  },
  mediaCaptionText: {
    flexShrink: 1,
    flexWrap: "wrap",
    fontSize: 14,
    includeFontPadding: false,
    lineHeight: 20,
    marginTop: 0,
    maxWidth: "100%"
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
