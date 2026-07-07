import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { fontStyles, radius } from "@/theme";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { reactionIcons } from "./reactionIcons";
import type { FoodReactionType } from "./reactionTypes";

type Props = {
  accessibilityName: string;
  count: number;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  reaction: FoodReactionType;
  selected?: boolean;
};

type ReactionPalette = {
  accent: string;
  fill: string;
  glow: string;
};

const reactionPalettes: Record<FoodReactionType, ReactionPalette> = {
  mustTry: {
    accent: "#F05A28",
    fill: "rgba(240, 90, 40, 0.16)",
    glow: "#F05A28"
  },
  notWorthIt: {
    accent: "#B45353",
    fill: "rgba(180, 83, 83, 0.13)",
    glow: "#B45353"
  }
};
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function voteLabel(count: number) {
  return `${count} ${count === 1 ? "vote" : "votes"}`;
}

export function ReactionButton({
  accessibilityName,
  count,
  disabled = false,
  label,
  onPress,
  reaction,
  selected = false
}: Props) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const Icon = reactionIcons[reaction];
  const palette = reactionPalettes[reaction];
  const activeProgress = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const countScale = useRef(new Animated.Value(1)).current;
  const countOpacity = useRef(new Animated.Value(1)).current;
  const previousCount = useRef(count);

  useEffect(() => {
    Animated.timing(activeProgress, {
      duration: selected ? 180 : 140,
      toValue: selected ? 1 : 0,
      useNativeDriver: false
    }).start();
  }, [activeProgress, selected]);

  useEffect(() => {
    if (previousCount.current === count) return;
    previousCount.current = count;
    countScale.setValue(0.9);
    countOpacity.setValue(0.6);
    Animated.parallel([
      Animated.spring(countScale, {
        damping: 12,
        mass: 0.45,
        stiffness: 260,
        toValue: 1,
        useNativeDriver: false
      }),
      Animated.timing(countOpacity, {
        duration: 160,
        toValue: 1,
        useNativeDriver: false
      })
    ]).start();
  }, [count, countOpacity, countScale]);

  function handlePress() {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  }

  const animatedSurfaceStyle = {
    backgroundColor: activeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [themeColors.surface, palette.fill]
    }),
    borderColor: activeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [themeColors.border, palette.accent]
    }),
    shadowOpacity: activeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.18]
    })
  };
  const animatedLabelStyle = {
    color: activeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [themeColors.mutedStrong, palette.accent]
    })
  };
  const iconColor = selected ? palette.accent : themeColors.mutedStrong;

  return (
    <AnimatedPressable
      accessibilityLabel={`${accessibilityName} reaction, ${voteLabel(count)}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
      onPress={handlePress}
      style={[
        styles.shell,
        { shadowColor: palette.glow },
        animatedSurfaceStyle,
        disabled && styles.disabled
      ]}
    >
      <View style={styles.labelCluster}>
        <Icon
          color={iconColor}
          fillColor={selected ? palette.accent : "transparent"}
          selected={selected}
          size={20}
          strokeWidth={2.25}
        />
        <Animated.Text numberOfLines={1} style={[styles.label, animatedLabelStyle]}>
          {label}
        </Animated.Text>
      </View>
      <Animated.Text
        numberOfLines={1}
        style={[
          styles.count,
          animatedLabelStyle,
          {
            opacity: countOpacity,
            transform: [{ scale: countScale }]
          }
        ]}
      >
        {count}
      </Animated.Text>
    </AnimatedPressable>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    count: {
      ...fontStyles.extraBold,
      color: c.mutedStrong,
      fontSize: 14,
      lineHeight: 18
    },
    disabled: {
      opacity: 0.56
    },
    label: {
      ...fontStyles.extraBold,
      color: c.mutedStrong,
      flexShrink: 1,
      fontSize: 14,
      lineHeight: 18
    },
    labelCluster: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 7,
      minWidth: 0
    },
    shell: {
      alignItems: "center",
      borderRadius: radius.pill,
      borderWidth: 1,
      flex: 1,
      flexDirection: "row",
      gap: 8,
      justifyContent: "space-between",
      minHeight: 44,
      minWidth: 0,
      paddingHorizontal: 13,
      paddingVertical: 8,
      shadowOffset: { height: 5, width: 0 },
      shadowRadius: 12
    }
  });
}
