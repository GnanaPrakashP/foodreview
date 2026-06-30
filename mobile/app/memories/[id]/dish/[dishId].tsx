import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { Star } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMemoryRoomQuery, useSetMemoryDishRatingMutation } from "@/hooks/useMemories";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { avatarAccents, fontStyles, memoryRoomTokens, radius, screenLayout, spacing } from "@/theme";

function dishInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || "?").toUpperCase();
}

function dishAccent(name: string) {
  const total = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return avatarAccents[total % avatarAccents.length];
}

function formatRating(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(1).replace(/\.0$/, "");
}

export default function DishRatingsScreen() {
  const params = useLocalSearchParams<{ id: string; dishId: string }>();
  const roomId = params.id ?? "";
  const dishId = params.dishId ?? "";
  const { resolvedTheme, themeColors } = useThemePreference();
  const tokens = memoryRoomTokens[resolvedTheme];
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: `/memories/${roomId}?tab=chat` });
  const room = useMemoryRoomQuery(roomId);
  const rateDish = useSetMemoryDishRatingMutation(roomId);
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");

  const dish = room.data?.dishes.find((item) => item.id === dishId) ?? null;
  const pending = rateDish.isPending;
  const myRating = dish?.myRating ?? 0;
  const sortedRatings = dish ? [...dish.ratings].sort((a, b) => b.rating - a.rating) : [];

  return (
    <Animated.View style={[{ backgroundColor: themeColors.bg, flex: 1 }, slideStyle]}>
      <Screen padded={false} scroll={false}>
        <View style={styles.headerWrap}>
          <MemoryRouteHeader backButtonVariant="plain" onBack={close} themeColors={themeColors} title="Table ratings" titleWeight="regular" />
        </View>

        {room.isLoading && !dish ? (
          <View style={styles.stateWrap}>
            <LoadingState message="Fetching the ratings for this dish." title="Loading ratings" />
          </View>
        ) : !dish ? (
          <View style={styles.stateWrap}>
            <ErrorState
              actionLabel="Go back"
              message="This dish may have been removed from the table."
              onAction={close}
              title="Dish not found"
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.dishHeader, { backgroundColor: tokens.surface, borderColor: tokens.divider }]}>
              <View style={[styles.dishIcon, { backgroundColor: dishAccent(dish.dishName) }]}>
                <Text style={styles.dishIconText}>{dish.dishName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.dishHeaderText}>
                <Text numberOfLines={2} style={[styles.dishName, { color: tokens.onSurface }]}>{dish.dishName}</Text>
                <Text numberOfLines={1} style={[styles.dishMeta, { color: tokens.onSurfaceVariant }]}>
                  Added by {dish.addedByDisplayName}
                </Text>
              </View>
              <View style={[styles.ratingPill, { backgroundColor: tokens.goldContainer, borderColor: tokens.goldOutline }]}>
                <Ionicons name={dish.averageRating === null ? "star-outline" : "star"} size={12} color={tokens.gold} />
                <Text style={[styles.ratingPillText, { color: tokens.gold }]}>{formatRating(dish.averageRating)}</Text>
              </View>
            </View>

            {dish.note ? (
              <Text style={[styles.note, { color: tokens.onSurfaceVariant }]}>{dish.note}</Text>
            ) : null}

            <View style={[styles.rateBlock, { backgroundColor: tokens.surface, borderColor: tokens.divider }]}>
              <Text style={[styles.rateLabel, { color: tokens.onSurface }]}>
                {myRating ? `Your rating · ${myRating}/5` : "Tap to rate"}
              </Text>
              <View style={styles.rateStars}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    accessibilityLabel={`Rate ${dish.dishName} ${star} out of 5`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: pending, selected: star <= myRating }}
                    disabled={pending}
                    hitSlop={6}
                    key={star}
                    onPress={() => rateDish.mutate({ dishId: dish.id, rating: star })}
                    style={[styles.rateStarButton, pending && styles.rateStarButtonDisabled]}
                  >
                    <Star
                      size={34}
                      color={tokens.gold}
                      fill={star <= myRating ? tokens.gold : "transparent"}
                      strokeWidth={1.7}
                    />
                  </Pressable>
                ))}
              </View>
            </View>

            {rateDish.error ? <Text style={styles.error}>{rateDish.error.message}</Text> : null}

            <Text style={[styles.sectionTitle, { color: tokens.onSurfaceVariant }]}>
              {dish.ratingCount === 0 ? "Who rated" : `Who rated · ${dish.ratingCount}`}
            </Text>
            {sortedRatings.length === 0 ? (
              <Text style={[styles.emptyRaters, { color: tokens.onSurfaceVariant }]}>
                No one has rated yet — be the first.
              </Text>
            ) : (
              <View style={styles.raterList}>
                {sortedRatings.map((rating) => {
                  const isMe = rating.ratedBy === myUsername;
                  return (
                    <View key={rating.id} style={[styles.raterRow, { backgroundColor: tokens.surface, borderColor: tokens.divider }]}>
                      <View style={[styles.raterAvatar, { backgroundColor: dishAccent(rating.ratedByDisplayName) }]}>
                        <Text style={styles.raterInitial}>{dishInitials(rating.ratedByDisplayName)}</Text>
                      </View>
                      <Text numberOfLines={1} style={[styles.raterName, { color: tokens.onSurface }]}>
                        {isMe ? "You" : rating.ratedByDisplayName}
                      </Text>
                      <View style={styles.raterStars}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            size={15}
                            color={tokens.gold}
                            fill={star <= rating.rating ? tokens.gold : "transparent"}
                            strokeWidth={1.6}
                          />
                        ))}
                        <Text style={[styles.raterValue, { color: tokens.gold }]}>{rating.rating}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </Screen>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.topGap
  },
  stateWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.headerContentGap
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.headerContentGap
  },
  dishHeader: {
    alignItems: "center",
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md
  },
  dishIcon: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  dishIconText: {
    ...fontStyles.extraBold,
    color: "#FFFFFF",
    fontSize: 18
  },
  dishHeaderText: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  dishName: {
    ...fontStyles.extraBold,
    fontSize: 18,
    lineHeight: 22
  },
  dishMeta: {
    ...fontStyles.semiBold,
    fontSize: 12,
    lineHeight: 16
  },
  ratingPill: {
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  ratingPillText: {
    ...fontStyles.extraBold,
    fontSize: 12
  },
  note: {
    ...fontStyles.semiBold,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: spacing.xs
  },
  rateBlock: {
    alignItems: "center",
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg
  },
  rateLabel: {
    ...fontStyles.extraBold,
    fontSize: 13
  },
  rateStars: {
    flexDirection: "row",
    gap: spacing.xs
  },
  rateStarButton: {
    padding: 2
  },
  rateStarButtonDisabled: {
    opacity: 0.5
  },
  error: {
    ...fontStyles.semiBold,
    color: "#E5484D",
    fontSize: 12,
    paddingHorizontal: spacing.xs
  },
  sectionTitle: {
    ...fontStyles.extraBold,
    fontSize: 12,
    letterSpacing: 0.4,
    paddingHorizontal: spacing.xs,
    textTransform: "uppercase"
  },
  emptyRaters: {
    ...fontStyles.semiBold,
    fontSize: 13,
    paddingHorizontal: spacing.xs
  },
  raterList: {
    gap: spacing.xs
  },
  raterRow: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  raterAvatar: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  raterInitial: {
    ...fontStyles.extraBold,
    color: "#FFFFFF",
    fontSize: 12
  },
  raterName: {
    ...fontStyles.semiBold,
    flex: 1,
    fontSize: 14,
    minWidth: 0
  },
  raterStars: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2
  },
  raterValue: {
    ...fontStyles.extraBold,
    fontSize: 12,
    marginLeft: 4
  }
});
