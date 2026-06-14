import { ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { useSettingsCommentsQuery } from "@/hooks/useSettings";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { colors, fontStyles, spacing } from "@/theme";
import type { SettingsCommentItem } from "@/services/settings";

type ThemeColors = ReturnType<typeof themeColorsFor>;
type CommentStyles = ReturnType<typeof createStyles>;

export default function MyCommentsScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const { slideStyle, close } = useSlideOverScreen();
  const comments = useSettingsCommentsQuery();
  const data = comments.data ?? [];

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen padded={false} scroll style={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <MemoryRouteHeader backButtonVariant="plain" onBack={close} themeColors={themeColors} title="My Comments" titleWeight="regular" />
      {comments.isLoading ? (
        <LoadingState message="Fetching comments you wrote." title="Loading comments" />
      ) : comments.isError ? (
        <ErrorState
          actionLabel="Try again"
          message={comments.error.message}
          onAction={() => comments.refetch()}
          title="Comments unavailable"
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon="chatbubble-outline"
          message="Comments you write on posts will appear here."
          title="No comments yet"
        />
      ) : (
        <View style={styles.list}>
          {data.map((comment, index) => (
            <View key={comment.id}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <CommentRow
                comment={comment}
                styles={styles}
                themeColors={themeColors}
                onPress={() => {
                  if (comment.post) router.push({ pathname: "/reviews/[id]", params: { id: comment.post.id } });
                }}
              />
            </View>
          ))}
        </View>
      )}
    </Screen>
    </Animated.View>
  );
}

function CommentRow({ comment, onPress, styles, themeColors }: { comment: SettingsCommentItem; onPress: () => void; styles: CommentStyles; themeColors: ThemeColors }) {
  const post = comment.post;
  const meta = post
    ? `${post.restaurantName} · @${post.reviewerName} · ${commentDate(comment.createdAt)}`
    : `Post unavailable · ${commentDate(comment.createdAt)}`;

  return (
    <Pressable disabled={!post} onPress={onPress} style={({ pressed }) => [styles.commentRow, pressed && post && styles.commentRowPressed]}>
      <Text numberOfLines={4} style={styles.commentText}>{`“${comment.content}”`}</Text>
      <Text numberOfLines={1} style={styles.meta}>{meta}</Text>
      {post ? (
        <View style={styles.viewPostRow}>
          <Text style={styles.viewPost}>View post</Text>
          <ChevronRight size={13} color={themeColors.orange} strokeWidth={2.6} />
        </View>
      ) : null}
    </Pressable>
  );
}

function commentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(date);
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    list: {
      gap: 0
    },
    divider: {
      backgroundColor: c === colors.dark ? "rgba(245, 237, 216, 0.08)" : c.border,
      height: 1
    },
    commentRow: {
      gap: 6,
      paddingVertical: spacing.base
    },
    commentRowPressed: {
      opacity: 0.55
    },
    commentText: {
      ...fontStyles.medium,
      color: c.cream,
      fontSize: 15,
      lineHeight: 22
    },
    meta: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16
    },
    viewPostRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 3,
      marginTop: 2
    },
    viewPost: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 12,
      lineHeight: 15
    }
  });
}
