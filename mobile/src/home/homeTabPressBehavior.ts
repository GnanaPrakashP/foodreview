export const HOME_TOP_THRESHOLD_PX = 24;

export type ActiveHomeTabPressAction = "ignore" | "refresh" | "scroll-to-top";

export function resolveActiveHomeTabPressAction(input: {
  canInteract: boolean;
  isAtTop: boolean;
  isInitialRequestPending: boolean;
  isPausedWithoutContent: boolean;
  isScrollToTopActive: boolean;
}): ActiveHomeTabPressAction {
  if (!input.canInteract || input.isInitialRequestPending || input.isScrollToTopActive) return "ignore";
  if (!input.isAtTop) return "scroll-to-top";
  if (input.isPausedWithoutContent) return "ignore";
  return "refresh";
}
