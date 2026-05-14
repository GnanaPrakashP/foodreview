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

test("PhotoUpload uses one add button before showing camera/gallery choices", () => {
  assert.match(source, /const MAX_PHOTOS = 4/);
  assert.match(source, /const \[showSourceMenu, setShowSourceMenu\] = useState\(false\)/);
  assert.match(source, /const sourceMenuRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(source, /if \(!canAddMore\) return;/);
  assert.match(source, /setShowSourceMenu\(\(open\) => !open\)/);
  assert.match(source, /aria-haspopup="menu"/);
  assert.match(source, /\{files\.length > 0 && !maxReached \? "Add more" : "Add photos"\}/);
  assert.match(source, /disabled=\{maxReached\}/);
  assert.match(source, /4 per post/);
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /aria-label="Photo options"/);
  assert.match(source, /position: "absolute"/);
  assert.match(source, /top: "50%"/);
  assert.match(source, /right: "12px"/);
  assert.match(source, /transform: "translateY\(-50%\)"/);
  assert.match(source, /width: "min\(calc\(100% - 24px\), 206px\)"/);
  assert.match(source, /minWidth: "168px"/);
  assert.match(source, /boxShadow: "0 8px 24px rgba\(0,0,0,0\.35\)"/);
  assert.match(source, /onClick=\{openCamera\}/);
  assert.match(source, /onClick=\{openGallery\}/);
  assert.doesNotMatch(source, /\{!showSourceMenu \? \(/);
});

test("photo moderation route limits posts to four photos", () => {
  assert.match(moderateRouteSource, /const MAX_PHOTOS = 4/);
  assert.match(moderateRouteSource, /Maximum \$\{MAX_PHOTOS\} photos allowed/);
});

test("PhotoUpload crops selected photos to the post portrait ratio before upload", () => {
  assert.match(source, /const POST_ASPECT_RATIO = 4 \/ 5/);
  assert.match(source, /const CROP_OUTPUT_WIDTH = 1080/);
  assert.match(source, /const CROP_OUTPUT_HEIGHT = 1350/);
  assert.match(source, /function getInitialCrop\(width: number, height: number\)/);
  assert.match(source, /setCropQueue\(\(current\) => \[\.\.\.current, \.\.\.accepted\]\)/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-label="Crop photo"/);
  assert.match(source, /startCropInteraction\("move", event\)/);
  assert.match(source, /startCropInteraction\("resize", event\)/);
  assert.match(source, /context\.drawImage\(/);
  assert.match(source, /new File\(\[blob\], getCroppedFileName\(cropSession\.file\.name\)/);
});
