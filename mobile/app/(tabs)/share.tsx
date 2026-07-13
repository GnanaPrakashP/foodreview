import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowLeft, Bookmark, Camera, ChevronRight, Crop, Globe, Heart, Lock, MapPin, MessageCircle, PenLine, Play, Plus, Share2, Star, Store, Tag, UserPlus, Users, Utensils, Volume2, VolumeX, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignedOutFeedState } from "@/components/feeds/PostFeed";
import { CropRectEditor } from "@/components/posts/CropRectEditor";
import { CropRegionImage } from "@/components/posts/CropRegionImage";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCreatePostMutation } from "@/hooks/useCreatePost";
import { useCreateMemoryRoomMutation } from "@/hooks/useMemories";
import { useUserProfileSearch } from "@/hooks/useUserProfileSearch";
import { getOccasionTheme } from "@/features/occasions/occasionThemes";
import type { OccasionType } from "@/features/occasions/occasionTypes";
import { POST_BITE_ASPECT_RATIO } from "@/constants/postCaptureLayout";
import type { MediaCropRect } from "@/services/mediaPipeline";
import { consumePendingPostCaptures, consumePostComposerReset, subscribeToPostCaptures } from "@/services/postCaptureSession";
import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";
import {
  autocompletePlaces,
  compactPlaceLocation,
  createPlacesSessionToken,
  placeDetails,
  selectedPlaceFromSuggestion,
  type PlaceSuggestion,
  type SelectedPlace
} from "@/services/places";
import {
  confirmDishAlias,
  findDishDidYouMean,
  normalizeDishNameForMatch,
  searchDishNameSuggestions,
  type DishDidYouMean,
  type DishNameSuggestion
} from "@/services/dishSuggestions";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useComposerStore } from "@/stores/composerStore";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import type { FoodItem, Visibility } from "@/types/models";
import { clearActivePostDraft, loadActivePostDraft, saveActivePostDraft } from "@/services/postDraftStore";

type ThemeColors = ReturnType<typeof themeColorsFor>;

function useShareTheme() {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return { themeColors, styles };
}

type PickedMedia = {
  // Non-destructive framing (relative 0..1); null shows/derives the default
  // center 4:5. Editable per item from the review step.
  cropRect?: MediaCropRect | null;
  // Screen-visible region at capture time; framing can't reach outside it.
  visibleRect?: MediaCropRect | null;
  duration?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mediaType: "image" | "video";
  mimeType?: string | null;
  muted?: boolean;
  uri: string;
  width?: number | null;
};

type DraftDish = FoodItem & {
  key: string;
};

type ReviewTag = {
  label: string;
};

type ShareMode = "choice" | "solo" | "friends";
type SoloStep = "review" | "details" | "preview";

const MAX_POST_MEDIA = 4;
// Matches the camera's recording cap and the API's duration limit.
const MAX_POST_VIDEO_MS = 30_000;

const DEFAULT_MEMORY_OCCASION_TITLE = "Occasion";
const DEFAULT_MEMORY_OCCASION_TYPE: OccasionType = "casual";

const tagOptions: ReviewTag[] = [
  { label: "Hidden gem" },
  { label: "Worth the hype" },
  { label: "Must try" },
  { label: "Budget friendly" },
  { label: "Big portions" },
  { label: "Spicy" },
  { label: "Sweet tooth" },
  { label: "Comfort food" }
];

const visibilityOptions: Array<{
  Icon: typeof Globe;
  label: string;
  sub: string;
  value: Visibility;
}> = [
  { Icon: Globe, label: "Public", sub: "Everyone", value: "public" },
  { Icon: Users, label: "Circle", sub: "Your friends", value: "circle" },
  { Icon: Lock, label: "Just me", sub: "Private log", value: "me" }
];

function emptyDish(): DraftDish {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "",
    rating: 0
  };
}

function splitUsernames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectedPlaceMatches(value: string, place: SelectedPlace | null) {
  return Boolean(place?.placeId && place.name.trim().toLowerCase() === value.trim().toLowerCase());
}

