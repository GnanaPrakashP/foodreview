import { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { useReducedMotionPreference } from "@/hooks/useReducedMotionPreference";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { radius, spacing } from "@/theme";

const POST_AVATAR_SIZE = 38;
const POST_HEADER_TOP_PADDING = 14;
const POST_HEADER_BOTTOM_PADDING = 12;
const POST_MEDIA_ASPECT_RATIO = 4 / 5;
const POST_ACTION_HEIGHT = 32;
const POST_FEEDBACK_HEIGHT = 44;
const MIN_PARTIAL_CARD_HEIGHT = 180;
const MAX_PARTIAL_CARD_HEIGHT = 300;

type PulseBlockProps = {
  opacity: Animated.Value;
  style: StyleProp<ViewStyle>;
};

function PulseBlock({ opacity, style }: PulseBlockProps) {
  return <Animated.View pointerEvents="none" style={[style, { opacity }]} />;
}

function HomePostSkeletonCard({
  opacity,
  styles,
  testID
}: {
  opacity: Animated.Value;
  styles: ReturnType<typeof createStyles>;
  testID?: string;
}) {
  return (
    <View importantForAccessibility="no-hide-descendants" style={styles.card} testID={testID}>
      <View style={styles.header}>
        <PulseBlock opacity={opacity} style={styles.avatar} />
        <View style={styles.authorCopy}>
          <PulseBlock opacity={opacity} style={styles.authorLine} />
          <PulseBlock opacity={opacity} style={styles.contextLine} />
        </View>
        <PulseBlock opacity={opacity} style={styles.moreButton} />
      </View>

      <View style={styles.postContent}>
        <PulseBlock opacity={opacity} style={styles.restaurantLine} />
        <PulseBlock opacity={opacity} style={styles.locationLine} />
        <View style={styles.bodyCopy}>
          <PulseBlock opacity={opacity} style={styles.captionLine} />
          <PulseBlock opacity={opacity} style={styles.captionLineShort} />
          <View style={styles.pills}>
            <PulseBlock opacity={opacity} style={styles.tagPill} />
            <PulseBlock opacity={opacity} style={styles.dishPill} />
          </View>
        </View>
      </View>

      <PulseBlock opacity={opacity} style={styles.media} />

      <View style={styles.actions}>
        <PulseBlock opacity={opacity} style={styles.actionCluster} />
        <PulseBlock opacity={opacity} style={styles.actionIcon} />
        <PulseBlock opacity={opacity} style={styles.actionIcon} />
      </View>

      <View style={styles.feedbackRow}>
        <PulseBlock opacity={opacity} style={styles.feedbackPill} />
        <PulseBlock opacity={opacity} style={styles.feedbackPill} />
      </View>
    </View>
  );
}

export function HomeFeedSkeleton({
  accessibilityLabel = "Loading Circle posts",
  postSpacing
}: {
  accessibilityLabel?: string;
  postSpacing: number;
}) {
  const { height } = useWindowDimensions();
  const { themeColors } = useThemePreference();
  const reducedMotion = useReducedMotionPreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const partialCardHeight = Math.min(
    MAX_PARTIAL_CARD_HEIGHT,
    Math.max(MIN_PARTIAL_CARD_HEIGHT, Math.round(height * 0.28))
  );

  useEffect(() => {
    pulseOpacity.stopAnimation();
    if (reducedMotion) {
      pulseOpacity.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          duration: 850,
          toValue: 0.58,
          useNativeDriver: true
        }),
        Animated.timing(pulseOpacity, {
          duration: 850,
          toValue: 1,
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => {
      animation.stop();
      pulseOpacity.stopAnimation();
    };
  }, [pulseOpacity, reducedMotion]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      testID="home-feed-skeleton"
    >
      <HomePostSkeletonCard opacity={pulseOpacity} styles={styles} testID="home-post-skeleton-full" />
      <View style={{ height: postSpacing }} />
      <View
        importantForAccessibility="no-hide-descendants"
        style={[styles.partialCardViewport, { height: partialCardHeight }]}
        testID="home-post-skeleton-partial"
      >
        <HomePostSkeletonCard opacity={pulseOpacity} styles={styles} />
      </View>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  const placeholder = {
    backgroundColor: c.border,
    borderRadius: radius.sm
  } as const;

  return StyleSheet.create({
    card: {
      backgroundColor: c.bg,
      borderBottomColor: c.border,
      borderBottomWidth: 0,
      width: "100%"
    },
    header: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      paddingBottom: POST_HEADER_BOTTOM_PADDING,
      paddingLeft: spacing.lg,
      paddingRight: 8,
      paddingTop: POST_HEADER_TOP_PADDING
    },
    avatar: {
      ...placeholder,
      borderRadius: POST_AVATAR_SIZE / 2,
      height: POST_AVATAR_SIZE,
      width: POST_AVATAR_SIZE
    },
    authorCopy: {
      flex: 1,
      gap: 5,
      justifyContent: "center",
      minHeight: 34
    },
    authorLine: {
      ...placeholder,
      height: 14,
      width: "44%"
    },
    contextLine: {
      ...placeholder,
      height: 10,
      width: "29%"
    },
    moreButton: {
      ...placeholder,
      borderRadius: 17,
      height: 34,
      width: 34
    },
    postContent: {
      paddingBottom: 12,
      paddingHorizontal: spacing.lg
    },
    restaurantLine: {
      ...placeholder,
      height: 18,
      width: "58%"
    },
    locationLine: {
      ...placeholder,
      height: 10,
      marginTop: 7,
      width: "38%"
    },
    bodyCopy: {
      paddingTop: 10
    },
    captionLine: {
      ...placeholder,
      height: 13,
      width: "92%"
    },
    captionLineShort: {
      ...placeholder,
      height: 13,
      marginTop: 7,
      width: "66%"
    },
    pills: {
      flexDirection: "row",
      gap: 6,
      marginTop: 10
    },
    tagPill: {
      ...placeholder,
      borderRadius: radius.pill,
      height: 22,
      width: 70
    },
    dishPill: {
      ...placeholder,
      height: 22,
      width: 104
    },
    media: {
      ...placeholder,
      aspectRatio: POST_MEDIA_ASPECT_RATIO,
      backgroundColor: c.surface,
      borderRadius: 0,
      width: "100%"
    },
    actions: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      paddingBottom: 8,
      paddingHorizontal: spacing.lg,
      paddingTop: 10
    },
    actionCluster: {
      ...placeholder,
      flex: 1,
      height: 18,
      maxWidth: 132
    },
    actionIcon: {
      ...placeholder,
      borderRadius: POST_ACTION_HEIGHT / 2,
      height: POST_ACTION_HEIGHT,
      width: POST_ACTION_HEIGHT
    },
    feedbackRow: {
      flexDirection: "row",
      gap: 12,
      paddingBottom: 14,
      paddingHorizontal: spacing.lg,
      paddingTop: 2
    },
    feedbackPill: {
      ...placeholder,
      borderRadius: radius.pill,
      flex: 1,
      height: POST_FEEDBACK_HEIGHT
    },
    partialCardViewport: {
      overflow: "hidden",
      width: "100%"
    }
  });
}
