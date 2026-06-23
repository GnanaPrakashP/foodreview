import { memoryRoomTokens, type MemoryRoomTokens } from "@/theme/tokens";
import { occasionLabel, type OccasionType } from "./occasionTypes";

export type OccasionTheme = {
  id: string;
  icon: string;
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    primary: string;
    secondary: string;
    text: string;
    mutedText: string;
    border: string;
  };
  backgroundPattern: string;
  copy: {
    emptyTitle: string;
    emptyDescription: string;
    composerPlaceholder: string;
    mediaAction: string;
    noteAction: string;
  };
};

const defaultTheme: OccasionTheme = {
  id: "default-memory-v1",
  icon: "🍽️",
  colors: {
    background: memoryRoomTokens.dark.background,
    surface: memoryRoomTokens.dark.surface,
    surfaceElevated: memoryRoomTokens.dark.surfaceRaised,
    primary: memoryRoomTokens.dark.primary,
    secondary: memoryRoomTokens.dark.secondary,
    text: memoryRoomTokens.dark.onSurface,
    mutedText: memoryRoomTokens.dark.onSurfaceVariant,
    border: memoryRoomTokens.dark.outline
  },
  backgroundPattern: "food-pattern",
  copy: {
    emptyTitle: "Start the table",
    emptyDescription: "Messages, photos, and dishes from this table will appear here.",
    composerPlaceholder: "Message...",
    mediaAction: "Add media",
    noteAction: "Write a note"
  }
};

export const occasionThemes: Record<OccasionType, OccasionTheme> = {
  date_night: {
    id: "date-night-v1",
    icon: "💗",
    colors: {
      background: "#0B070A",
      surface: "#25171F",
      surfaceElevated: "#321B29",
      primary: "#EF5A92",
      secondary: "#B767FF",
      text: "#FFF5EB",
      mutedText: "#AD9CA3",
      border: "#573044"
    },
    backgroundPattern: "romantic-food-pattern",
    copy: {
      emptyTitle: "Make tonight yours",
      emptyDescription: "Save the little moments, favorite bites, and things only you two understand.",
      composerPlaceholder: "Write something just for us...",
      mediaAction: "Add a moment",
      noteAction: "Write a note"
    }
  },
  friends_hangout: {
    id: "friends-hangout-v1",
    icon: "✨",
    colors: {
      background: "#071012",
      surface: "#142225",
      surfaceElevated: "#1C3034",
      primary: "#35D0BA",
      secondary: "#F2B84B",
      text: "#F4FFFC",
      mutedText: "#9BB4B1",
      border: "#2E5254"
    },
    backgroundPattern: "food-pattern",
    copy: {
      emptyTitle: "Keep the table buzzing",
      emptyDescription: "Save the jokes, shared plates, and plans for next time.",
      composerPlaceholder: "Drop a table note...",
      mediaAction: "Add a memory",
      noteAction: "Write a note"
    }
  },
  birthday: {
    id: "birthday-v1",
    icon: "🎂",
    colors: {
      background: "#120B14",
      surface: "#241B2B",
      surfaceElevated: "#30253B",
      primary: "#FFB84D",
      secondary: "#F071B8",
      text: "#FFF8EB",
      mutedText: "#B8A9B6",
      border: "#58405E"
    },
    backgroundPattern: "celebration-food-pattern",
    copy: {
      emptyTitle: "Save the birthday table",
      emptyDescription: "Collect wishes, cake moments, and the dishes everyone talked about.",
      composerPlaceholder: "Add a birthday note...",
      mediaAction: "Add a birthday moment",
      noteAction: "Write a wish"
    }
  },
  family_time: {
    id: "family-time-v1",
    icon: "🏡",
    colors: {
      background: "#0D0D08",
      surface: "#211F16",
      surfaceElevated: "#2D2A1E",
      primary: "#D8A848",
      secondary: "#72C7A3",
      text: "#FFF8E8",
      mutedText: "#B2AA95",
      border: "#514B34"
    },
    backgroundPattern: "food-pattern",
    copy: {
      emptyTitle: "Gather the family table",
      emptyDescription: "Keep the comfort dishes, stories, and small family details together.",
      composerPlaceholder: "Write for the family...",
      mediaAction: "Add a family moment",
      noteAction: "Write a note"
    }
  },
  work_meal: {
    id: "work-meal-v1",
    icon: "💼",
    colors: {
      background: "#080D12",
      surface: "#151D26",
      surfaceElevated: "#1E2A36",
      primary: "#67A7FF",
      secondary: "#8DE0C6",
      text: "#F4F8FF",
      mutedText: "#9AAABD",
      border: "#314154"
    },
    backgroundPattern: "food-pattern",
    copy: {
      emptyTitle: "Keep the working lunch useful",
      emptyDescription: "Save decisions, dishes worth repeating, and the table context.",
      composerPlaceholder: "Add a table update...",
      mediaAction: "Add a moment",
      noteAction: "Write a note"
    }
  },
  celebration: {
    id: "celebration-v1",
    icon: "🎉",
    colors: {
      background: "#100B08",
      surface: "#261A14",
      surfaceElevated: "#33231A",
      primary: "#FF8A4D",
      secondary: "#FFD166",
      text: "#FFF6ED",
      mutedText: "#B8A79B",
      border: "#624232"
    },
    backgroundPattern: "celebration-food-pattern",
    copy: {
      emptyTitle: "Mark the moment",
      emptyDescription: "Save the cheers, photos, and dishes from the celebration.",
      composerPlaceholder: "Write what happened...",
      mediaAction: "Add a celebration moment",
      noteAction: "Write a note"
    }
  },
  solo: {
    id: "solo-v1",
    icon: "☕",
    colors: {
      background: "#080D0C",
      surface: "#15211F",
      surfaceElevated: "#20302D",
      primary: "#7ED7C1",
      secondary: "#D8A848",
      text: "#F4FFFB",
      mutedText: "#9CB2AD",
      border: "#36534E"
    },
    backgroundPattern: "food-pattern",
    copy: {
      emptyTitle: "Keep this one for you",
      emptyDescription: "Save what you ordered, what you noticed, and why it mattered.",
      composerPlaceholder: "Write a note to yourself...",
      mediaAction: "Add a moment",
      noteAction: "Write a note"
    }
  },
  casual: {
    id: "casual-v1",
    icon: "🍜",
    colors: {
      background: "#0E0B08",
      surface: "#211C17",
      surfaceElevated: "#2B241D",
      primary: "#9D5BE8",
      secondary: "#E8A830",
      text: "#F5EDD8",
      mutedText: "#9A8C80",
      border: "rgba(245, 237, 216, 0.22)"
    },
    backgroundPattern: "food-pattern",
    copy: {
      emptyTitle: "Start the table",
      emptyDescription: "Messages, photos, and dishes from this table will appear here.",
      composerPlaceholder: "Message...",
      mediaAction: "Add media",
      noteAction: "Write a note"
    }
  },
  unknown: defaultTheme
};

