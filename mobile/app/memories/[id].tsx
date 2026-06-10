import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import * as Contacts from "expo-contacts";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { memo, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
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
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, Pattern, Rect } from "react-native-svg";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryDishMutation,
  useAddMemoryPhotoMutation,
  useDeleteMemoryItemsMutation,
  useEditMemoryMessageMutation,
  useLeaveMemoryRoomMutation,
  useMarkMemoryRoomReadMutation,
  useMemoryRoomQuery,
  useMemoryRoomRealtime
} from "@/hooks/useMemories";
import {
  pickMemoryMediaFromGallery,
  type MemoryMediaPickerResult
} from "@/services/mediaPicker";
import { compactPlaceLocation } from "@/services/places";
import { searchUserProfiles, type UserSearchResult } from "@/services/profiles";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { MemoryDish, MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom } from "@/types/models";
import { formatDisplayDate, formatDisplayTime } from "@/utils/datetime";

type RoomMode = "chat" | "media" | "dishes" | "people";
type TimelineItem =
  | { id: string; createdAt: string; type: "message"; value: MemoryMessage }
  | { id: string; createdAt: string; type: "media"; value: MemoryPhoto };
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
  height?: number | null;
  mimeType?: string | null;
  type?: string | null;
  uri: string;
  width?: number | null;
};
type ContactInvite = {
  detail: string;
  id: string;
  kind: "email" | "phone";
  name: string;
};

const ROOM_MAX_WIDTH = 640;
const ROOM_COLORS = {
  bg: "#0B0E10",
  header: "#101316",
  panel: "#151719",
  panelRaised: "#1B1E21",
  mediaPanel: "#111416",
  border: "rgba(226, 232, 240, 0.09)",
  borderStrong: "rgba(226, 232, 240, 0.14)",
  muted: "#8B929C",
  cool: "#22C7B8",
  coolDim: "rgba(34, 199, 184, 0.12)",
  coolBorder: "rgba(34, 199, 184, 0.30)",
  selection: "rgba(34, 199, 184, 0.15)"
} as const;
const CHAT_OWN_BUBBLE_COLOR = "#005C4B";
const CHAT_OTHER_BUBBLE_COLOR = "#1B2022";
const CHAT_ACCENTS = ["#22C7B8", "#8B6CFF", "#F06030", "#E8A830", "#38BDF8", "#F472B6", "#3DD68C"] as const;
const COMPOSER_TOP_GAP = 8;
const CLOSED_COMPOSER_BOTTOM_GAP = 16;
const KEYBOARD_COMPOSER_BOTTOM_GAP = 6;
const ANDROID_KEYBOARD_SAFETY_LIFT = 28;
const MEDIA_GRID_GAP = 4;
const CHAT_ROW_SIDE_PADDING = Platform.OS === "web" ? spacing.base : spacing.lg;
const COMPOSER_INPUT_FONT_SIZE = Platform.OS === "web" ? 14 : 15;
const COMPOSER_INPUT_LINE_HEIGHT = Platform.OS === "web" ? 20 : 21;
const COMPOSER_INPUT_VERTICAL_PADDING = 12;
const COMPOSER_INPUT_MIN_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING;
const COMPOSER_INPUT_MAX_HEIGHT = COMPOSER_INPUT_LINE_HEIGHT * 5 + COMPOSER_INPUT_VERTICAL_PADDING;
const SELECTION_ACTION_BUTTON_SIZE = 38;
const SELECTION_SECONDARY_ICON_SIZE = 19;
const REPLY_SWIPE_TRIGGER_DISTANCE = 54;
const REPLY_SWIPE_MAX_TRANSLATE = 58;
type MediaPreviewSize = { height: number; width: number };
type MediaTimestampPlacement = "bottom-left" | "bottom-right";
type MessageGroupPosition = "single" | "first" | "middle" | "last";
type AttachmentSheetView = "actions" | "dish" | "media";
type TypingScrollOptions = {
  animated?: boolean;
  delays?: number[];
  force?: boolean;
};

