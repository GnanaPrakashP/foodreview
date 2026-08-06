import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

test("mobile review media re-encodes images before creating upload intents", () => {
  const reviewMedia = source("mobile/src/services/reviewMedia.ts");

  assert.match(reviewMedia, /ImageManipulator, SaveFormat/);
  assert.match(reviewMedia, /REVIEW_IMAGE_TARGET_MAX_EDGE = 2400/);
  assert.match(reviewMedia, /REVIEW_IMAGE_MAX_SOURCE_PIXELS = 60_000_000/);
  assert.match(reviewMedia, /SUPPORTED_SOURCE_IMAGE_MIME_TYPES/);
  assert.match(reviewMedia, /ImageManipulator\.manipulate\(input\.uri\)/);
  assert.match(reviewMedia, /context\.resize/);
  assert.match(reviewMedia, /format: SaveFormat\.JPEG/);
  assert.match(reviewMedia, /assertJpegSignature\(body\)/);
  assert.match(reviewMedia, /mimeType: "image\/jpeg"/);
  assert.match(reviewMedia, /fileSizeBytes: prepared\.body\.byteLength/);
  assert.match(reviewMedia, /intent\.maxAllowedSize < prepared\.body\.byteLength/);
  assert.doesNotMatch(reviewMedia, /fileSizeBytes: body\.size/);
});

