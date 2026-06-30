import { useCallback, useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import {
  useMainTabPager,
  type MainTabName,
  type MainTabRequestSource,
  type MainTabSwipeDirection
} from "@/navigation/MainTabPagerContext";

type MainTabSwipeTarget = MainTabName | "adjacent";

type MainTabSwipeZoneOptions = {
  enabled?: boolean;
  left?: MainTabSwipeTarget;
  owner?: MainTabName;
  right?: MainTabSwipeTarget;
  source?: MainTabRequestSource;
};

const ACTIVATION_DISTANCE = 18;
const VERTICAL_FAIL_DISTANCE = 20;
const HORIZONTAL_INTENT_RATIO = 1.35;
const TRIGGER_DISTANCE = 78;
const TRIGGER_VELOCITY = 0.35;

export function useMainTabSwipeGestureZone({
  enabled = true,
  left,
  owner,
  right,
  source = "main-header-swipe"
}: Omit<MainTabSwipeZoneOptions, "shouldHandleEvent">) {
  const mainTabPager = useMainTabPager();

  const targetForDirection = useCallback((direction: MainTabSwipeDirection) => (
    direction === "left" ? left : right
  ), [left, right]);

  const canNavigate = useCallback((direction: MainTabSwipeDirection) => {
    if (!enabled || !mainTabPager) return false;
    if (owner && !mainTabPager.isActiveTab(owner)) return false;
    const target = targetForDirection(direction);
    if (!target) return false;
    if (target === "adjacent") return mainTabPager.canGoToAdjacentMainTab(direction);
    return mainTabPager.getActiveTab() !== target;
  }, [enabled, mainTabPager, owner, targetForDirection]);

  const navigate = useCallback((direction: MainTabSwipeDirection) => {
    if (!mainTabPager || !canNavigate(direction)) return;
    const target = targetForDirection(direction);
    if (target === "adjacent") {
      mainTabPager.goToAdjacentMainTab(direction, source);
      return;
    }
    if (target) mainTabPager.goToMainTab(target, source);
  }, [canNavigate, mainTabPager, source, targetForDirection]);

  const activeOffsetX = useMemo(() => {
    if (left && right) return [-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE] as [number, number];
    if (left) return [-ACTIVATION_DISTANCE, 100000] as [number, number];
    if (right) return [-100000, ACTIVATION_DISTANCE] as [number, number];
    return [-ACTIVATION_DISTANCE, ACTIVATION_DISTANCE] as [number, number];
  }, [left, right]);

  return useMemo(() => Gesture.Pan()
    // Phase 2: the main tabs are now a native react-native-pager-view (see app/(tabs)/_layout.tsx),
    // which owns cross-tab swiping and tracks the finger. This release-fling gesture is kept
    // (disabled) so its call sites/GestureDetectors stay intact until the screens are cleaned up.
    .enabled(false)
    .activeOffsetX(activeOffsetX)
    // Bail out early on vertical intent so the collapsing header / list scroll
    // (and the inner sub-tab pager) always win unless the drag is clearly horizontal.
    .failOffsetY([-VERTICAL_FAIL_DISTANCE, VERTICAL_FAIL_DISTANCE])
    .onEnd((event) => {
      const absX = Math.abs(event.translationX);
      const absY = Math.abs(event.translationY);
      const direction: MainTabSwipeDirection = event.translationX < 0 ? "left" : "right";
      const velocityX = event.velocityX / 1000;
      const hasIntent = (
        absX > TRIGGER_DISTANCE ||
        (direction === "left" ? velocityX < -TRIGGER_VELOCITY : velocityX > TRIGGER_VELOCITY)
      );
      if (hasIntent && absX > absY * HORIZONTAL_INTENT_RATIO) {
        runOnJS(navigate)(direction);
      }
    }), [activeOffsetX, enabled, left, mainTabPager, navigate, right]);
}
