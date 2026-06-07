import { Image, type ImageSource } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft, Bookmark, Camera, ChevronRight, Globe, Heart, ImagePlus, Lock, MapPin, MessageCircle, PenLine, Plus, Share2, Star, Store, Tag, UserPlus, Users, Utensils, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignedOutFeedState } from "@/components/feeds/PostFeed";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCreatePostMutation } from "@/hooks/useCreatePost";
import { useCreateMemoryRoomMutation } from "@/hooks/useMemories";
import {
  imageFromRecentAsset,
  listRecentPostImages,
  pickPostImageFromCamera,
  pickPostImageFromGallery,
  type RecentPostImage
} from "@/services/mediaPicker";
import {
  autocompletePlaces,
  compactPlaceLocation,
  createPlacesSessionToken,
  placeDetails,
  selectedPlaceFromSuggestion,
  type PlaceSuggestion,
  type SelectedPlace
} from "@/services/places";
import { searchUserProfiles, type UserSearchResult } from "@/services/profiles";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import type { FoodItem, Visibility } from "@/types/models";

const POST_BITE_IMAGE = require("../../assets/create/post-bite-card-bg.png");
const TABLE_MEMORY_IMAGE = require("../../assets/create/table-memory-card-bg.png");
const ACTION_CARD_HEIGHT = Platform.OS === "web" ? 286 : 252;

type PickedImage = {
  mimeType?: string | null;
  uri: string;
};

type DraftDish = FoodItem & {
  key: string;
};

type ReviewTag = {
  label: string;
};

