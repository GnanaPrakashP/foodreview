import type { OccasionType } from "./occasionTypes";

export type OccasionPatternGroup = {
  confidence: number;
  phrases: string[];
  reason: string;
  type: OccasionType;
};

export const DATE_NIGHT_PHRASES = [
  "date night",
  "date with",
  "just a date",
  "just date",
  "dinner date",
  "coffee date",
  "lunch date",
  "movie date",
  "breakfast date",
  "romantic dinner",
  "romantic evening",
  "romantic night",
  "anniversary dinner",
  "anniversary date",
  "valentine",
  "couples night",
  "couple time",
  "just the two of us",
  "hum dono",
  "aaj bas hum dono",
  "date pe",
  "ke saath date",
  "with my wife",
  "with my husband",
  "with my girlfriend",
  "with my boyfriend",
  "with my partner",
  "wife ke saath",
  "husband ke saath"
];

export const BIRTHDAY_PHRASES = [
  "birthday",
  "bday",
  "birthday dinner",
  "cake cutting",
  "born day"
];

export const FRIENDS_PHRASES = [
  "friends night",
  "friends outing",
  "with friends",
  "with a friend",
  "with friend",
  "hangout",
  "gang",
  "squad",
  "girls night",
  "boys night",
  "reunion"
];

export const FAMILY_PHRASES = [
  "family dinner",
  "family lunch",
  "family time",
  "with family",
  "parents",
  "siblings"
];

export const WORK_PHRASES = [
  "office lunch",
  "office dinner",
  "team lunch",
  "team dinner",
  "client dinner",
  "business lunch",
  "colleague",
  "work dinner",
  "data team"
];

export const CELEBRATION_PHRASES = [
  "promotion",
  "graduation",
  "engagement",
  "farewell",
  "achievement",
  "celebration"
];

export const SOLO_PHRASES = [
  "solo date",
  "me time",
  "myself",
  "solo dinner",
  "solo coffee"
];

export const DATA_WORK_CONTEXT_WORDS = [
  "team",
  "analytics",
  "database",
  "dataset",
  "office",
  "client",
  "business",
  "colleague",
  "work"
];

export const GENERIC_MEAL_WORDS = [
  "breakfast",
  "brunch",
  "chai",
  "coffee",
  "dinner",
  "lunch",
  "meal",
  "tea"
];

export const OCCASION_PATTERN_GROUPS: OccasionPatternGroup[] = [
  {
    confidence: 0.94,
    phrases: WORK_PHRASES,
    reason: "Matched a work meal phrase",
    type: "work_meal"
  },
  {
    confidence: 0.92,
    phrases: SOLO_PHRASES,
    reason: "Matched a solo occasion phrase",
    type: "solo"
  },
  {
    confidence: 0.93,
    phrases: DATE_NIGHT_PHRASES,
    reason: "Matched a date-night phrase",
    type: "date_night"
  },
  {
    confidence: 0.93,
    phrases: BIRTHDAY_PHRASES,
    reason: "Matched a birthday phrase",
    type: "birthday"
  },
  {
    confidence: 0.9,
    phrases: FAMILY_PHRASES,
    reason: "Matched a family phrase",
    type: "family_time"
  },
  {
    confidence: 0.88,
    phrases: FRIENDS_PHRASES,
    reason: "Matched a friends phrase",
    type: "friends_hangout"
  },
  {
    confidence: 0.88,
    phrases: CELEBRATION_PHRASES,
    reason: "Matched a celebration phrase",
    type: "celebration"
  }
];
