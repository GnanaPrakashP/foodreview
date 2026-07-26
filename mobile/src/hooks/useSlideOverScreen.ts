import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, useWindowDimensions } from "react-native";
import { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useReducedMotionPreference } from "@/hooks/useReducedMotionPreference";

// The panel travels close to a full screen width, so it needs a real screen
// duration — the old 150ms was borrowed from the small members panel and worked
// out to ~2700dp/s, which read as a snap rather than a slide. Quad easing keeps
// the deceleration gentle; cubic front-loaded ~66% of the distance into the
// first third of the run and then crawled to a stop.
const ENTER_MS = 300;
const EXIT_MS = 200;
const ENTER_EASING = Easing.out(Easing.quad);
const EXIT_EASING = Easing.in(Easing.quad);
// Cap the slide distance so wide screens don't get an exaggerated travel;
// identical to the full width on phones.
const PANEL_TRAVEL_MAX = 640;

type SlideOverOptions = {
  // Where to go if there is no screen to pop back to (e.g. deep link). When the
  // screen was reached normally this is unused since canGoBack() is true.
  fallbackHref?: Href;
  // Return true when a nested state handled back and the slide-over should stay open.
  onBack?: () => boolean;
  // Set by hosts that are not a route (an in-tree panel rendered over its
  // parent screen). When present the exit animation ends here instead of
  // navigating.
  onDismiss?: () => void;
};

// Drives a right-to-left slide-in / left-to-right slide-out for a screen that is
// presented over another one (transparentModal). The panel enters from the right
// over the still screen beneath it and slides back out on close. Returns the
// animated style for the screen's root view and a `close` that plays the exit
// animation before navigating back. Also handles Android hardware back.
export function useSlideOverScreen(options: SlideOverOptions = {}) {
  const { fallbackHref, onBack, onDismiss } = options;
  const router = useRouter();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotionPreference();
  const progress = useSharedValue(0);
  const closingRef = useRef(false);
  const [isClosing, setIsClosing] = useState(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const travel = Math.min(width, PANEL_TRAVEL_MAX);
  const slideStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 1 : interpolate(progress.value, [0, 0.35, 1], [0.92, 1, 1]),
    transform: [{ translateX: reducedMotion ? 0 : interpolate(progress.value, [0, 1], [travel, 0]) }]
  }));

  const performBack = useCallback(() => {
    if (onDismissRef.current) {
      onDismissRef.current();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (fallbackHref) {
      router.dismissTo(fallbackHref);
      return;
    }
    // Deep-linked straight onto a slide-over with no fallback: there is nothing
    // to pop to, so slide back in rather than leaving the screen parked
    // off-screen and unreachable.
    closingRef.current = false;
    setIsClosing(false);
    progress.value = withTiming(1, { duration: ENTER_MS, easing: ENTER_EASING });
  }, [fallbackHref, progress, router]);

  const close = useCallback(() => {
    if (onBackRef.current?.()) return;
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    progress.value = withTiming(0, { duration: reducedMotion ? 0 : EXIT_MS, easing: EXIT_EASING }, (finished) => {
      if (finished) runOnJS(performBack)();
    });
  }, [performBack, progress, reducedMotion]);

  // Enter once on mount, not on every focus: a slide-over can stay mounted while
  // a screen is pushed over it (Settings -> Edit Profile), and replaying the
  // entrance when it regains focus would be wrong. Reduced motion is handled by
  // slideStyle, which ignores progress entirely once the preference resolves.
  useEffect(() => {
    progress.value = withTiming(1, { duration: ENTER_MS, easing: ENTER_EASING });
  }, [progress]);

  // Hardware back should play the exit slide; keep this scoped to while focused.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [close])
  );

  return { slideStyle, close, isClosing };
}
