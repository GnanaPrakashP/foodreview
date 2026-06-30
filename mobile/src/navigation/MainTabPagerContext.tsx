import { createContext, useContext } from "react";

export type MainTabName = "index" | "explore" | "share" | "profile";

export type MainTabSwipeDirection = "left" | "right";

export type MainTabRequestSource =
  | "bottom-nav"
  | "explore-inner-edge"
  | "horizontal-swipe"
  | "main-header-swipe"
  | "profile-content-swipe"
  | "profile-header-swipe"
  | "profile-inner-edge"
  | "route-sync";

type MainTabPagerContextValue = {
  activeIndex: number;
  activeTab: MainTabName;
  canGoToAdjacentMainTab: (direction: MainTabSwipeDirection) => boolean;
  getActiveTab: () => MainTabName;
  goToAdjacentMainTab: (direction: MainTabSwipeDirection, source?: MainTabRequestSource) => void;
  goToMainTab: (tab: MainTabName, source?: MainTabRequestSource) => void;
  isActiveTab: (tab: MainTabName) => boolean;
};

const MainTabPagerContext = createContext<MainTabPagerContextValue | null>(null);

export const MainTabPagerProvider = MainTabPagerContext.Provider;

export function useMainTabPager() {
  return useContext(MainTabPagerContext);
}
