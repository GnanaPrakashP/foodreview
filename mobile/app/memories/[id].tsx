import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle
} from "react-native";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryDishMutation,
  useAddMemoryPhotoMutation,
  useMemoryRoomQuery
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
type MemoryCaptureAsset = {
  mimeType?: string | null;
  type?: string | null;
  uri: string;
};

const ROOM_MAX_WIDTH = 640;
const CHAT_ACCENTS = ["#8B6CFF", "#F06030", "#3DD68C", "#E8A830", "#38BDF8", "#F472B6"] as const;

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = params.id ?? "";
  const room = useMemoryRoomQuery(roomId);
  const addParticipant = useAddMemoryParticipantMutation(roomId);
  const addMessage = useAddMemoryMessageMutation(roomId);
  const addDish = useAddMemoryDishMutation(roomId);
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");
  const peopleInputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [mode, setMode] = useState<RoomMode>("chat");
  const [participant, setParticipant] = useState("");
  const [participantSuggestions, setParticipantSuggestions] = useState<UserSearchResult[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<UserSearchResult[]>([]);
  const [dishName, setDishName] = useState("");
  const [dishNote, setDishNote] = useState("");
  const [dishRating, setDishRating] = useState(0);
  const [message, setMessage] = useState("");
  const [mediaError, setMediaError] = useState("");
  const [attachmentOptionsVisible, setAttachmentOptionsVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaViewerState | null>(null);

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
      await addMessage.mutateAsync(message);
      setMessage("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
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
          body={room.error?.message ?? "Memory room not found"}
          buttonLabel="Go back"
          onPress={goBackToMemories}
          title="Could not load memory"
        />
      </Screen>
    );
  }

  const data = room.data;

  return (
    <Screen padded={false} style={styles.screenContent}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined}
        style={styles.keyboard}
      >
        <RoomHeader
          data={data}
          mode={mode}
          onAddPeople={openPeopleAdd}
          onBack={goBackToMemories}
          onChangeMode={setMode}
        />

        <View style={styles.body}>
          {mode === "chat" ? (
            <ChatTimeline data={data} myUsername={myUsername} onOpenMedia={openMediaViewer} scrollRef={scrollRef} />
          ) : mode === "media" ? (
            <MediaGallery
              error={mediaError || addPhoto.error?.message}
              onAddMedia={openAttachmentOptions}
              onOpenMedia={openMediaViewer}
              pending={addPhoto.isPending}
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
              selectedParticipants={selectedParticipants}
            />
          )}
        </View>

        {mode === "chat" ? (
          <Composer
            mediaError={mediaError}
            mediaPending={addPhoto.isPending}
            mediaMutationError={addPhoto.error?.message}
            message={message}
            messageError={addMessage.error?.message}
            messagePending={addMessage.isPending}
            onAttach={openAttachmentOptions}
            onChangeMessage={setMessage}
            onSend={submitMessage}
          />
        ) : null}

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
  onAddPeople,
  onBack,
  onChangeMode
}: {
  data: MemoryRoom;
  mode: RoomMode;
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

      <ParticipantsPreview participants={data.participants} />

      <View style={styles.modeTabs}>
        <ModeButton active={mode === "chat"} icon="chatbubble-ellipses-outline" label="Chat" onPress={() => onChangeMode("chat")} />
        <ModeButton active={mode === "media"} icon="images-outline" label="Media" onPress={() => onChangeMode("media")} />
        <ModeButton active={mode === "dishes"} icon="restaurant-outline" label="Dishes" onPress={() => onChangeMode("dishes")} />
        <ModeButton active={mode === "people"} icon="people-outline" label="People" onPress={() => onChangeMode("people")} />
      </View>
    </View>
  );
}

