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

test("mobile post flow rejects video early and uploads media sequentially", () => {
  const posts = source("mobile/src/services/posts.ts");
  const share = source("mobile/app/(tabs)/share.tsx");

  assert.match(posts, /REVIEW_VIDEO_DISABLED_MESSAGE = "Video uploads are temporarily unavailable"/);
  assert.match(posts, /if \(resolveMediaType\(media\) === "video"\) \{\s*throw new Error\(REVIEW_VIDEO_DISABLED_MESSAGE\)/);
  assert.match(posts, /async function uploadPostMediaItems/);
  assert.match(posts, /for \(const \[index, media\] of items\.entries\(\)\)/);
  assert.match(posts, /uploadPostMediaItems\(items, input\.onUploadProgress\)/);
  assert.doesNotMatch(posts, /Promise\.all\(items\.map/);
  assert.match(share, /captured\.mediaType === "video"/);
  assert.match(share, /Video uploads are temporarily unavailable\. Add a photo instead\./);
  assert.match(share, /onUploadProgress: setUploadProgress/);
  assert.match(share, /Posting \$\{uploadPercent\}%/);
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