function getAndroidKeyboardHeight(event: KeyboardEvent) {
  return Math.max(0, Math.round(event.endCoordinates.height));
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

  if (aspect < 0.8) {
    const width = Math.min(maxMediaWidth * 0.72, 250);
    const rawHeight = width / aspect;
    const height = Math.max(300, Math.min(rawHeight, 370));

    return {
      height: Math.round(height),
      width: Math.round(width)
    };
  }

  if (aspect <= 1.25) {
    const width = Math.min(maxMediaWidth * 0.9, 310);
    const rawHeight = width / aspect;
    const height = Math.max(240, Math.min(rawHeight, 320));

    return {
      height: Math.round(height),
      width: Math.round(width)
    };
  }

  const width = maxMediaWidth;
  const rawHeight = width / aspect;
  const height = Math.max(180, Math.min(rawHeight, 250));

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
  return item.type === "message" ? item.value.authorName : item.value.uploaderName;
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

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = params.id ?? "";
  const insets = useSafeAreaInsets();
  const room = useMemoryRoomQuery(roomId);
  useMemoryRoomRealtime(roomId);
  const addParticipant = useAddMemoryParticipantMutation(roomId);
  const addMessage = useAddMemoryMessageMutation(roomId);
  const addDish = useAddMemoryDishMutation(roomId);
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const editMessage = useEditMemoryMessageMutation(roomId);
  const deleteItems = useDeleteMemoryItemsMutation(roomId);
  const markRead = useMarkMemoryRoomReadMutation(roomId);
  const leaveRoom = useLeaveMemoryRoomMutation(roomId);
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");
  const { height: windowHeight } = useWindowDimensions();
  const peopleInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<FlatList<ChatTimelineRow>>(null);
  const initialWindowHeightRef = useRef(Dimensions.get("window").height);
  const nearBottomRef = useRef(false);
  const composerHeightRef = useRef(0);
  const chatTimelineHeightRef = useRef(0);
  const keepChatPinnedDuringKeyboardRef = useRef(false);
  const keyboardTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingScrollTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const readMarkerRef = useRef<string | null>(null);
  const suppressSelectionToggleRef = useRef<string | null>(null);
  const suppressSelectionToggleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mode, setMode] = useState<RoomMode>("chat");
  const [participant, setParticipant] = useState("");
  const [participantSuggestions, setParticipantSuggestions] = useState<UserSearchResult[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<UserSearchResult[]>([]);
  const [dishName, setDishName] = useState("");
  const [dishNote, setDishNote] = useState("");
  const [dishRating, setDishRating] = useState(0);
  const [message, setMessage] = useState("");
  const [editingMessage, setEditingMessage] = useState<MemoryMessage | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<MemoryMessage | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [attachmentOptionsVisible, setAttachmentOptionsVisible] = useState(false);
  const [roomActionsVisible, setRoomActionsVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaViewerState | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  useEffect(() => {
    if (mode !== "people") return;

    const query = participant.trim();
    if (query.replace(/^@/, "").length < 2) {
      setParticipantsLoading(false);
      setParticipantSuggestions([]);
      return;
    }

    let alive = true;
    setParticipantsLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const excludedUsernames = [
          myUsername,
          ...(room.data?.participants ?? []).map((item) => item.username),
          ...selectedParticipants.map((item) => item.username)
        ].filter(Boolean);
        const suggestions = await searchUserProfiles(query, excludedUsernames);
        if (!alive) return;
        setParticipantSuggestions(suggestions);
      } catch {
        if (!alive) return;
        setParticipantSuggestions([]);
      } finally {
        if (alive) setParticipantsLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [mode, myUsername, participant, room.data?.participants, selectedParticipants]);

  function markLatestRoomRead() {
    if (!roomId || !room.data) return;
    const latestMessage = room.data.messages[room.data.messages.length - 1];
    const marker = latestMessage?.createdAt ?? room.data.createdAt;
    if (readMarkerRef.current === marker) return;
    readMarkerRef.current = marker;
    markRead.mutate(undefined, {
      onError: () => {
        readMarkerRef.current = null;
      }
    });
  }

  useEffect(() => {
    if (mode !== "chat" || !nearBottomRef.current) return;
    markLatestRoomRead();
  }, [markRead, mode, room.data, roomId]);

  useEffect(() => {
    if (!keyboardVisible) initialWindowHeightRef.current = windowHeight;
  }, [keyboardVisible, windowHeight]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardVisible(true);
      if (Platform.OS === "android") setAndroidKeyboardHeight(getAndroidKeyboardHeight(event));
      beginKeyboardTransitionPin();
      scrollToLatestForTyping({
        animated: true,
        delays: Platform.OS === "ios" ? [16, 64, 120, 220, 340] : [16, 48, 96, 180]
      });
    });
    const hideSubscription = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      keepChatPinnedDuringKeyboardRef.current = false;
      setKeyboardVisible(false);
      setAndroidKeyboardHeight(0);
    });

    return () => {
      clearTypingScrollTimers();
      clearKeyboardTransitionTimer();
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function clearKeyboardTransitionTimer() {
    if (!keyboardTransitionTimeoutRef.current) return;
    clearTimeout(keyboardTransitionTimeoutRef.current);
    keyboardTransitionTimeoutRef.current = null;
  }

  function beginKeyboardTransitionPin() {
    keepChatPinnedDuringKeyboardRef.current = nearBottomRef.current;
    clearKeyboardTransitionTimer();
    keyboardTransitionTimeoutRef.current = setTimeout(() => {
      keyboardTransitionTimeoutRef.current = null;
    }, 520);
  }

  function clearTypingScrollTimers() {
    typingScrollTimeoutsRef.current.forEach(clearTimeout);
    typingScrollTimeoutsRef.current = [];
  }

  function scrollToLatestForTyping({
    animated = true,
    delays = [48, 120, 240],
    force = false
  }: TypingScrollOptions = {}) {
    if (!force && !keepChatPinnedDuringKeyboardRef.current && !nearBottomRef.current) return;
    clearTypingScrollTimers();
    scrollRef.current?.scrollToEnd({ animated: false });
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
    delays.forEach((delay, index) => {
      const timeout = setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: index === 0 && animated });
      }, delay);
      typingScrollTimeoutsRef.current.push(timeout);
    });
  }

  function handleComposerLayout(event: LayoutChangeEvent) {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (Math.abs(nextHeight - composerHeightRef.current) < 1) return;
    composerHeightRef.current = nextHeight;
    scrollToLatestForTyping({
      animated: false,
      delays: [32, 96, 180, 300],
      force: keepChatPinnedDuringKeyboardRef.current
    });
  }

  function handleChatTimelineLayout(event: LayoutChangeEvent) {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    if (Math.abs(nextHeight - chatTimelineHeightRef.current) < 1) return;
    chatTimelineHeightRef.current = nextHeight;
    scrollToLatestForTyping({
      animated: false,
      delays: [32, 96, 180, 300],
      force: keepChatPinnedDuringKeyboardRef.current
    });
  }

  function handleChatNearBottomChange(isNearBottom: boolean) {
    if (!isNearBottom && keepChatPinnedDuringKeyboardRef.current && keyboardTransitionTimeoutRef.current) return;
    nearBottomRef.current = isNearBottom;
    if (isNearBottom) {
      if (keyboardVisible) keepChatPinnedDuringKeyboardRef.current = true;
      markLatestRoomRead();
    } else if (!keyboardTransitionTimeoutRef.current) {
      keepChatPinnedDuringKeyboardRef.current = false;
    }
  }

  function handleChatScrollBeginDrag() {
    keepChatPinnedDuringKeyboardRef.current = false;
    clearTypingScrollTimers();
  }

  function handleComposerFocus() {
    beginKeyboardTransitionPin();
    scrollToLatestForTyping({
      animated: true,
      delays: Platform.OS === "ios" ? [16, 64, 120, 220, 340] : [16, 48, 96, 180],
      force: keepChatPinnedDuringKeyboardRef.current
    });
  }

  async function submitParticipants() {
    if (selectedParticipants.length === 0) return;
    try {
      for (const selected of selectedParticipants) {
        await addParticipant.mutateAsync(selected.username);
      }
      setParticipant("");
      setSelectedParticipants([]);
      setParticipantSuggestions([]);
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
    setParticipantSuggestions([]);
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
        await addMessage.mutateAsync({ body: message, replyToMessageId: replyingToMessage?.id ?? null });
      }
      setMessage("");
      setReplyingToMessage(null);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      // Rendered from mutation state.
    }
  }

  function beginEditMessage(target: MemoryMessage) {
    setSelectedItemKeys([]);
    setReplyingToMessage(null);
    setEditingMessage(target);
    setMessage(target.body);
    setMode("chat");
  }

  function beginReplyMessage(target: MemoryMessage) {
    setSelectedItemKeys([]);
    setEditingMessage(null);
    setReplyingToMessage(target);
    setMode("chat");
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
    setSelectedItemKeys([key]);
    suppressSelectionToggleRef.current = key;
    if (suppressSelectionToggleTimeoutRef.current) clearTimeout(suppressSelectionToggleTimeoutRef.current);
    suppressSelectionToggleTimeoutRef.current = setTimeout(() => {
      if (suppressSelectionToggleRef.current === key) suppressSelectionToggleRef.current = null;
    }, 450);
    setMode("chat");
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
      if (current.includes(key)) return current.filter((item) => item !== key);
      return [...current, key];
    });
  }

  function cancelSelection() {
    setSelectedItemKeys([]);
  }

  async function removeSelectedItems() {
    const messageIds = selectedItemKeys
      .filter((key) => key.startsWith("message:"))
      .map((key) => key.replace("message:", ""));
    const photoIds = selectedItemKeys
      .filter((key) => key.startsWith("photo:"))
      .map((key) => key.replace("photo:", ""));

    try {
      await deleteItems.mutateAsync({ messageIds, photoIds });
      if (editingMessage && messageIds.includes(editingMessage.id)) cancelEditMessage();
      setSelectedItemKeys([]);
    } catch {
      // Rendered from mutation state.
    }
  }

  async function sendMediaAssets(selectedAssets: MemoryCaptureAsset[]) {
    setMediaError("");
    if (selectedAssets.length === 0) return;

    try {
      await addPhoto.mutateAsync({
        assets: selectedAssets.map((asset) => ({
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
      setMode("chat");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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

  async function submitCameraCapture(asset: MemoryCaptureAsset) {
    setCameraVisible(false);
    await sendMediaAssets([asset]);
  }

  async function submitDish() {
    try {
      await addDish.mutateAsync({
        dishName,
        note: dishNote,
        rating: dishRating || null
      });
      setDishName("");
      setDishNote("");
      setDishRating(0);
      return true;
    } catch {
      // Rendered from mutation state.
      return false;
    }
  }

  async function submitDishFromAttachment() {
    const didAdd = await submitDish();
    if (!didAdd) return;
    setAttachmentOptionsVisible(false);
    setMode("chat");
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  function focusPeopleInput() {
    peopleInputRef.current?.focus();
  }

  function openPeopleAdd() {
    setMode("people");
    requestAnimationFrame(() => {
      focusPeopleInput();
      setTimeout(focusPeopleInput, Platform.OS === "web" ? 0 : 120);
    });
  }

  function openMediaViewer(media: MemoryPhoto, group: MemoryPhoto[] = [media]) {
    const index = Math.max(0, group.findIndex((item) => item.id === media.id));
    setSelectedMedia({ index, items: group });
  }

  function openAttachmentOptions() {
    setAttachmentOptionsVisible(true);
  }

  function openRoomActions() {
    setRoomActionsVisible(true);
  }

  function closeRoomActions() {
    setRoomActionsVisible(false);
  }

  function openPeopleFromRoomActions() {
    closeRoomActions();
    openPeopleAdd();
  }

  function viewPeopleFromRoomActions() {
    closeRoomActions();
    setMode("people");
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
              router.replace("/profile");
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

  function openCamera() {
    setAttachmentOptionsVisible(false);
    setCameraVisible(true);
  }

  function goBackToMemories() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/profile");
  }

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

  const data = room.data;
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
  const androidResizeAmount = Platform.OS === "android" && keyboardVisible
    ? Math.max(0, Math.round(initialWindowHeightRef.current - windowHeight))
    : 0;
  const androidKeyboardOffset = Platform.OS === "android" && keyboardVisible
    ? Math.max(0, androidKeyboardHeight - androidResizeAmount + ANDROID_KEYBOARD_SAFETY_LIFT)
    : 0;

  return (
    <Screen padded={false} style={styles.screenContent}>
      <RoomHeader
        data={data}
        mode={mode}
        onBack={goBackToMemories}
        onChangeMode={setMode}
        onOpenActions={openRoomActions}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
        style={styles.keyboard}
      >
        <View
          style={[
            styles.roomStage,
            mode === "chat" && styles.roomStageChat,
            mode === "chat" && androidKeyboardOffset > 0 && { paddingBottom: androidKeyboardOffset }
          ]}
        >
          {mode === "chat" ? <FoodChatWallpaper /> : null}
          <View style={styles.body}>
            {mode === "chat" ? (
              <ChatTimeline
                data={data}
                myUsername={myUsername}
                onAddDish={() => setMode("dishes")}
                onAddMedia={openAttachmentOptions}
                onAddPeople={openPeopleAdd}
                onBeginSelection={beginSelection}
                onLayoutChange={handleChatTimelineLayout}
                onNearBottomChange={handleChatNearBottomChange}
                onOpenMedia={openMediaViewer}
                onReplyMessage={beginReplyMessage}
                onScrollBeginDrag={handleChatScrollBeginDrag}
                onToggleSelection={toggleSelectedItem}
                editingMessageId={editingMessage?.id ?? null}
                lastReadAt={data.lastReadAt}
                scrollRef={scrollRef}
                selectedItemKeys={selectedItemKeys}
                selectionMode={selectedItemKeys.length > 0}
              />
            ) : mode === "media" ? (
              <MediaGallery
                error={mediaError || addPhoto.error?.message}
                onOpenMedia={openMediaViewer}
                photos={data.photos}
              />
            ) : mode === "dishes" ? (
              <DishesPanel
                dishName={dishName}
                dishNote={dishNote}
                dishRating={dishRating}
                dishes={data.dishes}
                error={addDish.error?.message}
                onChangeDishName={setDishName}
                onChangeDishNote={setDishNote}
                onChangeDishRating={setDishRating}
                onSubmitDish={submitDish}
                pending={addDish.isPending}
              />
            ) : (
              <PeoplePanel
                addParticipantError={addParticipant.error?.message}
                addParticipantPending={addParticipant.isPending}
                inputRef={peopleInputRef}
                onChangeParticipant={setParticipant}
                onRemoveSelectedParticipant={removeSelectedParticipant}
                onSelectParticipant={selectParticipantSuggestion}
                onSubmitParticipants={submitParticipants}
                participantValue={participant}
                participantsLoading={participantsLoading}
                participantSuggestions={participantSuggestions}
                participants={data.participants}
                roomName={data.restaurantName}
                selectedParticipants={selectedParticipants}
              />
            )}
          </View>

          {mode === "chat" && selectedItemKeys.length > 0 ? (
            <SelectionActionBar
              canDelete={canDeleteSelected}
              count={selectedItemKeys.length}
              bottomInset={insets.bottom}
              deleteError={deleteItems.error?.message}
              deleting={deleteItems.isPending}
              editableMessage={editableSelectedMessage}
              onCancel={cancelSelection}
              onDelete={removeSelectedItems}
              onEdit={beginEditMessage}
            />
          ) : mode === "chat" ? (
            <Composer
              mediaError={mediaError}
              mediaPending={addPhoto.isPending}
              mediaMutationError={addPhoto.error?.message}
              message={message}
              messageError={addMessage.error?.message || editMessage.error?.message}
              messagePending={addMessage.isPending || editMessage.isPending}
              editingLabel={editingMessage ? `Editing message` : undefined}
              bottomInset={insets.bottom}
              keyboardOpen={keyboardVisible}
              onAttach={openAttachmentOptions}
              onCancelEdit={cancelEditMessage}
              onCancelReply={cancelReplyMessage}
              onChangeMessage={setMessage}
              onLayoutChange={handleComposerLayout}
              onInputFocus={handleComposerFocus}
              replyingToMessage={replyingToMessage}
              onSend={submitMessage}
            />
          ) : null}
        </View>

        <AttachmentOptionsSheet
          dishError={addDish.error?.message}
          dishName={dishName}
          dishNote={dishNote}
          dishPending={addDish.isPending}
          dishRating={dishRating}
          onChangeDishName={setDishName}
          onChangeDishNote={setDishNote}
          onChangeDishRating={setDishRating}
          onCamera={openCamera}
          onClose={() => setAttachmentOptionsVisible(false)}
          onDishSubmit={submitDishFromAttachment}
          onGallery={() => submitMedia(pickMemoryMediaFromGallery)}
          pending={addPhoto.isPending}
          visible={attachmentOptionsVisible}
        />
        <RoomActionsSheet
          leavePending={leaveRoom.isPending}
          onAddPeople={openPeopleFromRoomActions}
          onClose={closeRoomActions}
          onLeave={confirmLeaveRoom}
          onViewPeople={viewPeopleFromRoomActions}
          visible={roomActionsVisible}
        />
        <MemoryCameraModal
          onCapture={submitCameraCapture}
          onClose={() => setCameraVisible(false)}
          visible={cameraVisible}
        />
        <MediaViewer selection={selectedMedia} onClose={() => setSelectedMedia(null)} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

function RoomHeader({
  data,
  mode,
  onBack,
  onChangeMode,
  onOpenActions
}: {
  data: MemoryRoom;
  mode: RoomMode;
  onBack: () => void;
  onChangeMode: (mode: RoomMode) => void;
  onOpenActions: () => void;
}) {
  const locationLabel = compactPlaceLocation({
    formattedAddress: data.area ?? "",
    shortFormattedAddress: data.area ?? ""
  });

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={onBack} style={styles.headerIconButton}>
          <Ionicons name="arrow-back" size={20} color={colors.dark.cream} />
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.roomTitle}>{data.restaurantName}</Text>
          <View style={styles.roomSubtitleRow}>
            <Ionicons name="location-outline" size={12} color={colors.dark.muted} />
            <Text numberOfLines={1} style={styles.roomSubtitle}>{locationLabel || "Area not set"}</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Room actions" accessibilityRole="button" hitSlop={8} onPress={onOpenActions} style={styles.headerIconButton}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.dark.cream} />
        </Pressable>
      </View>

      <View style={styles.modeTabs}>
        <ModeButton active={mode === "chat"} icon="chatbubble-ellipses-outline" label="Chat" onPress={() => onChangeMode("chat")} />
        <ModeButton active={mode === "media"} icon="images-outline" label="Media" onPress={() => onChangeMode("media")} />
        <ModeButton active={mode === "dishes"} icon="restaurant-outline" label="Dishes" onPress={() => onChangeMode("dishes")} />
        <ModeButton active={mode === "people"} icon="people-outline" label="People" onPress={() => onChangeMode("people")} />
      </View>
    </View>
  );
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
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeButton, active && styles.modeButtonActive]}
    >
      <Ionicons name={icon} size={15} color={active ? colors.dark.white : colors.dark.muted} />
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ChatTimeline({
  data,
  editingMessageId,
  myUsername,
  onAddDish,
  onAddMedia,
  onAddPeople,
  onBeginSelection,
  onLayoutChange,
  onNearBottomChange,
  onOpenMedia,
  onReplyMessage,
  onScrollBeginDrag,
  onToggleSelection,
  lastReadAt,
  scrollRef,
  selectedItemKeys,
  selectionMode
}: {
  data: MemoryRoom;
  editingMessageId: string | null;
  myUsername: string;
  onAddDish: () => void;
  onAddMedia: () => void;
  onAddPeople: () => void;
  onBeginSelection: (target: MemoryActionTarget) => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
  onNearBottomChange: (isNearBottom: boolean) => void;
  onOpenMedia: OpenMediaHandler;
  onReplyMessage: (message: MemoryMessage) => void;
  onScrollBeginDrag: () => void;
  onToggleSelection: (target: MemoryActionTarget) => void;
  lastReadAt: string | null;
  scrollRef: React.RefObject<FlatList<ChatTimelineRow> | null>;
  selectedItemKeys: string[];
  selectionMode: boolean;
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
      }))
    ];
    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [data.messages, data.photos]);
  const participantNames = useMemo(
    () => new Map(data.participants.map((participant) => [participant.username, participant.displayName])),
    [data.participants]
  );
  const didScrollToUnreadRef = useRef(false);
  const didInitialBottomScrollRef = useRef(false);
  const listNearBottomRef = useRef(false);
  const firstUnreadItemId = useMemo(() => {
    const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
    return timeline.find((item) => {
      const itemTime = new Date(item.createdAt).getTime();
      if (!Number.isFinite(itemTime) || itemTime <= lastReadTime) return false;
      return item.type === "message"
        ? item.value.authorName !== myUsername
        : item.value.uploaderName !== myUsername;
    })?.id ?? null;
  }, [lastReadAt, myUsername, timeline]);

  useEffect(() => {
    didScrollToUnreadRef.current = false;
  }, [firstUnreadItemId]);

  useEffect(() => {
    didInitialBottomScrollRef.current = false;
    listNearBottomRef.current = false;
  }, [data.id]);

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
  const firstUnreadRowIndex = useMemo(
    () => timelineRows.findIndex((row) => row.type === "unread"),
    [timelineRows]
  );

  useEffect(() => {
    if (firstUnreadRowIndex < 0 || didScrollToUnreadRef.current) return;
    const timeout = setTimeout(() => {
      didScrollToUnreadRef.current = true;
      scrollRef.current?.scrollToIndex({
        animated: false,
        index: firstUnreadRowIndex,
        viewPosition: 0.08
      });
    }, 50);

    return () => clearTimeout(timeout);
  }, [firstUnreadRowIndex, scrollRef]);

  function rowSpacingStyle(rowSpacing: Extract<ChatTimelineRow, { type: "message" | "media" }>["rowSpacing"]) {
    if (rowSpacing === "break") return styles.chatMessageRowAfterBreak;
    if (rowSpacing === "group-start") return styles.chatMessageRowGroupStart;
    return styles.chatMessageRowGrouped;
  }

  function renderTimelineRow({ item }: { item: ChatTimelineRow }) {
    if (item.type === "date") return <DateDivider label={item.label} />;

    if (item.type === "unread") {
      return (
        <UnreadDivider
          onJumpToLatest={() => scrollRef.current?.scrollToEnd({ animated: true })}
        />
      );
    }

    const rowStyle = [rowSpacingStyle(item.rowSpacing)];

    if (item.type === "message") {
      return (
        <MessageBubble
          message={item.value}
          mine={item.mine}
          onBeginSelection={() => onBeginSelection({ type: "message", value: item.value })}
          onOpenMedia={onOpenMedia}
          onReply={() => onReplyMessage(item.value)}
          onToggleSelection={() => onToggleSelection({ type: "message", value: item.value })}
          editing={editingMessageId === item.value.id}
          groupPosition={item.groupPosition}
          rowStyle={rowStyle}
          selected={selectedItemKeys.includes(`message:${item.value.id}`)}
          selectionMode={selectionMode}
          showSenderDetails={item.showSenderDetails}
        />
      );
    }

    return (
      <MediaBubble
        mine={item.mine}
        onBeginSelection={() => onBeginSelection({ type: "photo", value: item.value })}
        onOpenMedia={onOpenMedia}
        onToggleSelection={() => onToggleSelection({ type: "photo", value: item.value })}
        photo={item.value}
        groupPosition={item.groupPosition}
        rowStyle={rowStyle}
        selected={selectedItemKeys.includes(`photo:${item.value.id}`)}
        selectionMode={selectionMode}
        showSenderDetails={item.showSenderDetails}
        uploaderDisplayName={participantNames.get(item.value.uploaderName) ?? item.value.uploaderName}
      />
    );
  }

  return (
    <View onLayout={onLayoutChange} style={styles.chatTimelineWrap}>
      <FlatList
        data={timelineRows}
        ref={scrollRef}
        contentContainerStyle={[
          styles.timelineContent,
          timelineRows.length === 0 && styles.timelineContentEmpty
        ]}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <View style={styles.emptyChat}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles-outline" size={26} color={ROOM_COLORS.cool} />
            </View>
            <Text style={styles.emptyTitle}>Build the table memory</Text>
            <Text style={styles.emptyText}>Start with media, a favorite dish, or the friends who were there.</Text>
            <View style={styles.emptyActionRow}>
              <MemoryQuickAction icon="camera-outline" label="Media" onPress={onAddMedia} />
              <MemoryQuickAction icon="restaurant-outline" label="Dish" onPress={onAddDish} />
              <MemoryQuickAction icon="person-add-outline" label="Invite" onPress={onAddPeople} />
            </View>
          </View>
        )}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
          const isNearBottom = distanceFromBottom < 96;
          listNearBottomRef.current = isNearBottom;
          onNearBottomChange(isNearBottom);
        }}
        onScrollBeginDrag={onScrollBeginDrag}
        onContentSizeChange={() => {
          const shouldScrollToBottom = !firstUnreadItemId && (
            !didInitialBottomScrollRef.current || listNearBottomRef.current
          );
          if (shouldScrollToBottom) {
            didInitialBottomScrollRef.current = true;
            scrollRef.current?.scrollToEnd({ animated: false });
            listNearBottomRef.current = true;
            onNearBottomChange(true);
          }
        }}
        onScrollToIndexFailed={(info) => {
          const offset = Math.max(0, info.averageItemLength * info.index - 18);
          setTimeout(() => {
            scrollRef.current?.scrollToOffset({ animated: false, offset });
          }, 50);
        }}
        renderItem={renderTimelineRow}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.timelineList}
      />
    </View>
  );
}