function initialsForUser(displayName: string, username: string) {
  const parts = (displayName || username).split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? username[0] ?? "?"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

export default function ShareScreen() {
  const { themeColors: c, styles } = useShareTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const actor = useSessionStore((state) => state.profile);
  const createPost = useCreatePostMutation();
  const createMemoryRoom = useCreateMemoryRoomMutation();
  const [shareMode, setShareMode] = useState<ShareMode>("choice");
  const [soloStep, setSoloStep] = useState<SoloStep>("review");
  const [mediaItems, setMediaItems] = useState<PickedMedia[]>([]);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);
  // The item whose framing is being edited in the crop overlay. For videos,
  // uri is a first-frame still (same dimensions as the video), since the
  // editor renders images; the resulting rect applies to the video.
  const [cropEdit, setCropEdit] = useState<{ index: number; uri: string } | null>(null);

  async function openCropEditor(index: number) {
    const media = mediaItemsRef.current[index];
    if (!media) return;
    if (media.mediaType === "image") {
      setCropEdit({ index, uri: media.uri });
      return;
    }
    try {
      const still = await VideoThumbnails.getThumbnailAsync(media.uri, { time: 0 });
      setCropEdit({ index, uri: still.uri });
    } catch {
      setImageError("Could not open video framing. Try again.");
    }
  }
  const [imageError, setImageError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const mediaItemsRef = useRef(mediaItems);
  mediaItemsRef.current = mediaItems;
  const { width: windowWidth } = useWindowDimensions();
  const reviewPagerRef = useRef<ScrollView>(null);
  const [pagerWidth, setPagerWidth] = useState(windowWidth);
  const [previewMediaIndex, setPreviewMediaIndex] = useState(0);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantPlace, setRestaurantPlace] = useState<SelectedPlace | null>(null);
  const [dishes, setDishes] = useState<DraftDish[]>(() => [emptyDish()]);
  const [caption, setCaption] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const draftHydratedRef = useRef(false);
  const [success, setSuccess] = useState("");
  const [memoryOccasionTitle, setMemoryOccasionTitle] = useState("");
  const [memoryParticipants, setMemoryParticipants] = useState("");
  const [memoryParticipantInput, setMemoryParticipantInput] = useState("");
  const [memoryFriendFocused, setMemoryFriendFocused] = useState(false);
  // Keep the two choice cards aligned after removing their image-backed art.
  const [choiceCardHeight, setChoiceCardHeight] = useState<number>();
  const measureChoiceCard = useCallback((height: number) => {
    setChoiceCardHeight((current) => (current && current >= height ? current : Math.ceil(height)));
  }, []);

  const firstDish = dishes.find((dish) => dish.name.trim()) ?? dishes[0];
  const memoryParticipantNames = useMemo(() => splitUsernames(memoryParticipants), [memoryParticipants]);
  const memoryFriendExcludedUsernames = useMemo(() => ([
    ...memoryParticipantNames,
    actor?.username ?? ""
  ].filter(Boolean)), [actor?.username, memoryParticipantNames]);
  const memoryFriendSearch = useUserProfileSearch({
    enabled: shareMode === "friends" && memoryFriendFocused,
    excludedUsernames: memoryFriendExcludedUsernames,
    limit: 8,
    query: memoryParticipantInput
  });
  const hasSelectedRestaurant = selectedPlaceMatches(restaurantName, restaurantPlace);
  const hasSoloDetails = Boolean(hasSelectedRestaurant && dishes.some((dish) => dish.name.trim() && dish.rating > 0));
  const canAddMoreMedia = mediaItems.length < MAX_POST_MEDIA;
  const canSubmit = Boolean(mediaItems.length > 0 && hasSoloDetails);
  const soloHeaderActionLabel = soloStep === "preview" ? "Post" : "Next";
  const uploadPercent = uploadProgress === null ? null : Math.max(0, Math.min(100, Math.round(uploadProgress * 100)));
  const postSubmitLabel = createPost.isPending
    ? uploadPercent === null
      ? "Posting..."
      : `Posting ${uploadPercent}%`
    : soloHeaderActionLabel;
  const soloHeaderActionDisabled = soloStep === "review"
    ? mediaItems.length === 0
    : soloStep === "details"
      ? !hasSoloDetails
      : !canSubmit || createPost.isPending;
  const canCreateMemory = Boolean(memoryParticipantNames.length > 0);
  const previewAuthorName = actor?.displayName || actor?.username || "You";
  const previewInitials = previewAuthorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "Y";
  const previewTags = selectedTags;
  const previewLocation = compactPlaceLocation(restaurantPlace);
  const setComposing = useComposerStore((state) => state.setComposing);
  // The tab bar is hidden for the entire Post-a-Bite flow — any solo step,
  // with or without media (error and empty states included) — until the
  // post is made or the flow is abandoned.
  const composing = Boolean(isReady && isAuthenticated && shareMode === "solo");
  useEffect(() => {
    setComposing(composing);
    return () => setComposing(false);
  }, [composing, setComposing]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !actor?.userId || draftHydratedRef.current) return;
    try {
      const draft = loadActivePostDraft();
      if (draft) {
        setCaption(draft.caption);
        setDishes(draft.dishes);
        setMediaItems(draft.mediaItems);
        setRestaurantName(draft.restaurantName);
        setRestaurantPlace(draft.restaurantPlace);
        setSelectedTags(draft.selectedTags);
        setSoloStep(draft.soloStep);
        setVisibility(draft.visibility);
        setShareMode("solo");
      }
      draftHydratedRef.current = true;
    } catch {
      // AccountSessionBoundary may still be installing the owner marker. A
      // later mount/focus retries; never hydrate a draft without owner proof.
    }
  }, [actor?.userId, isAuthenticated, isReady]);

  useEffect(() => {
    if (!draftHydratedRef.current || !isAuthenticated || shareMode !== "solo" || mediaItems.length === 0) return;
    const timeout = setTimeout(() => {
      try {
        saveActivePostDraft({
          caption,
          dishes,
          mediaItems,
          restaurantName,
          restaurantPlace,
          selectedTags,
          soloStep,
          visibility
        });
      } catch {
        // Draft persistence must not interrupt composing or uploading.
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [caption, dishes, isAuthenticated, mediaItems, restaurantName, restaurantPlace, selectedTags, shareMode, soloStep, visibility]);

  function cancelShareMode() {
    try { clearActivePostDraft(); } catch {}
    setShareMode("choice");
    setSoloStep("review");
    setMediaItems([]);
    setImageError("");
    setUploadProgress(null);
  }

  function openSolo() {
    setSoloStep("review");
    setImageError("");
    setSuccess("");
    setUploadProgress(null);
    router.push("/share/camera");
  }

  // remaining tells the camera how many gallery items may still be picked.
  function openCameraForMore() {
    setImageError("");
    router.push({
      pathname: "/share/camera",
      params: { remaining: String(Math.max(1, MAX_POST_MEDIA - mediaItemsRef.current.length)) }
    });
  }

  function addMorePhotos() {
    if (!canAddMoreMedia) return;
    openCameraForMore();
  }

  function removeMediaAt(index: number) {
    const next = mediaItemsRef.current.filter((_, position) => position !== index);
    // Removing the last item mid-flow reopens the camera to reshoot instead
    // of stranding the user on an empty review screen. No state changes here:
    // any mutation renders under the camera's push transition and flashes the
    // empty review UI. The stale item stays mounted out of sight until the
    // next capture replaces it (or the camera closes without one).
    if (next.length === 0 && shareMode === "solo" && soloStep === "review") {
      retakePendingRef.current = true;
      // The next capture replaces everything, so all slots are free.
      router.push({ pathname: "/share/camera", params: { remaining: String(MAX_POST_MEDIA) } });
      return;
    }
    setMediaItems(next);
  }

  function toggleMuteAt(index: number) {
    setMediaItems((current) => current.map((media, position) =>
      position === index && media.mediaType === "video"
        ? { ...media, muted: !media.muted }
        : media
    ));
  }

  const appendCapturedPostMedia = useCallback((capturedList: PickedMedia[]) => {
    if (capturedList.length === 0) return;
    const pickedList: PickedMedia[] = capturedList.map((captured) => ({
      cropRect: captured.cropRect ?? null,
      visibleRect: captured.visibleRect ?? null,
      duration: captured.duration ?? null,
      fileSize: captured.fileSize ?? null,
      height: captured.height ?? null,
      mediaType: captured.mediaType,
      mimeType: captured.mimeType ?? null,
      uri: captured.uri,
      width: captured.width ?? null
    }));
    // A pending retake means the last item was "deleted" but kept mounted
    // while the camera was up (see removeMediaAt) — replace instead of append.
    const base = retakePendingRef.current ? [] : mediaItemsRef.current;
    retakePendingRef.current = false;
    const next = [...base, ...pickedList].slice(0, MAX_POST_MEDIA);
    setMediaItems(next);
    setSelectedMediaIndex(next.length - 1);
    setShareMode("solo");
    setSoloStep("review");
    setImageError("");
  }, []);

  const receiveCapturedPostMedia = useCallback((capturedItems: MemoryCapturedMediaInput[]) => {
    setUploadProgress(null);
    // The API rejects longer clips; gallery picks can exceed the camera's cap.
    const isTooLong = (item: MemoryCapturedMediaInput) =>
      item.mediaType === "video" && (item.duration ?? 0) > MAX_POST_VIDEO_MS + 500;
    const usable = capturedItems.filter((item) => !isTooLong(item));
    appendCapturedPostMedia(usable.map((captured) => ({
      cropRect: captured.cropRect ?? null,
      visibleRect: captured.visibleRect ?? null,
      duration: captured.duration ?? null,
      fileSize: captured.fileSize ?? null,
      height: captured.height ?? null,
      mediaType: captured.mediaType,
      mimeType: captured.mimeType ?? null,
      uri: captured.uri,
      width: captured.width ?? null
    })));
    if (usable.length < capturedItems.length) {
      setShareMode("solo");
      setSoloStep("review");
      setImageError(`Videos must be ${MAX_POST_VIDEO_MS / 1000} seconds or less.`);
    }
  }, [appendCapturedPostMedia]);

  // Captures are pushed here while the camera/crop screen still covers this
  // tab, so the review tree swap commits before that screen dismisses (see
  // postCaptureSession for the Fabric mounting race this avoids).
  useEffect(() => subscribeToPostCaptures(receiveCapturedPostMedia), [receiveCapturedPostMedia]);

  // Set when the last media item is removed: its state clear is deferred so
  // nothing re-renders in view during the camera push (see removeMediaAt).
  const retakePendingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const captured = consumePendingPostCaptures();
      if (captured.length > 0) {
        receiveCapturedPostMedia(captured);
        return;
      }
      // The camera's X abandons the whole post — reset to the Create tab.
      if (consumePostComposerReset()) {
        retakePendingRef.current = false;
        cancelShareMode();
        return;
      }
      // Back from the camera without capturing after a last-item removal:
      // finish the deferred delete now, landing on the empty review exit.
      if (retakePendingRef.current) {
        retakePendingRef.current = false;
        setMediaItems([]);
      }
    }, [receiveCapturedPostMedia])
  );

  // Keep the large preview's selection in range as media is added or removed.
  useEffect(() => {
    setSelectedMediaIndex((index) => Math.min(index, Math.max(0, mediaItems.length - 1)));
  }, [mediaItems.length]);

  // Tapping a thumbnail (or adding media) snaps the swipe pager to that page.
  useEffect(() => {
    reviewPagerRef.current?.scrollTo({ x: selectedMediaIndex * pagerWidth, animated: true });
  }, [selectedMediaIndex, pagerWidth]);

  function handlePagerScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (pagerWidth <= 0) return;
    const index = Math.round(event.nativeEvent.contentOffset.x / pagerWidth);
    if (index !== selectedMediaIndex) setSelectedMediaIndex(index);
  }

  function handlePreviewScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (windowWidth <= 0) return;
    const index = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
    if (index !== previewMediaIndex) setPreviewMediaIndex(index);
  }

  function handleSoloHeaderAction() {
    if (soloStep === "review") {
      setSoloStep("details");
      return;
    }
    if (soloStep === "details") {
      setPreviewMediaIndex(0);
      setSoloStep("preview");
      return;
    }

    void submit();
  }

  function handleSoloBackAction() {
    if (soloStep === "preview") {
      setSoloStep("details");
      return;
    }
    if (soloStep === "details") {
      setSoloStep("review");
      return;
    }
    cancelShareMode();
  }

  function updateDish(key: string, nextDish: Partial<FoodItem>) {
    setDishes((current) => current.map((dish) => (
      dish.key === key ? { ...dish, ...nextDish } : dish
    )));
  }

  function removeDish(key: string) {
    setDishes((current) => current.length > 1 ? current.filter((dish) => dish.key !== key) : current);
  }

  function addTag(raw: string) {
    const normalized = raw.trim().replace(/^#/, "");
    if (!normalized) return;
    setSelectedTags((current) => {
      const exists = current.some((tag) => tag.toLowerCase() === normalized.toLowerCase());
      if (exists) return current;
      if (current.length >= 5) return current;
      return [...current, normalized];
    });
  }

  function removeTag(tag: string) {
    setSelectedTags((current) => current.filter((item) => item !== tag));
  }

  function addCustomTag() {
    addTag(customTag);
    setCustomTag("");
  }

  function addMemoryParticipant(raw = memoryParticipantInput) {
    const normalized = raw.trim().replace(/^@/, "").toLowerCase();
    if (!normalized) return;
    const current = splitUsernames(memoryParticipants);
    if (current.some((name) => name.toLowerCase() === normalized)) {
      setMemoryParticipantInput("");
      setMemoryFriendFocused(false);
      return;
    }
    setMemoryParticipants([...current, normalized].join(", "));
    setMemoryParticipantInput("");
    setMemoryFriendFocused(false);
  }

  function removeMemoryParticipant(username: string) {
    setMemoryParticipants(
      splitUsernames(memoryParticipants)
        .filter((name) => name.toLowerCase() !== username.toLowerCase())
        .join(", ")
    );
  }

  async function submit() {
    setSuccess("");
    setUploadProgress(null);
    if (mediaItems.length === 0) {
      setImageError("Add a photo or video.");
      return;
    }

    try {
      setUploadProgress(0);
      const normalizedDishes = dishes
        .map((dish) => ({ name: dish.name.trim(), rating: dish.rating }))
        .filter((dish) => dish.name);

      await createPost.mutateAsync({
        caption,
        dishes: normalizedDishes,
        dishName: firstDish?.name ?? "",
        mediaItems: mediaItems.map((media) => ({
          cropRect: media.cropRect,
          durationMs: media.duration,
          fileSize: media.fileSize,
          height: media.height,
          mediaType: media.mediaType,
          mimeType: media.mimeType,
          muted: media.muted,
          uri: media.uri,
          width: media.width
        })),
        onUploadProgress: setUploadProgress,
        rating: firstDish?.rating || 0,
        recommended: true,
        restaurantAddress: restaurantPlace?.formattedAddress,
        restaurantArea: restaurantPlace?.shortFormattedAddress,
        restaurantId: restaurantPlace?.placeId,
        restaurantLat: restaurantPlace?.latitude,
        restaurantLng: restaurantPlace?.longitude,
        restaurantName: restaurantPlace?.name ?? restaurantName,
        restaurantPrimaryType: restaurantPlace?.primaryType,
        restaurantTypes: restaurantPlace?.types,
        tags: selectedTags,
        visibility
      });
      try { clearActivePostDraft(); } catch {}
      setMediaItems([]);
      setRestaurantName("");
      setRestaurantPlace(null);
      setDishes([emptyDish()]);
      setCaption("");
      setCustomTag("");
      setSelectedTags([]);
      setVisibility("public");
      // Posting ends the flow: back to the Create screen (tab bar returns),
      // where the success banner is shown.
      setShareMode("choice");
      setSoloStep("review");
      setSuccess("Post shared. Your feeds and profile are refreshing.");
      setUploadProgress(null);
    } catch {
      setUploadProgress(null);
      // Mutation error is rendered below.
    }
  }

  async function submitMemoryRoom() {
    setSuccess("");
    try {
      const result = await createMemoryRoom.mutateAsync({
        participantUsernames: splitUsernames(memoryParticipants),
        occasion: memoryOccasionTitle.trim() || DEFAULT_MEMORY_OCCASION_TITLE,
        occasionConfidence: 1,
        occasionConfirmedByUser: true,
        occasionType: DEFAULT_MEMORY_OCCASION_TYPE,
        restaurantName: "Table Memory",
        themeKey: getOccasionTheme(DEFAULT_MEMORY_OCCASION_TYPE).id
      });
      setMemoryOccasionTitle("");
      setMemoryParticipants("");
      setMemoryParticipantInput("");
      router.push({ pathname: "/memories/[id]", params: { id: result.id } });
    } catch {
      // Mutation error is rendered below.
    }
  }

  if (isReady && isAuthenticated && shareMode === "solo" && soloStep === "review") {
    return (
      <Screen padded={false} style={styles.screenContent}>
        <View style={styles.reviewScreen}>
          <View collapsable={false} style={styles.reviewHeaderRow}>
            {mediaItems.length > 0 ? (
              <Pressable accessibilityLabel="Back to camera" onPress={openCameraForMore} style={styles.headerCancelButton}>
                <ArrowLeft size={20} color={c.cream} strokeWidth={2.4} />
              </Pressable>
            ) : (
              <Pressable accessibilityLabel="Cancel share" onPress={cancelShareMode} style={styles.headerCancelButton}>
                <X size={20} color={c.cream} strokeWidth={2.4} />
              </Pressable>
            )}
            <Pressable
              disabled={soloHeaderActionDisabled}
              onPress={handleSoloHeaderAction}
              style={[styles.headerSubmitButton, soloHeaderActionDisabled && styles.submitButtonDisabled]}
            >
              <Text style={styles.headerSubmitText}>{soloHeaderActionLabel}</Text>
            </Pressable>
          </View>

          <View
            style={styles.reviewMain}
            onLayout={(event) => setPagerWidth(event.nativeEvent.layout.width)}
          >
            {mediaItems.length > 0 ? (
              <ScrollView
                ref={reviewPagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={handlePagerScrollEnd}
                style={StyleSheet.absoluteFill}
              >
                {mediaItems.map((media, index) => (
                  <View key={`${media.uri}-${index}`} style={{ width: pagerWidth, height: "100%", justifyContent: "center" }}>
                    {media.mediaType === "video" ? (
                      // Videos review in the same 4:5 crop the feed shows.
                      // Tapping the video toggles playback, so framing gets
                      // its own explicit badge button instead.
                      <View style={styles.reviewCropPressable}>
                        <SelectedPostVideo
                          active={index === selectedMediaIndex}
                          cropRect={media.cropRect}
                          muted={media.muted}
                          onToggleMute={() => toggleMuteAt(index)}
                          sourceHeight={media.height}
                          sourceWidth={media.width}
                          style={{ height: pagerWidth / POST_BITE_ASPECT_RATIO, width: pagerWidth }}
                          uri={media.uri}
                        />
                        {/* Top corner: the mute/time controls own the bottom edge. */}
                        <Pressable
                          accessibilityLabel="Adjust video framing"
                          onPress={() => void openCropEditor(index)}
                          style={styles.cropHintBadgeTop}
                        >
                          <Crop size={13} color="#fff" strokeWidth={2.2} />
                          <Text style={styles.cropHintText}>Adjust</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityLabel="Adjust photo framing"
                        onPress={() => void openCropEditor(index)}
                        style={styles.reviewCropPressable}
                      >
                        <CropRegionImage
                          boxHeight={pagerWidth / POST_BITE_ASPECT_RATIO}
                          boxWidth={pagerWidth}
                          cropRect={media.cropRect}
                          sourceHeight={media.height}
                          sourceWidth={media.width}
                          uri={media.uri}
                        />
                        <View pointerEvents="none" style={styles.cropHintBadgeTop}>
                          <Crop size={13} color="#fff" strokeWidth={2.2} />
                          <Text style={styles.cropHintText}>Adjust</Text>
                        </View>
                      </Pressable>
                    )}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.reviewEmptyText}>No photos yet</Text>
            )}
          </View>

          {imageError ? <View style={styles.reviewErrorWrap}><InlineError message={imageError} /></View> : null}

          <View style={[styles.reviewBottomBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            <ScrollView contentContainerStyle={styles.reviewStripContent} horizontal showsHorizontalScrollIndicator={false}>
              {mediaItems.map((media, index) => {
                const active = index === selectedMediaIndex;
                return (
                  <Pressable
                    key={`${media.uri}-${index}`}
                    onPress={() => setSelectedMediaIndex(index)}
                    style={[styles.reviewThumb, active && styles.reviewThumbActive]}
                  >
                    {media.mediaType === "video" ? (
                      <VideoThumbnail uri={media.uri} />
                    ) : (
                      <Image alt="Thumbnail" contentFit="cover" source={{ uri: media.uri }} style={styles.reviewThumbMedia} />
                    )}
                    <Pressable accessibilityLabel="Remove photo" hitSlop={6} onPress={() => removeMediaAt(index)} style={styles.reviewThumbRemove}>
                      <X size={11} color="#fff" strokeWidth={3} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </ScrollView>
            {canAddMoreMedia ? (
              <Pressable accessibilityLabel="Add more photos" onPress={addMorePhotos} style={styles.reviewAddButton}>
                <Plus size={26} color={c.gold} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </View>

          {cropEdit !== null && mediaItems[cropEdit.index] ? (
            <CropRectEditor
              boundsRect={mediaItems[cropEdit.index].visibleRect}
              initialCropRect={mediaItems[cropEdit.index].cropRect}
              onCancel={() => setCropEdit(null)}
              onConfirm={(rect) => {
                setMediaItems((current) => current.map((media, position) => (
                  position === cropEdit.index ? { ...media, cropRect: rect } : media
                )));
                setCropEdit(null);
              }}
              sourceHeight={mediaItems[cropEdit.index].height}
              sourceWidth={mediaItems[cropEdit.index].width}
              uri={cropEdit.uri}
              videoUri={mediaItems[cropEdit.index].mediaType === "video" ? mediaItems[cropEdit.index].uri : null}
            />
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} style={styles.screenContent}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: spacing.xl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View collapsable={false} style={styles.header}>
          {isReady && isAuthenticated && shareMode !== "choice" ? (
            <Pressable
              accessibilityLabel={shareMode === "solo" && soloStep !== "review" ? "Back" : "Cancel share"}
              onPress={shareMode === "solo" ? handleSoloBackAction : cancelShareMode}
              style={styles.headerCancelButton}
            >
              {shareMode === "solo" && soloStep !== "review" ? (
                <ArrowLeft size={20} color={c.cream} strokeWidth={2.4} />
              ) : (
                <X size={20} color={c.cream} strokeWidth={2.4} />
              )}
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            {shareMode === "friends" ? (
              <Text style={styles.title}>Table Memory</Text>
            ) : shareMode === "solo" ? (
              soloStep === "preview" ? <Text style={styles.title}>Preview</Text> : null
            ) : (
              <Text style={styles.title}>Create</Text>
            )}
          </View>
          {isReady && isAuthenticated && shareMode === "solo" ? (
            <Pressable
              disabled={soloHeaderActionDisabled}
              onPress={handleSoloHeaderAction}
              style={[styles.headerSubmitButton, soloHeaderActionDisabled && styles.submitButtonDisabled]}
            >
              <Text style={styles.headerSubmitText}>{postSubmitLabel}</Text>
            </Pressable>
          ) : null}
          {isReady && isAuthenticated && shareMode === "friends" ? (
            <Pressable
              disabled={!canCreateMemory || createMemoryRoom.isPending}
              onPress={submitMemoryRoom}
              style={[styles.headerSubmitButton, (!canCreateMemory || createMemoryRoom.isPending) && styles.submitButtonDisabled]}
            >
              <Text style={styles.headerSubmitText}>{createMemoryRoom.isPending ? "Creating..." : "Create"}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.stack}>
          {!isReady ? (
            <LoadingState message="Restoring your session." title="Loading" />
          ) : !isAuthenticated ? (
            <SignedOutFeedState message="Sign in to share a real food post." />
          ) : shareMode === "choice" ? (
            <View collapsable={false} style={styles.choiceStack}>
              {success ? (
                <View style={styles.successBanner}>
                  <Text style={styles.successTitle}>Shared</Text>
                  <Text style={styles.successText}>{success}</Text>
                </View>
              ) : null}
              <ActionCard
                Icon={PenLine}
                accent="orange"
                cardHeight={choiceCardHeight}
                cta="Capture Dish"
                CtaIcon={Camera}
                description="Share your dining experience and help others decide what's worth trying."
                onMeasureHeight={measureChoiceCard}
                onPress={openSolo}
                tags={["Photo", "Dish", "How was it?"]}
                title="Dining Experience"
              />
              <ActionCard
                Icon={Users}
                accent="memory"
                cardHeight={choiceCardHeight}
                cta="Create Memory"
                CtaIcon={UserPlus}
                description="A private room with friends for every stop, dish, and memory from the occasion."
                onMeasureHeight={measureChoiceCard}
                onPress={() => setShareMode("friends")}
                tags={["Private", "Friends", "Dishes"]}
                title="Table Memory"
              />
            </View>
          ) : (
            <>
              {shareMode === "solo" ? (
                <>
                  {soloStep === "details" ? (
                    <View style={styles.attachmentStack}>
                      <PlaceField
                        onChangeText={setRestaurantName}
                        onSelect={setRestaurantPlace}
                        placeholder="Place name"
                        selectedPlace={restaurantPlace}
                        value={restaurantName}
                      />

                      <View style={styles.captionRow}>
                        <TextInput
                          multiline
                          onChangeText={setCaption}
                          placeholder="Write something about the restaurant?"
                          placeholderTextColor={c.muted}
                          style={styles.captionInput}
                          textAlignVertical="top"
                          value={caption}
                        />
                      </View>

                      <View style={styles.dishStack}>
                        {dishes.map((dish) => (
                          <DishRow
                            key={dish.key}
                            dish={dish}
                            onChange={(nextDish) => updateDish(dish.key, nextDish)}
                            onRemove={() => removeDish(dish.key)}
                            showRemove={dishes.length > 1}
                          />
                        ))}
                      </View>
                      <Pressable onPress={() => setDishes((current) => [...current, emptyDish()])} style={styles.addDishButton}>
                        <Plus size={14} color={c.gold} strokeWidth={2.4} />
                        <Text style={styles.addDishText}>Add another dish</Text>
                      </Pressable>

                      {imageError ? <InlineError message={imageError} /> : null}

                      <View style={styles.tagGrid}>
                        <View style={styles.customTagRow}>
                          <Tag size={20} color={c.orange} strokeWidth={2} />
                          <TextInput
                            autoCapitalize="none"
                            editable={selectedTags.length < 5}
                            onChangeText={setCustomTag}
                            onSubmitEditing={addCustomTag}
                            placeholder={selectedTags.length >= 5 ? "Max 5 tags reached" : "Add your own tag"}
                            placeholderTextColor={c.muted}
                            returnKeyType="done"
                            style={styles.customTagInput}
                            value={customTag}
                          />
                          {selectedTags.length > 0 ? <Text style={styles.tagCount}>{selectedTags.length}/5</Text> : null}
                        </View>

                        {selectedTags.length > 0 ? (
                          <View style={styles.selectedTagGrid}>
                            {selectedTags.map((tag) => (
                              <Pressable key={tag} onPress={() => removeTag(tag)} style={styles.selectedTagPill}>
                                <Tag size={10} color={c.orange} strokeWidth={2.2} />
                                <Text style={styles.selectedTagText}>{tag}</Text>
                                <X size={11} color={c.orange} strokeWidth={2.4} />
                              </Pressable>
                            ))}
                          </View>
                        ) : null}

                        {selectedTags.length < 5 ? tagOptions
                          .filter((tag) => !selectedTags.some((selectedTag) => selectedTag.toLowerCase() === tag.label.toLowerCase()))
                          .map((tag) => (
                            <Pressable
                              key={tag.label}
                              onPress={() => addTag(tag.label)}
                              style={styles.tagPill}
                            >
                              <Tag size={10} color={c.muted} strokeWidth={2.2} />
                              <Text style={styles.tagText}>{tag.label}</Text>
                            </Pressable>
                          )) : null}
                      </View>

                    </View>
                  ) : (
                    <View style={styles.previewScreen}>
                      <View style={styles.previewFeedCard}>
                        <View style={styles.previewFeedHeader}>
                          <View style={styles.previewAvatar}>
                            <Text style={styles.previewAvatarText}>{previewInitials}</Text>
                          </View>
                          <View style={styles.previewAuthorColumn}>
                            <View style={styles.previewAuthorRow}>
                              <Text numberOfLines={1} style={styles.previewAuthor}>{previewAuthorName}</Text>
                              <Text style={styles.previewHeaderDot}>•</Text>
                              <Text style={styles.previewHeaderMeta}>just now</Text>
                            </View>
                            <Text style={styles.previewSharedContext}>shared a spot</Text>
                          </View>
                        </View>

                        <View style={styles.previewContentBlock}>
                          <View style={styles.previewPlaceBlock}>
                            <Text numberOfLines={2} style={styles.previewRestaurantName}>{restaurantName.trim()}</Text>
                            {previewLocation ? (
                              <View style={styles.previewLocationRow}>
                                <MapPin size={12} color={c.mutedStrong} strokeWidth={2} />
                                <Text numberOfLines={1} style={styles.previewLocationText}>{previewLocation}</Text>
                              </View>
                            ) : null}
                          </View>

                          <View style={styles.previewBody}>
                            {caption.trim() ? <Text style={styles.previewCaption}>{caption.trim()}</Text> : null}

                            <View style={styles.previewFeedDishes}>
                              {dishes
                                .filter((dish) => dish.name.trim())
                                .map((dish) => (
                                  <View key={dish.key} style={styles.previewFeedDish}>
                                    <Text numberOfLines={1} style={styles.previewFeedDishName}>{dish.name.trim()}</Text>
                                    {dish.rating > 0 ? (
                                      <View style={styles.previewRatingPill}>
                                        <Star size={8} color={c.gold} fill={c.gold} strokeWidth={0} />
                                        <Text style={styles.previewRatingText}>{dish.rating}</Text>
                                      </View>
                                    ) : null}
                                  </View>
                                ))}
                            </View>

                            {previewTags.length > 0 ? (
                              <View style={styles.previewFeedTags}>
                                {previewTags.map((tag) => (
                                  <View key={tag} style={styles.previewFeedTag}>
                                    <Text style={styles.previewFeedTagText}>{tag}</Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </View>
                        </View>

                        {mediaItems.length > 0 ? (
                          <View style={styles.previewMediaWrap}>
                            <ScrollView
                              horizontal
                              pagingEnabled
                              showsHorizontalScrollIndicator={false}
                              onMomentumScrollEnd={handlePreviewScrollEnd}
                            >
                              {mediaItems.map((media, index) => (
                                <View key={`${media.uri}-${index}`} style={{ width: windowWidth }}>
                                  {media.mediaType === "video" ? (
                                    <SelectedPostVideo
                                      active={index === previewMediaIndex}
                                      cropRect={media.cropRect}
                                      muted={media.muted}
                                      onToggleMute={() => toggleMuteAt(index)}
                                      sourceHeight={media.height}
                                      sourceWidth={media.width}
                                      style={styles.previewImage}
                                      uri={media.uri}
                                    />
                                  ) : (
                                    <CropRegionImage
                                      boxHeight={windowWidth / POST_BITE_ASPECT_RATIO}
                                      boxWidth={windowWidth}
                                      cropRect={media.cropRect}
                                      sourceHeight={media.height}
                                      sourceWidth={media.width}
                                      uri={media.uri}
                                    />
                                  )}
                                </View>
                              ))}
                            </ScrollView>
                            {mediaItems.length > 1 ? (
                              <View style={styles.previewMediaCount}>
                                <Text style={styles.previewMediaCountText}>{previewMediaIndex + 1}/{mediaItems.length}</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}

                        <View style={styles.previewActions}>
                          <View style={styles.previewActionCluster}>
                            <View style={styles.previewAction}>
                              <Heart size={19} color={c.muted} strokeWidth={2} />
                              <Text style={styles.previewActionText}>0</Text>
                            </View>
                            <View style={styles.previewAction}>
                              <MessageCircle size={18} color={c.muted} strokeWidth={2} />
                              <Text style={styles.previewActionText}>0</Text>
                            </View>
                            <View style={styles.previewAction}>
                              <Utensils size={17} color={c.muted} strokeWidth={2} />
                              <Text style={styles.previewActionText}>{dishes.filter((dish) => dish.name.trim()).length}</Text>
                            </View>
                          </View>
                          <View style={styles.previewIconButton}>
                            <Bookmark size={19} color={c.muted} strokeWidth={2} />
                          </View>
                          <View style={styles.previewIconButton}>
                            <Share2 size={18} color={c.muted} strokeWidth={2} />
                          </View>
                        </View>
                      </View>

                      <View style={styles.previewVisibilitySection}>
                        <View style={styles.visibilityGrid}>
                          {visibilityOptions.map(({ Icon, label, value }) => {
                            const active = visibility === value;
                            return (
                              <Pressable
                                key={value}
                                onPress={() => setVisibility(value)}
                                style={[styles.visibilityOption, active && styles.visibilityOptionActive]}
                              >
                                <Icon size={14} color={active ? c.orange : c.muted} strokeWidth={2} />
                                <Text style={[styles.visibilityLabel, active && styles.visibilityLabelActive]}>{label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    </View>
                  )}

                  {createPost.isError ? (
                    <ErrorState message={createPost.error.message} title="Could not share post" />
                  ) : null}
                  {success ? (
                    <View style={styles.successBanner}>
                      <Text style={styles.successTitle}>Shared</Text>
                      <Text style={styles.successText}>{success}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <View style={styles.memorySetup}>
                  <View style={styles.attachmentStack}>
                    <CreateMemoryOccasionPicker
                      onTitleChange={setMemoryOccasionTitle}
                      titleValue={memoryOccasionTitle}
                    />

                    <View style={styles.memoryFriendSection}>
                      <View style={styles.restaurantAttachment}>
                        <UserPlus size={20} color={c.orange} strokeWidth={1.9} />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={setMemoryParticipantInput}
                          onBlur={() => {
                            setTimeout(() => setMemoryFriendFocused(false), 150);
                          }}
                          onFocus={() => setMemoryFriendFocused(true)}
                          onSubmitEditing={() => addMemoryParticipant()}
                          placeholder="Who is at the table?"
                          placeholderTextColor={c.muted}
                          returnKeyType="done"
                          style={styles.fieldInput}
                          value={memoryParticipantInput}
                        />
                      </View>
                      {memoryFriendFocused && (memoryFriendSearch.loading || memoryFriendSearch.results.length > 0 || memoryFriendSearch.normalizedQuery.length >= 2) ? (
                        <View style={styles.friendSuggestions}>
                          <ScrollView
                            keyboardShouldPersistTaps="handled"
                            nestedScrollEnabled
                            showsVerticalScrollIndicator={memoryFriendSearch.results.length > 3}
                            style={styles.friendSuggestionsScroll}
                          >
                            {memoryFriendSearch.loading ? (
                              <View style={styles.placeSuggestionLoading}>
                                <ActivityIndicator color={c.orange} size="small" />
                                <Text style={styles.placeSuggestionMuted}>Searching people</Text>
                              </View>
                            ) : null}
                            {!memoryFriendSearch.loading && memoryFriendSearch.error ? (
                              <View style={styles.placeSuggestionLoading}>
                                <Text style={styles.placeSuggestionError}>Could not search people</Text>
                              </View>
                            ) : null}
                            {!memoryFriendSearch.loading && !memoryFriendSearch.error && memoryFriendSearch.results.length === 0 ? (
                              <View style={styles.placeSuggestionLoading}>
                                <Text style={styles.placeSuggestionMuted}>No people found</Text>
                              </View>
                            ) : null}
                            {memoryFriendSearch.results.map((friend) => (
                              <Pressable
                                key={friend.username}
                                onPressIn={() => addMemoryParticipant(friend.username)}
                                style={styles.friendSuggestionRow}
                              >
                                <View style={styles.friendSuggestionAvatar}>
                                  <Text style={styles.friendSuggestionAvatarText}>{initialsForUser(friend.displayName, friend.username)}</Text>
                                </View>
                                <View style={styles.placeSuggestionText}>
                                  <Text numberOfLines={1} style={styles.placeSuggestionTitle}>{friend.displayName}</Text>
                                  <Text numberOfLines={1} style={styles.placeSuggestionSub}>@{friend.username}</Text>
                                </View>
                                <ChevronRight size={17} color={c.muted} strokeWidth={2.2} />
                              </Pressable>
                            ))}
                          </ScrollView>
                        </View>
                      ) : null}
                      {memoryParticipantNames.length > 0 ? (
                        <>
                          <View style={styles.memoryFriendChips}>
                            {memoryParticipantNames.map((friend) => (
                              <Pressable key={friend} onPress={() => removeMemoryParticipant(friend)} style={styles.memoryFriendChip}>
                                <Text style={styles.memoryFriendChipText}>@{friend}</Text>
                                <X size={12} color={c.muted} strokeWidth={2.4} />
                              </Pressable>
                            ))}
                          </View>
                          <Text style={styles.memoryFriendAddedText}>
                            Private to invited friends.
                          </Text>
                        </>
                      ) : null}
                    </View>
                  </View>

                  {createMemoryRoom.isError ? (
                    <ErrorState message={createMemoryRoom.error.message} title="Could not create table memory" />
                  ) : null}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function ActionCard({
  CtaIcon,
  Icon,
  accent,
  cardHeight,
  cta,
  description,
  onMeasureHeight,
  onPress,
  tags,
  title
}: {
  accent: "memory" | "orange";
  cardHeight?: number;
  cta: string;
  CtaIcon?: typeof Users;
  description: string;
  Icon: typeof Users;
  onMeasureHeight?: (height: number) => void;
  onPress: () => void;
  tags: string[];
  title: string;
}) {
  const { themeColors: c, styles } = useShareTheme();
  const isMemory = accent === "memory";
  const accentColor = isMemory ? c.memory : c.orange;
  const gradientColors: readonly [string, string, string] = isMemory
    ? ["rgba(157, 91, 232, 0.20)", "rgba(124, 58, 237, 0.09)", "rgba(33, 28, 23, 0.98)"]
    : ["rgba(240, 96, 48, 0.22)", "rgba(232, 168, 48, 0.08)", "rgba(33, 28, 23, 0.98)"];

  return (
    <Pressable
      onLayout={onMeasureHeight ? (event) => onMeasureHeight(event.nativeEvent.layout.height) : undefined}
      onPress={onPress}
      style={[styles.actionCard, isMemory ? styles.actionCardMemory : styles.actionCardOrange, cardHeight ? { height: cardHeight } : null]}
    >
      <LinearGradient colors={gradientColors} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={["rgba(12, 9, 7, 0.28)", "rgba(12, 9, 7, 0.08)", "rgba(12, 9, 7, 0.18)"]}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.actionContent}>
        <View style={[styles.actionIcon, isMemory ? styles.actionIconMemory : styles.actionIconOrange]}>
          <Icon size={22} color={accentColor} strokeWidth={2.3} />
        </View>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
        <View style={styles.actionChips}>
          {tags.map((tag) => <ChoiceChip key={tag} accent={accent} label={tag} />)}
        </View>
        <View style={styles.actionCtaRow}>
          {CtaIcon ? <CtaIcon size={14} color={accentColor} strokeWidth={2.4} /> : null}
          <Text style={[styles.actionCta, { color: accentColor }]}>{cta}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function ChoiceChip({ accent, label }: { accent: "memory" | "orange"; label: string }) {
  const { themeColors: c, styles } = useShareTheme();
  const isMemory = accent === "memory";
  return (
    <View style={[styles.actionChip, isMemory ? styles.actionChipMemory : styles.actionChipOrange]}>
      <Text style={[styles.actionChipText, { color: isMemory ? c.memory : c.orange }]}>
        {label}
      </Text>
    </View>
  );
}

function CreateMemoryOccasionPicker({
  onTitleChange,
  titleValue
}: {
  onTitleChange: (value: string) => void;
  titleValue: string;
}) {
  const { themeColors: c, styles } = useShareTheme();

  return (
    <View style={styles.occasionPicker}>
      <View style={styles.restaurantAttachment}>
        <PenLine size={20} color={c.orange} strokeWidth={1.9} />
        <TextInput
          onChangeText={onTitleChange}
          placeholder="Occasion name"
          placeholderTextColor={c.muted}
          returnKeyType="done"
          style={styles.fieldInput}
          value={titleValue}
        />
      </View>
    </View>
  );
}

function PlaceField({
  onChangeText,
  onSelect,
  placeholder,
  selectedPlace,
  value
}: {
  onChangeText: (value: string) => void;
  onSelect: (place: SelectedPlace | null) => void;
  placeholder: string;
  selectedPlace: SelectedPlace | null;
  value: string;
}) {
  const { themeColors: c, styles } = useShareTheme();
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectingPlaceId, setSelectingPlaceId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState(() => createPlacesSessionToken());
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2 || selectedPlaceMatches(value, selectedPlace)) {
      setLoading(false);
      setSearchAttempted(false);
      setSearchError("");
      setSuggestions([]);
      return;
    }

    let alive = true;
    setLoading(true);
    setSearchAttempted(false);
    setSearchError("");
    const timeout = setTimeout(async () => {
      try {
        const nextSuggestions = await autocompletePlaces(query, sessionToken);
        if (!alive) return;
        setSuggestions(nextSuggestions);
        setSearchAttempted(true);
      } catch {
        if (!alive) return;
        setSearchError("Could not search places right now.");
        setSuggestions([]);
        setSearchAttempted(true);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);

    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [selectedPlace, sessionToken, value]);

  async function pickPlace(suggestion: PlaceSuggestion) {
    setSelectingPlaceId(suggestion.placeId);
    try {
      const details = await placeDetails(suggestion.placeId, sessionToken);
      const selected = selectedPlaceFromSuggestion(suggestion, details);
      onChangeText(selected.name);
      onSelect(selected);
      setSuggestions([]);
      setFocused(false);
      setSearchAttempted(false);
      setSearchError("");
      setSessionToken(createPlacesSessionToken());
    } finally {
      setSelectingPlaceId(null);
    }
  }

  const hasSearchableQuery = value.trim().length >= 2 && !selectedPlaceMatches(value, selectedPlace);
  const showSuggestions = focused && hasSearchableQuery && (loading || suggestions.length > 0 || searchAttempted || Boolean(searchError));
  const selectedLocationLabel = selectedPlaceMatches(value, selectedPlace)
    ? compactPlaceLocation(selectedPlace)
    : "";

  return (
    <View style={styles.placeField}>
      <View style={styles.restaurantAttachment}>
        <Store size={20} color={selectedPlaceMatches(value, selectedPlace) ? c.green : c.orange} strokeWidth={1.9} />
        <TextInput
          onBlur={() => setFocused(false)}
          onChangeText={(text) => {
            onChangeText(text);
            onSelect(null);
          }}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          style={styles.fieldInput}
          value={value}
        />
      </View>
      {selectedLocationLabel ? (
        <View style={styles.selectedPlaceLocation}>
          <MapPin size={15} color={c.muted} strokeWidth={2} />
          <Text numberOfLines={2} style={styles.selectedPlaceLocationText}>{selectedLocationLabel}</Text>
        </View>
      ) : null}
      {showSuggestions ? (
        <View style={styles.placeSuggestions}>
          {loading ? (
            <View style={styles.placeSuggestionLoading}>
              <ActivityIndicator color={c.orange} size="small" />
              <Text style={styles.placeSuggestionMuted}>Searching places</Text>
            </View>
          ) : null}
          {!loading && searchError ? (
            <View style={styles.placeSuggestionLoading}>
              <Text style={styles.placeSuggestionError}>{searchError}</Text>
            </View>
          ) : null}
          {!loading && !searchError && searchAttempted && suggestions.length === 0 ? (
            <View style={styles.placeSuggestionLoading}>
              <Text style={styles.placeSuggestionMuted}>No places found</Text>
            </View>
          ) : null}
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.placeId}
              onPressIn={() => void pickPlace(suggestion)}
              style={styles.placeSuggestionRow}
            >
              <View style={styles.placeSuggestionText}>
                <Text numberOfLines={1} style={styles.placeSuggestionTitle}>{suggestion.mainText}</Text>
                {suggestion.secondaryText ? (
                  <Text numberOfLines={1} style={styles.placeSuggestionSub}>{suggestion.secondaryText}</Text>
                ) : null}
              </View>
              {selectingPlaceId === suggestion.placeId ? (
                <ActivityIndicator color={c.orange} size="small" />
              ) : (
                <ChevronRight size={16} color={c.muted} strokeWidth={2.2} />
              )}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DishRow({
  dish,
  onChange,
  onRemove,
  showRemove
}: {
  dish: DraftDish;
  onChange: (dish: Partial<FoodItem>) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const { themeColors: c, styles } = useShareTheme();
  const [suggestions, setSuggestions] = useState<DishNameSuggestion[]>([]);
  const [didYouMean, setDidYouMean] = useState<DishDidYouMean | null>(null);
  // Names accepted from a suggestion or "keep as typed" — don't re-suggest them.
  const settledNameRef = useRef<string | null>(null);

  useEffect(() => {
    const term = dish.name.trim();
    if (term.length < 2 || term === settledNameRef.current) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchDishNameSuggestions(term, 3)
        .then((results) => {
          if (cancelled) return;
          const normalizedTerm = normalizeDishNameForMatch(term);
          setSuggestions(results.filter((result) => result.normalizedName !== normalizedTerm));
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dish.name]);

  function acceptSuggestion(suggestion: DishNameSuggestion) {
    settledNameRef.current = suggestion.name;
    setSuggestions([]);
    setDidYouMean(null);
    onChange({ name: suggestion.name });
  }

  function acceptDidYouMean(match: DishDidYouMean) {
    const typedName = dish.name.trim();
    acceptSuggestion(match.suggestion);
    // The typed spelling meant this canonical dish — teach the alias dictionary.
    void confirmDishAlias(typedName, match.suggestion.canonicalDishId);
  }

  function keepTypedName() {
    settledNameRef.current = dish.name.trim();
    setDidYouMean(null);
  }

  async function handleEndEditing() {
    setSuggestions([]);
    const term = dish.name.trim();
    if (term.length < 3 || term === settledNameRef.current) return;
    try {
      const match = await findDishDidYouMean(term);
      setDidYouMean(match);
    } catch {
      setDidYouMean(null);
    }
  }

  return (
    <View style={styles.dishRow}>
      <View style={styles.dishInputRow}>
        <Utensils size={20} color={c.gold} strokeWidth={1.9} />
        <TextInput
          onChangeText={(name) => {
            if (name.trim() !== settledNameRef.current) settledNameRef.current = null;
            setDidYouMean(null);
            onChange({ name });
          }}
          onEndEditing={() => {
            void handleEndEditing();
          }}
          placeholder="Chicken Biriyani"
          placeholderTextColor={c.muted}
          style={styles.dishInput}
          value={dish.name}
        />
        {showRemove ? (
          <Pressable onPress={onRemove} style={styles.removeDishButton}>
            <X size={14} color={c.muted} strokeWidth={2.1} />
          </Pressable>
        ) : null}
      </View>
      {suggestions.length > 0 ? (
        <View style={styles.dishSuggestionList}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.canonicalDishId}
              onPress={() => acceptSuggestion(suggestion)}
              style={styles.dishSuggestionItem}
            >
              <Text numberOfLines={1} style={styles.dishSuggestionText}>{suggestion.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {didYouMean ? (
        <View style={styles.didYouMeanRow}>
          <Text numberOfLines={1} style={styles.didYouMeanText}>
            Did you mean {didYouMean.suggestion.name}?
          </Text>
          <View style={styles.didYouMeanActions}>
            <Pressable onPress={() => acceptDidYouMean(didYouMean)} style={styles.didYouMeanButton}>
              <Text style={styles.didYouMeanButtonText}>Yes</Text>
            </Pressable>
            <Pressable onPress={keepTypedName} style={styles.didYouMeanButton}>
              <Text style={styles.didYouMeanKeepText}>Keep</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={styles.dishRatingRow}>
        <Text style={styles.ratingLabel}>{dish.rating > 0 ? `${dish.rating}/5` : "Rate dish"}</Text>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable
              key={star}
              onPress={() => onChange({ rating: dish.rating === star ? 0 : star })}
              style={styles.starButton}
            >
              <Star
                size={18}
                color={c.gold}
                fill={star <= dish.rating ? c.gold : "transparent"}
                strokeWidth={1.8}
              />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function InlineError({ message }: { message: string }) {
  const { styles } = useShareTheme();
  return <Text style={styles.inlineError}>{message}</Text>;
}

// A static first-frame preview of a video for the thumbnail strip (paused, muted)
// with a small play badge so it's clearly a video.
function VideoThumbnail({ uri }: { uri: string }) {
  const { styles } = useShareTheme();
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  // Generate a still image instead of mounting a live VideoView — a native video
  // surface doesn't clip to the small rounded tile and bleeds behind the strip.
  useEffect(() => {
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.6 })
      .then((result) => {
        if (!cancelled) setThumbUri(result.uri);
      })
      .catch(() => {
        // Leave the dark tile + play badge if a frame can't be extracted.
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <View style={styles.reviewThumbMedia}>
      {thumbUri ? (
        <Image alt="Video thumbnail" contentFit="cover" source={{ uri: thumbUri }} style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={styles.reviewThumbPlay}>
        <View style={styles.reviewThumbPlayBadge}>
          <Play size={11} color="#fff" fill="#fff" />
        </View>
      </View>
    </View>
  );
}

function formatVideoTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

// Minimal video controls: play/pause, elapsed/total time, and mute — nothing else
// (no fullscreen, PiP, or scrubber).
function SelectedPostVideo({
  active = true,
  cropRect,
  muted = false,
  onToggleMute,
  sourceHeight,
  sourceWidth,
  style,
  uri
}: {
  active?: boolean;
  cropRect?: MediaCropRect | null;
  muted?: boolean;
  onToggleMute?: () => void;
  sourceHeight?: number | null;
  sourceWidth?: number | null;
  style?: StyleProp<ViewStyle>;
  uri: string;
}) {
  const { styles } = useShareTheme();
  // With a crop rect and known dimensions the video is scaled/offset so the
  // rect fills the (overflow-hidden) container; otherwise cover center-crop.
  const [boxSize, setBoxSize] = useState<{ height: number; width: number } | null>(null);
  const videoWidth = Number(sourceWidth ?? 0);
  const videoHeight = Number(sourceHeight ?? 0);
  const regionStyle = cropRect && boxSize && videoWidth > 0 && videoHeight > 0
    ? (() => {
      const scale = boxSize.width / (cropRect.width * videoWidth);
      return {
        height: videoHeight * scale,
        left: -cropRect.x * videoWidth * scale,
        position: "absolute" as const,
        top: -cropRect.y * videoHeight * scale,
        width: videoWidth * scale
      };
    })()
    : null;
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Pause a video when it's swiped off-screen so audio doesn't keep playing.
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const timeEvent = useEvent(player, "timeUpdate");
  const currentTime = timeEvent?.currentTime ?? player.currentTime;

  function togglePlay() {
    if (player.playing) player.pause();
    else player.play();
  }

  return (
    <View
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        setBoxSize({ height, width });
      }}
      style={[styles.videoContainer, style ?? styles.previewVideo]}
    >
      <VideoView
        contentFit={regionStyle ? "fill" : "cover"}
        nativeControls={false}
        player={player}
        style={regionStyle ?? StyleSheet.absoluteFill}
      />
      <Pressable onPress={togglePlay} style={styles.videoTapLayer}>
        {!isPlaying ? (
          <View style={styles.videoPlayButton}>
            <Play size={24} color="#fff" fill="#fff" />
          </View>
        ) : null}
      </Pressable>
      <View style={styles.videoBottomBar}>
        <Text style={styles.videoTimeText}>
          {formatVideoTime(currentTime)} / {formatVideoTime(player.duration)}
        </Text>
        {onToggleMute ? (
          <Pressable accessibilityLabel={muted ? "Unmute video audio" : "Mute video audio"} hitSlop={8} onPress={onToggleMute} style={styles.videoSmallButton}>
            {muted ? <VolumeX size={16} color="#fff" strokeWidth={2.2} /> : <Volume2 size={16} color="#fff" strokeWidth={2.2} />}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
  screenContent: {
    paddingBottom: 0
  },
  scrollContent: {
    paddingTop: 0,
    position: "relative"
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: screenLayout.headerContentGap,
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.topGap
  },
  headerCancelButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    marginLeft: -10,
    marginRight: spacing.s,
    marginTop: -4,
    width: 40
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    paddingTop: 2
  },
  headerSubmitButton: {
    alignItems: "center",
    backgroundColor: c.orange,
    borderRadius: radius.pill,
    justifyContent: "center",
    marginLeft: spacing.md,
    minHeight: 40,
    minWidth: 88,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  headerSubmitText: {
    ...fontStyles.bold,
    color: c.white,
    fontSize: 14,
    lineHeight: 17
  },
  title: {
    ...fontStyles.regular,
    color: c.cream,
    fontSize: Platform.OS === "web" ? typography.webTitle : typography.heading,
    letterSpacing: 0,
    lineHeight: Platform.OS === "web" ? 32 : 29
  },
  subtitle: {
    ...fontStyles.semiBold,
    color: c.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
    maxWidth: 300
  },
  stack: {
    gap: spacing.base,
    paddingHorizontal: spacing.lg
  },
  choiceStack: {
    gap: 18,
    paddingTop: 8
  },
  actionCard: {
    backgroundColor: c.card,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: Platform.OS === "web" ? 244 : 222,
    overflow: "hidden",
    padding: 18,
    position: "relative"
  },
  actionCardOrange: {
    borderColor: "rgba(240, 96, 48, 0.42)"
  },
  actionCardMemory: {
    borderColor: c.memoryBorder
  },
  actionContent: {
    flex: 1,
    minWidth: 0,
    zIndex: 3
  },
  actionIcon: {
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    marginBottom: 13,
    width: 48
  },
  actionIconOrange: {
    backgroundColor: "rgba(240, 96, 48, 0.16)",
    borderColor: "rgba(240, 96, 48, 0.34)"
  },
  actionIconMemory: {
    backgroundColor: c.memoryDim,
    borderColor: c.memoryBorder
  },
  actionTitle: {
    ...fontStyles.extraBold,
    color: "#FFFFFF",
    fontSize: typography.heading,
    letterSpacing: 0,
    lineHeight: 28,
    marginBottom: 8
  },
  actionDescription: {
    ...fontStyles.semiBold,
    color: "rgba(245, 237, 216, 0.70)",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12
  },
  actionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 14
  },
  actionChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  actionChipOrange: {
    backgroundColor: "rgba(240, 96, 48, 0.10)",
    borderColor: "rgba(240, 96, 48, 0.24)"
  },
  actionChipMemory: {
    backgroundColor: c.memoryDim,
    borderColor: c.memoryBorder
  },
  actionChipText: {
    ...fontStyles.extraBold,
    fontSize: 10,
    lineHeight: 12
  },
  actionCtaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6
  },
  actionCta: {
    ...fontStyles.extraBold,
    fontSize: 14,
    lineHeight: 18
  },
  composerCard: {
    gap: 16
  },
  requiredPhotoBox: {
    backgroundColor: c.surface,
    borderColor: c.orangeBorder,
    borderRadius: radius.md,
    borderStyle: "dashed",
    borderWidth: 1,
    minHeight: 176,
    overflow: "hidden"
  },
  requiredPhotoBoxFilled: {
    borderColor: c.border,
    borderStyle: "solid"
  },
  requiredPhotoPreview: {
    aspectRatio: 4 / 3,
    backgroundColor: c.surface,
    width: "100%"
  },
  requiredPhotoEmpty: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 176,
    justifyContent: "center",
    padding: spacing.lg
  },
  requiredPhotoIcon: {
    alignItems: "center",
    backgroundColor: c.orangeDim,
    borderColor: c.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  requiredPhotoTextBlock: {
    alignItems: "center",
    gap: 6
  },
  requiredPhotoTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    justifyContent: "center"
  },
  requiredPhotoTitle: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center"
  },
  requiredPill: {
    ...fontStyles.extraBold,
    backgroundColor: c.orangeDim,
    borderColor: c.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: c.orange,
    fontSize: 10,
    lineHeight: 13,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  requiredPhotoText: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 12,
    lineHeight: 17,
    maxWidth: 230,
    textAlign: "center"
  },
  requiredPhotoBadge: {
    backgroundColor: "rgba(14, 11, 8, 0.72)",
    borderColor: "rgba(245, 237, 216, 0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    position: "absolute",
    top: 10
  },
  requiredPhotoBadgeText: {
    ...fontStyles.extraBold,
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 13
  },
  requiredPhotoAction: {
    alignItems: "center",
    backgroundColor: "rgba(14, 11, 8, 0.72)",
    borderColor: "rgba(245, 237, 216, 0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    bottom: 10,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    position: "absolute",
    right: 10
  },
  requiredPhotoActionText: {
    ...fontStyles.extraBold,
    color: c.white,
    fontSize: 12,
    lineHeight: 14
  },
  requiredPhotoRemove: {
    alignItems: "center",
    backgroundColor: "rgba(14, 11, 8, 0.72)",
    borderColor: "rgba(245, 237, 216, 0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: 10,
    width: 34
  },
  previewScreen: {
    gap: spacing.lg
  },
  previewFeedCard: {
    backgroundColor: c.bg,
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    // Break out of the composer's horizontal padding so the card (and its media)
    // spans edge-to-edge exactly like a real feed post.
    marginHorizontal: -spacing.lg
  },
  previewFeedHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
    paddingLeft: spacing.lg,
    paddingRight: 8,
    paddingTop: 14
  },
  previewAvatar: {
    alignItems: "center",
    backgroundColor: c.orange,
    borderColor: "rgba(245, 237, 216, 0.14)",
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  previewAvatarText: {
    ...fontStyles.extraBold,
    color: c.white,
    fontSize: 12,
    lineHeight: 14,
    textAlign: "center"
  },
  previewAuthorColumn: {
    flex: 1,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 0
  },
  previewAuthorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    height: 18,
    minWidth: 0
  },
  previewAuthor: {
    ...fontStyles.semiBold,
    color: c.cream,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18
  },
  previewHeaderDot: {
    ...fontStyles.bold,
    color: c.muted,
    fontSize: 15,
    lineHeight: 18
  },
  previewHeaderMeta: {
    ...fontStyles.regular,
    color: c.muted,
    fontSize: 13,
    lineHeight: 18
  },
  previewSharedContext: {
    ...fontStyles.regular,
    color: c.muted,
    fontSize: 12,
    lineHeight: 15
  },
  previewContentBlock: {
    paddingBottom: 12,
    paddingHorizontal: spacing.lg
  },
  previewPlaceBlock: {
    paddingBottom: 0,
    paddingTop: 1
  },
  previewRestaurantName: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 18,
    lineHeight: 21,
    marginBottom: 5
  },
  previewLocationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4
  },
  previewLocationText: {
    ...fontStyles.regular,
    color: c.mutedStrong,
    flex: 1,
    fontSize: 11,
    lineHeight: 14
  },
  previewBody: {
    gap: 10,
    paddingBottom: 0,
    paddingTop: 10
  },
  previewImage: {
    aspectRatio: 4 / 5,
    backgroundColor: c.surface,
    width: "100%"
  },
  previewVideo: {
    aspectRatio: 4 / 5,
    backgroundColor: c.black,
    width: "100%"
  },
  previewCaption: {
    ...fontStyles.regular,
    color: c.cream,
    fontSize: 13,
    lineHeight: 20
  },
  previewFeedTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  previewFeedTag: {
    backgroundColor: "rgba(240, 96, 48, 0.10)",
    borderColor: "rgba(240, 96, 48, 0.20)",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  previewFeedTagText: {
    ...fontStyles.extraBold,
    color: c.orange,
    fontSize: 10,
    lineHeight: 11
  },
  previewFeedDishes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  previewFeedDish: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  previewFeedDishName: {
    ...fontStyles.regular,
    color: c.cream,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14
  },
  previewRatingPill: {
    alignItems: "center",
    backgroundColor: "rgba(232, 168, 48, 0.15)",
    borderColor: "rgba(232, 168, 48, 0.25)",
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1
  },
  previewRatingText: {
    ...fontStyles.bold,
    color: c.gold,
    fontSize: 10,
    lineHeight: 11
  },
  previewMediaWrap: {
    position: "relative"
  },
  previewMediaCount: {
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    position: "absolute",
    right: 10,
    top: 10
  },
  previewMediaCountText: {
    ...fontStyles.semiBold,
    color: "#fff",
    fontSize: 11
  },
  reviewScreen: {
    flex: 1
  },
  reviewHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: screenLayout.headerContentGap,
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.topGap
  },
  reviewMain: {
    alignItems: "center",
    backgroundColor: c.black,
    flex: 1,
    justifyContent: "center",
    overflow: "hidden"
  },
  reviewMainImage: {
    height: "100%",
    width: "100%"
  },
  reviewCropPressable: {
    alignSelf: "center"
  },
  cropHintBadgeTop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    position: "absolute",
    right: 12,
    top: 12
  },
  cropHintText: {
    ...fontStyles.semiBold,
    color: "#fff",
    fontSize: 11,
    letterSpacing: 0.2
  },
  videoContainer: {
    backgroundColor: c.black,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative"
  },
  videoTapLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  videoPlayButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  videoBottomBar: {
    alignItems: "center",
    bottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    left: 12,
    position: "absolute",
    right: 12
  },
  videoTimeText: {
    ...fontStyles.semiBold,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    color: "#fff",
    fontSize: 12,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 3
  },
  videoSmallButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  reviewEmptyText: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 14
  },
  reviewErrorWrap: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm
  },
  reviewBottomBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md
  },
  reviewStripContent: {
    alignItems: "center",
    gap: 10,
    paddingRight: 4
  },
  reviewThumb: {
    borderColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 2,
    height: 64,
    overflow: "hidden",
    position: "relative",
    width: 64
  },
  reviewThumbActive: {
    borderColor: c.gold
  },
  reviewThumbMedia: {
    backgroundColor: c.black,
    borderRadius: radius.sm,
    height: "100%",
    overflow: "hidden",
    width: "100%"
  },
  reviewThumbPlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  reviewThumbPlayBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: radius.pill,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  reviewThumbRemove: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: radius.pill,
    height: 20,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    top: 2,
    width: 20
  },
  reviewAddButton: {
    alignItems: "center",
    borderColor: c.gold,
    borderRadius: radius.md,
    borderStyle: "dashed",
    borderWidth: 1.5,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  previewActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: 8,
    paddingHorizontal: spacing.lg,
    paddingTop: 10
  },
  previewActionCluster: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.base
  },
  previewAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5
  },
  previewActionText: {
    ...fontStyles.semiBold,
    color: c.muted,
    fontSize: 13
  },
  previewIconButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  previewVisibilitySection: {
    gap: spacing.sm
  },
  gallerySheet: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    bottom: 0,
    gap: spacing.sm,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    position: "absolute",
    right: 0
  },
  galleryHandle: {
    alignSelf: "center",
    backgroundColor: c.border,
    borderRadius: radius.pill,
    height: 4,
    width: 36
  },
  galleryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  galleryTitle: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 14,
    lineHeight: 18
  },
  galleryLibraryAction: {
    ...fontStyles.bold,
    color: c.orange,
    fontSize: 12,
    lineHeight: 16
  },
  galleryStatusText: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 11,
    lineHeight: 15
  },
  galleryStrip: {
    gap: spacing.sm,
    paddingBottom: spacing.sm
  },
  cameraTile: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: c.card,
    borderColor: c.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    justifyContent: "center",
    width: 86
  },
  cameraTileText: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 11,
    lineHeight: 13
  },
  galleryTile: {
    aspectRatio: 1,
    backgroundColor: c.card,
    borderRadius: radius.md,
    overflow: "hidden",
    width: 86
  },
  galleryImage: {
    height: "100%",
    width: "100%"
  },
  gallerySelectedBadge: {
    backgroundColor: "rgba(14, 11, 8, 0.72)",
    borderRadius: radius.pill,
    bottom: 7,
    left: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    position: "absolute"
  },
  gallerySelectedText: {
    ...fontStyles.extraBold,
    color: c.white,
    fontSize: 9,
    lineHeight: 11
  },
  galleryEmptyTile: {
    alignItems: "center",
    aspectRatio: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    width: 120
  },
  galleryEmptyText: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center"
  },
  attachmentStack: {
    gap: 10
  },
  placeField: {
    position: "relative",
    zIndex: 2
  },
  restaurantAttachment: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.s,
    paddingHorizontal: 0,
    paddingVertical: 14
  },
  fieldInput: {
    ...fontStyles.bold,
    color: c.cream,
    flex: 1,
    fontSize: 14,
    minWidth: 0,
    padding: 0
  },
  selectedPlaceLocation: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 7,
    paddingBottom: 4,
    paddingTop: 9
  },
  selectedPlaceLocationText: {
    ...fontStyles.medium,
    color: c.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16
  },
  placeSuggestions: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden"
  },
  placeSuggestionLoading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12
  },
  placeSuggestionMuted: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  placeSuggestionError: {
    ...fontStyles.semiBold,
    color: c.dangerSoft,
    fontSize: 12,
    lineHeight: 16
  },
  placeSuggestionRow: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: 10
  },
  placeSuggestionText: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  placeSuggestionTitle: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 13,
    lineHeight: 17
  },
  placeSuggestionSub: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 11,
    lineHeight: 15
  },
  memorySetup: {
    gap: spacing.lg
  },
  memoryFriendSection: {
    gap: spacing.sm
  },
  memoryFriendAddedText: {
    ...fontStyles.semiBold,
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  occasionPicker: {
    gap: spacing.sm,
    paddingTop: 0
  },
  occasionPickerContent: {
    gap: spacing.md,
    paddingRight: 2
  },
  occasionChoice: {
    alignItems: "center",
    gap: 7,
    width: 62
  },
  occasionIconButton: {
    alignItems: "center",
    backgroundColor: c.card,
    borderColor: c.border,
    borderRadius: 29,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  occasionIconButtonActive: {
    borderWidth: 2
  },
  occasionChoiceLabel: {
    ...fontStyles.extraBold,
    color: c.muted,
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 62,
    textAlign: "center"
  },
  friendSuggestions: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  friendSuggestionsScroll: {
    maxHeight: 244
  },
  friendSuggestionRow: {
    alignItems: "center",
    borderTopColor: c.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  friendSuggestionAvatar: {
    alignItems: "center",
    backgroundColor: c.orangeDim,
    borderColor: c.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  friendSuggestionAvatarText: {
    ...fontStyles.extraBold,
    color: c.orange,
    fontSize: 12,
    lineHeight: 16
  },
  memoryFriendChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  memoryFriendChip: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  memoryFriendChipText: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 12,
    lineHeight: 14
  },
  dishStack: {
    gap: 10
  },
  dishRow: {
    alignItems: "stretch",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    gap: 10,
    paddingBottom: 14,
    paddingTop: 6
  },
  dishInput: {
    ...fontStyles.medium,
    color: c.cream,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    minWidth: 0,
    padding: 0
  },
  dishInputRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.s,
    justifyContent: "space-between"
  },
  dishRatingRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  ratingLabel: {
    ...fontStyles.semiBold,
    color: c.muted,
    fontSize: 11,
    lineHeight: 14
  },
  stars: {
    flexDirection: "row",
    gap: 5
  },
  starButton: {
    padding: 2
  },
  removeDishButton: {
    padding: 4
  },
  dishSuggestionList: {
    gap: 2
  },
  dishSuggestionItem: {
    paddingLeft: 30,
    paddingVertical: 5
  },
  dishSuggestionText: {
    ...fontStyles.medium,
    color: c.gold,
    fontSize: 13,
    lineHeight: 17
  },
  didYouMeanRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.s,
    justifyContent: "space-between",
    paddingLeft: 30
  },
  didYouMeanText: {
    ...fontStyles.medium,
    color: c.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 0
  },
  didYouMeanActions: {
    flexDirection: "row",
    gap: spacing.s
  },
  didYouMeanButton: {
    paddingHorizontal: 4,
    paddingVertical: 2
  },
  didYouMeanButtonText: {
    ...fontStyles.semiBold,
    color: c.gold,
    fontSize: 12,
    lineHeight: 16
  },
  didYouMeanKeepText: {
    ...fontStyles.semiBold,
    color: c.muted,
    fontSize: 12,
    lineHeight: 16
  },
  addDishButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 5,
    paddingBottom: 2,
    paddingTop: 2
  },
  addDishText: {
    ...fontStyles.medium,
    color: c.gold,
    fontSize: 13,
    lineHeight: 17
  },
  captionRow: {
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingTop: 2
  },
  captionInput: {
    ...fontStyles.regular,
    backgroundColor: "transparent",
    color: c.cream,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 72,
    padding: 0
  },
  tagGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingTop: 2
  },
  customTagRow: {
    alignItems: "center",
    borderBottomColor: c.border,
    borderBottomWidth: 1,
    flexBasis: "100%",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: 0,
    paddingBottom: 12,
    paddingTop: 4
  },
  customTagInput: {
    ...fontStyles.bold,
    color: c.cream,
    flex: 1,
    fontSize: 13,
    minWidth: 0,
    padding: 0
  },
  tagCount: {
    ...fontStyles.medium,
    color: c.muted,
    fontSize: 10,
    lineHeight: 13
  },
  selectedTagGrid: {
    flexBasis: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  selectedTagPill: {
    alignItems: "center",
    backgroundColor: c.orangeDim,
    borderColor: c.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  selectedTagText: {
    ...fontStyles.extraBold,
    color: c.orange,
    fontSize: 11,
    lineHeight: 13
  },
  tagPill: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  tagText: {
    ...fontStyles.extraBold,
    color: c.cream,
    fontSize: 11,
    lineHeight: 13
  },
  visibilityGrid: {
    flex: 1,
    flexDirection: "row",
    gap: 6
  },
  visibilityOption: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 10
  },
  visibilityOptionActive: {
    backgroundColor: c.orangeDim,
    borderColor: c.orange
  },
  visibilityLabel: {
    ...fontStyles.bold,
    color: c.cream,
    fontSize: 11,
    lineHeight: 14
  },
  visibilityLabelActive: {
    color: c.orange
  },
  successBanner: {
    backgroundColor: c.greenDim,
    borderColor: c.greenBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 3,
    padding: spacing.md
  },
  successTitle: {
    ...fontStyles.extraBold,
    color: c.green,
    fontSize: 13,
    lineHeight: 17
  },
  successText: {
    ...fontStyles.regular,
    color: c.cream,
    fontSize: 12,
    lineHeight: 17
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: c.orange,
    borderRadius: radius.pill,
    justifyContent: "center",
    minWidth: 104,
    paddingHorizontal: 20,
    paddingVertical: 13
  },
  submitButtonDisabled: {
    backgroundColor: c.muted,
    opacity: 0.8
  },
  submitText: {
    ...fontStyles.bold,
    color: c.white,
    fontSize: 15,
    letterSpacing: 0.3,
    lineHeight: 18
  },
  inlineError: {
    ...fontStyles.medium,
    color: c.dangerSoft,
    fontSize: 12,
    lineHeight: 17
  },
  photoAttachment: {
    alignItems: "center",
    backgroundColor: c.surface,
    borderColor: c.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 8
  },
  photoThumb: {
    backgroundColor: c.surface,
    borderRadius: radius.sm,
    height: 58,
    width: 58
  },
  photoAttachmentText: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  photoAttachmentTitle: {
    ...fontStyles.bold,
    color: c.cream,
    fontSize: 13,
    lineHeight: 17
  },
  photoAttachmentAction: {
    ...fontStyles.semiBold,
    color: c.orange,
    fontSize: 12,
    lineHeight: 16
  },
  removePhotoButton: {
    padding: 6
  }
  });
}
