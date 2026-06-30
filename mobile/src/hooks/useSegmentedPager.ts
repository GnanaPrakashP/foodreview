import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, type PanResponderGestureState } from "react-native";

export type SegmentedPagerSwipeDirection = "left" | "right";

type UseSegmentedPagerOptions<T extends string> = {
  activationDistance?: number;
  canEdgeSwipe?: (direction: SegmentedPagerSwipeDirection, item: T, index: number) => boolean;
  enabled?: boolean;
  initialItem: T;
  intentRatio?: number;
  items: readonly T[];
  onEdgeSwipe?: (direction: SegmentedPagerSwipeDirection, item: T, index: number) => void;
  onSettledItemChange?: (item: T, index: number) => void;
  pageSize: number;
  settleDistance?: number;
  settleDurationMs?: number;
  shouldHandleGesture?: (gesture: PanResponderGestureState) => boolean;
  triggerVelocity?: number;
};

const DEFAULT_ACTIVATION_DISTANCE = 10;
const DEFAULT_INTENT_RATIO = 1.35;
const DEFAULT_SETTLE_DISTANCE = 0.22;
const DEFAULT_SETTLE_DURATION_MS = 220;
const DEFAULT_TRIGGER_VELOCITY = 0.35;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function indexOfItem<T extends string>(items: readonly T[], item: T) {
  const index = items.indexOf(item);
  return index >= 0 ? index : 0;
}

