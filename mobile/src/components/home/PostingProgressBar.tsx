import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useReducedMotionPreference } from "@/hooks/useReducedMotionPreference";
import { fontStyles, spacing } from "@/theme";
import {
  postingJobsInFlight,
  postingOverallProgress,
  usePostingStore,
  type PostingJob
} from "@/stores/postingStore";

const BAR_HEIGHT = 2;
const FAILURE_HEIGHT = 34;

function label(active: PostingJob[]) {
  if (active.length > 1) return `Posting ${active.length} posts`;
  return "Posting";
}

/**
 * The thin line at the top of Home while a post is on its way. Sharing returns
 * an empty composer and lands here, so this is the only place the post is
 * visible until it lands in the feed — the composer deliberately shows nothing.
 */
export function PostingProgressBar() {
  const { themeColors: colors } = useThemePreference();
  const reducedMotion = useReducedMotionPreference();
  const jobs = usePostingStore((state) => state.jobs);
  const requeue = usePostingStore((state) => state.requeue);
  const remove = usePostingStore((state) => state.remove);
  const width = useRef(new Animated.Value(0)).current;

  const active = postingJobsInFlight(jobs);
  const failed = jobs.filter((job) => job.status === "failed");
  const progress = postingOverallProgress(jobs);

  useEffect(() => {
    if (active.length === 0) {
      width.setValue(0);
      return;
    }
    // Never runs backwards and never quite reaches the end on its own: the last
    // step belongs to the post actually existing.
    const target = Math.max(0.04, Math.min(progress, 0.98));
    if (reducedMotion) {
      width.setValue(target);
      return;
    }
    Animated.timing(width, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
      toValue: target,
      useNativeDriver: false
    }).start();
  }, [active.length, progress, reducedMotion, width]);

  if (active.length === 0 && failed.length === 0) return null;

  const first = failed[0];
  // A permanent outcome is the post's answer, not a hiccup: offer to clear it
  // rather than to try the same thing again.
  const permanent = first?.failureKind === "permanent";

  return (
    <View>
      {active.length > 0 ? (
        <View accessibilityLabel={label(active)} accessibilityRole="progressbar" style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                backgroundColor: colors.orange,
                width: width.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"]
                })
              }
            ]}
          />
        </View>
      ) : null}
      {first ? (
        <Pressable
          accessibilityHint={permanent ? "Removes this post" : "Tries this post again"}
          accessibilityLabel={first.error ?? "Could not share this post"}
          accessibilityRole="button"
          onPress={() => (permanent ? remove(first.id) : requeue(first.id))}
          onLongPress={() => remove(first.id)}
          style={[styles.failure, { backgroundColor: colors.dangerSoft }]}
        >
          <Text numberOfLines={2} style={[styles.failureText, { color: colors.white }]}>
            {/* The reason, verbatim from the server. "Media did not pass the
                safety review" and "we lost the connection" call for different
                things from the person reading it. */}
            {first.error ?? "Could not share this post."}
            {" "}
            <Text style={styles.failureAction}>{permanent ? "Tap to dismiss" : "Tap to retry"}</Text>
          </Text>
          {failed.length > 1 ? (
            <Text style={[styles.failureCount, { color: colors.white }]}>
              {`+${failed.length - 1} more`}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: BAR_HEIGHT,
    overflow: "hidden",
    width: "100%"
  },
  fill: {
    borderBottomRightRadius: BAR_HEIGHT,
    borderTopRightRadius: BAR_HEIGHT,
    height: BAR_HEIGHT
  },
  failure: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.s,
    justifyContent: "space-between",
    minHeight: FAILURE_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.s
  },
  failureText: {
    ...fontStyles.semiBold,
    flexShrink: 1,
    fontSize: 13
  },
  failureAction: {
    ...fontStyles.bold,
    textDecorationLine: "underline"
  },
  failureCount: {
    ...fontStyles.semiBold,
    fontSize: 12,
    opacity: 0.85
  }
});
