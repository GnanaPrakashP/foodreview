import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const memoryRoomScreen = readFileSync("mobile/app/memories/[id].tsx", "utf8");
const memoryPreviewScreen = readFileSync("mobile/src/components/memories/camera/MediaPreviewScreen.tsx", "utf8");
const memoryService = readFileSync("mobile/src/services/memories.ts", "utf8");
const memoryStorage = readFileSync("mobile/src/services/memoryStorage.ts", "utf8");
const memoryValidation = readFileSync("mobile/src/services/memoryMediaValidation.ts", "utf8");

test("phase 4 chat and media lists use bounded render windows", () => {
  for (const expected of [
    "CHAT_TIMELINE_INITIAL_RENDER_COUNT",
    "CHAT_TIMELINE_MAX_RENDER_BATCH",
    "CHAT_TIMELINE_WINDOW_SIZE",
    "MEDIA_GALLERY_INITIAL_RENDER_COUNT",
    "MEDIA_GALLERY_MAX_RENDER_BATCH",
    "MEDIA_GALLERY_WINDOW_SIZE"
  ]) {
    assert.match(memoryRoomScreen, new RegExp(expected));
  }

  assert.match(memoryRoomScreen, /initialNumToRender=\{CHAT_TIMELINE_INITIAL_RENDER_COUNT\}/);
  assert.match(memoryRoomScreen, /maxToRenderPerBatch=\{CHAT_TIMELINE_MAX_RENDER_BATCH\}/);
  assert.match(memoryRoomScreen, /windowSize=\{CHAT_TIMELINE_WINDOW_SIZE\}/);
  assert.match(memoryRoomScreen, /removeClippedSubviews=\{false\}/);
  assert.match(memoryRoomScreen, /initialNumToRender=\{MEDIA_GALLERY_INITIAL_RENDER_COUNT\}/);
  assert.match(memoryRoomScreen, /maxToRenderPerBatch=\{MEDIA_GALLERY_MAX_RENDER_BATCH\}/);
  assert.match(memoryRoomScreen, /windowSize=\{MEDIA_GALLERY_WINDOW_SIZE\}/);
});