type ShareMode = "choice" | "solo" | "friends";
type SoloStep = "details" | "media" | "preview";

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const actor = useSessionStore((state) => state.profile);
  const createPost = useCreatePostMutation();
  const createMemoryRoom = useCreateMemoryRoomMutation();
  const [shareMode, setShareMode] = useState<ShareMode>("choice");
  const [soloStep, setSoloStep] = useState<SoloStep>("details");
  const [image, setImage] = useState<PickedImage | null>(null);
  const [imageError, setImageError] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantPlace, setRestaurantPlace] = useState<SelectedPlace | null>(null);
  const [dishes, setDishes] = useState<DraftDish[]>(() => [emptyDish()]);
  const [caption, setCaption] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [success, setSuccess] = useState("");
  const [memoryRestaurantName, setMemoryRestaurantName] = useState("");
  const [memoryRestaurantPlace, setMemoryRestaurantPlace] = useState<SelectedPlace | null>(null);
  const [memoryParticipants, setMemoryParticipants] = useState("");
  const [memoryParticipantInput, setMemoryParticipantInput] = useState("");
  const [memoryFriendFocused, setMemoryFriendFocused] = useState(false);
  const [memoryFriendSuggestions, setMemoryFriendSuggestions] = useState<UserSearchResult[]>([]);
  const [memoryFriendsLoading, setMemoryFriendsLoading] = useState(false);
  const [recentImages, setRecentImages] = useState<RecentPostImage[]>([]);
  const [recentImagesLoading, setRecentImagesLoading] = useState(false);

  const firstDish = dishes.find((dish) => dish.name.trim()) ?? dishes[0];
  const memoryParticipantNames = splitUsernames(memoryParticipants);
  const hasSelectedRestaurant = selectedPlaceMatches(restaurantName, restaurantPlace);
  const hasSelectedMemoryRestaurant = selectedPlaceMatches(memoryRestaurantName, memoryRestaurantPlace);
  const hasSoloDetails = Boolean(hasSelectedRestaurant && dishes.some((dish) => dish.name.trim() && dish.rating > 0));
  const canSubmit = Boolean(image && hasSoloDetails);
  const soloHeaderActionLabel = soloStep === "preview" ? "Post" : "Next";
  const soloHeaderActionDisabled = soloStep === "details"
    ? !hasSoloDetails
    : soloStep === "media"
      ? !image
      : !canSubmit || createPost.isPending;
  const canCreateMemory = Boolean(hasSelectedMemoryRestaurant && memoryParticipantNames.length > 0);
  const showGallerySheet = isReady && isAuthenticated && shareMode === "solo" && soloStep === "media";
  const previewAuthorName = actor?.displayName || actor?.username || "You";
  const previewInitials = previewAuthorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "Y";
  const previewTags = selectedTags;

  useEffect(() => {
    if (shareMode !== "solo" || soloStep !== "media") return;

    let alive = true;
    setRecentImagesLoading(true);
    listRecentPostImages()
      .then((result) => {
        if (!alive) return;
        setRecentImages(result.assets);
        if (result.error) setImageError(result.error);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setImageError(error instanceof Error ? error.message : "Could not load recent photos.");
      })
      .finally(() => {
        if (alive) setRecentImagesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [shareMode, soloStep]);

  useEffect(() => {
    if (shareMode !== "friends") return;

    const query = memoryParticipantInput.trim();
    if (query.replace(/^@/, "").length < 2) {
      setMemoryFriendsLoading(false);
      setMemoryFriendSuggestions([]);
      return;
    }

    let alive = true;
    setMemoryFriendsLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const excludedUsernames = [
          ...splitUsernames(memoryParticipants),
          actor?.username ?? ""
        ].filter(Boolean);
        const suggestions = await searchUserProfiles(query, excludedUsernames);
        if (!alive) return;
        setMemoryFriendSuggestions(suggestions);
      } catch {
        if (!alive) return;
        setMemoryFriendSuggestions([]);
      } finally {
        if (alive) setMemoryFriendsLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [actor?.username, memoryParticipantInput, memoryParticipants, shareMode]);

  function cancelShareMode() {
    setShareMode("choice");
    setSoloStep("details");
  }

  function openSolo() {
    setShareMode("solo");
    setSoloStep("details");
  }

  function handleSoloHeaderAction() {
    if (soloStep === "details") {
      setSoloStep("media");
      return;
    }

    if (soloStep === "media") {
      setSoloStep("preview");
      return;
    }

    void submit();
  }

  function handleSoloBackAction() {
    if (soloStep === "preview") {
      setSoloStep("media");
      return;
    }
    if (soloStep === "media") {
      setSoloStep("details");
      return;
    }
    cancelShareMode();
  }

  async function pickImage() {
    setImageError("");
    setSuccess("");
    const result = await pickPostImageFromGallery();
    if (result.error) {
      setImageError(result.error);
      return;
    }
    if (result.asset) {
      setImage({
        mimeType: result.asset.mimeType,
        uri: result.asset.uri
      });
    }
  }

  async function pickCameraImage() {
    setImageError("");
    setSuccess("");
    const result = await pickPostImageFromCamera();
    if (result.error) {
      setImageError(result.error);
      return;
    }
    if (result.asset) {
      setImage({
        mimeType: result.asset.mimeType,
        uri: result.asset.uri
      });
    }
  }

  async function selectRecentImage(asset: RecentPostImage) {
    setImageError("");
    setSuccess("");
    const result = await imageFromRecentAsset(asset);
    setImage({
      mimeType: result.asset.mimeType,
      uri: result.asset.uri
    });
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
    setMemoryFriendSuggestions([]);
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
    if (!image) {
      setImageError("Add at least one photo.");
      return;
    }

    try {
      const normalizedDishes = dishes
        .map((dish) => ({ name: dish.name.trim(), rating: dish.rating }))
        .filter((dish) => dish.name);

      await createPost.mutateAsync({
        caption,
        dishes: normalizedDishes,
        dishName: firstDish?.name ?? "",
        imageMimeType: image.mimeType,
        imageUri: image.uri,
        rating: firstDish?.rating || 0,
        recommended: true,
        restaurantAddress: restaurantPlace?.formattedAddress,
        restaurantArea: restaurantPlace?.shortFormattedAddress,
        restaurantId: restaurantPlace?.placeId,
        restaurantLat: restaurantPlace?.latitude,
        restaurantLng: restaurantPlace?.longitude,
        restaurantName: restaurantPlace?.name ?? restaurantName,
        tags: selectedTags,
        visibility
      });
      setImage(null);
      setRestaurantName("");
      setRestaurantPlace(null);
      setDishes([emptyDish()]);
      setCaption("");
      setCustomTag("");
      setSelectedTags([]);
      setVisibility("public");
      setSoloStep("details");
      setSuccess("Post shared. Your feeds and profile are refreshing.");
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function submitMemoryRoom() {
    setSuccess("");
    try {
      const result = await createMemoryRoom.mutateAsync({
        participantUsernames: splitUsernames(memoryParticipants),
        area: memoryRestaurantPlace?.shortFormattedAddress,
        restaurantId: memoryRestaurantPlace?.placeId,
        restaurantName: memoryRestaurantPlace?.name ?? memoryRestaurantName
      });
      setMemoryRestaurantName("");
      setMemoryRestaurantPlace(null);
      setMemoryParticipants("");
      setMemoryParticipantInput("");
      router.push({ pathname: "/memories/[id]", params: { id: result.id } });
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <Screen padded={false} style={styles.screenContent}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (showGallerySheet ? 258 : spacing.xl) + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          {isReady && isAuthenticated && shareMode !== "choice" ? (
            <Pressable
              accessibilityLabel={shareMode === "solo" && soloStep !== "details" ? "Back" : "Cancel share"}
              onPress={shareMode === "solo" ? handleSoloBackAction : cancelShareMode}
              style={styles.headerCancelButton}
            >
              {shareMode === "solo" && soloStep !== "details" ? (
                <ArrowLeft size={20} color={colors.dark.cream} strokeWidth={2.4} />
              ) : (
                <X size={20} color={colors.dark.cream} strokeWidth={2.4} />
              )}
            </Pressable>
          ) : null}
          <View style={styles.headerText}>
            {shareMode === "solo" || shareMode === "friends" ? null : (
              <>
                <Text style={styles.title}>Create</Text>
                <Text style={styles.subtitle}>Choose how you want to capture this meal.</Text>
              </>
            )}
          </View>
          {isReady && isAuthenticated && shareMode === "solo" ? (
            <Pressable
              disabled={soloHeaderActionDisabled}
              onPress={handleSoloHeaderAction}
              style={[styles.headerSubmitButton, soloHeaderActionDisabled && styles.submitButtonDisabled]}
            >
              <Text style={styles.headerSubmitText}>{createPost.isPending ? "Posting..." : soloHeaderActionLabel}</Text>
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
            <View style={styles.choiceStack}>
              <ActionCard
                Icon={PenLine}
                accent="orange"
                cta="Capture Dish"
                CtaIcon={Camera}
                description="Share the dish worth talking about."
                imageSource={POST_BITE_IMAGE}
                onPress={openSolo}
                tags={["Photo", "Rating"]}
                title="Post a Bite"
              />
              <ActionCard
                Icon={Users}
                accent="green"
                cta="Create Room"
                CtaIcon={UserPlus}
                description="Capture private table memories with friends."
                imageSource={TABLE_MEMORY_IMAGE}
                onPress={() => setShareMode("friends")}
                tags={["Private", "Invite friends"]}
                title="Shared Bite"
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
                          placeholderTextColor={colors.dark.muted}
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
                        <Plus size={14} color={colors.dark.green} strokeWidth={2.4} />
                        <Text style={styles.addDishText}>Add another dish</Text>
                      </Pressable>

                      <View style={styles.tagGrid}>
                        <View style={styles.customTagRow}>
                          <Tag size={20} color={colors.dark.orange} strokeWidth={2} />
                          <TextInput
                            autoCapitalize="none"
                            editable={selectedTags.length < 5}
                            onChangeText={setCustomTag}
                            onSubmitEditing={addCustomTag}
                            placeholder={selectedTags.length >= 5 ? "Max 5 tags reached" : "Add your own tag"}
                            placeholderTextColor={colors.dark.muted}
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
                                <Tag size={10} color={colors.dark.orange} strokeWidth={2.2} />
                                <Text style={styles.selectedTagText}>{tag}</Text>
                                <X size={11} color={colors.dark.orange} strokeWidth={2.4} />
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
                              <Tag size={10} color={colors.dark.muted} strokeWidth={2.2} />
                              <Text style={styles.tagText}>{tag.label}</Text>
                            </Pressable>
                          )) : null}
                      </View>

                    </View>
                  ) : soloStep === "media" ? (
                    <View style={styles.mediaStep}>
                      <Pressable onPress={pickImage} style={[styles.requiredPhotoBox, image && styles.requiredPhotoBoxFilled]}>
                        {image ? (
                          <>
                            <Image source={{ uri: image.uri }} style={styles.requiredPhotoPreview} contentFit="cover" />
                            <View style={styles.requiredPhotoBadge}>
                              <Text style={styles.requiredPhotoBadgeText}>Required photo</Text>
                            </View>
                            <View style={styles.requiredPhotoAction}>
                              <ImagePlus size={14} color={colors.dark.white} strokeWidth={2.1} />
                              <Text style={styles.requiredPhotoActionText}>Change</Text>
                            </View>
                            <Pressable onPress={() => setImage(null)} style={styles.requiredPhotoRemove}>
                              <X size={15} color={colors.dark.white} strokeWidth={2.2} />
                            </Pressable>
                          </>
                        ) : (
                          <View style={styles.requiredPhotoEmpty}>
                            <View style={styles.requiredPhotoIcon}>
                              <ImagePlus size={28} color={colors.dark.orange} strokeWidth={2} />
                            </View>
                            <View style={styles.requiredPhotoTextBlock}>
                              <View style={styles.requiredPhotoTitleRow}>
                                <Text style={styles.requiredPhotoTitle}>Add food photo</Text>
                                <Text style={styles.requiredPill}>Required</Text>
                              </View>
                              <Text style={styles.requiredPhotoText}>Add a photo, then tap Next to preview your post.</Text>
                            </View>
                          </View>
                        )}
                      </Pressable>
                      {imageError ? <InlineError message={imageError} /> : null}
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
                          </View>

                          <View style={styles.previewBody}>
                            {caption.trim() ? <Text style={styles.previewCaption}>{caption.trim()}</Text> : null}

                            {previewTags.length > 0 ? (
                              <View style={styles.previewFeedTags}>
                                {previewTags.map((tag) => (
                                  <View key={tag} style={styles.previewFeedTag}>
                                    <Text style={styles.previewFeedTagText}>{tag}</Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}

                            <View style={styles.previewFeedDishes}>
                              {dishes
                                .filter((dish) => dish.name.trim())
                                .map((dish) => (
                                  <View key={dish.key} style={styles.previewFeedDish}>
                                    <Text numberOfLines={1} style={styles.previewFeedDishName}>{dish.name.trim()}</Text>
                                    {dish.rating > 0 ? (
                                      <View style={styles.previewRatingPill}>
                                        <Star size={8} color={colors.dark.gold} fill={colors.dark.gold} strokeWidth={0} />
                                        <Text style={styles.previewRatingText}>{dish.rating}</Text>
                                      </View>
                                    ) : null}
                                  </View>
                                ))}
                            </View>
                          </View>
                        </View>

                        {image ? (
                          <View style={styles.previewMediaWrap}>
                            <Image source={{ uri: image.uri }} style={styles.previewImage} contentFit="cover" />
                          </View>
                        ) : null}

                        <View style={styles.previewActions}>
                          <View style={styles.previewActionCluster}>
                            <View style={styles.previewAction}>
                              <Heart size={19} color={colors.dark.muted} strokeWidth={2} />
                              <Text style={styles.previewActionText}>0</Text>
                            </View>
                            <View style={styles.previewAction}>
                              <MessageCircle size={18} color={colors.dark.muted} strokeWidth={2} />
                              <Text style={styles.previewActionText}>0</Text>
                            </View>
                            <View style={styles.previewAction}>
                              <Utensils size={17} color={colors.dark.muted} strokeWidth={2} />
                              <Text style={styles.previewActionText}>{dishes.filter((dish) => dish.name.trim()).length}</Text>
                            </View>
                          </View>
                          <View style={styles.previewIconButton}>
                            <Bookmark size={19} color={colors.dark.muted} strokeWidth={2} />
                          </View>
                          <View style={styles.previewIconButton}>
                            <Share2 size={18} color={colors.dark.muted} strokeWidth={2} />
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
                                <Icon size={14} color={active ? colors.dark.orange : colors.dark.muted} strokeWidth={2} />
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
                    <PlaceField
                      onChangeText={setMemoryRestaurantName}
                      onSelect={setMemoryRestaurantPlace}
                      placeholder="Place name"
                      selectedPlace={memoryRestaurantPlace}
                      value={memoryRestaurantName}
                    />

                    <View style={styles.memoryFriendSection}>
                      <View style={styles.restaurantAttachment}>
                        <UserPlus size={20} color={colors.dark.orange} strokeWidth={1.9} />
                        <TextInput
                          autoCapitalize="none"
                          onChangeText={setMemoryParticipantInput}
                          onBlur={() => {
                            setTimeout(() => setMemoryFriendFocused(false), 150);
                          }}
                          onFocus={() => setMemoryFriendFocused(true)}
                          onSubmitEditing={() => addMemoryParticipant()}
                          placeholder="Add friend"
                          placeholderTextColor={colors.dark.muted}
                          returnKeyType="done"
                          style={styles.fieldInput}
                          value={memoryParticipantInput}
                        />
                      </View>
                      {memoryFriendFocused && (memoryFriendsLoading || memoryFriendSuggestions.length > 0 || memoryParticipantInput.trim().replace(/^@/, "").length >= 2) ? (
                        <View style={styles.friendSuggestions}>
                          {memoryFriendsLoading ? (
                            <View style={styles.placeSuggestionLoading}>
                              <ActivityIndicator color={colors.dark.orange} size="small" />
                              <Text style={styles.placeSuggestionMuted}>Searching people</Text>
                            </View>
                          ) : null}
                          {!memoryFriendsLoading && memoryFriendSuggestions.length === 0 ? (
                            <View style={styles.placeSuggestionLoading}>
                              <Text style={styles.placeSuggestionMuted}>No people found</Text>
                            </View>
                          ) : null}
                          {memoryFriendSuggestions.map((friend) => (
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
                              <ChevronRight size={16} color={colors.dark.muted} strokeWidth={2.2} />
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                      {memoryParticipantNames.length > 0 ? (
                        <View style={styles.memoryFriendChips}>
                          {memoryParticipantNames.map((friend) => (
                            <Pressable key={friend} onPress={() => removeMemoryParticipant(friend)} style={styles.memoryFriendChip}>
                              <Text style={styles.memoryFriendChipText}>@{friend}</Text>
                              <X size={12} color={colors.dark.muted} strokeWidth={2.4} />
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {createMemoryRoom.isError ? (
                    <ErrorState message={createMemoryRoom.error.message} title="Could not create room" />
                  ) : null}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
      {showGallerySheet ? (
        <View style={[styles.gallerySheet, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <View style={styles.galleryHandle} />
          <View style={styles.galleryHeader}>
            <Text style={styles.galleryTitle}>Recent photos</Text>
            <Pressable onPress={pickImage}>
              <Text style={styles.galleryLibraryAction}>Open library</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryStrip}>
            <Pressable onPress={pickCameraImage} style={styles.cameraTile}>
              <Camera size={24} color={colors.dark.cream} strokeWidth={2.2} />
              <Text style={styles.cameraTileText}>Camera</Text>
            </Pressable>
            {recentImages.map((asset) => (
              <Pressable key={asset.id} onPress={() => void selectRecentImage(asset)} style={styles.galleryTile}>
                <Image source={{ uri: asset.uri }} style={styles.galleryImage} contentFit="cover" />
                {image?.uri === asset.uri ? (
                  <View style={styles.gallerySelectedBadge}>
                    <Text style={styles.gallerySelectedText}>Selected</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
            {!recentImagesLoading && recentImages.length === 0 ? (
              <View style={styles.galleryEmptyTile}>
                <Text style={styles.galleryEmptyText}>No recent photos</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </Screen>
  );
}

function ActionCard({
  CtaIcon,
  Icon,
  accent,
  cta,
  description,
  imageSource,
  onPress,
  tags,
  title
}: {
  accent: "green" | "orange";
  cta: string;
  CtaIcon?: typeof Users;
  description: string;
  Icon: typeof Users;
  imageSource: ImageSource;
  onPress: () => void;
  tags: string[];
  title: string;
}) {
  const isGreen = accent === "green";
  const accentColor = isGreen ? colors.dark.green : colors.dark.orange;
  const gradientColors: readonly [string, string, string] = isGreen
    ? ["rgba(61, 214, 140, 0.18)", "rgba(20, 184, 166, 0.08)", "rgba(33, 28, 23, 0.98)"]
    : ["rgba(240, 96, 48, 0.22)", "rgba(232, 168, 48, 0.08)", "rgba(33, 28, 23, 0.98)"];

  return (
    <Pressable onPress={onPress} style={[styles.actionCard, isGreen ? styles.actionCardGreen : styles.actionCardOrange]}>
      <Image source={imageSource} style={styles.actionBackgroundImage} contentFit="cover" contentPosition="right center" />
      <LinearGradient colors={gradientColors} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={StyleSheet.absoluteFillObject} />
      <LinearGradient
        colors={["rgba(12, 9, 7, 0.28)", "rgba(12, 9, 7, 0.08)", "rgba(12, 9, 7, 0.18)"]}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.actionContent}>
        <View style={[styles.actionIcon, isGreen ? styles.actionIconGreen : styles.actionIconOrange]}>
          <Icon size={22} color={accentColor} strokeWidth={2.3} />
        </View>
        <Text numberOfLines={2} style={styles.actionTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.actionDescription}>{description}</Text>
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

function ChoiceChip({ accent, label }: { accent: "green" | "orange"; label: string }) {
  const isGreen = accent === "green";
  return (
    <View style={[styles.actionChip, isGreen ? styles.actionChipGreen : styles.actionChipOrange]}>
      <Text style={[styles.actionChipText, { color: isGreen ? colors.dark.green : colors.dark.orange }]}>
        {label}
      </Text>
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
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectingPlaceId, setSelectingPlaceId] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState(() => createPlacesSessionToken());
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2 || selectedPlaceMatches(value, selectedPlace)) {
      setLoading(false);
      setSuggestions([]);
      return;
    }

    let alive = true;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const nextSuggestions = await autocompletePlaces(query, sessionToken);
        if (!alive) return;
        setSuggestions(nextSuggestions);
      } catch {
        if (!alive) return;
        setSuggestions([]);
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
      setSessionToken(createPlacesSessionToken());
    } finally {
      setSelectingPlaceId(null);
    }
  }

  const showSuggestions = focused && (loading || suggestions.length > 0);
  const selectedLocationLabel = selectedPlaceMatches(value, selectedPlace)
    ? compactPlaceLocation(selectedPlace)
    : "";

  return (
    <View style={styles.placeField}>
      <View style={styles.restaurantAttachment}>
        <Store size={20} color={selectedPlaceMatches(value, selectedPlace) ? colors.dark.green : colors.dark.orange} strokeWidth={1.9} />
        <TextInput
          onBlur={() => setFocused(false)}
          onChangeText={(text) => {
            onChangeText(text);
            onSelect(null);
          }}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={colors.dark.muted}
          style={styles.fieldInput}
          value={value}
        />
      </View>
      {selectedLocationLabel ? (
        <View style={styles.selectedPlaceLocation}>
          <MapPin size={15} color={colors.dark.muted} strokeWidth={2} />
          <Text numberOfLines={2} style={styles.selectedPlaceLocationText}>{selectedLocationLabel}</Text>
        </View>
      ) : null}
      {showSuggestions ? (
        <View style={styles.placeSuggestions}>
          {loading ? (
            <View style={styles.placeSuggestionLoading}>
              <ActivityIndicator color={colors.dark.orange} size="small" />
              <Text style={styles.placeSuggestionMuted}>Searching places</Text>
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
                <ActivityIndicator color={colors.dark.orange} size="small" />
              ) : (
                <ChevronRight size={16} color={colors.dark.muted} strokeWidth={2.2} />
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
  return (
    <View style={styles.dishRow}>
      <View style={styles.dishInputRow}>
        <Utensils size={20} color={colors.dark.green} strokeWidth={1.9} />
        <TextInput
          onChangeText={(name) => onChange({ name })}
          placeholder="Chicken Biriyani"
          placeholderTextColor={colors.dark.muted}
          style={styles.dishInput}
          value={dish.name}
        />
        {showRemove ? (
          <Pressable onPress={onRemove} style={styles.removeDishButton}>
            <X size={14} color={colors.dark.muted} strokeWidth={2.1} />
          </Pressable>
        ) : null}
      </View>
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
                color={colors.dark.gold}
                fill={star <= dish.rating ? colors.dark.gold : "transparent"}
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
  return <Text style={styles.inlineError}>{message}</Text>;
}

const styles = StyleSheet.create({
  screenContent: {
    paddingBottom: 0
  },
  scrollContent: {
    paddingTop: 0,
    position: "relative"
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  headerCancelButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    marginLeft: -10,
    marginRight: spacing.s,
    width: 40
  },
  headerText: {
    flex: 1,
    minWidth: 0
  },
  headerSubmitButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
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
    color: colors.dark.white,
    fontSize: 14,
    lineHeight: 17
  },
  title: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    fontSize: Platform.OS === "web" ? typography.webTitle : 24,
    letterSpacing: 0,
    lineHeight: Platform.OS === "web" ? 32 : 29
  },
  subtitle: {
    ...fontStyles.semiBold,
    color: "rgba(245, 237, 216, 0.62)",
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
    backgroundColor: colors.dark.card,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    height: ACTION_CARD_HEIGHT,
    overflow: "hidden",
    padding: 18,
    position: "relative"
  },
  actionCardOrange: {
    borderColor: "rgba(240, 96, 48, 0.42)",
    shadowColor: colors.dark.orange,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { height: 10, width: 0 },
    elevation: 4
  },
  actionCardGreen: {
    borderColor: "rgba(61, 214, 140, 0.34)",
    shadowColor: colors.dark.green,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { height: 10, width: 0 },
    elevation: 4
  },
  actionBackgroundImage: {
    ...StyleSheet.absoluteFillObject
  },
  actionContent: {
    flex: 1,
    minWidth: 0,
    maxWidth: "62%",
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
  actionIconGreen: {
    backgroundColor: "rgba(61, 214, 140, 0.14)",
    borderColor: "rgba(61, 214, 140, 0.30)"
  },
  actionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 24,
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
  actionChipGreen: {
    backgroundColor: "rgba(61, 214, 140, 0.10)",
    borderColor: "rgba(61, 214, 140, 0.22)"
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
  mediaStep: {
    gap: spacing.md
  },
  requiredPhotoBox: {
    backgroundColor: "rgba(14, 11, 8, 0.40)",
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.md,
    borderStyle: "dashed",
    borderWidth: 1,
    minHeight: 176,
    overflow: "hidden"
  },
  requiredPhotoBoxFilled: {
    borderColor: "rgba(245, 237, 216, 0.12)",
    borderStyle: "solid"
  },
  requiredPhotoPreview: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.dark.surface,
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
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
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
    color: colors.dark.cream,
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center"
  },
  requiredPill: {
    ...fontStyles.extraBold,
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.dark.orange,
    fontSize: 10,
    lineHeight: 13,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  requiredPhotoText: {
    ...fontStyles.medium,
    color: colors.dark.muted,
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
    color: colors.dark.cream,
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
    color: colors.dark.white,
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
    backgroundColor: colors.dark.bg,
    borderBottomColor: "rgba(46, 39, 32, 0.78)",
    borderBottomWidth: 1
  },
  previewFeedHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 12,
    paddingRight: 8,
    paddingTop: 14
  },
  previewAvatar: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderColor: "rgba(245, 237, 216, 0.14)",
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  previewAvatarText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
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
    color: colors.dark.cream,
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18
  },
  previewHeaderDot: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 15,
    lineHeight: 18
  },
  previewHeaderMeta: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 18
  },
  previewSharedContext: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 15
  },
  previewContentBlock: {
    paddingBottom: 12
  },
  previewPlaceBlock: {
    paddingBottom: 0,
    paddingTop: 1
  },
  previewRestaurantName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 18,
    lineHeight: 21,
    marginBottom: 5
  },
  previewBody: {
    paddingBottom: 0,
    paddingTop: 10
  },
  previewImage: {
    aspectRatio: 4 / 5,
    backgroundColor: colors.dark.surface,
    width: "100%"
  },
  previewCaption: {
    ...fontStyles.regular,
    color: "rgba(245, 237, 216, 0.90)",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10
  },
  previewFeedTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10
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
    color: colors.dark.orange,
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
    backgroundColor: "rgba(245, 237, 216, 0.055)",
    borderColor: "rgba(245, 237, 216, 0.10)",
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
    color: colors.dark.cream,
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
    color: colors.dark.gold,
    fontSize: 10,
    lineHeight: 11
  },
  previewMediaWrap: {
    position: "relative"
  },
  previewActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: 8,
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
    color: colors.dark.muted,
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
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
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
    backgroundColor: colors.dark.border,
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
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 18
  },
  galleryLibraryAction: {
    ...fontStyles.bold,
    color: colors.dark.orange,
    fontSize: 12,
    lineHeight: 16
  },
  galleryStrip: {
    gap: spacing.sm,
    paddingBottom: spacing.sm
  },
  cameraTile: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 6,
    justifyContent: "center",
    width: 86
  },
  cameraTileText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 11,
    lineHeight: 13
  },
  galleryTile: {
    aspectRatio: 1,
    backgroundColor: colors.dark.card,
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
    color: colors.dark.white,
    fontSize: 9,
    lineHeight: 11
  },
  galleryEmptyTile: {
    alignItems: "center",
    aspectRatio: 1,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    width: 120
  },
  galleryEmptyText: {
    ...fontStyles.medium,
    color: colors.dark.muted,
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
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.s,
    paddingHorizontal: 0,
    paddingVertical: 14
  },
  fieldInput: {
    ...fontStyles.bold,
    color: colors.dark.cream,
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
    color: colors.dark.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16
  },
  placeSuggestions: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
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
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16
  },
  placeSuggestionRow: {
    alignItems: "center",
    borderTopColor: colors.dark.border,
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
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 17
  },
  placeSuggestionSub: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 15
  },
  memorySetup: {
    gap: spacing.lg
  },
  memoryFriendSection: {
    gap: spacing.sm
  },
  friendSuggestions: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  friendSuggestionRow: {
    alignItems: "center",
    borderTopColor: colors.dark.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    paddingVertical: 10
  },
  friendSuggestionAvatar: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32
  },
  friendSuggestionAvatarText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 11,
    lineHeight: 13
  },
  memoryFriendChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  memoryFriendChip: {
    alignItems: "center",
    backgroundColor: "rgba(245, 237, 216, 0.055)",
    borderColor: "rgba(245, 237, 216, 0.12)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  memoryFriendChipText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 12,
    lineHeight: 14
  },
  dishStack: {
    gap: 10
  },
  dishRow: {
    alignItems: "stretch",
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 1,
    gap: 10,
    paddingBottom: 14,
    paddingTop: 6
  },
  dishInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
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
    color: colors.dark.muted,
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
    color: colors.dark.green,
    fontSize: 13,
    lineHeight: 17
  },
  captionRow: {
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingTop: 2
  },
  captionInput: {
    ...fontStyles.regular,
    backgroundColor: "transparent",
    color: colors.dark.cream,
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
    borderBottomColor: colors.dark.border,
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
    color: colors.dark.cream,
    flex: 1,
    fontSize: 13,
    minWidth: 0,
    padding: 0
  },
  tagCount: {
    ...fontStyles.medium,
    color: colors.dark.muted,
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
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  selectedTagText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 11,
    lineHeight: 13
  },
  tagPill: {
    alignItems: "center",
    backgroundColor: "rgba(14, 11, 8, 0.36)",
    borderColor: "rgba(245, 237, 216, 0.10)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  tagText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
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
    backgroundColor: "rgba(245, 237, 216, 0.04)",
    borderColor: colors.dark.border,
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
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orange
  },
  visibilityLabel: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 11,
    lineHeight: 14
  },
  visibilityLabelActive: {
    color: colors.dark.orange
  },
  successBanner: {
    backgroundColor: colors.dark.greenDim,
    borderColor: colors.dark.greenBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 3,
    padding: spacing.md
  },
  successTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.green,
    fontSize: 13,
    lineHeight: 17
  },
  successText: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    fontSize: 12,
    lineHeight: 17
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.pill,
    justifyContent: "center",
    minWidth: 104,
    paddingHorizontal: 20,
    paddingVertical: 13
  },
  submitButtonDisabled: {
    backgroundColor: colors.dark.muted,
    opacity: 0.8
  },
  submitText: {
    ...fontStyles.bold,
    color: colors.dark.white,
    fontSize: 15,
    letterSpacing: 0.3,
    lineHeight: 18
  },
  inlineError: {
    ...fontStyles.medium,
    color: colors.dark.dangerSoft,
    fontSize: 12,
    lineHeight: 17
  },
  photoAttachment: {
    alignItems: "center",
    backgroundColor: "rgba(14, 11, 8, 0.34)",
    borderColor: "rgba(245, 237, 216, 0.08)",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 8
  },
  photoThumb: {
    backgroundColor: colors.dark.surface,
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
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 17
  },
  photoAttachmentAction: {
    ...fontStyles.semiBold,
    color: colors.dark.orange,
    fontSize: 12,
    lineHeight: 16
  },
  removePhotoButton: {
    padding: 6
  }
});
