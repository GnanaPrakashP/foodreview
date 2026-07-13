import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/reviews/PhotoUpload.tsx", import.meta.url),
  "utf8",
);
const moderateRouteSource = readFileSync(
  new URL("../app/api/photos/moderate/route.ts", import.meta.url),
  "utf8",
);

test("PhotoUpload uses one add button before showing a bottom-sheet media picker", () => {
  assert.match(source, /const MAX_MEDIA = 4/);
  assert.match(source, /export const MAX_VIDEO_DURATION_SECONDS = 10/);
  assert.match(source, /const \[showSourceMenu, setShowSourceMenu\] = useState\(false\)/);
  assert.match(source, /const videoCameraRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(source, /if \(!canAddMore\) return;/);
  assert.match(source, /setShowSourceMenu\(\(open\) => !open\)/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /\{files\.length > 0 && !maxReached \? "Add more" : "Add media"\}/);
  assert.match(source, /disabled=\{maxReached\}/);
  assert.match(source, /4 per post/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-label="Add media"/);
  assert.match(source, /position: "fixed"/);
  assert.match(source, /alignItems: "flex-end"/);
  assert.match(source, /maxWidth: "32rem"/);
  assert.match(source, /borderRadius: "18px 18px 0 0"/);
  assert.match(source, /env\(safe-area-inset-bottom\)/);
  assert.match(source, /boxShadow: "0 20px 50px rgba\(0,0,0,0\.45\)"/);
  assert.match(source, /onClick=\{openCamera\}/);
  assert.match(source, /onClick=\{openVideoCamera\}/);
  assert.match(source, /onClick=\{openGallery\}/);
  assert.match(source, /Take photo/);
  assert.match(source, /Record video/);
  assert.match(source, /Choose from library/);
  assert.match(source, /accept="video\/\*"/);
  assert.match(source, /getVideoDurationSeconds\(file\)/);
  assert.match(source, /durationSeconds > MAX_VIDEO_DURATION_SECONDS/);
  assert.match(source, /video must be 10 seconds or less/);
  assert.doesNotMatch(source, /\{!showSourceMenu \? \(/);
});

test("legacy photo moderation route is retired instead of publishing caller-selected paths", () => {
  assert.match(moderateRouteSource, /Legacy media moderation endpoint is retired/);
  assert.match(moderateRouteSource, /status: 410/);
  assert.doesNotMatch(moderateRouteSource, /\.storage\./);
});

test("PhotoUpload crops selected photos to the post portrait ratio before upload", () => {
  assert.match(source, /const POST_ASPECT_RATIO = 4 \/ 5/);
  assert.match(source, /const CROP_OUTPUT_WIDTH = 1080/);
  assert.match(source, /const CROP_OUTPUT_HEIGHT = 1350/);
  assert.match(source, /function getInitialCrop\(width: number, height: number\)/);
  assert.match(source, /setCropQueue\(\(current\) => \[\.\.\.current, \.\.\.imagesForCrop\]\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-label="Crop photo"/);
  assert.match(source, /startCropInteraction\("move", event\)/);
  assert.match(source, /startCropInteraction\("resize", event\)/);
  assert.match(source, /context\.drawImage\(/);
  assert.match(source, /new File\(\[blob\], getCroppedFileName\(cropSession\.file\.name\)/);
});
