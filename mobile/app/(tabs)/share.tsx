import { Image } from "expo-image";
import { Camera, Globe, ImagePlus, Lock, Plus, Star, Store, Tag, Users, Utensils, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SignedOutFeedState } from "@/components/feeds/PostFeed";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCreatePostMutation } from "@/hooks/useCreatePost";
import { pickPostImageFromGallery } from "@/services/mediaPicker";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { FoodItem, Visibility } from "@/types/models";

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

export default function ShareScreen() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const createPost = useCreatePostMutation();
  const [image, setImage] = useState<PickedImage | null>(null);
  const [imageError, setImageError] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [dishes, setDishes] = useState<DraftDish[]>(() => [emptyDish()]);
  const [caption, setCaption] = useState("");
  const [recommended, setRecommended] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [success, setSuccess] = useState("");

  const firstDish = dishes.find((dish) => dish.name.trim()) ?? dishes[0];
  const canSubmit = Boolean(image && restaurantName.trim() && dishes.some((dish) => dish.name.trim() && dish.rating > 0));

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

  function updateDish(key: string, nextDish: Partial<FoodItem>) {
    setDishes((current) => current.map((dish) => (
      dish.key === key ? { ...dish, ...nextDish } : dish
    )));
  }

  function removeDish(key: string) {
    setDishes((current) => current.length > 1 ? current.filter((dish) => dish.key !== key) : current);
  }

  function toggleTag(tag: string) {
    setSelectedTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      if (current.length >= 5) return current;
      return [...current, tag];
    });
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
        recommended,
        restaurantName,
        tags: selectedTags,
        visibility
      });
      setImage(null);
      setRestaurantName("");
      setDishes([emptyDish()]);
      setCaption("");
      setRecommended(true);
      setSelectedTags([]);
      setVisibility("public");
      setSuccess("Post shared. Your feeds and profile are refreshing.");
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Share a spot</Text>
      </View>

      <View style={styles.stack}>
        {!isReady ? (
          <LoadingState message="Restoring your session." title="Loading" />
        ) : !isAuthenticated ? (
          <SignedOutFeedState message="Sign in to share a real food post." />
        ) : (
          <>
            <FormSection label="Media">
              <Pressable onPress={pickImage} style={[styles.photoPicker, image && styles.photoPickerFilled]}>
                {image ? (
                  <>
                    <Image source={{ uri: image.uri }} style={styles.photo} contentFit="cover" />
                    <View style={styles.photoOverlay}>
                      <Camera size={15} color={colors.dark.white} strokeWidth={2.2} />
                      <Text style={styles.photoOverlayText}>Change photo</Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.photoEmpty}>
                    <View style={styles.photoIcon}>
                      <ImagePlus size={30} color={colors.dark.orange} strokeWidth={2} />
                    </View>
                    <Text style={styles.photoTitle}>Add food photo</Text>
                    <Text style={styles.photoText}>Choose a real photo from your gallery.</Text>
                  </View>
                )}
              </Pressable>
              {imageError ? <InlineError message={imageError} /> : null}
            </FormSection>

            <FormSection label="Restaurant">
              <IconField
                Icon={Store}
                onChangeText={setRestaurantName}
                placeholder="e.g. Bawarchi"
                value={restaurantName}
              />
            </FormSection>

            <FormSection label="Dishes">
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
                <View style={styles.addDishIcon}>
                  <Plus size={15} color={colors.dark.orange} strokeWidth={2.4} />
                </View>
                <Text style={styles.addDishText}>Add more dishes</Text>
              </Pressable>
            </FormSection>

            <FormSection label="Your one line" optional>
              <TextInput
                multiline
                onChangeText={setCaption}
                placeholder="Write something..."
                placeholderTextColor={colors.dark.muted}
                style={styles.captionInput}
                textAlignVertical="top"
                value={caption}
              />
            </FormSection>

            <FormSection label="Tags" optional>
              <View style={styles.tagGrid}>
                {tagOptions.map((tag) => {
                  const active = selectedTags.includes(tag.label);
                  return (
                    <Pressable
                      key={tag.label}
                      onPress={() => toggleTag(tag.label)}
                      style={[styles.tagPill, active && styles.tagPillActive]}
                    >
                      <Tag size={10} color={active ? colors.dark.orange : colors.dark.muted} strokeWidth={2.2} />
                      <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </FormSection>

            <FormSection label="Share with">
              <View style={styles.visibilityGrid}>
                {visibilityOptions.map(({ Icon, label, sub, value }) => {
                  const active = visibility === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setVisibility(value)}
                      style={[styles.visibilityOption, active && styles.visibilityOptionActive]}
                    >
                      <Icon size={18} color={active ? colors.dark.orange : colors.dark.muted} strokeWidth={1.9} />
                      <Text style={[styles.visibilityLabel, active && styles.visibilityLabelActive]}>{label}</Text>
                      <Text style={styles.visibilitySub}>{sub}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </FormSection>

            <Pressable onPress={() => setRecommended((value) => !value)} style={styles.recommendRow}>
              <View style={[styles.recommendCheck, recommended && styles.recommendCheckActive]}>
                <Star
                  size={13}
                  color={recommended ? colors.dark.bg : colors.dark.muted}
                  fill={recommended ? colors.dark.bg : "transparent"}
                  strokeWidth={2}
                />
              </View>
              <Text style={styles.recommendText}>{recommended ? "Worth recommending" : "Keep as a note, not a recommendation"}</Text>
            </Pressable>

            {createPost.isError ? (
              <ErrorState message={createPost.error.message} title="Could not share post" />
            ) : null}
            {success ? (
              <EmptyState icon="checkmark-circle-outline" message={success} title="Shared" />
            ) : null}

            <Pressable
              disabled={!canSubmit || createPost.isPending}
              onPress={submit}
              style={[styles.submitButton, (!canSubmit || createPost.isPending) && styles.submitButtonDisabled]}
            >
              <Text style={styles.submitText}>{createPost.isPending ? "Posting..." : "Post it"}</Text>
            </Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}

function FormSection({
  children,
  label,
  optional
}: {
  children: React.ReactNode;
  label: string;
  optional?: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {optional ? <Text style={styles.optional}>optional</Text> : null}
      </View>
      {children}
    </View>
  );
}

function IconField({
  Icon,
  onChangeText,
  placeholder,
  value
}: {
  Icon: typeof Store;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.iconField}>
      <Icon size={16} color={colors.dark.orange} strokeWidth={1.9} />
      <TextInput
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.dark.muted}
        style={styles.fieldInput}
        value={value}
      />
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
      <Utensils size={16} color={colors.dark.green} strokeWidth={1.9} />
      <TextInput
        onChangeText={(name) => onChange({ name })}
        placeholder="e.g. Mutton Biryani"
        placeholderTextColor={colors.dark.muted}
        style={styles.dishInput}
        value={dish.name}
      />
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable
            key={star}
            onPress={() => onChange({ rating: dish.rating === star ? 0 : star })}
            style={styles.starButton}
          >
            <Star
              size={16}
              color={colors.dark.gold}
              fill={star <= dish.rating ? colors.dark.gold : "transparent"}
              strokeWidth={1.8}
            />
          </Pressable>
        ))}
      </View>
      {showRemove ? (
        <Pressable onPress={onRemove} style={styles.removeDishButton}>
          <X size={14} color={colors.dark.muted} strokeWidth={2.1} />
        </Pressable>
      ) : null}
    </View>
  );
}

function InlineError({ message }: { message: string }) {
  return <Text style={styles.inlineError}>{message}</Text>;
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: spacing.sm
  },
  title: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 20,
    lineHeight: 25
  },
  stack: {
    gap: spacing.base
  },
  section: {
    gap: spacing.sm
  },
  labelRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 6
  },
  label: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 13,
    textTransform: "uppercase"
  },
  optional: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 10,
    lineHeight: 13
  },
  photoPicker: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderStyle: "dashed",
    borderWidth: 1,
    minHeight: 220,
    overflow: "hidden"
  },
  photoPickerFilled: {
    borderStyle: "solid"
  },
  photo: {
    aspectRatio: 4 / 5,
    width: "100%"
  },
  photoOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.56)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    bottom: spacing.md,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    position: "absolute",
    right: spacing.md
  },
  photoOverlayText: {
    ...fontStyles.bold,
    color: colors.dark.white,
    fontSize: 12
  },
  photoEmpty: {
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 220,
    justifyContent: "center",
    padding: spacing.xl
  },
  photoIcon: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.pill,
    height: 54,
    justifyContent: "center",
    width: 54
  },
  photoTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 17,
    marginTop: spacing.xs,
    textAlign: "center"
  },
  photoText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center"
  },
  iconField: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.s,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  fieldInput: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    minWidth: 0,
    padding: 0
  },
  dishStack: {
    gap: spacing.sm
  },
  dishRow: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.s,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  dishInput: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    minWidth: 0,
    padding: 0
  },
  stars: {
    flexDirection: "row",
    gap: 2
  },
  starButton: {
    padding: 1
  },
  removeDishButton: {
    paddingLeft: spacing.xs
  },
  addDishButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    paddingTop: spacing.sm
  },
  addDishIcon: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.pill,
    height: 22,
    justifyContent: "center",
    width: 22
  },
  addDishText: {
    ...fontStyles.medium,
    color: colors.dark.orange,
    fontSize: 13,
    lineHeight: 17
  },
  captionInput: {
    ...fontStyles.medium,
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 86,
    padding: 14
  },
  tagGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  tagPill: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  tagPillActive: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder
  },
  tagText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 11,
    lineHeight: 13
  },
  tagTextActive: {
    color: colors.dark.orange
  },
  visibilityGrid: {
    flexDirection: "row",
    gap: spacing.sm
  },
  visibilityOption: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1.5,
    flex: 1,
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 13
  },
  visibilityOptionActive: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orange
  },
  visibilityLabel: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 12,
    lineHeight: 15
  },
  visibilityLabelActive: {
    color: colors.dark.orange
  },
  visibilitySub: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: "center"
  },
  recommendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  recommendCheck: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26
  },
  recommendCheckActive: {
    backgroundColor: colors.dark.gold,
    borderColor: colors.dark.gold
  },
  recommendText: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 13,
    lineHeight: 18
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.card,
    justifyContent: "center",
    paddingVertical: 16
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
  }
});