export function useSegmentedPager<T extends string>({
  activationDistance = DEFAULT_ACTIVATION_DISTANCE,
  canEdgeSwipe,
  enabled = true,
  initialItem,
  intentRatio = DEFAULT_INTENT_RATIO,
  items,
  onEdgeSwipe,
  onSettledItemChange,
  pageSize,
  settleDistance = DEFAULT_SETTLE_DISTANCE,
  settleDurationMs = DEFAULT_SETTLE_DURATION_MS,
  shouldHandleGesture,
  triggerVelocity = DEFAULT_TRIGGER_VELOCITY
}: UseSegmentedPagerOptions<T>) {
  const initialIndex = indexOfItem(items, initialItem);
  const initialSelectedItem = items[initialIndex] ?? initialItem;
  const [activeItem, setActiveItem] = useState<T>(initialSelectedItem);
  const activeItemRef = useRef<T>(initialSelectedItem);
  const activeIndexRef = useRef(initialIndex);
  const dragStartIndexRef = useRef(initialIndex);
  const animatingRef = useRef(false);
  const progress = useRef(new Animated.Value(initialIndex)).current;
  const lastIndex = Math.max(0, items.length - 1);

  const commitIndex = useCallback((nextIndex: number) => {
    const clampedIndex = clamp(Math.round(nextIndex), 0, lastIndex);
    const nextItem = items[clampedIndex];
    if (!nextItem) return;

    activeIndexRef.current = clampedIndex;
    activeItemRef.current = nextItem;
    setActiveItem(nextItem);
    onSettledItemChange?.(nextItem, clampedIndex);
  }, [items, lastIndex, onSettledItemChange]);

  const animateToIndex = useCallback((nextIndex: number, startProgress?: number) => {
    const clampedIndex = clamp(nextIndex, 0, lastIndex);
    progress.stopAnimation((currentProgress) => {
      const fromProgress = typeof startProgress === "number" ? startProgress : currentProgress;
      progress.setValue(clamp(fromProgress, 0, lastIndex));
      animatingRef.current = true;
      Animated.timing(progress, {
        duration: settleDurationMs,
        easing: Easing.out(Easing.cubic),
        toValue: clampedIndex,
        useNativeDriver: false
      }).start(({ finished }) => {
        animatingRef.current = false;
        if (finished) commitIndex(clampedIndex);
      });
    });
  }, [commitIndex, lastIndex, progress, settleDurationMs]);

  const goToItem = useCallback((item: T) => {
    animateToIndex(indexOfItem(items, item));
  }, [animateToIndex, items]);

  const resetToActiveItem = useCallback(() => {
    animateToIndex(activeIndexRef.current);
  }, [animateToIndex]);

  const canSwipeEdge = useCallback((direction: SegmentedPagerSwipeDirection, index: number) => {
    const item = items[index];
    if (!item || !onEdgeSwipe) return false;
    return canEdgeSwipe ? canEdgeSwipe(direction, item, index) : true;
  }, [canEdgeSwipe, items, onEdgeSwipe]);

  const finishSwipe = useCallback((dx: number, dy: number, vx: number) => {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const isHorizontal = absX >= activationDistance && absX > absY * intentRatio;
    const direction: SegmentedPagerSwipeDirection = dx < 0 ? "left" : "right";
    const startIndex = clamp(dragStartIndexRef.current, 0, lastIndex);
    const nextIndex = direction === "left" ? startIndex + 1 : startIndex - 1;
    const pageDistance = absX / Math.max(pageSize, 1);
    const hasSettleIntent = pageDistance > settleDistance || (direction === "left" ? vx < -triggerVelocity : vx > triggerVelocity);
    const hasEdgeIntent = absX > Math.max(72, pageSize * settleDistance) || (direction === "left" ? vx < -triggerVelocity : vx > triggerVelocity);

    if (!isHorizontal) {
      resetToActiveItem();
      return;
    }

    if (nextIndex >= 0 && nextIndex <= lastIndex && hasSettleIntent) {
      const currentProgress = clamp(startIndex - dx / Math.max(pageSize, 1), 0, lastIndex);
      animateToIndex(nextIndex, currentProgress);
      return;
    }

    if ((nextIndex < 0 || nextIndex > lastIndex) && hasEdgeIntent && canSwipeEdge(direction, startIndex)) {
      progress.setValue(startIndex);
      const item = items[startIndex];
      if (item) onEdgeSwipe?.(direction, item, startIndex);
      return;
    }

    resetToActiveItem();
  }, [
    activationDistance,
    animateToIndex,
    canSwipeEdge,
    intentRatio,
    items,
    lastIndex,
    onEdgeSwipe,
    pageSize,
    progress,
    resetToActiveItem,
    settleDistance,
    triggerVelocity
  ]);

  const shouldSetPagerResponder = useCallback((gesture: PanResponderGestureState) => {
      if (!enabled || animatingRef.current || items.length <= 1) return false;
      if (shouldHandleGesture && !shouldHandleGesture(gesture)) return false;
      const absX = Math.abs(gesture.dx);
      const absY = Math.abs(gesture.dy);
      if (absX < activationDistance || absX < absY * intentRatio) return false;

      const currentIndex = activeIndexRef.current;
      if (gesture.dx < 0) return currentIndex < lastIndex || canSwipeEdge("left", currentIndex);
      return currentIndex > 0 || canSwipeEdge("right", currentIndex);
  }, [activationDistance, canSwipeEdge, enabled, intentRatio, items.length, lastIndex, shouldHandleGesture]);

  const beginGesture = useCallback(() => {
    dragStartIndexRef.current = activeIndexRef.current;
    progress.stopAnimation();
  }, [progress]);

  const updateGesture = useCallback((dx: number) => {
    const pageWidth = Math.max(pageSize, 1);
    const nextProgress = clamp(dragStartIndexRef.current - dx / pageWidth, 0, lastIndex);
    progress.setValue(nextProgress);
  }, [lastIndex, pageSize, progress]);

  const finishGesture = useCallback((dx: number, dy: number, vx = 0) => {
    finishSwipe(dx, dy, vx);
  }, [finishSwipe]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => shouldSetPagerResponder(gesture),
    onMoveShouldSetPanResponderCapture: (_, gesture) => shouldSetPagerResponder(gesture),
    onPanResponderGrant: beginGesture,
    onPanResponderMove: (_, gesture) => updateGesture(gesture.dx),
    onPanResponderRelease: (_, gesture) => finishGesture(gesture.dx, gesture.dy, gesture.vx),
    onPanResponderTerminate: resetToActiveItem,
    onPanResponderTerminationRequest: () => false
  }), [
    beginGesture,
    finishGesture,
    finishSwipe,
    lastIndex,
    pageSize,
    progress,
    resetToActiveItem,
    shouldSetPagerResponder,
    updateGesture
  ]);

  const contentTranslateX = useMemo(() => progress.interpolate({
    inputRange: items.map((_, index) => index),
    outputRange: items.map((_, index) => -index * pageSize),
    extrapolate: "clamp"
  }), [items, pageSize, progress]);

  return {
    activeIndexRef,
    activeItem,
    activeItemRef,
    beginGesture,
    contentTranslateX,
    finishGesture,
    goToItem,
    panHandlers: panResponder.panHandlers,
    progress,
    updateGesture
  };
}
