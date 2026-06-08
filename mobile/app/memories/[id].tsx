import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import * as Contacts from "expo-contacts";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Fragment, type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle
} from "react-native";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect } from "react-native-svg";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryDishMutation,
  useAddMemoryPhotoMutation,
  useDeleteMemoryItemsMutation,
  useEditMemoryMessageMutation,
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
const CHAT_ACCENTS = ["#8B6CFF", "#F06030", "#3DD68C", "#E8A830", "#38BDF8", "#F472B6"] as const;
const CHAT_MESSAGE_GAP = 8;
const COMPOSER_TOP_GAP = 16;
const CLOSED_COMPOSER_BOTTOM_GAP = 22;
const KEYBOARD_COMPOSER_BOTTOM_GAP = 8;
const ANDROID_KEYBOARD_SAFETY_LIFT = 28;
const MEDIA_GRID_GAP = 4;
type MediaPreviewSize = { height: number; width: number };

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
  const maxMediaWidth = Math.min(screenWidth * 0.72, 320);

  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
    return {
      height: 220,
      width: Math.min(maxMediaWidth, 280)
    };
  }

  const aspect = imageWidth / imageHeight;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return {
      height: 220,
      width: Math.min(maxMediaWidth, 280)
    };
  }

  if (aspect < 0.8) {
    const width = Math.min(maxMediaWidth * 0.72, 240);
    const rawHeight = width / aspect;
    const height = Math.max(300, Math.min(rawHeight, 360));

    return {
      height: Math.round(height),
      width: Math.round(width)
    };
  }

  if (aspect <= 1.25) {
    const width = Math.min(maxMediaWidth * 0.9, 290);
    const rawHeight = width / aspect;
    const height = Math.min(rawHeight, 310);

    return {
      height: Math.round(height),
      width: Math.round(width)
    };
  }

  const width = maxMediaWidth;
  const rawHeight = width / aspect;
  const height = Math.max(180, Math.min(rawHeight, 240));

  return {
    height: Math.round(height),
    width: Math.round(width)
  };
}

function getMultiMediaGridWidth(screenWidth: number) {
  return Math.round(Math.min(screenWidth * 0.72, Platform.OS === "web" ? 280 : 320));
}

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = params.id ?? "";
  const room = useMemoryRoomQuery(roomId);
  useMemoryRoomRealtime(roomId);
  const addParticipant = useAddMemoryParticipantMutation(roomId);
  const addMessage = useAddMemoryMessageMutation(roomId);
  const addDish = useAddMemoryDishMutation(roomId);
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const editMessage = useEditMemoryMessageMutation(roomId);
  const deleteItems = useDeleteMemoryItemsMutation(roomId);
  const markRead = useMarkMemoryRoomReadMutation(roomId);
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");
  const { height: windowHeight } = useWindowDimensions();
  const peopleInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const initialWindowHeightRef = useRef(Dimensions.get("window").height);
  const nearBottomRef = useRef(true);
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
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [attachmentOptionsVisible, setAttachmentOptionsVisible] = useState(false);
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

  useEffect(() => {
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
  }, [markRead, room.data, roomId]);

  useEffect(() => {
    if (!keyboardVisible) initialWindowHeightRef.current = windowHeight;
  }, [keyboardVisible, windowHeight]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (event: KeyboardEvent) => {
      setKeyboardVisible(true);
      if (Platform.OS === "android") setAndroidKeyboardHeight(getAndroidKeyboardHeight(event));
      scrollToLatestForTyping();
    });
    const hideSubscription = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
      setKeyboardVisible(false);
      setAndroidKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function scrollToLatestForTyping() {
    if (!nearBottomRef.current) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
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
        await addMessage.mutateAsync(message);
      }
      setMessage("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      // Rendered from mutation state.
    }
  }

  function beginEditMessage(target: MemoryMessage) {
    setSelectedItemKeys([]);
    setEditingMessage(target);
    setMessage(target.body);
    setMode("chat");
  }

  function cancelEditMessage() {
    setEditingMessage(null);
    setMessage("");
  }

  function beginSelection(target: MemoryActionTarget) {
    const key = memoryActionKey(target);
    setEditingMessage(null);
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
        roomId
      });
      setMessage("");
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
    } catch {
      // Rendered from mutation state.
    }
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
        myUsername={myUsername}
        onAddPeople={openPeopleAdd}
        onBack={goBackToMemories}
        onChangeMode={setMode}
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
                onNearBottomChange={(isNearBottom) => {
                  nearBottomRef.current = isNearBottom;
                }}
                onOpenMedia={openMediaViewer}
                onToggleSelection={toggleSelectedItem}
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
              keyboardOpen={keyboardVisible}
              onAttach={openAttachmentOptions}
              onCancelEdit={cancelEditMessage}
              onChangeMessage={setMessage}
              onInputFocus={scrollToLatestForTyping}
              onSend={submitMessage}
            />
          ) : null}
        </View>

        <AttachmentOptionsSheet
          onCamera={openCamera}
          onClose={() => setAttachmentOptionsVisible(false)}
          onGallery={() => submitMedia(pickMemoryMediaFromGallery)}
          pending={addPhoto.isPending}
          visible={attachmentOptionsVisible}
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
  myUsername,
  onAddPeople,
  onBack,
  onChangeMode
}: {
  data: MemoryRoom;
  mode: RoomMode;
  myUsername: string;
  onAddPeople: () => void;
  onBack: () => void;
  onChangeMode: (mode: RoomMode) => void;
}) {
  const locationLabel = compactPlaceLocation({
    formattedAddress: data.area ?? "",
    shortFormattedAddress: data.area ?? ""
  });

  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <Pressable accessibilityLabel="Go back" hitSlop={8} onPress={onBack} style={styles.headerIconButton}>
          <Ionicons name="arrow-back" size={20} color={colors.dark.cream} />
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.roomTitle}>{data.restaurantName}</Text>
          <View style={styles.roomSubtitleRow}>
            <Ionicons name="location-outline" size={12} color={colors.dark.muted} />
            <Text numberOfLines={1} style={styles.roomSubtitle}>{locationLabel || "Area not set"}</Text>
          </View>
        </View>
        <Pressable accessibilityLabel="Add participant" hitSlop={8} onPress={onAddPeople} style={styles.headerIconButton}>
          <Ionicons name="person-add-outline" size={19} color={colors.dark.cream} />
        </Pressable>
      </View>

      <ParticipantsPreview
        myUsername={myUsername}
        onPress={() => onChangeMode("people")}
        participants={data.participants}
      />

      <View style={styles.modeTabs}>
        <ModeButton active={mode === "chat"} icon="sparkles-outline" label="Table" onPress={() => onChangeMode("chat")} />
        <ModeButton active={mode === "media"} icon="images-outline" label="Photos" onPress={() => onChangeMode("media")} />
        <ModeButton active={mode === "dishes"} icon="restaurant-outline" label="Dishes" onPress={() => onChangeMode("dishes")} />
        <ModeButton active={mode === "people"} icon="people-outline" label="Friends" onPress={() => onChangeMode("people")} />
      </View>
    </View>
  );
}

