import { Platform, StatusBar } from "react-native";
import { spacing } from "@/theme";

export const POST_BITE_ASPECT_RATIO = 4 / 5;

// Mirrors CameraScreen's top chrome: the close/flash row starts at
// max(safe top + sm, 42), and the recording-timer badge hangs 58pt below
// that row and is ~30pt tall. The guide clears both so the timer floats
// above the frame while recording.
const CAMERA_TOP_CHROME_HEIGHT = 88;

// The capture guide sits directly below the camera's top controls, clear of
// the bottom control stack (zoom rail, photo/video rail, shutter row). It
// intentionally does not track the review screen's photo position: with video
// mode the bottom controls are too tall for the two layouts to coexist.
export type PostBiteGuideFrame = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function postBiteGuideFrame(window: { height: number; width: number }, safeAreaTopInset: number): PostBiteGuideFrame | null {
  if (window.width < 1 || window.height < 1) return null;
  const statusBarInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const controlsTop = Math.max(Math.max(safeAreaTopInset, statusBarInset) + spacing.sm, 42);
  const top = controlsTop + CAMERA_TOP_CHROME_HEIGHT + spacing.sm;
  const width = window.width;
  return {
    height: width / POST_BITE_ASPECT_RATIO,
    left: 0,
    top,
    width
  };
}
