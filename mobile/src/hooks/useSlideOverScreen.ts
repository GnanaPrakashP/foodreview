import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef } from "react";
import { BackHandler, useWindowDimensions } from "react-native";
import { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

// Slide timing matched to the table-memory members panel (PeoplePanel).
const ENTER_MS = 230;
const EXIT_MS = 190;

type SlideOverOptions = {
  // Where to go if there is no screen to pop back to (e.g. deep link). When the
  // screen was reached normally this is unused since canGoBack() is true.
  fallbackHref?: Href;
};

// Drives a right-to-left slide-in / left-to-right slide-out for a screen that is
// presented over another one (transparentModal). The panel enters from the right
// over the still screen beneath it and slides back out on close. Returns the
// animated style for the screen's root view and a `close` that plays the exit
// animation before navigating back. Also handles Android hardware back.
export function useSlideOverScreen(options: SlideOverOptions = {}) {
  const { fallbackHref } = options;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const progress = useSharedValue(0);
  const closingRef = useRef(false);

  const slideStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.35, 1], [0.92, 1, 1]),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [width, 0]) }]
  }));

  const performBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (fallbackHref) router.dismissTo(fallbackHref);
  }, [fallbackHref, router]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    progress.value = withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(performBack)();
    });
  }, [performBack, progress]);

  useFocusEffect(
    useCallback(() => {
      closingRef.current = false;
      progress.value = 0;
      progress.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });

      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [close, progress])
  );

  return { slideStyle, close };
}