type DoodleProps = {
  children: ReactNode;
  opacity?: number;
  transform: string;
};

const FOOD_WALLPAPER_TILE_SIZE = 260;
const FOOD_WALLPAPER_LINE_COLOR = "#D7CAB9";
const FOOD_WALLPAPER_OPACITY = 0.34;

function Doodle({ children, opacity = 1, transform }: DoodleProps) {
  return (
    <G opacity={opacity} transform={transform}>
      {children}
    </G>
  );
}

function Pizza({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M0 0l42 14-32 32z" />
      <Path d="M7 8c9 4 20 8 31 10" />
      <Circle cx={14} cy={15} r={2} />
      <Circle cx={24} cy={19} r={1.8} />
      <Circle cx={17} cy={27} r={1.5} />
      <Path d="M9 38c4 2 8 1 11-2" />
    </Doodle>
  );
}

function Burger({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M2 20h38" />
      <Path d="M7 20c0-10 8-17 17-17s17 7 17 17" />
      <Path d="M5 28h36" />
      <Path d="M9 36h28" />
      <Path d="M11 14h2" />
      <Path d="M19 10h2" />
      <Path d="M28 13h2" />
    </Doodle>
  );
}

function Fries({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M7 14h31l-5 34H12z" />
      <Path d="M3 14h39" />
      <Line x1={13} x2={12} y1={2} y2={34} />
      <Line x1={21} x2={21} y1={0} y2={35} />
      <Line x1={30} x2={33} y1={3} y2={34} />
      <Path d="M18 30c4 3 9 3 14 0" />
    </Doodle>
  );
}

function CoffeeCup({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M7 9h29l-5 36H12z" />
      <Path d="M3 9h37" />
      <Path d="M13 45h18" />
      <Path d="M13 24c5 3 12 3 17 0" />
      <Path d="M18 2c3-4 9-4 12 0" />
    </Doodle>
  );
}

function BubbleTea({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M8 10h31l-5 42H13z" />
      <Path d="M3 10h41" />
      <Line x1={28} x2={22} y1={0} y2={31} />
      <Circle cx={18} cy={42} r={1.6} />
      <Circle cx={25} cy={43} r={1.6} />
      <Circle cx={31} cy={39} r={1.5} />
      <Circle cx={21} cy={35} r={1.4} />
      <Path d="M13 27c6 4 15 4 21 0" />
    </Doodle>
  );
}

function Donut({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Circle cx={18} cy={18} r={16} />
      <Circle cx={18} cy={18} r={7} />
      <Circle cx={10} cy={12} r={1} />
      <Circle cx={26} cy={13} r={1} />
      <Circle cx={12} cy={25} r={1} />
      <Circle cx={25} cy={25} r={1} />
      <Path d="M7 18c4-3 7-3 11 0s7 3 11 0" />
    </Doodle>
  );
}

function Ramen({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M0 27h48c-2 12-11 19-24 19S2 39 0 27z" />
      <Path d="M7 22c9-7 25-7 34 0" />
      <Path d="M9 31c4-3 7-3 11 0s7 3 11 0 7-3 10 0" />
      <Path d="M11 37c4-2 7-2 10 0s7 2 11 0" />
      <Circle cx={28} cy={24} r={4} />
      <Line x1={35} x2={47} y1={2} y2={25} />
      <Line x1={42} x2={49} y1={1} y2={21} />
    </Doodle>
  );
}

function Taco({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M2 28c3-14 13-23 25-23s22 9 25 23z" />
      <Path d="M5 29h45" />
      <Path d="M12 23c4-4 8-4 12 0s8 4 12 0 7-4 10 0" />
      <Circle cx={17} cy={17} r={1.4} />
      <Circle cx={30} cy={15} r={1.4} />
      <Circle cx={39} cy={19} r={1.4} />
    </Doodle>
  );
}

function Sushi({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Ellipse cx={18} cy={14} rx={17} ry={11} />
      <Ellipse cx={18} cy={14} rx={8} ry={5} />
      <Path d="M11 14c4-3 10-3 14 0" />
      <Path d="M8 25h20" />
    </Doodle>
  );
}

function IceCream({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M11 20c0-7 6-13 14-13s14 6 14 13c0 4-2 7-5 9H16c-3-2-5-5-5-9z" />
      <Path d="M16 29l9 28 9-28z" />
      <Path d="M19 37h12" />
      <Path d="M21 45h8" />
      <Circle cx={25} cy={4} r={2} />
    </Doodle>
  );
}

function Cocktail({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M1 1h43L23 26z" />
      <Line x1={23} x2={23} y1={26} y2={51} />
      <Path d="M10 51h26" />
      <Circle cx={36} cy={8} r={5} />
      <Line x1={36} x2={36} y1={3} y2={13} />
      <Line x1={31} x2={41} y1={8} y2={8} />
    </Doodle>
  );
}

function Cake({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M2 14l37-10v34H2z" />
      <Path d="M2 14h37" />
      <Path d="M2 25h37" />
      <Path d="M13 9c2-5 8-5 10 0" />
      <Circle cx={18} cy={6} r={2} />
    </Doodle>
  );
}

function Croissant({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M2 23c5-13 18-21 32-17" />
      <Path d="M34 6c10 3 16 10 18 21" />
      <Path d="M2 23c10 8 38 8 50 4" />
      <Path d="M15 14c3 6 3 11 0 17" />
      <Path d="M30 8c3 8 3 16 0 24" />
      <Path d="M43 15c-3 6-3 10 0 15" />
    </Doodle>
  );
}

function Cookie({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M30 12c4 3 7 8 7 14 0 10-8 18-18 18S1 36 1 26 9 8 19 8c3 0 5 1 7 2" />
      <Path d="M29 6c-3 3-2 8 3 9" />
      <Circle cx={13} cy={20} r={1.5} />
      <Circle cx={22} cy={18} r={1.4} />
      <Circle cx={16} cy={31} r={1.5} />
      <Circle cx={27} cy={29} r={1.3} />
    </Doodle>
  );
}

function Egg({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M2 21c0-9 8-16 17-16 7 0 12 4 14 10 5 1 8 5 8 10 0 9-9 16-21 16S2 33 2 21z" />
      <Circle cx={22} cy={23} r={6} />
    </Doodle>
  );
}

function Leaf({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M0 10c8-8 20-8 28 0-8 8-20 8-28 0z" />
      <Path d="M3 10h22" />
    </Doodle>
  );
}

function Sparkle({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M10 0l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
    </Doodle>
  );
}

function Heart({ transform }: { transform: string }) {
  return (
    <Doodle transform={transform}>
      <Path d="M12 21C5 15 1 11 1 6c0-3 2-5 5-5 3 0 5 2 6 4 1-2 3-4 6-4 3 0 5 2 5 5 0 5-4 9-11 15z" />
    </Doodle>
  );
}

function TinyMarks() {
  return (
    <>
      <Circle cx={28} cy={52} r={1.2} />
      <Circle cx={98} cy={34} r={1.2} />
      <Circle cx={202} cy={26} r={1.2} />
      <Circle cx={226} cy={88} r={1.2} />
      <Circle cx={64} cy={128} r={1.2} />
      <Circle cx={150} cy={116} r={1.2} />
      <Circle cx={238} cy={168} r={1.2} />
      <Circle cx={116} cy={224} r={1.2} />
      <Circle cx={190} cy={236} r={1.2} />
      <Path d="M74 66c5-3 10-1 12 4" />
      <Path d="M182 54c-4 2-8 1-11-3" />
      <Path d="M38 178c4 3 9 3 13 0" />
      <Path d="M132 188c5-3 10-1 12 4" />
      <Path d="M214 214c-4 2-8 1-11-3" />
      <Line x1={40} x2={49} y1={222} y2={231} />
      <Line x1={49} x2={40} y1={222} y2={231} />
      <Line x1={168} x2={177} y1={76} y2={85} />
      <Line x1={177} x2={168} y1={76} y2={85} />
      <Path d="M18 112h10" />
      <Path d="M23 107v10" />
      <Path d="M222 128h10" />
      <Path d="M227 123v10" />
    </>
  );
}