function ParticipantsPreview({ participants }: { participants: MemoryParticipant[] }) {
  const visible = participants.slice(0, 5);
  const remaining = Math.max(0, participants.length - visible.length);

  return (
    <View style={styles.participantsPreview}>
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
      <Text numberOfLines={1} style={styles.participantSummary}>
        {participants.length} participant{participants.length === 1 ? "" : "s"} · {participants.map((item) => item.displayName).slice(0, 3).join(", ")}
      </Text>
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
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Ionicons name={icon} size={16} color={active ? colors.dark.white : colors.dark.muted} />
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ChatTimeline({
  data,
  myUsername,
  onOpenMedia,
  scrollRef
}: {
  data: MemoryRoom;
  myUsername: string;
  onOpenMedia: OpenMediaHandler;
  scrollRef: React.RefObject<ScrollView | null>;
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

  if (timeline.length === 0) {
    return (
      <View style={styles.emptyChat}>
        <View style={styles.emptyIcon}>
          <Ionicons name="chatbubbles-outline" size={26} color={colors.dark.orange} />
        </View>
        <Text style={styles.emptyTitle}>Start the room</Text>
        <Text style={styles.emptyText}>Send a message, photo, or video to begin this shared food memory.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.timelineContent}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      showsVerticalScrollIndicator={false}
    >
      {timeline.map((item) => (
        item.type === "message" ? (
          <MessageBubble key={item.id} message={item.value} mine={item.value.authorName === myUsername} onOpenMedia={onOpenMedia} />
        ) : (
          <MediaBubble
            key={item.id}
            mine={item.value.uploaderName === myUsername}
            onOpenMedia={onOpenMedia}
            photo={item.value}
            uploaderDisplayName={participantNames.get(item.value.uploaderName) ?? item.value.uploaderName}
          />
        )
      ))}
    </ScrollView>
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

function SenderAvatar({ accentColor, name }: { accentColor: string; name: string }) {
  const initials = senderInitials(name);

  return (
    <View style={[styles.senderAvatar, { backgroundColor: accentColor }]}>
      <Text style={styles.senderInitial}>{initials}</Text>
    </View>
  );
}

function ChatMessageRow({
  children,
  contentStyle,
  mine,
  senderName,
  timestamp
}: {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  mine: boolean;
  senderName: string;
  timestamp: string;
}) {
  const accentColor = senderAccent(senderName);
  const avatar = <SenderAvatar accentColor={accentColor} name={senderName} />;
  const bubble = (
    <View style={styles.chatBubble}>
      <Text numberOfLines={1} style={[styles.senderName, { color: accentColor }]}>{senderName}</Text>
      <View style={[styles.chatBubbleContent, contentStyle]}>
        {children}
      </View>
      <Text style={styles.bubbleTime}>{timestamp}</Text>
    </View>
  );

  return (
    <View style={[styles.chatMessageRow, mine && styles.chatMessageRowMine]}>
      {mine ? (
        <>
          {bubble}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {bubble}
        </>
      )}
    </View>
  );
}

function MessageBubble({
  message,
  mine,
  onOpenMedia
}: {
  message: MemoryMessage;
  mine: boolean;
  onOpenMedia: OpenMediaHandler;
}) {
  const body = message.body.trim();
  const hasAttachments = message.attachments.length > 0;

  return (
    <ChatMessageRow
      contentStyle={hasAttachments ? (body ? styles.messageWithMediaContent : styles.mediaBubbleContent) : undefined}
      mine={mine}
      senderName={message.authorDisplayName}
      timestamp={formatDisplayTime(message.createdAt)}
    >
      {body ? <Text style={styles.bubbleText}>{body}</Text> : null}
      {hasAttachments ? <MediaAttachmentGrid hasText={Boolean(body)} media={message.attachments} onOpenMedia={onOpenMedia} /> : null}
    </ChatMessageRow>
  );
}

function MediaBubble({
  mine,
  onOpenMedia,
  photo,
  uploaderDisplayName
}: {
  mine: boolean;
  onOpenMedia: OpenMediaHandler;
  photo: MemoryPhoto;
  uploaderDisplayName: string;
}) {
  return (
    <ChatMessageRow
      contentStyle={styles.mediaBubbleContent}
      mine={mine}
      senderName={uploaderDisplayName}
      timestamp={formatDisplayTime(photo.createdAt)}
    >
      <Pressable onPress={() => onOpenMedia(photo, [photo])} style={styles.mediaMessageContent}>
        <MediaPreview media={photo} compact />
      </Pressable>
    </ChatMessageRow>
  );
}

function MediaAttachmentGrid({
  hasText,
  media,
  onOpenMedia
}: {
  hasText?: boolean;
  media: MemoryPhoto[];
  onOpenMedia: OpenMediaHandler;
}) {
  const visible = media.slice(0, 4);
  const hiddenCount = Math.max(0, media.length - visible.length);

  if (media.length === 1) {
    return (
      <View style={[styles.singleAttachment, hasText && styles.attachmentsAfterText]}>
        <Pressable onPress={() => onOpenMedia(media[0], media)} style={styles.mediaMessageContent}>
          <MediaPreview media={media[0]} compact />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.attachmentGrid, hasText && styles.attachmentsAfterText]}>
      {visible.map((item, index) => {
        const showHiddenCount = index === visible.length - 1 && hiddenCount > 0;

        return (
          <Pressable key={item.id} onPress={() => onOpenMedia(item, media)} style={styles.attachmentTile}>
            <MediaPreview media={item} />
            {showHiddenCount ? (
              <View style={styles.attachmentMoreOverlay}>
                <Text style={styles.attachmentMoreText}>+{hiddenCount}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function MediaGallery({
  error,
  onAddMedia,
  onOpenMedia,
  pending,
  photos
}: {
  error?: string;
  onAddMedia: () => void;
  onOpenMedia: OpenMediaHandler;
  pending: boolean;
  photos: MemoryPhoto[];
}) {
  return (
    <ScrollView contentContainerStyle={styles.galleryContent} showsVerticalScrollIndicator={false}>
      <View style={styles.panelActionRow}>
        <Pressable disabled={pending} onPress={onAddMedia} style={[styles.panelPrimaryButton, pending && styles.panelPrimaryButtonDisabled]}>
          <Ionicons name={pending ? "hourglass-outline" : "add"} size={17} color={colors.dark.white} />
          <Text style={styles.panelPrimaryButtonText}>{pending ? "Adding" : "Add media"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {photos.length === 0 ? (
        <View style={styles.emptyPanel}>
          <View style={styles.emptyIcon}>
            <Ionicons name="images-outline" size={26} color={colors.dark.orange} />
          </View>
          <Text style={styles.emptyTitle}>No media yet</Text>
          <Text style={styles.emptyText}>Photos and videos added to this room will collect here.</Text>
        </View>
      ) : (
        <View style={styles.galleryGrid}>
          {photos.map((photo) => (
            <View key={photo.id} style={styles.galleryItem}>
              <Pressable onPress={() => onOpenMedia(photo, [photo])} style={styles.galleryMediaButton}>
                <MediaPreview media={photo} />
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

  return (
    <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
      <View style={styles.dishAddWrap}>
        <View style={styles.dishInputWrap}>
          <Ionicons name="restaurant-outline" size={16} color={colors.dark.orange} />
          <TextInput
            onChangeText={onChangeDishName}
            placeholder="Add dish"
            placeholderTextColor={colors.dark.muted}
            style={styles.dishInput}
            value={dishName}
          />
        </View>
        <View style={styles.dishInputWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.dark.muted} />
          <TextInput
            onChangeText={onChangeDishNote}
            placeholder="Note"
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
          <Text style={styles.emptyTitle}>No dishes yet</Text>
          <Text style={styles.emptyText}>Dishes from this memory will collect here once someone adds them.</Text>
        </View>
      ) : (
        dishes.map((dish) => (
          <View key={dish.id} style={styles.dishCard}>
            <View style={[styles.dishIcon, { backgroundColor: senderAccent(dish.dishName) }]}>
              <Ionicons name="restaurant" size={16} color={colors.dark.white} />
            </View>
            <View style={styles.dishText}>
              <View style={styles.dishTitleRow}>
                <Text numberOfLines={1} style={styles.dishName}>{dish.dishName}</Text>
                {dish.rating ? <Text style={styles.dishRating}>{Number(dish.rating).toFixed(1).replace(/\.0$/, "")}/5</Text> : null}
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
  selectedParticipants: UserSearchResult[];
}) {
  const canAdd = selectedParticipants.length > 0 && !addParticipantPending;
  const showSuggestions = participantsLoading || participantSuggestions.length > 0 || participantValue.trim().replace(/^@/, "").length >= 2;

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
    </ScrollView>
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
        await onCapture({ mimeType: "image/jpeg", type: "image", uri: photo.uri });
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

  async function openVideo(media: MemoryPhoto) {
    await Linking.openURL(media.publicUrl);
  }

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
          <Text numberOfLines={1} style={styles.viewerTitle}>
            {activeMedia.uploaderDisplayName} · {formatDisplayDate(activeMedia.createdAt)}
          </Text>
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
                  <View style={styles.viewerVideo}>
                    <View style={styles.playBadge}>
                      <Ionicons name="play" size={22} color={colors.dark.white} />
                    </View>
                    <Text style={styles.viewerVideoTitle}>Video upload</Text>
                    <Pressable onPress={() => openVideo(media)} style={styles.viewerVideoButton}>
                      <Text style={styles.viewerVideoButtonText}>Open video</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Image contentFit="contain" source={{ uri: media.publicUrl }} style={styles.viewerImage} />
                )}
              </View>
            ))}
          </ScrollView>
        </View>
        {items.length > 1 ? (
          <View style={styles.viewerFooter}>
            <Text style={styles.viewerCount}>{safeActiveIndex + 1} / {items.length}</Text>
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

function MediaPreview({ compact, media }: { compact?: boolean; media: MemoryPhoto }) {
  if (media.mediaType === "video") {
    return (
      <View style={[styles.videoPreview, compact && styles.mediaPreviewCompact]}>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={18} color={colors.dark.white} />
        </View>
        <Text style={styles.videoLabel}>Video</Text>
      </View>
    );
  }

  return (
    <Image
      contentFit="cover"
      source={{ uri: media.publicUrl }}
      style={[styles.mediaPreview, compact && styles.mediaPreviewCompact]}
    />
  );
}

function Composer({
  mediaError,
  mediaMutationError,
  mediaPending,
  message,
  messageError,
  messagePending,
  onAttach,
  onChangeMessage,
  onSend
}: {
  mediaError?: string;
  mediaMutationError?: string;
  mediaPending: boolean;
  message: string;
  messageError?: string;
  messagePending: boolean;
  onAttach: () => void;
  onChangeMessage: (value: string) => void;
  onSend: () => void;
}) {
  const canSend = Boolean(message.trim()) && !messagePending;

  return (
    <View style={styles.composerWrap}>
      {messageError || mediaError || mediaMutationError ? (
        <Text style={styles.error}>{messageError || mediaError || mediaMutationError}</Text>
      ) : null}
      <View style={styles.composer}>
        <View style={styles.messageBox}>
          <Pressable accessibilityLabel="Attach photo or video" disabled={mediaPending} onPress={onAttach} style={styles.attachButton}>
            <Ionicons name={mediaPending ? "hourglass-outline" : "add"} size={Platform.OS === "web" ? 19 : 21} color={colors.dark.orange} />
          </Pressable>
          <TextInput
            multiline
            onChangeText={onChangeMessage}
            placeholder="Message..."
            placeholderTextColor={colors.dark.muted}
            style={[
              styles.composerInput,
              Platform.OS === "web" ? styles.composerInputWeb : styles.composerInputNative
            ]}
            value={message}
          />
        </View>
        <Pressable accessibilityLabel="Send message" disabled={!canSend} onPress={onSend} style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}>
          <Ionicons name="send" size={Platform.OS === "web" ? 15 : 17} color={colors.dark.white} />
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
  timelineContent: {
    gap: 11,
    paddingHorizontal: Platform.OS === "web" ? spacing.base : spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.xl
  },
  chatMessageRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    width: "100%"
  },
  chatMessageRowMine: {
    justifyContent: "flex-end"
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
  chatBubbleContent: {
    minWidth: 0,
    paddingRight: 2
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
    fontSize: 14,
    lineHeight: 20
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
    marginBottom: 2,
    marginTop: 4,
    paddingRight: 0
  },
  messageWithMediaContent: {
    marginBottom: 2,
    paddingRight: 0
  },
  singleAttachment: {
    borderRadius: radius.md,
    overflow: "hidden"
  },
  attachmentsAfterText: {
    marginTop: 8
  },
  attachmentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    width: Platform.OS === "web" ? 160 : 190
  },
  attachmentTile: {
    backgroundColor: colors.dark.surface,
    borderRadius: radius.md,
    overflow: "hidden",
    width: Platform.OS === "web" ? 78 : 93
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
    borderRadius: radius.md,
    overflow: "hidden"
  },
  mediaPreview: {
    aspectRatio: 1,
    backgroundColor: colors.dark.surface,
    borderRadius: radius.md,
    width: "100%"
  },
  mediaPreviewCompact: {
    height: Platform.OS === "web" ? 160 : 190,
    width: Platform.OS === "web" ? 160 : 190
  },
  videoPreview: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: colors.dark.black,
    borderRadius: radius.md,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%"
  },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  videoLabel: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.sm,
    opacity: 0.84
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
  attachSheetOptionText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 20
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
  viewerTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    flex: 1,
    fontSize: 13,
    lineHeight: 17
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
    gap: spacing.md
  },
  viewerVideoTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 18,
    lineHeight: 23
  },
  viewerVideoButton: {
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  viewerVideoButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 14
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
  dishAddWrap: {
    backgroundColor: "#181411",
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
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
    borderRadius: radius.md,
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
    backgroundColor: colors.dark.bg,
    borderLeftColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderLeftWidth: Platform.OS === "web" ? 1 : 0,
    borderRightColor: Platform.OS === "web" ? colors.dark.border : "transparent",
    borderRightWidth: Platform.OS === "web" ? 1 : 0,
    gap: 6,
    maxWidth: ROOM_MAX_WIDTH,
    paddingBottom: 30,
    paddingHorizontal: Platform.OS === "web" ? spacing.md : spacing.lg,
    paddingTop: 7,
    width: "100%"
  },
  composer: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
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
