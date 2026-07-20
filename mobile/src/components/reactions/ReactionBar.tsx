import { memo, useCallback, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { ReactionButton } from "./ReactionButton";
import {
  foodReactionDefinitions,
  type FoodReactionCounts,
  type FoodReactionType
} from "./reactionTypes";

export type {
  FoodReactionCounts,
  FoodReactionType
} from "./reactionTypes";

export type ReactionBarProps = {
  counts: FoodReactionCounts;
  countAnimationRevision?: number;
  diagnosticPlainIcons?: boolean;
  disabled?: boolean;
  onReact: (reaction: FoodReactionType) => void;
  recyclingKey?: string;
  selectedReaction?: FoodReactionType | null;
};

const ReactionBarItem = memo(function ReactionBarItem({
  count,
  countAnimationRevision,
  diagnosticPlainIcons,
  disabled,
  onReact,
  recyclingKey,
  reaction,
  selected
}: {
  count: number;
  countAnimationRevision: number;
  diagnosticPlainIcons: boolean;
  disabled: boolean;
  onReact: (reaction: FoodReactionType) => void;
  recyclingKey?: string;
  reaction: (typeof foodReactionDefinitions)[number];
  selected: boolean;
}) {
  const handlePress = useCallback(() => onReact(reaction.type), [onReact, reaction.type]);
  return (
    <ReactionButton
      accessibilityName={reaction.accessibilityName}
      count={count}
      countAnimationRevision={countAnimationRevision}
      diagnosticPlainIcon={diagnosticPlainIcons}
      disabled={disabled}
      label={reaction.label}
      onPress={handlePress}
      reaction={reaction.type}
      recyclingKey={recyclingKey}
      selected={selected}
    />
  );
});

function ReactionBarComponent({
  counts,
  countAnimationRevision = 0,
  diagnosticPlainIcons = false,
  disabled = false,
  onReact,
  recyclingKey,
  selectedReaction = null
}: ReactionBarProps) {
  const styles = useMemo(() => createStyles(), []);

  return (
    <View style={styles.row}>
      {foodReactionDefinitions.map((reaction) => (
        <ReactionBarItem
          count={counts[reaction.type]}
          countAnimationRevision={countAnimationRevision}
          diagnosticPlainIcons={diagnosticPlainIcons}
          disabled={disabled}
          key={reaction.type}
          onReact={onReact}
          reaction={reaction}
          recyclingKey={recyclingKey}
          selected={selectedReaction === reaction.type}
        />
      ))}
    </View>
  );
}

export const ReactionBar = memo(ReactionBarComponent, (previous, next) => (
  previous.counts.mustTry === next.counts.mustTry &&
  previous.counts.notWorthIt === next.counts.notWorthIt &&
  previous.countAnimationRevision === next.countAnimationRevision &&
  previous.diagnosticPlainIcons === next.diagnosticPlainIcons &&
  previous.disabled === next.disabled &&
  previous.onReact === next.onReact &&
  previous.recyclingKey === next.recyclingKey &&
  previous.selectedReaction === next.selectedReaction
));

function createStyles() {
  return StyleSheet.create({
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12
    }
  });
}