const FoodChatWallpaper = memo(function FoodChatWallpaper() {
  return (
    <View pointerEvents="none" style={styles.chatWallpaper}>
      <Svg height="100%" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <Pattern
            height={FOOD_WALLPAPER_TILE_SIZE}
            id="foodChatDoodlePattern"
            patternUnits="userSpaceOnUse"
            width={FOOD_WALLPAPER_TILE_SIZE}
            x={0}
            y={0}
          >
            <Rect fill={ROOM_COLORS.bg} height={FOOD_WALLPAPER_TILE_SIZE} width={FOOD_WALLPAPER_TILE_SIZE} x={0} y={0} />
            <G
              fill="none"
              opacity={FOOD_WALLPAPER_OPACITY}
              stroke={FOOD_WALLPAPER_LINE_COLOR}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.25}
            >
              <Pizza transform="translate(18 22) rotate(-18) scale(0.75)" />
              <BubbleTea transform="translate(188 14) rotate(10) scale(0.62)" />
              <Donut transform="translate(104 26) rotate(14) scale(0.55)" />
              <Croissant transform="translate(42 86) rotate(12) scale(0.48)" />
              <Ramen transform="translate(158 78) rotate(-8) scale(0.55)" />
              <CoffeeCup transform="translate(20 150) rotate(-12) scale(0.58)" />
              <Taco transform="translate(80 132) rotate(15) scale(0.48)" />
              <Cocktail transform="translate(176 162) rotate(14) scale(0.48)" />
              <Burger transform="translate(20 214) rotate(-8) scale(0.55)" />
              <Cake transform="translate(112 198) rotate(12) scale(0.5)" />
              <IceCream transform="translate(214 210) rotate(-16) scale(0.42)" />
            </G>
            <G
              fill="none"
              opacity={FOOD_WALLPAPER_OPACITY * 0.78}
              stroke={FOOD_WALLPAPER_LINE_COLOR}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.05}
            >
              <Fries transform="translate(90 80) rotate(-7) scale(0.42)" />
              <Sushi transform="translate(218 62) rotate(19) scale(0.4)" />
              <Cookie transform="translate(132 142) rotate(-20) scale(0.4)" />
              <Egg transform="translate(60 188) rotate(18) scale(0.36)" />
              <CoffeeCup transform="translate(224 120) rotate(18) scale(0.34)" />
              <Pizza transform="translate(144 232) rotate(-18) scale(0.38)" />
              <Donut transform="translate(62 30) rotate(-12) scale(0.32)" />
              <BubbleTea transform="translate(6 72) rotate(18) scale(0.32)" />
              <Taco transform="translate(202 244) rotate(10) scale(0.34)" />
            </G>
            <G
              fill="none"
              opacity={FOOD_WALLPAPER_OPACITY * 0.65}
              stroke={FOOD_WALLPAPER_LINE_COLOR}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={0.95}
            >
              <Sparkle transform="translate(150 18) scale(0.55)" />
              <Sparkle transform="translate(228 44) rotate(18) scale(0.42)" />
              <Sparkle transform="translate(32 132) rotate(-12) scale(0.45)" />
              <Sparkle transform="translate(150 176) rotate(8) scale(0.38)" />
              <Sparkle transform="translate(88 232) rotate(-16) scale(0.42)" />
              <Heart transform="translate(70 54) rotate(-8) scale(0.42)" />
              <Heart transform="translate(216 190) rotate(16) scale(0.34)" />
              <Heart transform="translate(8 238) rotate(-18) scale(0.34)" />
              <Leaf transform="translate(132 68) rotate(-22) scale(0.38)" />
              <Leaf transform="translate(238 98) rotate(28) scale(0.32)" />
              <Leaf transform="translate(104 166) rotate(12) scale(0.34)" />
              <Leaf transform="translate(170 226) rotate(-24) scale(0.32)" />
              <TinyMarks />
            </G>
          </Pattern>
        </Defs>
        <Rect fill={ROOM_COLORS.bg} height="100%" width="100%" x={0} y={0} />
        <Rect fill="url(#foodChatDoodlePattern)" height="100%" width="100%" x={0} y={0} />
      </Svg>
      <View style={styles.chatWallpaperOverlay} />
    </View>
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
      <Ionicons name={icon} size={16} color={colors.dark.cream} />
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

function memoryMessageReplyPreview(message: Pick<MemoryMessage, "attachments" | "body">) {
  const body = message.body.trim();
  if (body) return body;
  return message.attachments.length > 0 ? "Media" : "Message";
}

function ReplyPreviewBlock({
  author,
  body,
  mine
}: {
  author: string;
  body: string;
  mine?: boolean;
}) {
  return (
    <View style={[styles.replyPreviewBlock, mine && styles.replyPreviewBlockMine]}>
      <Text numberOfLines={1} style={styles.replyPreviewAuthor}>{author}</Text>
      <Text numberOfLines={2} style={styles.replyPreviewText}>{body}</Text>
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

  function handleMediaLongPress() {
    ignoreOpenAfterLongPressRef.current = true;
    if (ignoreOpenTimeoutRef.current) clearTimeout(ignoreOpenTimeoutRef.current);
    ignoreOpenTimeoutRef.current = setTimeout(() => {
      ignoreOpenAfterLongPressRef.current = false;
    }, 450);
    onBeginSelection();
  }

  function shouldIgnoreMediaOpen() {
    if (!ignoreOpenAfterLongPressRef.current) return false;
    ignoreOpenAfterLongPressRef.current = false;
    if (ignoreOpenTimeoutRef.current) {
      clearTimeout(ignoreOpenTimeoutRef.current);
      ignoreOpenTimeoutRef.current = null;
    }
    return true;
  }

  return { handleMediaLongPress, shouldIgnoreMediaOpen };
}

function getMessageTimestampLabel(message: MemoryMessage) {
  const time = formatDisplayTime(message.createdAt);
  return message.editedAt ? `edited ${time}` : time;
}

function MessageRow({
  children,
  editing = false,
  mine,
  onPress,
  onLongPress,
  onSwipeRight,
  rowStyle,
  selected,
  senderName,
  showSenderDetails = true
}: {
  children: ReactNode;
  editing?: boolean;
  mine: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onSwipeRight?: () => void;
  rowStyle?: StyleProp<ViewStyle>;
  selected?: boolean;
  senderName: string;
  showSenderDetails?: boolean;
}) {
  const accentColor = senderAccent(senderName);
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const swipeIndicatorOpacity = swipeTranslateX.interpolate({
    inputRange: [0, REPLY_SWIPE_TRIGGER_DISTANCE],
    outputRange: [0, 1],
    extrapolate: "clamp"
  });
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      Boolean(onSwipeRight) &&
      gesture.dx > 8 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.35
    ),
    onPanResponderMove: (_event, gesture) => {
      if (!onSwipeRight) return;
      swipeTranslateX.setValue(Math.min(REPLY_SWIPE_MAX_TRANSLATE, Math.max(0, gesture.dx)));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (onSwipeRight && gesture.dx >= REPLY_SWIPE_TRIGGER_DISTANCE && Math.abs(gesture.dy) < 42) {
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
  }), [onSwipeRight, swipeTranslateX]);

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
    selected && styles.chatMessageRowSelected,
    editing && styles.chatMessageRowEditing
  ];

  const rowElement = onLongPress || onPress ? (
    <Pressable
      accessibilityLabel={onPress ? `${selected ? "Deselect" : "Select"} chat item` : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={onPress ? { selected: Boolean(selected) } : undefined}
      delayLongPress={280}
      onLongPress={onLongPress}
      onPress={onPress}
      style={resolvedRowStyle}
    >
      {rowContent}
    </Pressable>
  ) : (
    <View style={resolvedRowStyle}>
      {rowContent}
    </View>
  );

  if (onSwipeRight) {
    return (
      <View style={styles.swipeReplyWrap}>
        <Animated.View style={[styles.swipeReplyIndicator, { opacity: swipeIndicatorOpacity }]}>
          <Ionicons name="arrow-undo-outline" size={17} color={colors.dark.white} />
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
        {text}
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[timeStyle, styles.inlineTimestampReserve]}
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
  message,
  mine,
  onBeginSelection,
  onOpenMedia,
  onReply,
  rowStyle,
  onToggleSelection,
  selected,
  selectionMode,
  showSenderDetails
}: {
  editing: boolean;
  groupPosition: MessageGroupPosition;
  message: MemoryMessage;
  mine: boolean;
  onBeginSelection: () => void;
  onOpenMedia: OpenMediaHandler;
  onReply: () => void;
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
  const { handleMediaLongPress, shouldIgnoreMediaOpen } = useMediaOpenGuard(onBeginSelection);
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
    return (
      <MessageRow
        editing={editing}
        mine={mine}
        onLongPress={!selectionMode ? onBeginSelection : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onSwipeRight={!selectionMode ? onReply : undefined}
        rowStyle={rowStyle}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
      >
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
              text={body}
              textStyle={styles.textOnlyBubbleText}
              time={timestampLabel}
            />
          </View>
        </MessageBubbleFrame>
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
        mine={mine}
        onLongPress={!selectionMode ? onBeginSelection : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onSwipeRight={!selectionMode ? onReply : undefined}
        rowStyle={[rowStyle, styles.chatMessageRowMedia]}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
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
              style={styles.mediaMessageContent}
            >
              <SingleMediaPreview
                media={media}
                sizeOverride={previewSize}
                timestamp={isMediaOnly ? timestampLabel : undefined}
                timestampPlacement={media.mediaType === "video" ? "bottom-left" : "bottom-right"}
              />
            </Pressable>
            {isMediaWithCaption ? (
              <View style={styles.mediaCaptionContainer}>
                {message.replyToMessage ? renderReplyPreview() : null}
                <InlineTimestampText
                  fill
                  nativeAvailableWidth={Math.max(0, previewSize.width - 24)}
                  text={body}
                  textStyle={styles.mediaCaptionText}
                  time={timestampLabel}
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
        mine={mine}
        onLongPress={!selectionMode ? onBeginSelection : undefined}
        onPress={selectionMode ? onToggleSelection : undefined}
        onSwipeRight={!selectionMode ? onReply : undefined}
        rowStyle={[rowStyle, styles.chatMessageRowMedia]}
        selected={selected}
        senderName={message.authorDisplayName}
        showSenderDetails={showSenderDetails}
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
              media={message.attachments}
              onBeginSelection={onBeginSelection}
              onOpenMedia={onOpenMedia}
              selectionMode={selectionMode}
              timestamp={isMediaOnly ? timestampLabel : undefined}
            />
            {isMediaWithCaption ? (
              <View style={styles.mediaCaptionContainer}>
                {message.replyToMessage ? renderReplyPreview() : null}
                <InlineTimestampText
                  fill
                  nativeAvailableWidth={Math.max(0, multiMediaCardWidth - 24)}
                  text={body}
                  textStyle={styles.mediaCaptionText}
                  time={timestampLabel}
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

function MediaBubble({
  groupPosition,
  mine,
  onBeginSelection,
  onOpenMedia,
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
  const { handleMediaLongPress, shouldIgnoreMediaOpen } = useMediaOpenGuard(onBeginSelection);
  const bubbleCornerStyle = groupedBubbleCornerStyle(mine, groupPosition);

  function handleOpenMedia() {
    if (shouldIgnoreMediaOpen()) return;
    onOpenMedia(photo, [photo]);
  }

  return (
    <MessageRow
      mine={mine}
      onLongPress={!selectionMode ? onBeginSelection : undefined}
      onPress={selectionMode ? onToggleSelection : undefined}
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
            style={styles.mediaMessageContent}
          >
            <SingleMediaPreview
              media={photo}
              sizeOverride={singleMediaPreviewSize}
              timestamp={formatDisplayTime(photo.createdAt)}
              timestampPlacement={photo.mediaType === "video" ? "bottom-left" : "bottom-right"}
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
  onBeginSelection,
  onOpenMedia,
  selectionMode,
  timestamp
}: {
  gridWidth: number;
  media: MemoryPhoto[];
  onBeginSelection: () => void;
  onOpenMedia: OpenMediaHandler;
  selectionMode?: boolean;
  timestamp?: string;
}) {
  const { handleMediaLongPress, shouldIgnoreMediaOpen } = useMediaOpenGuard(onBeginSelection);
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
              onLongPress={handleMediaLongPress}
              onPress={() => handleOpenMedia(item)}
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
            onLongPress={handleMediaLongPress}
            onPress={() => handleOpenMedia(visible[0])}
            selectionMode={selectionMode}
            style={{ height: gridHeight, width: leftWidth }}
          />
          <View style={styles.mediaGridStack}>
            {visible.slice(1, 3).map((item) => (
              <MediaGridTile
                hiddenCount={0}
                key={item.id}
                media={item}
                onLongPress={handleMediaLongPress}
                onPress={() => handleOpenMedia(item)}
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
              onLongPress={handleMediaLongPress}
              onPress={() => handleOpenMedia(item)}
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
  const visible = media.slice(0, 4);
  const bottomRightMedia = media.length === 3 ? visible[2] : visible[Math.min(visible.length - 1, 3)];
  const hasMoreOverlay = media.length > 4;
  if (hasMoreOverlay || bottomRightMedia?.mediaType === "video") return "bottom-left";
  return "bottom-right";
}

function MediaGridTile({
  hiddenCount,
  media,
  onLongPress,
  onPress,
  selectionMode,
  style
}: {
  hiddenCount: number;
  media: MemoryPhoto;
  onLongPress: () => void;
  onPress: () => void;
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
  if (media.mediaType === "video") {
    return (
      <View style={styles.gridVideoPreview}>
        <View style={styles.gridVideoOverlay}>
          {isOptimisticMemoryMedia(media) ? (
            <View style={styles.mediaPendingOverlay}>
              <Ionicons name="cloud-upload-outline" size={17} color={colors.dark.white} />
              <Text style={styles.mediaPendingText}>Sending</Text>
            </View>
          ) : null}
          <View style={styles.gridPlayBadge}>
            <Ionicons name="play" size={18} color={colors.dark.white} />
          </View>
          <View style={styles.gridMediaTypeBadge}>
            <Ionicons name="videocam" size={11} color={colors.dark.white} />
            <Text style={styles.mediaTypeBadgeText}>Video</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <Image
      contentFit="cover"
      source={{ uri: media.publicUrl }}
      style={styles.gridMediaFill}
    />
  );
}

function MediaGallery({
  error,
  onOpenMedia,
  photos
}: {
  error?: string;
  onOpenMedia: OpenMediaHandler;
  photos: MemoryPhoto[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.galleryContent} showsVerticalScrollIndicator={false}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {photos.length === 0 ? (
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="images-outline" size={26} color={colors.dark.orange} />
          </View>
          <Text style={styles.emptyTitle}>No media shared yet</Text>
          <Text style={styles.emptyText}>Photos and videos from the table will appear here.</Text>
        </View>
      ) : (
        <View style={styles.galleryGrid}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.galleryItem}>
              <Pressable
                accessibilityLabel={photo.mediaType === "video" ? "Open video" : "Open photo"}
                accessibilityRole="imagebutton"
                onPress={() => onOpenMedia(photo, [photo])}
                style={styles.galleryMediaButton}
              >
                <MediaPreview media={photo} style={styles.mediaPreviewFlush} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function DishesPanel({
  dishName,
  dishNote,
  dishRating,
  dishes,
  error,
  onChangeDishName,
  onChangeDishNote,
  onChangeDishRating,
  onSubmitDish,
  pending
}: {
  dishName: string;
  dishNote: string;
  dishRating: number;
  dishes: MemoryDish[];
  error?: string;
  onChangeDishName: (value: string) => void;
  onChangeDishNote: (value: string) => void;
  onChangeDishRating: (value: number) => void;
  onSubmitDish: () => void;
  pending: boolean;
}) {
  const canAdd = Boolean(dishName.trim()) && !pending;
  const ratedDishes = dishes.filter((dish) => dish.rating);
  const averageRating = ratedDishes.length > 0
    ? ratedDishes.reduce((total, dish) => total + Number(dish.rating ?? 0), 0) / ratedDishes.length
    : null;
  const friendCount = new Set(dishes.map((dish) => dish.addedByDisplayName)).size;

  return (
    <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
      {dishes.length > 0 ? (
        <View style={styles.dishMemorySummary}>
          <View style={styles.dishSummaryItem}>
            <Text style={styles.dishSummaryValue}>{dishes.length}</Text>
            <Text style={styles.dishSummaryLabel}>Dishes</Text>
          </View>
          <View style={styles.dishSummaryDivider} />
          <View style={styles.dishSummaryItem}>
            <Text style={styles.dishSummaryValue}>{averageRating ? averageRating.toFixed(1) : "-"}</Text>
            <Text style={styles.dishSummaryLabel}>Avg rating</Text>
          </View>
          <View style={styles.dishSummaryDivider} />
          <View style={styles.dishSummaryItem}>
            <Text style={styles.dishSummaryValue}>{friendCount}</Text>
            <Text style={styles.dishSummaryLabel}>Friends</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.dishAddWrap}>
        <View style={styles.dishInputWrap}>
          <Ionicons name="restaurant-outline" size={16} color={colors.dark.orange} />
          <TextInput
            onChangeText={onChangeDishName}
            placeholder="Dish name"
            placeholderTextColor={colors.dark.muted}
            style={styles.dishInput}
            value={dishName}
          />
        </View>
        <View style={styles.dishInputWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.dark.muted} />
          <TextInput
            onChangeText={onChangeDishNote}
            placeholder="What should friends remember?"
            placeholderTextColor={colors.dark.muted}
            style={styles.dishInput}
            value={dishNote}
          />
        </View>
        <View style={styles.dishAddFooter}>
          <View style={styles.dishStars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable key={star} hitSlop={6} onPress={() => onChangeDishRating(dishRating === star ? 0 : star)}>
                <Ionicons name={star <= dishRating ? "star" : "star-outline"} size={20} color={colors.dark.gold} />
              </Pressable>
            ))}
          </View>
          <Pressable disabled={!canAdd} onPress={onSubmitDish} style={[styles.panelPrimaryButton, !canAdd && styles.panelPrimaryButtonDisabled]}>
            <Text style={styles.panelPrimaryButtonText}>{pending ? "Adding" : "Add"}</Text>
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {dishes.length === 0 ? (
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="restaurant-outline" size={26} color={colors.dark.orange} />
          </View>
          <Text style={styles.emptyTitle}>No table favorites yet</Text>
          <Text style={styles.emptyText}>Add the dishes everyone tried so the group remembers what to order again.</Text>
        </View>
      ) : (
        dishes.map((dish) => (
          <View key={dish.id} style={styles.dishCard}>
            <View style={[styles.dishIcon, { backgroundColor: senderAccent(dish.dishName) }]}>
              <Text style={styles.dishIconText}>{dish.dishName.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.dishText}>
              <View style={styles.dishTitleRow}>
                <Text numberOfLines={1} style={styles.dishName}>{dish.dishName}</Text>
                {dish.rating ? (
                  <View style={styles.dishRatingPill}>
                    <Ionicons name="star" size={11} color={colors.dark.gold} />
                    <Text style={styles.dishRating}>{Number(dish.rating).toFixed(1).replace(/\.0$/, "")}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={styles.dishMeta}>Added by {dish.addedByDisplayName}</Text>
              {dish.note ? <Text style={styles.dishNote}>{dish.note}</Text> : null}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function PeoplePanel({
  addParticipantError,
  addParticipantPending,
  inputRef,
  onChangeParticipant,
  onRemoveSelectedParticipant,
  onSelectParticipant,
  onSubmitParticipants,
  participantValue,
  participants,
  participantsLoading,
  participantSuggestions,
  roomName,
  selectedParticipants
}: {
  addParticipantError?: string;
  addParticipantPending: boolean;
  inputRef: RefObject<TextInput | null>;
  onChangeParticipant: (value: string) => void;
  onRemoveSelectedParticipant: (username: string) => void;
  onSelectParticipant: (person: UserSearchResult) => void;
  onSubmitParticipants: () => void;
  participantValue: string;
  participants: MemoryParticipant[];
  participantsLoading: boolean;
  participantSuggestions: UserSearchResult[];
  roomName: string;
  selectedParticipants: UserSearchResult[];
}) {
  const [contactsError, setContactsError] = useState("");
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsSearch, setContactsSearch] = useState("");
  const [contactsVisible, setContactsVisible] = useState(false);
  const [contactInvites, setContactInvites] = useState<ContactInvite[]>([]);
  const canAdd = selectedParticipants.length > 0 && !addParticipantPending;
  const showSuggestions = participantsLoading || participantSuggestions.length > 0 || participantValue.trim().replace(/^@/, "").length >= 2;
  const filteredContacts = useMemo(() => {
    const query = contactsSearch.trim().toLowerCase();
    if (!query) return contactInvites;
    return contactInvites.filter((contact) => `${contact.name} ${contact.detail}`.toLowerCase().includes(query));
  }, [contactInvites, contactsSearch]);

  async function openContacts() {
    setContactsVisible(true);
    if (contactInvites.length > 0 || contactsLoading) return;
    setContactsError("");
    setContactsLoading(true);
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setContactsError("Contacts permission was not granted.");
        return;
      }

      const response = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers],
        pageSize: 400
      });
      const invites = response.data
        .map((contact) => {
          const phone = contact.phoneNumbers?.find((item) => item.number || item.digits);
          const email = contact.emails?.find((item) => item.email);
          const detail = phone?.number ?? phone?.digits ?? email?.email ?? "";
          const kind: ContactInvite["kind"] = phone ? "phone" : "email";
          const name = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || detail;
          if (!name || !detail) return null;
          return { detail, id: contact.id, kind, name };
        })
        .filter((contact): contact is ContactInvite => Boolean(contact))
        .sort((a, b) => a.name.localeCompare(b.name));

      setContactInvites(invites);
      if (invites.length === 0) setContactsError("No contacts with phone or email found.");
    } catch {
      setContactsError("Could not load contacts right now.");
    } finally {
      setContactsLoading(false);
    }
  }

  async function inviteContact(contact: ContactInvite) {
    const message = `Join my Table Memory for ${roomName} on CircleBites. We can save the media, dishes, and notes from this place together.`;
    try {
      if (contact.kind === "phone") {
        const separator = Platform.OS === "ios" ? "&" : "?";
        const url = `sms:${encodeURIComponent(contact.detail)}${separator}body=${encodeURIComponent(message)}`;
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      }

      if (contact.kind === "email") {
        const url = `mailto:${encodeURIComponent(contact.detail)}?subject=${encodeURIComponent(`Join my Table Memory at ${roomName}`)}&body=${encodeURIComponent(message)}`;
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) {
          await Linking.openURL(url);
          return;
        }
      }

      await Share.share({
        message,
        title: `Join my Table Memory at ${roomName}`
      });
    } catch {
      setContactsError(`Could not open invite for ${contact.name}.`);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
      <View style={styles.peopleAddWrap}>
        <View style={styles.peopleAddRow}>
          <View style={styles.peopleAddInputWrap}>
            <Ionicons name="person-add-outline" size={16} color={colors.dark.orange} />
            <TextInput
              autoCapitalize="none"
              onChangeText={onChangeParticipant}
              placeholder="Add friend"
              placeholderTextColor={colors.dark.muted}
              ref={inputRef}
              style={styles.peopleAddInput}
              value={participantValue}
            />
          </View>
          <Pressable disabled={!canAdd} onPress={onSubmitParticipants} style={[styles.peopleAddButton, !canAdd && styles.peopleAddButtonDisabled]}>
            <Text style={styles.peopleAddButtonText}>{addParticipantPending ? "Adding" : "Add"}</Text>
          </Pressable>
        </View>
        <Pressable onPress={openContacts} style={styles.contactsImportButton}>
          <Ionicons name="people-circle-outline" size={17} color={colors.dark.orange} />
          <View style={styles.contactsImportText}>
            <Text style={styles.contactsImportTitle}>Find friends from contacts</Text>
            <Text numberOfLines={1} style={styles.contactsImportSubtitle}>Invite only the people you choose.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.dark.muted} />
        </Pressable>
        {addParticipantError ? <Text style={styles.error}>{addParticipantError}</Text> : null}
        {showSuggestions ? (
          <View style={styles.peopleSuggestions}>
            {participantsLoading ? (
              <View style={styles.peopleSuggestionState}>
                <Text style={styles.peopleSuggestionMuted}>Searching people</Text>
              </View>
            ) : null}
            {!participantsLoading && participantSuggestions.length === 0 ? (
              <View style={styles.peopleSuggestionState}>
                <Text style={styles.peopleSuggestionMuted}>No people found</Text>
              </View>
            ) : null}
            {participantSuggestions.map((person) => (
              <Pressable key={person.username} onPress={() => onSelectParticipant(person)} style={styles.peopleSuggestionRow}>
                <View style={[styles.peopleSuggestionAvatar, { backgroundColor: senderAccent(person.displayName) }]}>
                  <Text style={styles.peopleSuggestionInitial}>{senderInitials(person.displayName || person.username)}</Text>
                </View>
                <View style={styles.peopleSuggestionText}>
                  <Text numberOfLines={1} style={styles.peopleSuggestionName}>{person.displayName}</Text>
                  <Text numberOfLines={1} style={styles.peopleSuggestionUsername}>@{person.username}</Text>
                </View>
                <Ionicons name="add" size={18} color={colors.dark.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {selectedParticipants.length > 0 ? (
          <View style={styles.selectedPeopleChips}>
            {selectedParticipants.map((person) => (
              <Pressable key={person.username} onPress={() => onRemoveSelectedParticipant(person.username)} style={styles.selectedPeopleChip}>
                <Text numberOfLines={1} style={styles.selectedPeopleChipText}>@{person.username}</Text>
                <Ionicons name="close" size={12} color={colors.dark.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {participants.map((participant) => {
        const accentColor = senderAccent(participant.displayName);

        return (
          <View key={participant.id} style={styles.personRow}>
            <View style={[styles.personAvatar, { backgroundColor: accentColor }]}>
              <Text style={styles.personInitial}>{senderInitials(participant.displayName)}</Text>
            </View>
            <View style={styles.personText}>
              <Text numberOfLines={1} style={styles.personName}>{participant.displayName}</Text>
              <Text numberOfLines={1} style={styles.personMeta}>
                @{participant.username} · {participant.role === "owner" ? "Owner" : "Participant"}
              </Text>
            </View>
          </View>
        );
      })}
      <ContactsInviteModal
        contacts={filteredContacts}
        error={contactsError}
        loading={contactsLoading}
        onChangeSearch={setContactsSearch}
        onClose={() => setContactsVisible(false)}
        onInvite={inviteContact}
        search={contactsSearch}
        visible={contactsVisible}
      />
    </ScrollView>
  );
}

function ContactsInviteModal({
  contacts,
  error,
  loading,
  onChangeSearch,
  onClose,
  onInvite,
  search,
  visible
}: {
  contacts: ContactInvite[];
  error: string;
  loading: boolean;
  onChangeSearch: (value: string) => void;
  onClose: () => void;
  onInvite: (contact: ContactInvite) => void;
  search: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <View style={styles.contactsModal}>
        <View style={styles.contactsHeader}>
          <View style={styles.contactsHeaderText}>
            <Text style={styles.contactsTitle}>Invite from contacts</Text>
            <Text style={styles.contactsSubtitle}>Contacts stay on this device unless you send an invite.</Text>
          </View>
          <Pressable accessibilityLabel="Close contacts" onPress={onClose} style={styles.contactsClose}>
            <Ionicons name="close" size={21} color={colors.dark.cream} />
          </Pressable>
        </View>
        <View style={styles.contactsSearchBox}>
          <Ionicons name="search-outline" size={16} color={colors.dark.muted} />
          <TextInput
            autoCapitalize="none"
            onChangeText={onChangeSearch}
            placeholder="Search contacts"
            placeholderTextColor={colors.dark.muted}
            style={styles.contactsSearchInput}
            value={search}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.contactsState}>
            <Ionicons name="hourglass-outline" size={22} color={colors.dark.orange} />
            <Text style={styles.contactsStateText}>Loading contacts</Text>
          </View>
        ) : contacts.length === 0 ? (
          <View style={styles.contactsState}>
            <Ionicons name="people-outline" size={24} color={colors.dark.orange} />
            <Text style={styles.contactsStateText}>No contacts to show</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.contactsList} showsVerticalScrollIndicator={false}>
            {contacts.map((contact) => (
              <View key={contact.id} style={styles.contactInviteRow}>
                <View style={[styles.contactInviteAvatar, { backgroundColor: senderAccent(contact.name) }]}>
                  <Text style={styles.contactInviteInitial}>{senderInitials(contact.name)}</Text>
                </View>
                <View style={styles.contactInviteText}>
                  <Text numberOfLines={1} style={styles.contactInviteName}>{contact.name}</Text>
                  <Text numberOfLines={1} style={styles.contactInviteDetail}>{contact.detail}</Text>
                </View>
                <Pressable onPress={() => onInvite(contact)} style={styles.contactInviteButton}>
                  <Text style={styles.contactInviteButtonText}>Invite</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function AttachmentOptionsSheet({
  dishError,
  dishName,
  dishNote,
  dishPending,
  dishRating,
  onChangeDishName,
  onChangeDishNote,
  onChangeDishRating,
  onCamera,
  onClose,
  onDishSubmit,
  onGallery,
  pending,
  visible
}: {
  dishError?: string;
  dishName: string;
  dishNote: string;
  dishPending: boolean;
  dishRating: number;
  onChangeDishName: (value: string) => void;
  onChangeDishNote: (value: string) => void;
  onChangeDishRating: (value: number) => void;
  onCamera: () => void;
  onClose: () => void;
  onDishSubmit: () => void;
  onGallery: () => void;
  pending: boolean;
  visible: boolean;
}) {
  const [view, setView] = useState<AttachmentSheetView>("actions");
  const canSubmitDish = Boolean(dishName.trim()) && !dishPending;

  useEffect(() => {
    if (visible) setView("actions");
  }, [visible]);

  const title = view === "dish" ? "Add dish" : view === "media" ? "Add media" : "Add to memory";
  const subtitle = view === "dish"
    ? "Save a dish and your rating for this group."
    : view === "media"
      ? "Share a photo or video in the chat."
      : "Choose what you want to add to this chat.";

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.attachSheetKeyboard}>
        <Pressable onPress={onClose} style={styles.attachSheetBackdrop}>
          <Pressable style={styles.attachSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.attachSheetHeaderRow}>
              {view === "actions" ? <View style={styles.attachSheetHeaderSpacer} /> : (
                <Pressable accessibilityLabel="Back" hitSlop={8} onPress={() => setView("actions")} style={styles.attachSheetHeaderButton}>
                  <Ionicons name="chevron-back" size={18} color={ROOM_COLORS.cool} />
                </Pressable>
              )}
              <View style={styles.attachSheetHeaderText}>
                <Text style={styles.attachSheetTitle}>{title}</Text>
                <Text numberOfLines={1} style={styles.attachSheetSubtitle}>{subtitle}</Text>
              </View>
              <Pressable accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.attachSheetHeaderButton}>
                <Ionicons name="close" size={18} color={colors.dark.muted} />
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
                    <Ionicons name="restaurant-outline" size={22} color={colors.dark.gold} />
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
                <View style={styles.attachDishInputWrap}>
                  <Ionicons name="restaurant-outline" size={16} color={colors.dark.gold} />
                  <TextInput
                    onChangeText={onChangeDishName}
                    placeholder="Dish name"
                    placeholderTextColor={colors.dark.muted}
                    style={styles.attachDishInput}
                    value={dishName}
                  />
                </View>
                <View style={styles.attachDishInputWrap}>
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.dark.muted} />
                  <TextInput
                    onChangeText={onChangeDishNote}
                    placeholder="Note for the group"
                    placeholderTextColor={colors.dark.muted}
                    style={styles.attachDishInput}
                    value={dishNote}
                  />
                </View>
                <View style={styles.attachDishFooter}>
                  <View style={styles.attachDishStars}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Pressable key={star} hitSlop={6} onPress={() => onChangeDishRating(dishRating === star ? 0 : star)}>
                        <Ionicons name={star <= dishRating ? "star" : "star-outline"} size={22} color={colors.dark.gold} />
                      </Pressable>
                    ))}
                  </View>
                  <Pressable disabled={!canSubmitDish} onPress={onDishSubmit} style={[styles.attachDishSubmit, !canSubmitDish && styles.attachDishSubmitDisabled]}>
                    <Text style={styles.attachDishSubmitText}>{dishPending ? "Adding" : "Add"}</Text>
                  </Pressable>
                </View>
                {dishError ? <Text style={styles.error}>{dishError}</Text> : null}
              </View>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RoomActionsSheet({
  leavePending,
  onAddPeople,
  onClose,
  onLeave,
  onViewPeople,
  visible
}: {
  leavePending: boolean;
  onAddPeople: () => void;
  onClose: () => void;
  onLeave: () => void;
  onViewPeople: () => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.roomActionsBackdrop}>
        <Pressable style={styles.roomActionsPopover} onPress={(event) => event.stopPropagation()}>
          <Pressable onPress={onAddPeople} style={styles.roomActionOption}>
            <View style={styles.roomActionIcon}>
              <Ionicons name="person-add-outline" size={19} color={colors.dark.orange} />
            </View>
            <View style={styles.roomActionText}>
              <Text style={styles.roomActionTitle}>Add friends</Text>
              <Text style={styles.roomActionSubtitle}>Invite more people to this room.</Text>
            </View>
          </Pressable>
          <Pressable onPress={onViewPeople} style={styles.roomActionOption}>
            <View style={[styles.roomActionIcon, styles.roomActionIconCool]}>
              <Ionicons name="people-outline" size={19} color={ROOM_COLORS.cool} />
            </View>
            <View style={styles.roomActionText}>
              <Text style={styles.roomActionTitle}>View friends</Text>
              <Text style={styles.roomActionSubtitle}>See everyone in the room.</Text>
            </View>
          </Pressable>
          <Pressable disabled={leavePending} onPress={onLeave} style={[styles.roomActionOption, leavePending && styles.roomActionDisabled]}>
            <View style={[styles.roomActionIcon, styles.roomActionIconDanger]}>
              <Ionicons name="exit-outline" size={19} color={colors.dark.dangerSoft} />
            </View>
            <View style={styles.roomActionText}>
              <Text style={[styles.roomActionTitle, styles.roomActionDangerText]}>{leavePending ? "Leaving..." : "Leave room"}</Text>
              <Text style={styles.roomActionSubtitle}>Remove this memory from your rooms.</Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SelectionActionBar({
  bottomInset,
  canDelete,
  count,
  deleteError,
  deleting,
  editableMessage,
  onCancel,
  onDelete,
  onEdit
}: {
  bottomInset: number;
  canDelete: boolean;
  count: number;
  deleteError?: string;
  deleting: boolean;
  editableMessage: MemoryMessage | null;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: (message: MemoryMessage) => void;
}) {
  return (
    <View
      style={[
        styles.selectionBarWrap,
        { paddingBottom: Math.max(CLOSED_COMPOSER_BOTTOM_GAP, bottomInset + spacing.sm) }
      ]}
    >
      {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
      <View style={styles.selectionBar}>
        <Pressable accessibilityLabel="Cancel selection" onPress={onCancel} style={styles.selectionBarButton}>
          <Ionicons name="close" size={22} color={colors.dark.cream} />
        </Pressable>
        <Text style={styles.selectionBarTitle}>
          {count} selected
        </Text>
        {editableMessage ? (
          <Pressable
            accessibilityLabel="Edit selected message"
            disabled={deleting}
            onPress={() => onEdit(editableMessage)}
            style={[styles.selectionEditButton, deleting && styles.selectionDeleteButtonDisabled]}
          >
            <Ionicons name="create-outline" size={SELECTION_SECONDARY_ICON_SIZE} color={colors.dark.white} />
          </Pressable>
        ) : null}
        {canDelete ? (
          <Pressable
            accessibilityLabel="Delete selected items"
            disabled={deleting || count === 0}
            onPress={onDelete}
            style={[styles.selectionDeleteButton, (deleting || count === 0) && styles.selectionDeleteButtonDisabled]}
          >
            <Ionicons name={deleting ? "hourglass-outline" : "trash-outline"} size={SELECTION_SECONDARY_ICON_SIZE} color={colors.dark.white} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function MemoryCameraModal({
  onCapture,
  onClose,
  visible
}: {
  onCapture: (asset: MemoryCaptureAsset) => Promise<void>;
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraGranted, setCameraGranted] = useState(false);
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!visible) return;

    let alive = true;
    setCameraError("");
    setCameraReady(false);
    setRecording(false);
    setCapturing(false);

    async function requestPermissions() {
      const cameraPermission = await Camera.requestCameraPermissionsAsync();
      const microphonePermission = await Camera.requestMicrophonePermissionsAsync();
      if (!alive) return;
      setCameraGranted(cameraPermission.granted);
      setMicrophoneGranted(microphonePermission.granted);
      if (!cameraPermission.granted) {
        setCameraError("Camera permission was not granted.");
      }
    }

    requestPermissions().catch(() => {
      if (alive) setCameraError("Could not open camera.");
    });

    return () => {
      alive = false;
    };
  }, [visible]);

  async function closeCamera() {
    if (recording) cameraRef.current?.stopRecording();
    onClose();
  }

  async function capturePhoto() {
    if (!cameraReady || capturing || recording) return;
    setCapturing(true);
    setCameraError("");
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        await onCapture({ height: photo.height, mimeType: "image/jpeg", type: "image", uri: photo.uri, width: photo.width });
      }
    } catch {
      setCameraError("Could not capture photo.");
    } finally {
      setCapturing(false);
    }
  }

  async function toggleVideoRecording() {
    if (!cameraReady || capturing) return;
    if (!microphoneGranted) {
      setCameraError("Microphone permission is needed to record video.");
      return;
    }
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }

    setCapturing(true);
    setRecording(true);
    setCameraError("");
    try {
      const video = await cameraRef.current?.recordAsync({ maxDuration: 90 });
      if (video?.uri) {
        await onCapture({ mimeType: "video/mp4", type: "video", uri: video.uri });
      }
    } catch {
      setCameraError("Could not record video.");
    } finally {
      setRecording(false);
      setCapturing(false);
    }
  }

  function capture() {
    if (cameraMode === "video") {
      void toggleVideoRecording();
      return;
    }
    void capturePhoto();
  }

  return (
    <Modal animationType="slide" onRequestClose={closeCamera} visible={visible}>
      <View style={styles.cameraModal}>
        {cameraGranted ? (
          <CameraView
            active={visible}
            facing={facing}
            mode={cameraMode}
            onCameraReady={() => setCameraReady(true)}
            ref={cameraRef}
            style={styles.cameraPreview}
          />
        ) : (
          <View style={styles.cameraPermissionState}>
            <Ionicons name="camera-outline" size={34} color={colors.dark.orange} />
            <Text style={styles.cameraPermissionTitle}>Camera unavailable</Text>
            <Text style={styles.cameraPermissionText}>{cameraError || "Camera permission is required."}</Text>
          </View>
        )}

        <View
          style={[
            styles.cameraTopControls,
            { paddingTop: Platform.OS === "web" ? spacing.lg : Math.max(54, insets.top + spacing.sm) }
          ]}
        >
          <Pressable accessibilityLabel="Close camera" onPress={closeCamera} style={styles.cameraIconButton}>
            <Ionicons name="close" size={22} color={colors.dark.white} />
          </Pressable>
          <Pressable
            accessibilityLabel="Flip camera"
            disabled={recording}
            onPress={() => setFacing((current) => current === "back" ? "front" : "back")}
            style={[styles.cameraIconButton, recording && styles.cameraControlDisabled]}
          >
            <Ionicons name="camera-reverse-outline" size={22} color={colors.dark.white} />
          </Pressable>
        </View>

        <View
          style={[
            styles.cameraBottomControls,
            { paddingBottom: Platform.OS === "web" ? spacing.xl : Math.max(42, insets.bottom + spacing.lg) }
          ]}
        >
          {cameraError && cameraGranted ? <Text style={styles.cameraError}>{cameraError}</Text> : null}
          <View style={styles.cameraModeSwitch}>
            <Pressable
              disabled={recording}
              onPress={() => setCameraMode("picture")}
              style={[styles.cameraModeButton, cameraMode === "picture" && styles.cameraModeButtonActive]}
            >
              <Text style={[styles.cameraModeText, cameraMode === "picture" && styles.cameraModeTextActive]}>Photo</Text>
            </Pressable>
            <Pressable
              disabled={recording}
              onPress={() => setCameraMode("video")}
              style={[styles.cameraModeButton, cameraMode === "video" && styles.cameraModeButtonActive]}
            >
              <Text style={[styles.cameraModeText, cameraMode === "video" && styles.cameraModeTextActive]}>Video</Text>
            </Pressable>
          </View>

          <Pressable
            accessibilityLabel={cameraMode === "video" ? recording ? "Stop recording" : "Record video" : "Take photo"}
            disabled={!cameraGranted || !cameraReady || capturing && !recording}
            onPress={capture}
            style={[
              styles.cameraCaptureButton,
              cameraMode === "video" && styles.cameraCaptureButtonVideo,
              recording && styles.cameraCaptureButtonRecording,
              (!cameraGranted || !cameraReady || capturing && !recording) && styles.cameraControlDisabled
            ]}
          >
            <View style={[styles.cameraCaptureInner, recording && styles.cameraCaptureInnerRecording]} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MediaViewer({ onClose, selection }: { onClose: () => void; selection: MediaViewerState | null }) {
  const viewerScrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(selection?.index ?? 0);
  const [carouselWidth, setCarouselWidth] = useState(0);

  useEffect(() => {
    if (!selection) return;
    setActiveIndex(selection.index);
  }, [selection]);

  useEffect(() => {
    if (!selection || carouselWidth <= 0) return;
    viewerScrollRef.current?.scrollTo({ animated: false, x: selection.index * carouselWidth });
  }, [carouselWidth, selection]);

  if (!selection || selection.items.length === 0) return null;

  const items = selection.items;
  const safeActiveIndex = Math.max(0, Math.min(items.length - 1, activeIndex));
  const activeMedia = items[safeActiveIndex];
  const activeKind = activeMedia.mediaType === "video" ? "Video" : "Photo";

  function handleViewerScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (carouselWidth <= 0) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / carouselWidth);
    setActiveIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
  }

  function selectViewerItem(index: number) {
    setActiveIndex(index);
    if (carouselWidth > 0) {
      viewerScrollRef.current?.scrollTo({ animated: true, x: index * carouselWidth });
    }
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.viewerBackdrop}>
        <View style={styles.viewerHeader}>
          <View style={styles.viewerHeaderText}>
            <Text numberOfLines={1} style={styles.viewerTitle}>
              {activeKind}{items.length > 1 ? ` ${safeActiveIndex + 1} of ${items.length}` : ""}
            </Text>
            <Text numberOfLines={1} style={styles.viewerSubtitle}>
              {activeMedia.uploaderDisplayName} · {formatDisplayDate(activeMedia.createdAt)}
            </Text>
          </View>
          <Pressable accessibilityLabel="Close media viewer" onPress={onClose} style={styles.viewerClose}>
            <Ionicons name="close" size={22} color={colors.dark.white} />
          </Pressable>
        </View>
        <View
          onLayout={(event) => setCarouselWidth(event.nativeEvent.layout.width)}
          style={styles.viewerBody}
        >
          <ScrollView
            horizontal
            onMomentumScrollEnd={handleViewerScroll}
            pagingEnabled
            ref={viewerScrollRef}
            showsHorizontalScrollIndicator={false}
            style={styles.viewerCarousel}
          >
            {items.map((media) => (
              <View key={media.id} style={[styles.viewerSlide, carouselWidth > 0 && { width: carouselWidth }]}>
                {media.mediaType === "video" ? (
                  <ViewerVideo media={media} />
                ) : (
                  <Image contentFit="contain" source={{ uri: media.publicUrl }} style={styles.viewerImage} />
                )}
              </View>
            ))}
          </ScrollView>
        </View>
        {items.length > 1 ? (
          <View style={styles.viewerFooter}>
            <ScrollView
              contentContainerStyle={styles.viewerThumbnails}
              horizontal
              showsHorizontalScrollIndicator={false}
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
                      <Ionicons name="play" size={14} color={colors.dark.white} />
                    </View>
                  ) : (
                    <Image contentFit="cover" source={{ uri: media.publicUrl }} style={styles.viewerThumbnailImage} />
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

function MediaPreview({ media, style }: { media: MemoryPhoto; style?: StyleProp<ViewStyle> }) {
  if (media.mediaType === "video") {
    return (
      <View style={[styles.videoPreview, style as StyleProp<ViewStyle>]}>
        {isOptimisticMemoryMedia(media) ? (
          <View style={styles.mediaPendingOverlay}>
            <Ionicons name="cloud-upload-outline" size={17} color={colors.dark.white} />
            <Text style={styles.mediaPendingText}>Sending</Text>
          </View>
        ) : null}
        <View style={styles.mediaTypeBadge}>
          <Ionicons name="videocam" size={11} color={colors.dark.white} />
          <Text style={styles.mediaTypeBadgeText}>Video</Text>
        </View>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={18} color={colors.dark.white} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.mediaImageWrap, style as StyleProp<ViewStyle>]}>
      <Image
        contentFit="cover"
        source={{ uri: media.publicUrl }}
        style={styles.mediaImage}
      />
      {isOptimisticMemoryMedia(media) ? (
        <View style={styles.mediaPendingOverlay}>
          <Ionicons name="cloud-upload-outline" size={17} color={colors.dark.white} />
          <Text style={styles.mediaPendingText}>Sending</Text>
        </View>
      ) : null}
    </View>
  );
}

function Composer({
  bottomInset,
  editingLabel,
  keyboardOpen,
  mediaError,
  mediaMutationError,
  mediaPending,
  message,
  messageError,
  messagePending,
  onAttach,
  onCancelEdit,
  onCancelReply,
  onChangeMessage,
  onLayoutChange,
  onInputFocus,
  replyingToMessage,
  onSend
}: {
  bottomInset: number;
  editingLabel?: string;
  keyboardOpen: boolean;
  mediaError?: string;
  mediaMutationError?: string;
  mediaPending: boolean;
  message: string;
  messageError?: string;
  messagePending: boolean;
  onAttach: () => void;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
  onChangeMessage: (value: string) => void;
  onLayoutChange: (event: LayoutChangeEvent) => void;
  onInputFocus: () => void;
  replyingToMessage?: MemoryMessage | null;
  onSend: () => void;
}) {
  const canSend = Boolean(message.trim()) && !messagePending && !mediaPending;
  const [composerInputHeight, setComposerInputHeight] = useState(COMPOSER_INPUT_MIN_HEIGHT);
  const composerCanScroll = composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT;
  const bottomPadding = keyboardOpen
    ? KEYBOARD_COMPOSER_BOTTOM_GAP
    : Math.max(CLOSED_COMPOSER_BOTTOM_GAP, bottomInset + spacing.xs);

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
    <View
      onLayout={onLayoutChange}
      style={[styles.composerWrap, keyboardOpen && styles.composerWrapKeyboardOpen, { paddingBottom: bottomPadding }]}
    >
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
          <View style={styles.replyComposerCopy}>
            <Text numberOfLines={1} style={styles.replyComposerLabel}>Replying to {replyingToMessage.authorDisplayName}</Text>
            <Text numberOfLines={2} style={styles.replyComposerPreview}>
              {memoryMessageReplyPreview(replyingToMessage)}
            </Text>
          </View>
          <Pressable accessibilityLabel="Cancel reply" hitSlop={8} onPress={onCancelReply}>
            <Ionicons name="close" size={18} color={colors.dark.muted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composer}>
        <View style={styles.messageBox}>
          <Pressable
            accessibilityLabel="Attach photo or video"
            accessibilityRole="button"
            accessibilityState={{ disabled: Boolean(editingLabel) || mediaPending }}
            disabled={Boolean(editingLabel) || mediaPending}
            onPress={onAttach}
            style={[styles.attachButton, (editingLabel || mediaPending) && styles.attachButtonDisabled]}
          >
            <Ionicons name={mediaPending ? "hourglass-outline" : "add"} size={Platform.OS === "web" ? 19 : 21} color={ROOM_COLORS.cool} />
          </Pressable>
          <TextInput
            multiline
            onContentSizeChange={handleComposerContentSizeChange}
            onChangeText={onChangeMessage}
            onFocus={onInputFocus}
            placeholder="Message..."
            placeholderTextColor={colors.dark.muted}
            scrollEnabled={composerCanScroll}
            style={[
              styles.composerInput,
              Platform.OS === "web" ? styles.composerInputWeb : styles.composerInputNative,
              { height: composerInputHeight }
            ]}
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
          <Ionicons name={editingLabel ? "checkmark" : "send"} size={Platform.OS === "web" ? 15 : 17} color={colors.dark.white} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1
  },
  screenContent: {
    paddingBottom: 0
  },
  roomStage: {
    flex: 1
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
    gap: 6,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    width: "100%"
  },
  headerTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  headerIconButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  headerIconSpacer: {
    width: 34
  },
  headerText: {
    flex: 1,
    minWidth: 0
  },
  roomTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 19,
    lineHeight: 24
  },
  roomSubtitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    marginTop: 1,
    minWidth: 0
  },
  roomSubtitle: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16
  },
  modeTabs: {
    backgroundColor: ROOM_COLORS.panel,
    borderRadius: radius.input,
    flexDirection: "row",
    padding: 2
  },
  modeButton: {
    alignItems: "center",
    borderRadius: radius.md,
    flex: 1,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    minHeight: 34
  },
  modeButtonActive: {
    backgroundColor: CHAT_OWN_BUBBLE_COLOR
  },
  modeButtonText: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.muted,
    fontSize: 10
  },
  modeButtonTextActive: {
    color: colors.dark.white
  },
  body: {
    alignSelf: "center",
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    flex: 1,
    maxWidth: ROOM_MAX_WIDTH,
    width: "100%"
  },
  chatTimelineWrap: {
    backgroundColor: "transparent",
    flex: 1,
    overflow: "hidden"
  },
  chatWallpaper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ROOM_COLORS.bg
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
    justifyContent: "flex-end",
    paddingTop: spacing.base,
    paddingBottom: 0
  },
  timelineContentEmpty: {
    flexGrow: 1
  },
  dateDividerRow: {
    alignItems: "center",
    paddingHorizontal: CHAT_ROW_SIDE_PADDING,
    paddingVertical: 8,
    width: "100%"
  },
  dateDividerText: {
    ...fontStyles.extraBold,
    backgroundColor: "rgba(21,23,25,0.92)",
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
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
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
    color: colors.dark.white,
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
  chatMessageRowSelected: {
    backgroundColor: ROOM_COLORS.selection,
    borderRadius: 0
  },
  chatMessageRowEditing: {
    backgroundColor: "rgba(232,168,48,0.10)",
    borderLeftColor: colors.dark.gold,
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
    backgroundColor: ROOM_COLORS.cool,
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    left: CHAT_ROW_SIDE_PADDING,
    marginTop: -17,
    position: "absolute",
    top: "50%",
    width: 34
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
    borderColor: ROOM_COLORS.coolBorder,
    minWidth: 64
  },
  textMessageBubbleOther: {
    alignSelf: "flex-start",
    minWidth: 88
  },
  messageBubbleGroupedMine: {
    borderTopRightRadius: 7
  },
  messageBubbleGroupedOther: {
    borderTopLeftRadius: 7
  },
  singleMediaMessageCard: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    padding: 0,
    position: "relative",
    zIndex: 1
  },
  multiMediaMessageCard: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    padding: 0,
    position: "relative",
    zIndex: 1
  },
  mediaMessageCardMine: {
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
    borderColor: "rgba(34, 199, 184, 0.18)"
  },
  mediaMessageCardOther: {
    backgroundColor: CHAT_OTHER_BUBBLE_COLOR,
    borderColor: "rgba(255,255,255,0.08)"
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
    backgroundColor: "rgba(14,11,8,0.18)",
    borderLeftColor: colors.dark.gold
  },
  replyPreviewAuthor: {
    ...fontStyles.extraBold,
    color: ROOM_COLORS.cool,
    fontSize: 11,
    lineHeight: 14
  },
  replyPreviewText: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
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
    color: colors.dark.white,
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
    color: colors.dark.cream,
    flexShrink: 1,
    flexWrap: "wrap",
    includeFontPadding: false
  },
  inlineTimestampText: {
    ...fontStyles.semiBold,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 13
  },
  inlineTimestampReserve: {
    ...fontStyles.semiBold,
    color: "rgba(255,255,255,0)",
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
    backgroundColor: "#0B0D0F",
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
    backgroundColor: "#0B0D0F",
    height: "100%",
    overflow: "hidden",
    width: "100%"
  },
  gridVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  gridPlayBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  gridMediaTypeBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.58)",
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
    backgroundColor: "rgba(0,0,0,0.45)",
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
    color: colors.dark.white,
    fontSize: 11,
    includeFontPadding: false,
    lineHeight: 13
  },
  attachmentMoreOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.58)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  attachmentMoreText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 18,
    lineHeight: 23
  },
  mediaMessageContent: {
    borderRadius: 0,
    overflow: "hidden"
  },
  mediaImageWrap: {
    aspectRatio: 1,
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
    aspectRatio: 1,
    backgroundColor: colors.dark.black,
    borderRadius: radius.md,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    width: "100%"
  },
  mediaPendingOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
    bottom: 0,
    gap: 5,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  mediaPendingText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 11,
    lineHeight: 14
  },
  mediaTypeBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.58)",
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
    color: colors.dark.white,
    fontSize: 10,
    lineHeight: 12
  },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  attachSheetKeyboard: {
    flex: 1
  },
  attachSheetBackdrop: {
    backgroundColor: "rgba(0,0,0,0.20)",
    flex: 1,
    justifyContent: "flex-end"
  },
  attachSheet: {
    alignSelf: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: Platform.OS === "web" ? 78 : 74,
    maxWidth: ROOM_MAX_WIDTH,
    padding: spacing.md,
    width: Platform.OS === "web" ? "88%" : "90%"
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
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 18
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
    backgroundColor: "rgba(232, 168, 48, 0.12)",
    borderColor: "rgba(232, 168, 48, 0.24)"
  },
  attachActionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
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
    backgroundColor: colors.dark.dangerDim,
    borderColor: colors.dark.dangerBorder,
    borderWidth: 1
  },
  attachSheetOptionText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
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
    color: colors.dark.dangerSoft
  },
  attachDishForm: {
    gap: spacing.sm
  },
  attachDishInputWrap: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md
  },
  attachDishInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    paddingVertical: Platform.OS === "web" ? 8 : 0
  },
  attachDishFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between"
  },
  attachDishStars: {
    flexDirection: "row",
    gap: spacing.xs
  },
  attachDishSubmit: {
    alignItems: "center",
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
    borderRadius: radius.pill,
    minHeight: 38,
    minWidth: 84,
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  attachDishSubmitDisabled: {
    opacity: 0.45
  },
  attachDishSubmitText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 14,
    lineHeight: 18
  },
  roomActionsBackdrop: {
    backgroundColor: "transparent",
    flex: 1
  },
  roomActionsPopover: {
    alignSelf: "flex-end",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: radius.input,
    borderWidth: 1,
    gap: 2,
    marginRight: Platform.OS === "web" ? spacing.lg : spacing.md,
    marginTop: Platform.OS === "web" ? 58 : 54,
    maxWidth: 292,
    padding: spacing.sm,
    shadowColor: colors.dark.black,
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    width: "74%",
    elevation: 10
  },
  roomActionOption: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  roomActionDisabled: {
    opacity: 0.55
  },
  roomActionIcon: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  roomActionIconCool: {
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderWidth: 1
  },
  roomActionIconDanger: {
    backgroundColor: colors.dark.dangerDim,
    borderColor: colors.dark.dangerBorder,
    borderWidth: 1
  },
  roomActionText: {
    flex: 1,
    minWidth: 0
  },
  roomActionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 17
  },
  roomActionSubtitle: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2
  },
  roomActionDangerText: {
    color: colors.dark.dangerSoft
  },
  selectionBarWrap: {
    alignSelf: "center",
    backgroundColor: "transparent",
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    gap: 6,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: CLOSED_COMPOSER_BOTTOM_GAP,
    paddingHorizontal: Platform.OS === "web" ? spacing.md : spacing.lg,
    paddingTop: 4,
    width: "100%"
  },
  selectionBar: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm
  },
  selectionBarButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  selectionBarTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    textAlign: "center"
  },
  selectionDeleteButton: {
    alignItems: "center",
    backgroundColor: colors.dark.dangerSoft,
    borderRadius: radius.pill,
    height: SELECTION_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: SELECTION_ACTION_BUTTON_SIZE
  },
  selectionEditButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.pill,
    height: SELECTION_ACTION_BUTTON_SIZE,
    justifyContent: "center",
    width: SELECTION_ACTION_BUTTON_SIZE
  },
  selectionDeleteButtonDisabled: {
    opacity: 0.5
  },
  cameraModal: {
    backgroundColor: colors.dark.black,
    flex: 1
  },
  cameraPreview: {
    flex: 1
  },
  cameraPermissionState: {
    alignItems: "center",
    backgroundColor: colors.dark.black,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.xl
  },
  cameraPermissionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 18,
    lineHeight: 23
  },
  cameraPermissionText: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  cameraTopControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === "web" ? spacing.lg : 54,
    position: "absolute",
    right: 0,
    top: 0
  },
  cameraIconButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderRadius: radius.pill,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  cameraBottomControls: {
    alignItems: "center",
    bottom: 0,
    gap: spacing.base,
    left: 0,
    paddingBottom: Platform.OS === "web" ? spacing.xl : 42,
    paddingHorizontal: spacing.lg,
    position: "absolute",
    right: 0
  },
  cameraError: {
    ...fontStyles.semiBold,
    backgroundColor: "rgba(0,0,0,0.52)",
    borderRadius: radius.input,
    color: colors.dark.cream,
    fontSize: 12,
    lineHeight: 16,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: "center"
  },
  cameraModeSwitch: {
    backgroundColor: "rgba(0,0,0,0.48)",
    borderRadius: radius.pill,
    flexDirection: "row",
    padding: 4
  },
  cameraModeButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    minWidth: 78,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm
  },
  cameraModeButtonActive: {
    backgroundColor: colors.dark.white
  },
  cameraModeText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 12,
    lineHeight: 16
  },
  cameraModeTextActive: {
    color: colors.dark.black
  },
  cameraCaptureButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.3)",
    borderColor: colors.dark.white,
    borderRadius: radius.pill,
    borderWidth: 4,
    height: 76,
    justifyContent: "center",
    width: 76
  },
  cameraCaptureButtonVideo: {
    borderColor: "#FF4D4D"
  },
  cameraCaptureButtonRecording: {
    borderColor: "#FF4D4D"
  },
  cameraCaptureInner: {
    backgroundColor: colors.dark.white,
    borderRadius: radius.pill,
    height: 56,
    width: 56
  },
  cameraCaptureInnerRecording: {
    backgroundColor: "#FF4D4D",
    borderRadius: 10,
    height: 28,
    width: 28
  },
  cameraControlDisabled: {
    opacity: 0.45
  },
  viewerBackdrop: {
    backgroundColor: "rgba(0,0,0,0.94)",
    flex: 1,
    padding: spacing.lg
  },
  viewerHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.md
  },
  viewerHeaderText: {
    flex: 1,
    minWidth: 0
  },
  viewerTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 14,
    lineHeight: 18
  },
  viewerSubtitle: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  viewerClose: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
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
    gap: spacing.sm,
    paddingTop: spacing.md
  },
  viewerCount: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center"
  },
  viewerThumbnails: {
    gap: spacing.sm,
    justifyContent: "center",
    minWidth: "100%",
    paddingBottom: spacing.sm,
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
    borderColor: colors.dark.orange,
    borderWidth: 2
  },
  viewerThumbnailImage: {
    height: "100%",
    width: "100%"
  },
  viewerThumbnailVideo: {
    alignItems: "center",
    backgroundColor: colors.dark.black,
    height: "100%",
    justifyContent: "center",
    width: "100%"
  },
  galleryContent: {
    gap: spacing.base,
    padding: spacing.lg,
    paddingBottom: spacing.xl
  },
  panelContent: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.xl
  },
  panelActionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end"
  },
  panelPrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.base
  },
  panelPrimaryButtonDisabled: {
    opacity: 0.45
  },
  panelPrimaryButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 13
  },
  peopleAddWrap: {
    gap: 6,
    marginBottom: 2
  },
  peopleAddRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  peopleAddInputWrap: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md
  },
  peopleAddInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    includeFontPadding: false,
    padding: 0
  },
  peopleAddButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    height: 42,
    justifyContent: "center",
    paddingHorizontal: spacing.base
  },
  peopleAddButtonDisabled: {
    opacity: 0.45
  },
  peopleAddButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 13
  },
  contactsImportButton: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  contactsImportText: {
    flex: 1,
    minWidth: 0
  },
  contactsImportTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 17
  },
  contactsImportSubtitle: {
    ...fontStyles.semiBold,
    color: ROOM_COLORS.muted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 1
  },
  peopleSuggestions: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden"
  },
  peopleSuggestionState: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  peopleSuggestionMuted: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16
  },
  peopleSuggestionRow: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.05)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  peopleSuggestionAvatar: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  peopleSuggestionInitial: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 11,
    lineHeight: 14
  },
  peopleSuggestionText: {
    flex: 1,
    minWidth: 0
  },
  peopleSuggestionName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 17
  },
  peopleSuggestionUsername: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
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
  contactsModal: {
    backgroundColor: colors.dark.bg,
    flex: 1,
    paddingBottom: Platform.OS === "web" ? spacing.lg : 28,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === "web" ? spacing.lg : 54
  },
  contactsHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.base
  },
  contactsHeaderText: {
    flex: 1,
    minWidth: 0
  },
  contactsTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 19,
    lineHeight: 24
  },
  contactsSubtitle: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  contactsClose: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  contactsSearchBox: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md
  },
  contactsSearchInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    includeFontPadding: false,
    padding: 0
  },
  contactsState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.xl
  },
  contactsStateText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center"
  },
  contactsList: {
    gap: spacing.sm,
    paddingTop: spacing.base
  },
  contactInviteRow: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  contactInviteAvatar: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  contactInviteInitial: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 11,
    lineHeight: 14
  },
  contactInviteText: {
    flex: 1,
    minWidth: 0
  },
  contactInviteName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 18
  },
  contactInviteDetail: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 1
  },
  contactInviteButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  contactInviteButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 12,
    lineHeight: 15
  },
  dishAddWrap: {
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  dishMemorySummary: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 74,
    paddingHorizontal: spacing.md
  },
  dishSummaryItem: {
    alignItems: "center",
    flex: 1,
    gap: 3
  },
  dishSummaryValue: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 18,
    lineHeight: 22
  },
  dishSummaryLabel: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14
  },
  dishSummaryDivider: {
    backgroundColor: "rgba(255,255,255,0.08)",
    height: 34,
    width: 1
  },
  dishInputWrap: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md
  },
  dishInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    includeFontPadding: false,
    padding: 0
  },
  dishAddFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  dishStars: {
    flexDirection: "row",
    gap: 3
  },
  dishCard: {
    alignItems: "flex-start",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
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
    color: colors.dark.white,
    fontSize: 13,
    lineHeight: 16
  },
  dishText: {
    flex: 1,
    minWidth: 0
  },
  dishTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  dishName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 15,
    lineHeight: 19
  },
  dishRatingPill: {
    alignItems: "center",
    backgroundColor: "rgba(232,168,48,0.13)",
    borderColor: "rgba(232,168,48,0.22)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  dishRating: {
    ...fontStyles.extraBold,
    color: colors.dark.gold,
    fontSize: 12,
    lineHeight: 15
  },
  dishMeta: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  dishNote: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm
  },
  personRow: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.panel,
    borderColor: ROOM_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
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
    color: colors.dark.white,
    fontSize: 12,
    lineHeight: 15
  },
  personText: {
    flex: 1,
    minWidth: 0
  },
  personName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 19
  },
  personMeta: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2
  },
  galleryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  galleryItem: {
    width: "48%"
  },
  galleryMediaButton: {
    borderRadius: 0,
    overflow: "hidden"
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
    color: colors.dark.cream,
    fontSize: 18,
    lineHeight: 23,
    textAlign: "center"
  },
  emptyText: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: "center"
  },
  composerWrap: {
    alignSelf: "center",
    backgroundColor: "transparent",
    borderLeftColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? ROOM_COLORS.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    gap: 6,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: 30,
    paddingHorizontal: Platform.OS === "web" ? spacing.md : spacing.lg,
    paddingTop: COMPOSER_TOP_GAP,
    width: "100%"
  },
  composerWrapKeyboardOpen: {
    paddingBottom: KEYBOARD_COMPOSER_BOTTOM_GAP
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
    color: colors.dark.cream,
    fontSize: 12,
    lineHeight: 15
  },
  editingCancelText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 12,
    lineHeight: 15
  },
  replyComposerBanner: {
    alignItems: "center",
    backgroundColor: ROOM_COLORS.coolDim,
    borderColor: ROOM_COLORS.coolBorder,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  replyComposerCopy: {
    flex: 1,
    minWidth: 0
  },
  replyComposerLabel: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
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
  messageBox: {
    alignItems: "flex-end",
    backgroundColor: ROOM_COLORS.panelRaised,
    borderColor: ROOM_COLORS.borderStrong,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: Platform.OS === "web" ? 38 : 42,
    paddingHorizontal: Platform.OS === "web" ? 4 : 5,
    paddingVertical: Platform.OS === "web" ? 2 : 3
  },
  attachButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: radius.pill,
    height: Platform.OS === "web" ? 30 : 34,
    justifyContent: "center",
    width: Platform.OS === "web" ? 30 : 34
  },
  attachButtonDisabled: {
    opacity: 0.35
  },
  composerInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
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
    backgroundColor: CHAT_OWN_BUBBLE_COLOR,
    borderRadius: radius.pill,
    height: Platform.OS === "web" ? 36 : 40,
    justifyContent: "center",
    width: Platform.OS === "web" ? 36 : 40
  },
  sendButtonDisabled: {
    opacity: 0.45
  },
  error: {
    ...fontStyles.regular,
    color: colors.dark.dangerSoft,
    fontSize: 12,
    lineHeight: 17
  }
});
