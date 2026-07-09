import { useKeyboardHandler } from "react-native-keyboard-controller";
import { Easing, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

export type DrivenKeyboardHeight = {
  /** Driven keyboard height in px, positive, glued-animation safe. */
  height: SharedValue<number>;
  /** Final height announced by the in-flight transition (0 when closing). */
  target: SharedValue<number>;
  /**
   * Height of the keyboard at rest, updated only when a transition completes.
   * Safe to drive LAYOUT from (e.g. scroll reserves): it never changes while
   * frames are in flight, so it cannot add app-side work during the slide.
   */
  settled: SharedValue<number>;
};

// Keyboard height for composers that must move with the IME with zero wiggle.
//
// OPENING parks, it does not ride. onStart announces the exact final height
// before the slide begins, so the composer makes one quick one-directional
// move (140ms) to that predetermined position and is stationary before the
// IME is halfway up. Frame-by-frame screen captures (comments sheet,
// 2026-07-08, vs Instagram on the same phone) proved that every ride/chase
// variant — raw follow, matched-curve timing, snap re-anchor, smooth
// catch-up — reads as relative wiggle against the OS-rendered keyboard,
// because the app render-freezes ~4 frames at slide start while the IME
// (a separate window) keeps moving. A parked composer cannot wiggle.
//
// CLOSING follows per frame (verified smooth on device) through a monotonic
// gate clamped to the announced target. Stale onEnd events from
// cancelled/superseded transitions are ignored (measured: end(0) mid-open,
// fresh start(378) 1ms later — honoring it dives the composer); genuine
// retargets reconcile with one short glide.
//
// Consumers must keep the motion transform-only (no per-frame layout) and
// derive it from this single value — see PostCommentsSheet for the pattern.
export function useDrivenKeyboardHeight(): DrivenKeyboardHeight {
  const height = useSharedValue(0);
  const target = useSharedValue(0);
  const settled = useSharedValue(0);
  const direction = useSharedValue(0); // 1 opening, -1 closing, 0 idle

  useKeyboardHandler({
    onStart: (event) => {
      "worklet";
      const nextTarget = Math.max(0, event.height);
      target.value = nextTarget;
      if (nextTarget > height.value) {
        direction.value = 1;
        if (event.duration > 0) {
          // PARK, don't ride: the destination is predetermined (onStart
          // announces the exact final height), so the composer makes one
          // one-directional move and is stationary before the IME's final,
          // drop-prone frames. Riding the keyboard is impossible to render
          // faithfully on devices that freeze app frames at slide start
          // (measured ~4 frames on the Motorola Edge 70 Fusion) — every
          // chase/catch-up variant showed as relative wiggle against the
          // OS-rendered keyboard. A parked composer cannot wiggle.
          // The move spans MOST of the keyboard's announced duration and
          // lands ~60ms early: a much faster move (140ms was tried) leaves
          // the two arrivals far apart and reads as a "two-stop" sequence —
          // composer lands, dead air, keyboard docks. Overlapping the
          // motions with the same AOSP curve makes it one continuous event
          // in which the composer simply leads.
          height.value = withTiming(nextTarget, {
            duration: Math.max(120, Math.min(event.duration - 60, 240)),
            easing: Easing.bezier(0.2, 0, 0, 1)
          });
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
      direction.value = 0;
      settled.value = finalHeight;
      if (Math.abs(height.value - finalHeight) > 1) {
        height.value = withTiming(finalHeight, {
          duration: 120,
          easing: Easing.out(Easing.quad)
        });
      } else {
        height.value = finalHeight;
      }
    }
  }, []);

  return { height, target, settled };
}
