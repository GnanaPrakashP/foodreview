export type FoodReactionType = "mustTry" | "notWorthIt";

export type FoodReactionCounts = Record<FoodReactionType, number>;

export type FoodReactionDefinition = {
  accessibilityName: string;
  label: string;
  type: FoodReactionType;
};

export const foodReactionDefinitions: FoodReactionDefinition[] = [
  { accessibilityName: "Must Try", label: "Must Try", type: "mustTry" },
  { accessibilityName: "Not Worth It", label: "Not Worth It", type: "notWorthIt" }
];
