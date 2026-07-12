import type { ViewStyle } from "react-native";

type MainTabBarColors = {
  border: string;
  surface: string;
};

const MAIN_TAB_BAR_MIN_BOTTOM_INSET = 8;
const MAIN_TAB_BAR_CONTENT_HEIGHT = 52;

export function mainTabBarStyle(colors: MainTabBarColors, bottomInset: number, hidden = false): ViewStyle {
  const bottomPadding = Math.max(bottomInset, MAIN_TAB_BAR_MIN_BOTTOM_INSET);

  return {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    display: hidden ? "none" : "flex",
    height: MAIN_TAB_BAR_CONTENT_HEIGHT + bottomPadding,
    paddingBottom: bottomPadding,
    paddingTop: MAIN_TAB_BAR_MIN_BOTTOM_INSET
  };
}
