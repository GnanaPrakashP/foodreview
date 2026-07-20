import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { fontStyles, radius } from "@/theme";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { reactionIcons } from "./reactionIcons";
import type { FoodReactionType } from "./reactionTypes";

type Props = {
  accessibilityName: string;
  countAnimationRevision?: number;
  count: number;
  diagnosticPlainIcon?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  reaction: FoodReactionType;
  recyclingKey?: string;
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

const REACTION_HIT_SLOP = { bottom: 8, left: 8, right: 8, top: 8 } as const;

function voteLabel(count: number) {
  return `${count} ${count === 1 ? "vote" : "votes"}`;
}

function ReactionButtonComponent({
  accessibilityName,
  countAnimationRevision = 0,
  count,
  diagnosticPlainIcon = false,
  disabled = false,
  label,
  onPress,
  reaction,
  recyclingKey,
  selected = false
}: Props) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const Icon = reactionIcons[reaction];
  const palette = reactionPalettes[reaction];
  const countScale = useRef(new Animated.Value(1)).current;
  const countOpacity = useRef(new Animated.Value(1)).current;
  const previousCount = useRef(count);
  const previousCountAnimationRevision = useRef(countAnimationRevision);
  const recyclingAssignmentRef = useRef(recyclingKey);
  const recyclingAssignmentChanged = recyclingAssignmentRef.current !== recyclingKey;
  if (recyclingAssignmentChanged) {
    recyclingAssignmentRef.current = recyclingKey;
    previousCount.current = count;
    previousCountAnimationRevision.current = countAnimationRevision;
  }

  useLayoutEffect(() => {
    if (!recyclingAssignmentChanged) return;
    countScale.stopAnimation();
    countOpacity.stopAnimation();
    countScale.setValue(1);
    countOpacity.setValue(1);
  }, [countOpacity, countScale, recyclingAssignmentChanged, recyclingKey]);

  useEffect(() => {
    const countChanged = previousCount.current !== count;
    const userTriggered = previousCountAnimationRevision.current !== countAnimationRevision;
    previousCount.current = count;
    previousCountAnimationRevision.current = countAnimationRevision;
    if (!countChanged) return;
    countScale.stopAnimation();
    countOpacity.stopAnimation();
    if (!userTriggered) {
      countScale.setValue(1);
      countOpacity.setValue(1);
      return;
    }
    countScale.setValue(0.9);
    countOpacity.setValue(0.6);
    Animated.parallel([
      Animated.spring(countScale, {
        damping: 12,
        mass: 0.45,
        stiffness: 260,
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.timing(countOpacity, {
        duration: 160,
        toValue: 1,
        useNativeDriver: true
      })
    ]).start();
  }, [count, countAnimationRevision, countOpacity, countScale]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  }, [disabled, onPress]);

  const selectedSurfaceStyle = useMemo(() => ({
    backgroundColor: selected ? palette.fill : themeColors.surface,
    borderColor: selected ? palette.accent : themeColors.border,
    shadowOpacity: selected ? 0.18 : 0
  }), [palette, selected, themeColors.border, themeColors.surface]);
  const selectedLabelStyle = useMemo(() => ({
    color: selected ? palette.accent : themeColors.mutedStrong
  }), [palette.accent, selected, themeColors.mutedStrong]);
  const shellStyle = useMemo(() => [
    styles.shell,
    { shadowColor: palette.glow },
    selectedSurfaceStyle,
    disabled && styles.disabled
  ], [disabled, palette.glow, selectedSurfaceStyle, styles]);
  const labelStyle = useMemo(
    () => [styles.label, selectedLabelStyle],
    [selectedLabelStyle, styles]
  );
  const countStyle = useMemo(() => [
    styles.count,
    selectedLabelStyle,
    {
      opacity: countOpacity,
      transform: [{ scale: countScale }]
    }
  ], [countOpacity, countScale, selectedLabelStyle, styles]);
  const accessibilityLabel = useMemo(
    () => `${accessibilityName} reaction, ${voteLabel(count)}`,
    [accessibilityName, count]
  );
  const accessibilityState = useMemo(() => ({ disabled, selected }), [disabled, selected]);
  const iconColor = selected ? palette.accent : themeColors.mutedStrong;
  const showDiagnosticPlainIcon = __DEV__ && diagnosticPlainIcon;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={disabled}
      hitSlop={REACTION_HIT_SLOP}
      onPress={handlePress}
      style={shellStyle}
    >
      <View style={styles.labelCluster}>
        {showDiagnosticPlainIcon ? (
          <View style={[styles.diagnosticPlainIcon, { backgroundColor: iconColor }]} />
        ) : (
          <Icon
            color={iconColor}
            fillColor={selected ? palette.accent : "transparent"}
            selected={selected}
            size={20}
            strokeWidth={2.25}
          />
        )}
        <Text numberOfLines={1} style={labelStyle}>
          {label}
        </Text>
      </View>
      <Animated.Text
        numberOfLines={1}
        style={countStyle}
      >
        {count}
      </Animated.Text>
    </Pressable>
  );
}

export const ReactionButton = memo(ReactionButtonComponent);

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
    diagnosticPlainIcon: {
      borderRadius: 2,
      height: 20,
      width: 20
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