export function getOccasionTheme(type: OccasionType | null | undefined) {
  return type && type !== "unknown" ? occasionThemes[type] : defaultTheme;
}

export function occasionChipLabel(type: OccasionType) {
  const theme = getOccasionTheme(type);
  return `${theme.icon} ${occasionLabel(type)}`;
}

export function occasionThemeToMemoryRoomTokens(base: MemoryRoomTokens, type: OccasionType | null | undefined): MemoryRoomTokens {
  if (!type || type === "unknown") return base;
  const theme = getOccasionTheme(type);
  return {
    ...base,
    background: theme.colors.background,
    wallpaperBackground: theme.colors.background,
    wallpaperLine: theme.colors.secondary,
    wallpaperOpacity: type === "date_night" ? 0.12 : base.wallpaperOpacity,
    surface: theme.colors.surface,
    surfaceRaised: theme.colors.surfaceElevated,
    surfaceHigh: theme.colors.surfaceElevated,
    surfaceHighest: theme.colors.surfaceElevated,
    surfaceDim: theme.colors.background,
    onSurface: theme.colors.text,
    onSurfaceVariant: theme.colors.mutedText,
    primary: theme.colors.primary,
    primaryPressed: theme.colors.secondary,
    primaryContainer: `${theme.colors.primary}26`,
    onPrimaryContainer: theme.colors.text,
    primaryOutline: theme.colors.border,
    divider: theme.colors.border,
    outline: theme.colors.border,
    outlineStrong: theme.colors.border,
    sentBubble: theme.colors.primary,
    sentBubbleOutline: theme.colors.border,
    onSentBubble: theme.colors.text,
    receivedBubble: theme.colors.surface,
    onReceivedBubble: theme.colors.text,
    messageTimestamp: `${theme.colors.mutedText}CC`,
    gold: theme.colors.secondary,
    goldContainer: `${theme.colors.secondary}24`,
    goldOutline: theme.colors.border,
    glass: `${theme.colors.text}24`,
    glassDim: `${theme.colors.text}18`,
    selection: `${theme.colors.primary}24`
  };
}