test("mobile review media upload uses progress aware retry-safe storage writes", () => {
  const reviewMedia = source("mobile/src/services/reviewMedia.ts");

  assert.match(reviewMedia, /REVIEW_MEDIA_UPLOAD_RETRIES = 1/);
  assert.match(reviewMedia, /function isObjectAlreadyExistsError/);
  assert.match(reviewMedia, /async function uploadFileBody/);
  assert.match(reviewMedia, /for \(let attempt = 0; attempt <= REVIEW_MEDIA_UPLOAD_RETRIES/);
  assert.match(reviewMedia, /XMLHttpRequest/);
  assert.match(reviewMedia, /xhr\.timeout = 45_000/);
  assert.match(reviewMedia, /xhr\.upload\.onprogress/);
  assert.match(reviewMedia, /resolvedSupabaseUrl/);
  assert.match(reviewMedia, /resolvedSupabaseAnonKey/);
  assert.match(reviewMedia, /onUploadProgress\?\.\(0\.2 \+ progress \* 0\.7\)/);
});

test("mobile post flow uploads through media assets sequentially", () => {
  const posts = source("mobile/src/services/posts.ts");
  const mediaPipeline = source("mobile/src/services/mediaPipeline.ts");
  const share = source("mobile/app/(tabs)/share.tsx");
  const shareCamera = source("mobile/app/share/camera.tsx");
  const mediaPicker = source("mobile/src/services/mediaPicker.ts");
  const postCaptureSession = source("mobile/src/services/postCaptureSession.ts");

  // Posting goes through the media-asset pipeline, never a direct storage
  // write, and each item is queued before the batch waits for all of them.
  assert.match(posts, /uploadPostMediaAsset,/);
  assert.match(posts, /waitForReadyMediaAssets,/);
  assert.match(posts, /type MediaCropRect/);
  assert.match(posts, /deferReadyWait: true/);
  assert.match(posts, /cropRect\?: MediaCropRect \| null/);
  assert.match(posts, /const uploaded = await uploadPostMediaAsset/);
  assert.match(posts, /intendedVisibility: visibility/);
  assert.match(posts, /assetId: uploaded\.assetId/);
  assert.match(posts, /assetId: item\.assetId/);
  assert.match(posts, /async function uploadPostMediaItems/);
  assert.match(posts, /for \(const \[index, media\] of items\.entries\(\)\)/);
  assert.match(posts, /uploadPostMediaItems\(items, input\.visibility, input\.onUploadProgress\)/);
  assert.doesNotMatch(posts, /Promise\.all\(items\.map/);
  assert.match(mediaPipeline, /\/api\/media\/upload-intent/);
  assert.match(mediaPipeline, /\/api\/media\/finalize-upload/);
  assert.match(mediaPipeline, /\/api\/media\/status\?ids=/);
  assert.match(mediaPipeline, /function defaultCropRect/);
  // A post binds 4:5 and an avatar binds 1:1; the room surface, added later,
  // deliberately binds nothing and keeps the frame it was shot in.
  assert.match(
    mediaPipeline,
    /targetAspect: surface === "memory"\s*\?\s*null\s*:\s*surface === "avatar"\s*\?\s*1\s*:\s*mediaKind === "image" \|\| mediaKind === "video"\s*\?\s*4 \/ 5\s*:\s*null/
  );
  assert.match(mediaPipeline, /waitForReadyMedia/);
  assert.match(mediaPipeline, /intent\.accessClass !== expectedAccessClass/);
  // The transfer must report progress and stay cancellable — it moved from a
  // raw XHR to expo-file-system's upload task, which is what account teardown
  // aborts through the active-task registry.
  assert.match(mediaPipeline, /FileSystem\.createUploadTask\(/);
  assert.match(mediaPipeline, /activeUploadTasks/);
  assert.match(mediaPipeline, /task\.cancelAsync\(\)/);
  assert.match(share, /router\.push\("\/share\/camera"\)/);
  assert.match(share, /consumePendingPostCaptures\(\)/);
  assert.match(share, /<CropRegionImage[\s\S]+cropRect=\{media\.cropRect\}[\s\S]+uri=\{media\.uri\}/);
  assert.doesNotMatch(share, /pickPostImageFromCamera\(\)/);
  assert.doesNotMatch(shareCamera, /allowVideo=\{false\}/);
  assert.match(shareCamera, /autoCropPhotoToGuide/);
  assert.match(shareCamera, /postBiteGuideFrame/);
  assert.match(shareCamera, /photoGuideFrame=\{guideFrame\}/);
  assert.match(shareCamera, /setPendingPostCaptures\(assets\)/);
  assert.match(shareCamera, /setPendingPostCapture\(asset\)/);
  assert.match(shareCamera, /function returnAfterCapture\(\)[\s\S]*openedFromProfilePosts[\s\S]*router\.dismissTo\("\/share"\)[\s\S]*else router\.back\(\)/);
  assert.match(shareCamera, /setTimeout\(returnAfterCapture, 48\)/);
  assert.match(mediaPicker, /export async function pickPostImageFromGallery\(\)[\s\S]*allowsEditing: false/);
  assert.match(postCaptureSession, /subscribeToPostCaptures/);
  assert.match(postCaptureSession, /consumePendingPostCaptures/);
  // Upload progress no longer belongs to this screen: sharing hands the post to
  // the background queue, and the runner reports progress into the store that
  // drives the line on Home.
  assert.match(share, /usePostingStore\.getState\(\)\.enqueue\(/);
  assert.match(
    source("mobile/src/providers/PostingQueueRunner.tsx"),
    /onUploadProgress: \(progress\) => usePostingStore\.getState\(\)\.setProgress\(next\.id, progress\)/
  );
  // The percentage moved off this screen with the wait itself. Progress is a
  // line at the top of Home now, so the composer's action never says "Posting".
  assert.match(source("mobile/src/components/home/PostingProgressBar.tsx"), /accessibilityRole="progressbar"/);
  assert.doesNotMatch(share, /Posting \$\{|uploadPercent/);
  assert.match(posts, /height: uploaded\.height \?\? media\.height \?\? null/);
  assert.match(posts, /width: uploaded\.width \?\? media\.width \?\? null/);
});

test("mobile in-app camera retries raw capture when Android post-processing fails", () => {
  const cameraScreen = source("mobile/src/components/memories/camera/CameraScreen.tsx");

  assert.match(cameraScreen, /takePhotoWithProcessingFallback/);
  assert.match(cameraScreen, /skipProcessing: false/);
  assert.match(cameraScreen, /skipProcessing: true/);
  assert.match(cameraScreen, /emitCapturedPhoto\(photo\)/);
  assert.match(cameraScreen, /stageAccountFile\(photo\.uri, "camera-photo"\)/);
  assert.match(cameraScreen, /PhotoCropGuide/);
  assert.match(cameraScreen, /relativeCropRectForVisibleFrame/);
  assert.match(cameraScreen, /visibleRect: sourceSize \? relativeCropRectForVisibleFrame/);
  assert.doesNotMatch(cameraScreen, /ImageManipulator|cropCapturedPhotoToGuide/);
  assert.match(cameraScreen, /function chooseGuidedPictureSize\(sizes: string\[\]\)/);
  assert.match(cameraScreen, /Math\.abs\(size\.longEdge \/ size\.shortEdge - 4 \/ 3\) < 0\.02/);
  assert.match(cameraScreen, /const selectedSize = guidedPhotoMode[\s\S]*\? chooseGuidedPictureSize\(sizes \?\? \[\]\)[\s\S]*: chooseMemoryPictureSize\(sizes \?\? \[\]\)/);
  assert.match(cameraScreen, /pictureSize=\{pictureSize\}/);
  assert.match(cameraScreen, /const width = viewport\.width/);
  assert.match(cameraScreen, /top: \(viewport\.height - height\) \/ 2/);
  assert.match(cameraScreen, /preview cover-fills the viewport/);
  assert.match(cameraScreen, /const scale = Math\.max\(viewport\.width \/ source\.width, viewport\.height \/ source\.height\)/);
  assert.match(cameraScreen, /\.\.\.StyleSheet\.absoluteFillObject/);
});

test("mobile avatar uploads pass picker metadata into the hardened media service", () => {
  const profileService = source("mobile/src/services/profiles.ts");
  const editProfile = source("mobile/app/profile/settings/edit.tsx");

  assert.match(profileService, /fileSize\?: number \| null/);
  assert.match(profileService, /height\?: number \| null/);
  assert.match(profileService, /width\?: number \| null/);
  assert.match(profileService, /fileSize: input\.fileSize/);
  assert.match(profileService, /height: input\.height/);
  assert.match(profileService, /width: input\.width/);
  assert.match(editProfile, /fileSize: asset\.fileSize \?\? null/);
  assert.match(editProfile, /height: asset\.height \?\? null/);
  assert.match(editProfile, /width: asset\.width \?\? null/);
});