function firstNameForDisplay(value: string) {
  return value.trim().split(/\s+/).filter(Boolean)[0] ?? value;
}

function ParticipantsPreview({
  myUsername,
  onPress,
  participants
}: {
  myUsername?: string;
  onPress: () => void;
  participants: MemoryParticipant[];
}) {
  const orderedParticipants = myUsername
    ? [...participants].sort((a, b) => Number(b.username === myUsername) - Number(a.username === myUsername))
    : participants;
  const visible = orderedParticipants.slice(0, 3);
  const remaining = Math.max(0, orderedParticipants.length - visible.length);
  const names = orderedParticipants.map((participant) => (
    participant.username === myUsername ? "You" : firstNameForDisplay(participant.displayName || participant.username)
  ));
  const label = orderedParticipants.length > 0
    ? names.join(", ")
    : "Invite friends";

  return (
    <Pressable onPress={onPress} style={styles.participantsPreview}>
      <View style={styles.avatarStack}>
        {visible.map((participant, index) => (
          <View
            key={participant.id}
            style={[
              styles.participantAvatar,
              {
                backgroundColor: senderAccent(participant.displayName),
                marginLeft: index === 0 ? 0 : -8
              }
            ]}
          >
            <Text style={styles.participantInitial}>{participant.displayName.slice(0, 1).toUpperCase()}</Text>
          </View>
        ))}
        {remaining > 0 ? (
          <View style={[styles.participantAvatar, styles.remainingAvatar, { marginLeft: -8 }]}>
            <Text style={styles.participantInitial}>+{remaining}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.participantSummary}>{label}</Text>
      <Ionicons name="chevron-forward" size={14} color={colors.dark.muted} />
    </Pressable>
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
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Ionicons name={icon} size={16} color={active ? colors.dark.white : colors.dark.muted} />
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ChatTimeline({
  data,
  myUsername,
  onAddDish,
  onAddMedia,
  onAddPeople,
  onBeginSelection,
  onNearBottomChange,
  onOpenMedia,
  onToggleSelection,
  lastReadAt,
  scrollRef,
  selectedItemKeys,
  selectionMode
}: {
  data: MemoryRoom;
  myUsername: string;
  onAddDish: () => void;
  onAddMedia: () => void;
  onAddPeople: () => void;
  onBeginSelection: (target: MemoryActionTarget) => void;
  onNearBottomChange: (isNearBottom: boolean) => void;
  onOpenMedia: OpenMediaHandler;
  onToggleSelection: (target: MemoryActionTarget) => void;
  lastReadAt: string | null;
  scrollRef: React.RefObject<ScrollView | null>;
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

  function handleUnreadDividerLayout(event: LayoutChangeEvent) {
    if (!firstUnreadItemId || didScrollToUnreadRef.current) return;
    didScrollToUnreadRef.current = true;
    const y = Math.max(0, event.nativeEvent.layout.y - 18);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y }));
  }

  return (
    <View style={styles.chatTimelineWrap}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.timelineContent}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
          onNearBottomChange(distanceFromBottom < 96);
        }}
        onContentSizeChange={() => {
          if (!firstUnreadItemId) scrollRef.current?.scrollToEnd({ animated: false });
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={styles.timelineList}
      >
        {timeline.length === 0 ? (
          <View style={styles.emptyChat}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles-outline" size={26} color={colors.dark.orange} />
            </View>
            <Text style={styles.emptyTitle}>Build the table memory</Text>
            <Text style={styles.emptyText}>Start with a photo, a favorite dish, or the friends who were there.</Text>
            <View style={styles.emptyActionRow}>
              <MemoryQuickAction icon="camera-outline" label="Photo" onPress={onAddMedia} />
              <MemoryQuickAction icon="restaurant-outline" label="Dish" onPress={onAddDish} />
              <MemoryQuickAction icon="person-add-outline" label="Invite" onPress={onAddPeople} />
            </View>
          </View>
        ) : (
          timeline.map((item) => (
            <Fragment key={item.id}>
              {item.id === firstUnreadItemId ? (
                <UnreadDivider
                  onJumpToLatest={() => scrollRef.current?.scrollToEnd({ animated: true })}
                  onLayout={handleUnreadDividerLayout}
                />
              ) : null}
              {item.type === "message" ? (
                <MessageBubble
                  message={item.value}
                  mine={item.value.authorName === myUsername}
                  onBeginSelection={() => onBeginSelection({ type: "message", value: item.value })}
                  onOpenMedia={onOpenMedia}
                  onToggleSelection={() => onToggleSelection({ type: "message", value: item.value })}
                  selected={selectedItemKeys.includes(`message:${item.value.id}`)}
                  selectionMode={selectionMode}
                />
              ) : (
                <MediaBubble
                  mine={item.value.uploaderName === myUsername}
                  onBeginSelection={() => onBeginSelection({ type: "photo", value: item.value })}
                  onOpenMedia={onOpenMedia}
                  onToggleSelection={() => onToggleSelection({ type: "photo", value: item.value })}
                  photo={item.value}
                  selected={selectedItemKeys.includes(`photo:${item.value.id}`)}
                  selectionMode={selectionMode}
                  uploaderDisplayName={participantNames.get(item.value.uploaderName) ?? item.value.uploaderName}
                />
              )}
            </Fragment>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function FoodChatWallpaper() {
  return (
    <View pointerEvents="none" style={styles.chatWallpaper}>
      <Svg height="100%" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <Pattern height={196} id="foodChatPattern" patternUnits="userSpaceOnUse" width={196}>
            <Rect fill="#0F0F0E" height={196} width={196} x={0} y={0} />
            <G fill="none" opacity={0.2} stroke="#81786D" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}>
              <G transform="translate(18 21) rotate(-14) scale(0.9)">
                <Path d="M0 18h30c-1 8-6 13-15 13S1 26 0 18z" />
                <Path d="M7 14c4-5 15-5 19 0" />
                <Line x1={10} x2={9} y1={5} y2={15} />
                <Line x1={18} x2={18} y1={3} y2={15} />
                <Line x1={25} x2={27} y1={6} y2={15} />
              </G>

              <G transform="translate(118 14) rotate(18) scale(0.8)">
                <Path d="M0 0l35 12-27 25z" />
                <Circle cx={15} cy={13} r={2} />
                <Circle cx={23} cy={17} r={2} />
                <Path d="M8 8c7 3 14 6 23 8" />
              </G>

              <G transform="translate(61 47) rotate(9) scale(0.72)">
                <Path d="M0 18h30" />
                <Path d="M5 18c0-9 6-16 13-16s13 7 13 16" />
                <Path d="M0 24h31" />
                <Path d="M7 31h18" />
              </G>

              <G transform="translate(139 63) rotate(-9) scale(0.75)">
                <Path d="M6 8h27l-4 28H11z" />
                <Path d="M0 8h39" />
                <Path d="M17 0c3-6 10-6 13 0" />
                <Line x1={23} x2={23} y1={8} y2={36} />
              </G>

              <G transform="translate(25 105) rotate(12) scale(0.8)">
                <Path d="M0 18h26" />
                <Path d="M5 12h16c3 0 5 3 5 6H0c0-3 2-6 5-6z" />
                <Path d="M7 7h12" />
              </G>

              <G transform="translate(108 127) rotate(-17) scale(0.8)">
                <Path d="M5 17c6-8 17-8 23 0" />
                <Path d="M0 17h33c-1 9-7 14-17 14S1 26 0 17z" />
                <Path d="M13 9h9" />
                <Path d="M17 3v11" />
              </G>

              <G transform="translate(150 150) rotate(25) scale(0.64)">
                <Path d="M7 0v25" />
                <Line x1={2} x2={12} y1={2} y2={2} />
                <Line x1={2} x2={12} y1={7} y2={7} />
                <Line x1={2} x2={12} y1={12} y2={12} />
                <Path d="M22 0v25" />
                <Path d="M29 0c-8 6-8 14 0 20" />
              </G>

              <G transform="translate(170 28) rotate(-24) scale(0.61)">
                <Path d="M7 7h24l-5 26H12z" />
                <Path d="M3 7h32" />
                <Path d="M14 33h10" />
                <Path d="M19 33v8" />
                <Path d="M12 17c4 3 10 3 15 0" />
              </G>

              <G transform="translate(168 112) rotate(13) scale(0.62)">
                <Path d="M3 2h22" />
                <Path d="M6 9h16" />
                <Path d="M1 16h26" />
                <Path d="M7 23h14" />
              </G>

              <G transform="translate(28 168) rotate(-11) scale(0.6)">
                <Path d="M0 0l30 11-23 21z" />
                <Circle cx={12} cy={12} r={1.8} />
                <Circle cx={20} cy={15} r={1.6} />
                <Path d="M6 8c7 3 13 5 21 7" />
              </G>

              <G transform="translate(78 12) rotate(28) scale(0.56)">
                <Path d="M0 16h24" />
                <Path d="M5 11h14c3 0 5 2 5 5H0c0-3 2-5 5-5z" />
                <Path d="M7 6h10" />
              </G>

              <G transform="translate(124 170) rotate(-8) scale(0.54)">
                <Path d="M5 16h26" />
                <Path d="M10 10h16c3 0 5 3 5 6H5c0-3 2-6 5-6z" />
                <Path d="M12 5h11" />
              </G>

              <G transform="translate(42 70) rotate(-27) scale(0.56)">
                <Path d="M12 0h10v9l5 6v29H7V15l5-6z" />
                <Path d="M12 9h10" />
                <Path d="M10 25h14" />
                <Path d="M10 34h14" />
              </G>

              <G transform="translate(162 76) rotate(16) scale(0.54)">
                <Path d="M13 0h7v10l5 7v30H8V17l5-7z" />
                <Path d="M10 25c5 3 10 3 15 0" />
                <Circle cx={28} cy={8} r={1.6} />
                <Circle cx={33} cy={2} r={1.2} />
              </G>

              <G transform="translate(98 118) rotate(-22) scale(0.52)">
                <Path d="M0 0l31 10-23 23z" />
                <Circle cx={12} cy={11} r={1.7} />
                <Circle cx={20} cy={15} r={1.5} />
                <Path d="M6 8c7 3 14 5 22 6" />
              </G>

              <G transform="translate(6 132) rotate(18) scale(0.48)">
                <Path d="M13 0h8v9l5 7v28H8V16l5-7z" />
                <Path d="M10 25h14" />
                <Path d="M10 34h14" />
              </G>

              <G transform="translate(112 70) rotate(-33) scale(0.46)">
                <Path d="M0 0l30 10-22 22z" />
                <Circle cx={11} cy={11} r={1.6} />
                <Circle cx={19} cy={14} r={1.4} />
                <Path d="M6 7c6 3 13 5 21 6" />
              </G>

              <G transform="translate(74 170) rotate(13) scale(0.48)">
                <Path d="M2 7h27l-4 27H7z" />
                <Line x1={8} x2={8} y1={0} y2={26} />
                <Line x1={15} x2={15} y1={0} y2={27} />
                <Line x1={22} x2={22} y1={0} y2={26} />
              </G>
            </G>
            <G fill="none" opacity={0.17} stroke="#6F6960" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}>
              <G transform="translate(88 88) rotate(8) scale(0.74)">
                <Path d="M20 7c0 9-5 15-13 15S-6 16-6 7z" />
                <Path d="M-1 2c5-5 13-5 17 0" />
                <Path d="M26 8c6 0 6 9 0 9h-7" />
              </G>

              <G transform="translate(16 154) rotate(-22) scale(0.68)">
                <Path d="M0 0c7 1 12 6 13 13C6 12 1 7 0 0z" />
                <Path d="M29 13c-6-1-10-5-11-11 6 1 10 5 11 11z" />
              </G>

              <G transform="translate(73 152) rotate(14) scale(0.7)">
                <Path d="M0 12c6-6 15-6 21 0" />
                <Path d="M2 18h17" />
                <Path d="M6 5c2-4 8-4 10 0" />
              </G>

              <G transform="translate(125 174) rotate(-31) scale(0.58)">
                <Path d="M0 5c8-6 18-6 26 0" />
                <Path d="M4 13h18" />
                <Path d="M8 1c2-4 8-4 10 0" />
              </G>

              <G transform="translate(172 174) rotate(21) scale(0.64)">
                <Path d="M3 0v22" />
                <Path d="M10 0v22" />
                <Path d="M18 0c5 5 5 13 0 18" />
              </G>

              <G transform="translate(151 84) rotate(-18) scale(0.54)">
                <Path d="M0 11c5-5 13-5 18 0" />
                <Path d="M2 16h14" />
                <Path d="M6 4c2-3 6-3 8 0" />
              </G>

              <G transform="translate(16 25) rotate(19) scale(0.52)">
                <Path d="M0 0c6 1 10 5 11 11C5 10 1 6 0 0z" />
                <Path d="M22 11c-5-1-8-4-9-9 5 1 8 4 9 9z" />
              </G>

              <G transform="translate(62 174) rotate(23) scale(0.5)">
                <Path d="M4 6h25l-4 27H8z" />
                <Line x1={9} x2={9} y1={0} y2={25} />
                <Line x1={16} x2={16} y1={0} y2={26} />
                <Line x1={23} x2={23} y1={0} y2={25} />
              </G>

              <G transform="translate(126 54) rotate(31) scale(0.46)">
                <Path d="M6 5h24l-5 25H11z" />
                <Path d="M2 5h32" />
                <Path d="M17 30v8" />
                <Path d="M10 39h15" />
              </G>

              <G transform="translate(7 80) rotate(-14) scale(0.48)">
                <Path d="M0 16h25" />
                <Path d="M4 11h17c3 0 5 2 5 5H0c0-3 2-5 4-5z" />
                <Path d="M7 6h11" />
              </G>

              <G transform="translate(48 8) rotate(-19) scale(0.44)">
                <Path d="M8 8h20l-4 21H12z" />
                <Path d="M4 8h28" />
                <Path d="M18 29v7" />
                <Path d="M11 36h14" />
              </G>

              <G transform="translate(154 28) rotate(26) scale(0.46)">
                <Path d="M0 15h24" />
                <Path d="M5 10h14c3 0 5 2 5 5H0c0-3 2-5 5-5z" />
                <Path d="M7 5h10" />
              </G>

              <G transform="translate(174 152) rotate(-24) scale(0.46)">
                <Path d="M8 0h8v20" />
                <Path d="M0 20h24" />
                <Path d="M4 27h16" />
              </G>

              <G transform="translate(104 14) rotate(11) scale(0.44)">
                <Path d="M5 16h24" />
                <Path d="M10 10h14c3 0 5 2 5 6H5c0-4 2-6 5-6z" />
                <Path d="M12 5h10" />
              </G>

              <Path d="M52 22l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" />
              <Path d="M164 103l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M184 64l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M92 180l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M18 118l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M142 28l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M88 44l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M172 92l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M116 184l2 3 3 2-3 2-2 3-2-3-3-2 3-2z" />
              <Path d="M108 37c5-1 9 2 11 7-5 1-9-2-11-7z" />
              <Path d="M42 79c-4-1-7-4-8-8 5 1 8 4 8 8z" />
              <Path d="M181 151c5 0 9 3 10 8-5 0-9-3-10-8z" />
              <Path d="M68 181c-4 0-8-3-9-7 5 0 8 3 9 7z" />
              <Path d="M128 137c4-1 8 2 9 6-4 1-8-2-9-6z" />
              <Path d="M31 103c-4-1-7-4-8-8 5 1 8 4 8 8z" />
              <Circle cx={47} cy={133} r={1.6} />
              <Circle cx={121} cy={106} r={1.5} />
              <Circle cx={172} cy={42} r={1.4} />
              <Circle cx={82} cy={24} r={1.4} />
              <Circle cx={30} cy={57} r={1.3} />
              <Circle cx={169} cy={132} r={1.3} />
              <Circle cx={190} cy={87} r={1.4} />
              <Circle cx={146} cy={190} r={1.3} />
              <Circle cx={17} cy={188} r={1.3} />
              <Circle cx={190} cy={12} r={1.3} />
              <Circle cx={116} cy={151} r={1.4} />
              <Circle cx={5} cy={64} r={1.3} />
              <Circle cx={187} cy={5} r={1.3} />
              <Circle cx={58} cy={101} r={1.3} />
              <Circle cx={93} cy={67} r={1.3} />
              <Circle cx={137} cy={106} r={1.3} />
              <Circle cx={27} cy={143} r={1.3} />
              <Circle cx={183} cy={176} r={1.3} />
              <Circle cx={72} cy={31} r={1.3} />
              <Circle cx={101} cy={103} r={1.3} />
              <Circle cx={149} cy={72} r={1.3} />
              <Circle cx={45} cy={188} r={1.3} />
              <Circle cx={160} cy={124} r={1.3} />
              <Circle cx={12} cy={13} r={1.3} />
              <Path d="M74 117h12" />
              <Path d="M80 111v12" />
              <Line x1={137} x2={147} y1={111} y2={121} />
              <Line x1={147} x2={137} y1={111} y2={121} />
              <Line x1={181} x2={191} y1={137} y2={147} />
              <Line x1={191} x2={181} y1={137} y2={147} />
              <Path d="M12 92h10" />
              <Path d="M17 87v10" />
              <Path d="M154 132h9" />
              <Path d="M158 128v9" />
              <Line x1={34} x2={42} y1={165} y2={173} />
              <Line x1={42} x2={34} y1={165} y2={173} />
            </G>
          </Pattern>
        </Defs>
        <Rect fill="#0F0F0E" height="100%" width="100%" x={0} y={0} />
        <Rect fill="url(#foodChatPattern)" height="100%" width="100%" x={0} y={0} />
      </Svg>
      <View style={styles.chatWallpaperOverlay} />
    </View>
  );
}

function UnreadDivider({
  onJumpToLatest,
  onLayout
}: {
  onJumpToLatest: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  return (
    <View onLayout={onLayout} style={styles.unreadDividerRow}>
      <View style={styles.unreadDividerLine} />
      <Text style={styles.unreadDividerText}>New messages</Text>
      <Pressable hitSlop={6} onPress={onJumpToLatest} style={styles.unreadDividerButton}>
        <Text style={styles.unreadDividerButtonText}>Latest</Text>
      </Pressable>
      <View style={styles.unreadDividerLine} />
    </View>
  );
}

function MemoryQuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.quickAction}>
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

function SenderAvatar({ accentColor, name }: { accentColor: string; name: string }) {
  const initials = senderInitials(name);

  return (
    <View style={[styles.senderAvatar, { backgroundColor: accentColor }]}>
      <Text style={styles.senderInitial}>{initials}</Text>
    </View>
  );
}

function ChatMessageRow({
  bubbleStyle,
  children,
  contentStyle,
  inlineTimestamp,
  mine,
  onPress,
  onLongPress,
  rowStyle,
  selected,
  senderName,
  timestamp
}: {
  bubbleStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  inlineTimestamp?: boolean;
  mine: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  rowStyle?: StyleProp<ViewStyle>;
  selected?: boolean;
  senderName: string;
  timestamp: string;
}) {
  const accentColor = senderAccent(senderName);
  const avatar = <SenderAvatar accentColor={accentColor} name={senderName} />;
  const bubbleContent = (
    <>
      <Text numberOfLines={1} style={[styles.senderName, { color: accentColor }]}>{senderName}</Text>
      <View style={[styles.chatBubbleContent, contentStyle]}>
        {children}
      </View>
      {inlineTimestamp ? null : <Text style={styles.bubbleTime}>{timestamp}</Text>}
    </>
  );
  const bubble = (
    <View style={[styles.chatBubble, bubbleStyle]}>
      {bubbleContent}
    </View>
  );

  const rowContent = mine ? (
    <>
      {bubble}
      {avatar}
    </>
  ) : (
    <>
      {avatar}
      {bubble}
    </>
  );
  const resolvedRowStyle = [styles.chatMessageRow, rowStyle, mine && styles.chatMessageRowMine, selected && styles.chatMessageRowSelected];

  if (onLongPress || onPress) {
    return (
      <Pressable delayLongPress={280} onLongPress={onLongPress} onPress={onPress} style={resolvedRowStyle}>
        {rowContent}
      </Pressable>
    );
  }

  return (
    <View style={resolvedRowStyle}>
      {rowContent}
    </View>
  );
}

function MessageBubble({
  message,
  mine,
  onBeginSelection,
  onOpenMedia,
  onToggleSelection,
  selected,
  selectionMode
}: {
  message: MemoryMessage;
  mine: boolean;
  onBeginSelection: () => void;
  onOpenMedia: OpenMediaHandler;
  onToggleSelection: () => void;
  selected: boolean;
  selectionMode: boolean;
}) {
  const body = message.body.trim();
  const hasAttachments = message.attachments.length > 0;
  const timestampLabel = message.deliveryStatus === "pending"
    ? "Sending..."
    : `${formatDisplayTime(message.createdAt)}${message.editedAt ? " · edited" : ""}`;

  return (
    <ChatMessageRow
      bubbleStyle={!body && hasAttachments ? styles.mediaOnlyChatBubble : undefined}
      contentStyle={hasAttachments ? (body ? styles.messageWithMediaContent : styles.mediaBubbleContent) : undefined}
      inlineTimestamp={!hasAttachments}
      mine={mine}
      onLongPress={!selectionMode ? onBeginSelection : undefined}
      onPress={selectionMode ? onToggleSelection : undefined}
      rowStyle={hasAttachments ? styles.chatMessageRowMedia : undefined}
      selected={selected}
      senderName={message.authorDisplayName}
      timestamp={timestampLabel}
    >
      {body ? (
        hasAttachments ? (
            <Text style={styles.bubbleText}>{body}</Text>
        ) : (
          <View style={styles.textMessageLine}>
            <Text style={styles.bubbleText}>{body}</Text>
            <Text style={[styles.inlineBubbleTime, message.deliveryStatus === "pending" && styles.pendingBubbleTime]}>
              {timestampLabel}
            </Text>
          </View>
        )
      ) : null}
      {hasAttachments ? (
        <MediaAttachmentGrid
          hasText={Boolean(body)}
          media={message.attachments}
          onBeginSelection={onBeginSelection}
          onOpenMedia={onOpenMedia}
          selectionMode={selectionMode}
        />
      ) : null}
    </ChatMessageRow>
  );
}

function MediaBubble({
  mine,
  onBeginSelection,
  onOpenMedia,
  onToggleSelection,
  photo,
  selected,
  selectionMode,
  uploaderDisplayName
}: {
  mine: boolean;
  onBeginSelection: () => void;
  onOpenMedia: OpenMediaHandler;
  onToggleSelection: () => void;
  photo: MemoryPhoto;
  selected: boolean;
  selectionMode: boolean;
  uploaderDisplayName: string;
}) {
  const ignoreOpenAfterLongPressRef = useRef(false);
  const ignoreOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMediaLongPress() {
    ignoreOpenAfterLongPressRef.current = true;
    if (ignoreOpenTimeoutRef.current) clearTimeout(ignoreOpenTimeoutRef.current);
    ignoreOpenTimeoutRef.current = setTimeout(() => {
      ignoreOpenAfterLongPressRef.current = false;
    }, 450);
    onBeginSelection();
  }

  function handleOpenMedia() {
    if (ignoreOpenAfterLongPressRef.current) {
      ignoreOpenAfterLongPressRef.current = false;
      if (ignoreOpenTimeoutRef.current) {
        clearTimeout(ignoreOpenTimeoutRef.current);
        ignoreOpenTimeoutRef.current = null;
      }
      return;
    }
    onOpenMedia(photo, [photo]);
  }

  return (
    <ChatMessageRow
      bubbleStyle={styles.mediaOnlyChatBubble}
      contentStyle={styles.mediaBubbleContent}
      mine={mine}
      onLongPress={!selectionMode ? onBeginSelection : undefined}
      onPress={selectionMode ? onToggleSelection : undefined}
      rowStyle={styles.chatMessageRowMedia}
      selected={selected}
      senderName={uploaderDisplayName}
      timestamp={formatDisplayTime(photo.createdAt)}
    >
      <Pressable
        disabled={selectionMode}
        delayLongPress={280}
        onLongPress={!selectionMode ? handleMediaLongPress : undefined}
        onPress={handleOpenMedia}
        style={styles.mediaMessageContent}
      >
        <SingleMediaPreview media={photo} />
      </Pressable>
    </ChatMessageRow>
  );
}

function MediaAttachmentGrid({
  hasText,
  media,
  onBeginSelection,
  onOpenMedia,
  selectionMode
}: {
  hasText?: boolean;
  media: MemoryPhoto[];
  onBeginSelection: () => void;
  onOpenMedia: OpenMediaHandler;
  selectionMode?: boolean;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const ignoreOpenAfterLongPressRef = useRef(false);
  const ignoreOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = media.slice(0, 4);
  const hiddenCount = Math.max(0, media.length - visible.length);
  const gridWidth = getMultiMediaGridWidth(screenWidth);

  function handleMediaLongPress() {
    ignoreOpenAfterLongPressRef.current = true;
    if (ignoreOpenTimeoutRef.current) clearTimeout(ignoreOpenTimeoutRef.current);
    ignoreOpenTimeoutRef.current = setTimeout(() => {
      ignoreOpenAfterLongPressRef.current = false;
    }, 450);
    onBeginSelection();
  }

  function handleOpenMedia(item: MemoryPhoto) {
    if (ignoreOpenAfterLongPressRef.current) {
      ignoreOpenAfterLongPressRef.current = false;
      if (ignoreOpenTimeoutRef.current) {
        clearTimeout(ignoreOpenTimeoutRef.current);
        ignoreOpenTimeoutRef.current = null;
      }
      return;
    }
    onOpenMedia(item, media);
  }

  if (media.length === 1) {
    return (
      <View style={[styles.singleAttachment, hasText && styles.attachmentsAfterText]}>
        <Pressable
          delayLongPress={280}
          disabled={selectionMode}
          onLongPress={!selectionMode ? handleMediaLongPress : undefined}
          onPress={() => handleOpenMedia(media[0])}
          style={styles.mediaMessageContent}
        >
          <SingleMediaPreview media={media[0]} />
        </Pressable>
      </View>
    );
  }

  if (media.length === 2) {
    const tileWidth = (gridWidth - MEDIA_GRID_GAP) / 2;
    const tileSize = { height: Platform.OS === "web" ? 138 : 160, width: tileWidth };

    return (
      <View style={[styles.multiMediaGrid, hasText && styles.attachmentsAfterText, { width: gridWidth }]}>
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
    );
  }

  if (media.length === 3) {
    const gridHeight = Platform.OS === "web" ? 190 : 220;
    const leftWidth = Math.round(gridWidth * 0.62);
    const rightWidth = gridWidth - leftWidth - MEDIA_GRID_GAP;
    const rightTileHeight = (gridHeight - MEDIA_GRID_GAP) / 2;

    return (
      <View style={[styles.multiMediaGrid, hasText && styles.attachmentsAfterText, { height: gridHeight, width: gridWidth }]}>
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
    );
  }

  const tileWidth = (gridWidth - MEDIA_GRID_GAP) / 2;
  const tileHeight = Platform.OS === "web" ? 128 : 150;

  return (
    <View style={[styles.multiMediaGrid, styles.multiMediaGridWrap, hasText && styles.attachmentsAfterText, { width: gridWidth }]}>
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
  );
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
  return (
    <Pressable
      delayLongPress={280}
      disabled={selectionMode}
      onLongPress={!selectionMode ? onLongPress : undefined}
      onPress={onPress}
      style={[styles.mediaGridTile, style]}
    >
      <MediaPreview media={media} style={styles.mediaFill} />
      {hiddenCount > 0 ? (
        <View style={styles.attachmentMoreOverlay}>
          <Text style={styles.attachmentMoreText}>+{hiddenCount}</Text>
        </View>
      ) : null}
    </Pressable>
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
          <Text style={styles.emptyTitle}>No table photos yet</Text>
          <Text style={styles.emptyText}>Photos and videos from everyone at the meal will collect here.</Text>
        </View>
      ) : (
        <View style={styles.galleryGrid}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.galleryItem}>
              <Pressable onPress={() => onOpenMedia(photo, [photo])} style={styles.galleryMediaButton}>
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
    const message = `Join my Table Memory for ${roomName} on CircleBites. We can save the photos, dishes, and notes from this place together.`;
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
  onCamera,
  onClose,
  onGallery,
  pending,
  visible
}: {
  onCamera: () => void;
  onClose: () => void;
  onGallery: () => void;
  pending: boolean;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.attachSheetBackdrop}>
        <Pressable style={styles.attachSheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.attachSheetHandle} />
          <Pressable disabled={pending} onPress={onCamera} style={styles.attachSheetOption}>
            <View style={styles.attachSheetIcon}>
              <Ionicons name="camera-outline" size={20} color={colors.dark.orange} />
            </View>
            <Text style={styles.attachSheetOptionText}>Camera</Text>
          </Pressable>
          <Pressable disabled={pending} onPress={onGallery} style={styles.attachSheetOption}>
            <View style={styles.attachSheetIcon}>
              <Ionicons name="images-outline" size={20} color={colors.dark.orange} />
            </View>
            <Text style={styles.attachSheetOptionText}>Gallery</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.attachSheetCancel}>
            <Text style={styles.attachSheetCancelText}>Cancel</Text>
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
  onCancel,
  onDelete,
  onEdit
}: {
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
    <View style={styles.selectionBarWrap}>
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
            <Ionicons name="create-outline" size={19} color={colors.dark.white} />
          </Pressable>
        ) : null}
        {canDelete ? (
          <Pressable
            accessibilityLabel="Delete selected items"
            disabled={deleting || count === 0}
            onPress={onDelete}
            style={[styles.selectionDeleteButton, (deleting || count === 0) && styles.selectionDeleteButtonDisabled]}
          >
            <Ionicons name={deleting ? "hourglass-outline" : "trash-outline"} size={19} color={colors.dark.white} />
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

        <View style={styles.cameraTopControls}>
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

        <View style={styles.cameraBottomControls}>
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

function SingleMediaPreview({ media }: { media: MemoryPhoto }) {
  const { width: screenWidth } = useWindowDimensions();
  const previewSize = getSingleMediaPreviewSize({
    imageHeight: media.imageHeight,
    imageWidth: media.imageWidth,
    screenWidth
  });

  return (
    <View style={[styles.singleMediaContainer, previewSize]}>
      <MediaPreview media={media} style={styles.singleMediaFill} />
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
  onChangeMessage,
  onInputFocus,
  onSend
}: {
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
  onChangeMessage: (value: string) => void;
  onInputFocus: () => void;
  onSend: () => void;
}) {
  const canSend = Boolean(message.trim()) && !messagePending;

  return (
    <View style={[styles.composerWrap, keyboardOpen && styles.composerWrapKeyboardOpen]}>
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
      <View style={styles.composer}>
        <View style={styles.messageBox}>
          <Pressable accessibilityLabel="Attach photo or video" disabled={Boolean(editingLabel) || mediaPending} onPress={onAttach} style={[styles.attachButton, editingLabel && styles.attachButtonDisabled]}>
            <Ionicons name={mediaPending ? "hourglass-outline" : "add"} size={Platform.OS === "web" ? 19 : 21} color={colors.dark.orange} />
          </Pressable>
          <TextInput
            multiline
            onChangeText={onChangeMessage}
            onFocus={onInputFocus}
            placeholder="Message..."
            placeholderTextColor={colors.dark.muted}
            style={[
              styles.composerInput,
              Platform.OS === "web" ? styles.composerInputWeb : styles.composerInputNative
            ]}
            value={message}
          />
        </View>
        <Pressable accessibilityLabel={editingLabel ? "Save message" : "Send message"} disabled={!canSend} onPress={onSend} style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}>
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
    backgroundColor: "#0F0F0E",
    overflow: "hidden"
  },
  header: {
    alignSelf: "center",
    backgroundColor: colors.dark.bg,
    borderBottomColor: "rgba(255,255,255,0.06)",
    borderBottomWidth: 1,
    borderLeftColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    gap: spacing.sm,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: spacing.base,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
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
  participantsPreview: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 30
  },
  avatarStack: {
    flexDirection: "row"
  },
  participantAvatar: {
    alignItems: "center",
    borderColor: colors.dark.bg,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  remainingAvatar: {
    backgroundColor: colors.dark.surface
  },
  participantInitial: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 11,
    lineHeight: 14
  },
  participantSummary: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16
  },
  modeTabs: {
    backgroundColor: colors.dark.surface,
    borderRadius: radius.input,
    flexDirection: "row",
    padding: 3
  },
  modeButton: {
    alignItems: "center",
    borderRadius: radius.md,
    flex: 1,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    minHeight: 38
  },
  modeButtonActive: {
    backgroundColor: colors.dark.orange
  },
  modeButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11
  },
  modeButtonTextActive: {
    color: colors.dark.white
  },
  body: {
    alignSelf: "center",
    borderLeftColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? colors.dark.border : "transparent",
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
    backgroundColor: "#0F0F0E"
  },
  chatWallpaperOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.02)"
  },
  timelineList: {
    backgroundColor: "transparent",
    flex: 1
  },
  timelineContent: {
    backgroundColor: "transparent",
    gap: CHAT_MESSAGE_GAP,
    paddingTop: spacing.base,
    paddingBottom: 0
  },
  unreadDividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 3,
    width: "100%"
  },
  unreadDividerLine: {
    backgroundColor: "rgba(240,96,48,0.34)",
    flex: 1,
    height: 1
  },
  unreadDividerText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 11,
    lineHeight: 14
  },
  unreadDividerButton: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4
  },
  unreadDividerButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 10,
    lineHeight: 12
  },
  quickAction: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
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
    alignItems: "flex-start",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: Platform.OS === "web" ? spacing.base : spacing.lg,
    width: "100%"
  },
  chatMessageRowMedia: {
    gap: Platform.OS === "web" ? 10 : 8,
    paddingHorizontal: Platform.OS === "web" ? spacing.base : spacing.md
  },
  chatMessageRowMine: {
    justifyContent: "flex-end"
  },
  chatMessageRowSelected: {
    backgroundColor: "rgba(240,96,48,0.16)",
    borderRadius: 0
  },
  chatBubble: {
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 15,
    borderWidth: 1,
    maxWidth: Platform.OS === "web" ? "68%" : "73%",
    minWidth: 112,
    paddingHorizontal: 13,
    paddingVertical: 10
  },
  mediaOnlyChatBubble: {
    backgroundColor: "#120F0D",
    borderColor: "rgba(245,237,216,0.10)",
    maxWidth: Platform.OS === "web" ? "72%" : "88%",
    paddingHorizontal: 13,
    paddingVertical: 10
  },
  chatBubbleContent: {
    minWidth: 0,
    paddingRight: 0
  },
  senderAvatar: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  senderInitial: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 11,
    lineHeight: 14
  },
  senderName: {
    ...fontStyles.extraBold,
    maxWidth: "100%",
    fontSize: 11,
    lineHeight: 14,
    marginBottom: 4
  },
  bubbleText: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20
  },
  textMessageLine: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  inlineBubbleTime: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 12,
    marginBottom: 2,
    textAlign: "right"
  },
  pendingBubbleTime: {
    color: "rgba(245,237,216,0.46)"
  },
  bubbleTime: {
    ...fontStyles.semiBold,
    alignSelf: "flex-end",
    color: colors.dark.muted,
    fontSize: 10,
    lineHeight: 12,
    marginTop: 4,
    minWidth: 58,
    textAlign: "right"
  },
  mediaBubbleContent: {
    marginHorizontal: -13,
    marginBottom: 2,
    marginTop: 4,
    paddingRight: 0
  },
  messageWithMediaContent: {
    marginBottom: 2,
    paddingRight: 0
  },
  singleAttachment: {
    borderRadius: 0,
    overflow: "hidden"
  },
  singleMediaContainer: {
    alignSelf: "flex-start",
    borderRadius: 0,
    overflow: "hidden"
  },
  singleMediaFill: {
    aspectRatio: undefined,
    borderRadius: 0,
    height: "100%",
    width: "100%"
  },
  attachmentsAfterText: {
    marginHorizontal: -13,
    marginTop: 8
  },
  multiMediaGrid: {
    flexDirection: "row",
    gap: MEDIA_GRID_GAP,
    overflow: "hidden"
  },
  multiMediaGridWrap: {
    flexWrap: "wrap"
  },
  mediaGridStack: {
    gap: MEDIA_GRID_GAP
  },
  mediaGridTile: {
    backgroundColor: colors.dark.surface,
    position: "relative",
    overflow: "hidden"
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
    backgroundColor: colors.dark.surface,
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
  attachSheetBackdrop: {
    backgroundColor: "rgba(0,0,0,0.46)",
    flex: 1,
    justifyContent: "flex-end"
  },
  attachSheet: {
    alignSelf: "center",
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.08)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    gap: 4,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: Platform.OS === "web" ? spacing.lg : 30,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    width: "100%"
  },
  attachSheetHandle: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: radius.pill,
    height: 4,
    marginBottom: spacing.sm,
    width: 38
  },
  actionSheetHeader: {
    backgroundColor: "rgba(245,237,216,0.04)",
    borderColor: "rgba(245,237,216,0.08)",
    borderRadius: radius.input,
    borderWidth: 1,
    gap: 3,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 10
  },
  actionSheetTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 18
  },
  actionSheetPreview: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16
  },
  attachSheetOption: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 52
  },
  attachSheetIcon: {
    alignItems: "center",
    backgroundColor: "rgba(240,96,48,0.12)",
    borderRadius: radius.pill,
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
    fontSize: 15,
    lineHeight: 20
  },
  deleteSheetText: {
    color: colors.dark.dangerSoft
  },
  attachSheetCancel: {
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.06)",
    borderTopWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    marginTop: spacing.xs
  },
  attachSheetCancelText: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 14,
    lineHeight: 18
  },
  selectionBarWrap: {
    alignSelf: "center",
    backgroundColor: "transparent",
    borderLeftColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? colors.dark.border : "transparent",
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
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
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
    height: 38,
    justifyContent: "center",
    width: 38
  },
  selectionEditButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38
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
    backgroundColor: colors.dark.surface,
    borderColor: "rgba(255,255,255,0.12)",
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
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
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
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
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
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 1
  },
  peopleSuggestions: {
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
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
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
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
    color: colors.dark.orange,
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
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
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
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
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
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  dishMemorySummary: {
    alignItems: "center",
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
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
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
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
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
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
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
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
    backgroundColor: colors.dark.orangeDim,
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
    borderLeftColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? colors.dark.border : "transparent",
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
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  editingBanner: {
    alignItems: "center",
    backgroundColor: "rgba(245,237,216,0.045)",
    borderColor: "rgba(245,237,216,0.08)",
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
  messageBox: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: Platform.OS === "web" ? 38 : 42,
    paddingHorizontal: 4,
    paddingVertical: 2
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
    alignSelf: "center",
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    includeFontPadding: false,
    maxHeight: Platform.OS === "web" ? 72 : 100,
    paddingHorizontal: 2,
    textAlignVertical: "center"
  },
  composerInputNative: {
    height: 28,
    lineHeight: 20,
    paddingBottom: 0,
    paddingTop: 0
  },
  composerInputWeb: {
    height: 30,
    lineHeight: 18,
    paddingBottom: 6,
    paddingTop: 6
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
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
