import { useMemo } from "react";
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
  disabled?: boolean;
  onReact: (reaction: FoodReactionType) => void;
  selectedReaction?: FoodReactionType | null;
};

export function ReactionBar({
  counts,
  disabled = false,
  onReact,
  selectedReaction = null
}: ReactionBarProps) {
  const styles = useMemo(() => createStyles(), []);

  return (
    <View style={styles.row}>
      {foodReactionDefinitions.map((reaction) => (
        <ReactionButton
          accessibilityName={reaction.accessibilityName}
          count={counts[reaction.type]}
          disabled={disabled}
          key={reaction.type}
          label={reaction.label}
          onPress={() => onReact(reaction.type)}
          reaction={reaction.type}
          selected={selectedReaction === reaction.type}
        />
      ))}
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12
    }
  });
}
