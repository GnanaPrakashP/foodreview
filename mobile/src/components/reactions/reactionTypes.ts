export type FoodReactionType = "mustTry" | "notWorthIt";

export type FoodReactionCounts = Record<FoodReactionType, number>;

export type FoodReactionDefinition = {
  accessibilityName: string;
  label: string;
  type: FoodReactionType;
};

export const foodReactionDefinitions: FoodReactionDefinition[] = [
  { accessibilityName: "Helpful", label: "Helpful", type: "mustTry" },
  { accessibilityName: "Disagree", label: "Disagree", type: "notWorthIt" }
];