test("phase 4 media viewer is virtualized instead of mounting every media item", () => {
  const mediaViewerBody = memoryRoomScreen.match(/function MediaViewer\([\s\S]*?\nfunction ViewerVideo/)?.[0] ?? "";

  assert.match(mediaViewerBody, /viewerListRef = useRef<FlatList<MemoryPhoto>>/);
  assert.match(mediaViewerBody, /<FlatList[\s\S]*data=\{items\}/);
  assert.match(mediaViewerBody, /initialNumToRender=\{1\}/);
  assert.match(mediaViewerBody, /maxToRenderPerBatch=\{MEDIA_VIEWER_MAX_RENDER_BATCH\}/);
  assert.match(mediaViewerBody, /windowSize=\{MEDIA_VIEWER_WINDOW_SIZE\}/);
  const carouselBody = mediaViewerBody.match(/style=\{styles\.viewerBody\}[\s\S]*?<\/View>/)?.[0] ?? "";
  assert.doesNotMatch(carouselBody, /<ScrollView/);
});

test("phase 4 media images use disk cache and stable recycling keys", () => {
  assert.match(memoryRoomScreen, /cachePolicy="memory-disk"/);
  assert.match(memoryRoomScreen, /recyclingKey=\{media\.storagePath \|\| media\.publicUrl\}/);
  assert.match(memoryRoomScreen, /const VIDEO_THUMBNAIL_CACHE_LIMIT = 80/);
  assert.match(memoryRoomScreen, /cacheKey=\{memoryMediaCacheKey\(media\)\}/);
});

test("chat media previews show the whole captured image or video thumbnail", () => {
  const mediaPreviewBody = memoryRoomScreen.match(/function MediaPreview\([\s\S]*?\nfunction createStyles/)?.[0] ?? "";
  assert.match(mediaPreviewBody, /contentFit = "contain"/);
  assert.match(mediaPreviewBody, /<VideoThumbnailLayer cacheKey=\{memoryMediaCacheKey\(media\)\} contentFit=\{contentFit\} uri=\{media\.publicUrl\}/);
  assert.match(mediaPreviewBody, /contentFit=\{contentFit\}/);
  assert.doesNotMatch(mediaPreviewBody, /contentFit="cover"/);
});

test("single-media chat previews size continuously from actual aspect ratio", () => {
  const sizeBody = memoryRoomScreen.match(/function getSingleMediaPreviewSize[\s\S]*?\nfunction /)?.[0] ?? "";
  assert.match(sizeBody, /const maxMediaWidth = Math\.min\(screenWidth \* 0\.82, 340\)/);
  assert.match(sizeBody, /const maxMediaHeight = Math\.min\(Math\.max\(screenWidth \* 1\.05, 360\), 430\)/);
  assert.match(sizeBody, /let width = maxMediaWidth/);
  assert.match(sizeBody, /let height = width \/ aspect/);
  assert.match(sizeBody, /height > maxMediaHeight/);
  assert.match(sizeBody, /height < minMediaHeight/);
  assert.doesNotMatch(sizeBody, /aspect < 0\.8/);
  assert.doesNotMatch(sizeBody, /aspect <= 1\.25/);
  assert.doesNotMatch(memoryRoomScreen, /mediaImageWrap:\s*\{[^}]*aspectRatio: 1/);
  assert.doesNotMatch(memoryRoomScreen, /videoPreview:\s*\{[^}]*aspectRatio: 1/);
});

test("media tab keeps fixed square gallery blocks independent of chat bubble sizing", () => {
  const galleryBody = memoryRoomScreen.match(/function MediaGallery\([\s\S]*?\nfunction formatMemoryDishRating/)?.[0] ?? "";
  assert.match(galleryBody, /numColumns=\{2\}/);
  assert.match(galleryBody, /style=\{styles\.galleryMediaButton\}/);
  assert.match(galleryBody, /<MediaPreview contentFit="cover" media=\{photo\} style=\{styles\.galleryMediaPreview\}/);
  assert.match(memoryRoomScreen, /galleryItem:\s*\{[\s\S]*?width: "50%"/);
  assert.match(memoryRoomScreen, /galleryMediaPreview:\s*\{[\s\S]*?aspectRatio: 1/);
});

test("phase 4 keeps upload-side media crash guards in place", () => {
  assert.match(memoryStorage, /const MAX_IMAGE_DIMENSION = 1600/);
  assert.match(memoryStorage, /const IMAGE_COMPRESS_QUALITY = 0\.7/);
  assert.match(memoryStorage, /assertValidMemoryUploadSize\(fileBody\.byteLength, mediaType\)/);
  assert.match(memoryValidation, /MEMORY_VIDEO_MAX_DURATION_MS/);
  assert.match(memoryValidation, /memoryMediaMaxOriginalBytes\(kind\)/);
});

test("phase 4 uploads and finalizes memory media sequentially to cap memory pressure", () => {
  const addMediaBody = memoryService.match(/export async function addMemoryPhoto\([\s\S]*?\n}/)?.[0] ?? "";
  assert.match(addMediaBody, /for \(const \[index, asset\] of uploadInputs\.entries\(\)\)/);
  assert.match(addMediaBody, /for \(const \[position, media\] of uploadResults\.entries\(\)\)/);
  assert.doesNotMatch(addMediaBody, /Promise\.all\(uploadInputs\.map/);
  assert.doesNotMatch(addMediaBody, /Promise\.all\(uploadResults\.map/);
});

test("camera preview uploads media directly before returning to chat", () => {
  assert.match(memoryPreviewScreen, /await postMemoryRoomMedia\(\{[\s\S]*asset,[\s\S]*roomId[\s\S]*\}\)/);
  assert.match(memoryPreviewScreen, /removeMemoryCapture\(asset\.id\)/);
  assert.match(memoryPreviewScreen, /router\.dismissTo\(\{[\s\S]*params: \{ id: roomId, tab: "chat" \}/);
  assert.match(memoryPreviewScreen, /Could not post media\. Check your connection and try again\./);
  assert.doesNotMatch(memoryPreviewScreen, /queueMemoryCapturePost\(asset\.id/);
  assert.doesNotMatch(memoryPreviewScreen, /postCaptureId: asset\.id/);
  assert.doesNotMatch(memoryRoomScreen, /consumeMemoryCapturePost\(postCaptureId\)/);
  assert.doesNotMatch(memoryRoomScreen, /postCaptureId/);
});

test("adding a dish from the attachment sheet returns to chat, not the dishes tab", () => {
  const submitDishBody = memoryRoomScreen.match(/async function submitDishFromAttachment\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(submitDishBody, /setAttachmentOptionsVisible\(false\)/);
  assert.match(submitDishBody, /requestRoomMode\("chat"\)/);
  assert.match(submitDishBody, /scrollChatToBottom\(true\)/);
  assert.doesNotMatch(submitDishBody, /"dishes"/);
  assert.doesNotMatch(submitDishBody, /attachmentOriginMode === "chat"/);
});
