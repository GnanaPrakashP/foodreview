export type OccasionType =
  | "date_night"
  | "friends_hangout"
  | "birthday"
  | "family_time"
  | "work_meal"
  | "celebration"
  | "solo"
  | "casual"
  | "unknown";

export type OccasionContext = {
  participantCount?: number;
  relationship?: "partner" | "spouse" | "friend" | "family" | "colleague" | "unknown";
  explicitOccasion?: OccasionType;
  savedCorrections?: OccasionCorrection[];
};

export type OccasionClassification = {
  type: OccasionType;
  confidence: number;
  reason: string;
  suggestedCorrection?: string;
};

export type OccasionCorrection = {
  normalizedText: string;
  type: OccasionType;
  updatedAt: string;
};

export const OCCASION_TYPES: OccasionType[] = [
  "date_night",
  "friends_hangout",
  "birthday",
  "family_time",
  "work_meal",
  "celebration",
  "solo",
  "casual",
  "unknown"
];

export const USER_SELECTABLE_OCCASIONS: OccasionType[] = [
  "date_night",
  "friends_hangout",
  "birthday",
  "family_time",
  "work_meal",
  "celebration",
  "solo",
  "casual"
];

export function isOccasionType(value: string | null | undefined): value is OccasionType {
  return OCCASION_TYPES.includes(value as OccasionType);
}

export function occasionLabel(type: OccasionType) {
  switch (type) {
    case "date_night":
      return "Date night";
    case "friends_hangout":
      return "Friends";
    case "birthday":
      return "Birthday";
    case "family_time":
      return "Family";
    case "work_meal":
      return "Work";
    case "celebration":
      return "Celebration";
    case "solo":
      return "Solo";
    case "casual":
      return "Casual";
    case "unknown":
      return "Occasion";
  }
}
