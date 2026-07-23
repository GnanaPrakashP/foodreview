import { useCallback } from "react";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import { Easing, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

export type DrivenKeyboardHeight = {
  /** Driven keyboard height in px, positive, glued-animation safe. */
  height: SharedValue<number>;
  /** Final height announced by the in-flight transition (0 when closing). */
  target: SharedValue<number>;
  /**
   * Starts toward the last settled open height immediately on input focus.
   * The native transition still owns the authoritative target and reconciles
   * this hint as soon as Android/iOS announces the next keyboard frame.
   */
  prepareForOpen: () => void;
  /**
   * Height of the keyboard at rest, updated only when a transition completes.
   * Safe to drive LAYOUT from (e.g. scroll reserves): it never changes while
   * frames are in flight, so it cannot add app-side work during the slide.
   */
  settled: SharedValue<number>;
};

const KEYBOARD_OPEN_LEAD_MS = 24;
const KEYBOARD_OPEN_MAX_DURATION_MS = 280;
const KEYBOARD_OPEN_MIN_DURATION_MS = 120;

// Keyboard height for composers that must move with the IME with zero wiggle.
//
// OPENING parks, it does not ride. After the first completed opening, focus
// can begin toward the cached authoritative height before Android dispatches
// its first animation frame; onStart then confirms or corrects that target.
// The composer makes one one-directional move and is stationary before the
// IME finishes. Frame-by-frame screen captures (comments sheet,
// 2026-07-08, vs Instagram on the same phone) proved that every ride/chase
// variant — raw follow, matched-curve timing, snap re-anchor, smooth
// catch-up — reads as relative wiggle against the OS-rendered keyboard,
// because the app render-freezes ~4 frames at slide start while the IME
// (a separate window) keeps moving. A parked composer cannot wiggle.
//
// CLOSING follows per frame (verified smooth on device) through a monotonic
// gate clamped to the announced target. Stale onEnd events from
// cancelled/superseded transitions are ignored (measured: end(0) mid-open,
// fresh start(378) 1ms later — honoring it dives the composer). The matching
// final event reconciles atomically and never starts a second animation.
//
// Consumers must keep the motion transform-only (no per-frame layout) and
// derive it from this single value — see PostCommentsSheet for the pattern.
export function useDrivenKeyboardHeight(): DrivenKeyboardHeight {
  const height = useSharedValue(0);
  const target = useSharedValue(0);
  const settled = useSharedValue(0);
  const direction = useSharedValue(0); // 1 opening, -1 closing, 0 idle
  const primedOpening = useSharedValue(false);
  const cachedOpenHeight = useSharedValue(0);
  const cachedAnimationDuration = useSharedValue(240);

  const prepareForOpen = useCallback(() => {
    const cachedTarget = cachedOpenHeight.value;
    // TextInput dispatches press and focus for the same tap. Never let the
    // second callback restart the already-running cached animation.
    if (primedOpening.value || cachedTarget <= 0 || height.value > 1) return;

    primedOpening.value = true;
    direction.value = 1;
    target.value = cachedTarget;
    height.value = withTiming(cachedTarget, {
      duration: Math.max(
        KEYBOARD_OPEN_MIN_DURATION_MS,
        Math.min(cachedAnimationDuration.value - KEYBOARD_OPEN_LEAD_MS, KEYBOARD_OPEN_MAX_DURATION_MS)
      ),
      easing: Easing.bezier(0.2, 0, 0, 1)
    });
  }, [cachedAnimationDuration, cachedOpenHeight, direction, height, primedOpening, target]);

  useKeyboardHandler({
    onStart: (event) => {
      "worklet";
      const nextTarget = Math.max(0, event.height);
      const previousTarget = target.value;
      const wasOpening = direction.value > 0;
      const wasPrimed = primedOpening.value;
      const continuesSameOpening = (
        event.duration > 0 &&
        wasOpening &&
        nextTarget > 0 &&
        Math.abs(nextTarget - previousTarget) <= 1
      );
      primedOpening.value = false;
      target.value = nextTarget;
      // Android can announce the same opening more than once. Preserve the
      // existing animation even if it has already reached the cached target;
      // allowing onMove to take over there would pull the composer backward.
      if (continuesSameOpening) {
        direction.value = 1;
        return;
      }
      if (nextTarget > 0 && (wasPrimed || nextTarget > height.value)) {
        direction.value = 1;
        if (event.duration > 0) {
          // PARK, don't ride: the destination is predetermined (or primed
          // from the last settled opening), so the composer makes one
          // one-directional move and is stationary before the IME's final,
          // drop-prone frames. Riding the keyboard is impossible to render
          // faithfully on devices that freeze app frames at slide start
          // (measured ~4 frames on the Motorola Edge 70 Fusion) — every
          // chase/catch-up variant showed as relative wiggle against the
          // OS-rendered keyboard. A parked composer cannot wiggle.
          // The move lands roughly one frame before the keyboard rather than
          // the old 60ms lead. That keeps the motions overlapped and makes the
          // temporary bridge between them short enough to read as one event.
          const remainingDistance = Math.abs(nextTarget - height.value);
          if (remainingDistance <= 1) {
            height.value = nextTarget;
          } else {
            const fullDuration = Math.max(
              KEYBOARD_OPEN_MIN_DURATION_MS,
              Math.min(event.duration - KEYBOARD_OPEN_LEAD_MS, KEYBOARD_OPEN_MAX_DURATION_MS)
            );
            const remainingRatio = wasPrimed
              ? Math.min(1, remainingDistance / Math.max(nextTarget, 1))
              : 1;
            height.value = withTiming(nextTarget, {
              duration: Math.max(80, Math.round(fullDuration * remainingRatio)),
              easing: Easing.bezier(0.2, 0, 0, 1)
            });
          }
        } else {
          // Instant/fallback transitions (e.g. emoji<->text panel snaps)
          // resize the panel in one frame; match it.
          height.value = nextTarget;
          settled.value = nextTarget;
        }
      } else if (nextTarget < height.value) {
        direction.value = -1;
        if (event.duration <= 0) {
          height.value = nextTarget;
          settled.value = nextTarget;
        }
      } else {
        direction.value = 0;
      }
    },
    onMove: (event) => {
      "worklet";
      if (direction.value > 0) return; // opening: the park animation owns the value
      const raw = Math.max(0, event.height);
      if (direction.value < 0) {
        height.value = Math.max(Math.min(height.value, raw), target.value);
      } else {
        height.value = raw;
      }
    },
    onInteractive: (event) => {
      "worklet";
      // iOS interactive dismiss: the finger owns the keyboard, follow raw.
      direction.value = 0;
      height.value = Math.max(0, event.height);
    },
    onEnd: (event) => {
      "worklet";
      const finalHeight = Math.max(0, event.height);
      // End of a superseded transition carries the old animation's height; a
      // fresh onStart with the real target follows immediately. Ignore it.
      if (Math.abs(finalHeight - target.value) > 1) return;
      primedOpening.value = false;
      direction.value = 0;
      if (finalHeight > 0) cachedOpenHeight.value = finalHeight;
      if (event.duration > 0) cachedAnimationDuration.value = event.duration;
      // Never start another visible animation after the OS keyboard stops.
      // The native final height is authoritative; any sub-frame remainder is
      // reconciled atomically so an open cannot acquire a second stop.
      height.value = finalHeight;
      settled.value = finalHeight;
    }
  }, []);

  return { height, prepareForOpen, target, settled };
}
