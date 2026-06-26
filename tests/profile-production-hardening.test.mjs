import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "mobile/supabase/migrations/202606250001_profile_media_username_hardening.sql",
  "utf8"
);
const reviewMedia = readFileSync("lib/server/review-media.ts", "utf8");
const uploadIntentRoute = readFileSync("app/api/mobile/review-media/upload-intent/route.ts", "utf8");
const finalizeRoute = readFileSync("app/api/mobile/review-media/finalize-upload/route.ts", "utf8");
const reviewsRoute = readFileSync("app/api/reviews/route.ts", "utf8");
const reviewDeleteRoute = readFileSync("app/api/reviews/[id]/route.ts", "utf8");
const deleteAccountRoute = readFileSync("app/api/delete-account/route.ts", "utf8");
const cleanupWorkerRoute = readFileSync("app/api/internal/account-media-cleanup/route.ts", "utf8");
const cleanupHelper = readFileSync("lib/server/account-media-cleanup.ts", "utf8");
const usernameRoute = readFileSync("app/api/mobile/profile/username/route.ts", "utf8");
const profileService = readFileSync("mobile/src/services/profiles.ts", "utf8");
const postService = readFileSync("mobile/src/services/posts.ts", "utf8");
const mobileReviewMedia = readFileSync("mobile/src/services/reviewMedia.ts", "utf8");
const profileScreen = readFileSync("mobile/app/(tabs)/profile.tsx", "utf8");
const profileHooks = readFileSync("mobile/src/hooks/useProfiles.ts", "utf8");
const createPostHook = readFileSync("mobile/src/hooks/useCreatePost.ts", "utf8");
const engagementService = readFileSync("mobile/src/services/engagement.ts", "utf8");

function assertOrder(source, before, after, message) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${message}: missing first marker`);
  assert.notEqual(afterIndex, -1, `${message}: missing second marker`);
  assert.ok(beforeIndex < afterIndex, message);
}

test("review media upload intents use generated owner-prefixed paths and trusted validation", () => {
  assert.match(reviewMedia, /export const REVIEW_POST_MAX_ITEMS = 4/);
  assert.match(reviewMedia, /REVIEW_AVATAR_MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(reviewMedia, /REVIEW_POST_IMAGE_MAX_BYTES = 12 \* 1024 \* 1024/);
  assert.match(reviewMedia, /REVIEW_POST_VIDEO_MAX_BYTES = 50 \* 1024 \* 1024/);
  assert.match(reviewMedia, /REVIEW_MEDIA_INTENT_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(reviewMedia, /REVIEW_MEDIA_QUARANTINE_BUCKET = "review-media-quarantine"/);
  assert.match(reviewMedia, /REVIEW_VIDEO_DISABLED_ERROR = "review_media_video_not_supported"/);
  assert.match(reviewMedia, /ALLOWED_POST_VIDEO_MIME_TYPES = new Set<string>\(\)/);
  assert.match(reviewMedia, /REVIEW_IMAGE_MAX_WIDTH = 6000/);
  assert.match(reviewMedia, /REVIEW_IMAGE_MAX_PIXELS = 25_000_000/);
  assert.match(reviewMedia, /const prefix = category === "avatar" \? "avatars" : "posts"/);
  assert.match(reviewMedia, /quarantineStoragePath: `pending\/\$\{userId\}\/\$\{intentId\}\/original\.\$\{extension\}`/);
  assert.match(reviewMedia, /storagePath: `\$\{prefix\}\/\$\{userId\}\/\$\{intentId\}\/\$\{finalName\}`/);
  assert.match(reviewMedia, /review_media_avatar_must_be_image/);
  assert.match(reviewMedia, /if \(kind === "video"\) throw new Error\(REVIEW_VIDEO_DISABLED_ERROR\)/);
  assert.match(reviewMedia, /review_media_mime_type_not_allowed/);
  assert.match(reviewMedia, /review_media_extension_not_allowed/);
  assert.match(reviewMedia, /review_media_file_too_large/);
  assert.match(reviewMedia, /detectReviewMedia\(buffer\)/);
  assert.match(reviewMedia, /normalizeAndValidateReviewImage/);
  assert.match(reviewMedia, /sharp\(buffer/);
  assert.match(reviewMedia, /\.rotate\(\)/);
  assert.match(reviewMedia, /\.flatten\(\{ background: "#ffffff" \}\)/);
  assert.match(reviewMedia, /\.jpeg\(\{ mozjpeg: true, quality: 85 \}\)/);
  assert.match(reviewMedia, /review_media_signature_not_allowed/);
  assert.match(reviewMedia, /review_media_detected_mime_type_mismatch/);
  assert.match(reviewMedia, /review_media_image_decode_failed/);
  assert.match(reviewMedia, /review_media_image_dimensions_too_large/);
});

test("review media upload intent route derives owner from auth and never accepts a client destination path", () => {
  assert.match(uploadIntentRoute, /getRouteActor\(req\)/);
  assert.match(uploadIntentRoute, /if \(!actor\)/);
  assert.match(uploadIntentRoute, /normalizeReviewMediaIntentInput/);
  assert.match(uploadIntentRoute, /buildReviewMediaUploadPath/);
  assert.match(uploadIntentRoute, /assertSafeReviewStoragePath/);
  assert.match(uploadIntentRoute, /quarantine_storage_path: quarantineStoragePath/);
  assert.match(uploadIntentRoute, /quarantine_bucket_id: REVIEW_MEDIA_QUARANTINE_BUCKET/);
  assert.match(uploadIntentRoute, /user_id: actor\.userId/);
  assert.match(uploadIntentRoute, /user_name: actor\.actorName/);
  assert.match(uploadIntentRoute, /expires_at: expiresAt/);
  assert.doesNotMatch(uploadIntentRoute, /body\?\.storagePath|body\?\.path|body\?\.ownerId|body\?\.userId/);
});

test("review media finalization validates ownership, expiry, exact path, exact bytes, and detected file signature", () => {
  assert.match(finalizeRoute, /intent\.user_id !== actor\.userId/);
  assert.match(finalizeRoute, /intent\.user_name !== actor\.actorName/);
  assert.match(finalizeRoute, /requestedCategory && requestedCategory !== intent\.category/);
  assert.match(finalizeRoute, /requestedPath && requestedPath !== intent\.quarantine_storage_path/);
  assert.match(finalizeRoute, /intent\.media_type === "video"/);
  assert.match(finalizeRoute, /Video uploads are temporarily unavailable/);
  assert.match(finalizeRoute, /intent\.status !== "created"/);
  assert.match(finalizeRoute, /REVIEW_MEDIA_QUARANTINE_BUCKET/);
  assert.match(finalizeRoute, /isOwnedReviewMediaQuarantinePath/);
  assert.match(finalizeRoute, /Upload intent expired/);
  assert.match(finalizeRoute, /Uploaded object not found/);
  assert.match(finalizeRoute, /Uploaded object is too large/);
  assert.match(finalizeRoute, /Uploaded object size does not match intent/);
  assert.match(finalizeRoute, /Buffer\.from\(await blob\.arrayBuffer\(\)\)/);
  assert.match(finalizeRoute, /normalizeAndValidateReviewImage/);
  assert.match(finalizeRoute, /validateDetectedReviewMedia/);
  assert.match(finalizeRoute, /\.from\(REVIEW_MEDIA_BUCKET\)[\s\S]*\.upload\(intent\.storage_path, finalizedMedia\.buffer/);
  assert.match(finalizeRoute, /status: "finalized"/);
  assert.match(finalizeRoute, /status: "rejected"/);
  assert.match(finalizeRoute, /\.from\(REVIEW_MEDIA_QUARANTINE_BUCKET\)[\s\S]*\.remove\(\[intent\.quarantine_storage_path\]\)/);
  assert.match(finalizeRoute, /safeReviewMediaErrorMessage/);
});

test("avatar replacement updates profile through trusted finalization and records old-object cleanup failures", () => {
  assert.match(finalizeRoute, /async function finalizeAvatarProfile/);
  assert.match(finalizeRoute, /\.from\("profiles"\)[\s\S]*\.update\(\{ avatar_url: publicUrl \}\)/);
  assert.match(finalizeRoute, /publicReviewMediaPathFromUrl\(previousUrl\)/);
  assert.match(finalizeRoute, /isOwnedReviewMediaPath\(previousPath, userId\)/);
  assert.match(finalizeRoute, /admin\.storage\.from\(REVIEW_MEDIA_BUCKET\)\.remove\(\[previousPath\]\)/);
  assert.match(finalizeRoute, /account_media_cleanup_jobs/);
  assert.match(profileService, /uploadReviewMedia\(\{\s+category: "avatar"/);
  assert.doesNotMatch(profileService, /storage\.from\("review-photos"\)\.upload/);
});

test("review creation accepts only finalized post intents and does not trust client URLs or storage paths", () => {
  assert.match(reviewsRoute, /REVIEW_POST_MAX_ITEMS/);
  assert.match(reviewsRoute, /typeof \(p as IncomingMedia\)\.intentId === "string"/);
  assert.match(reviewsRoute, /loadFinalizedReviewMedia\(writeDb, actor, incomingMediaItems\)/);
  assert.match(reviewsRoute, /Video uploads are temporarily unavailable/);
  assert.match(reviewsRoute, /intent\.user_id !== actor\.userId/);
  assert.match(reviewsRoute, /intent\.user_name !== actor\.actorName/);
  assert.match(reviewsRoute, /intent\.category !== "post"/);
  assert.match(reviewsRoute, /intent\.status !== "finalized"/);
  assert.match(reviewsRoute, /admin\.storage\.from\(REVIEW_MEDIA_BUCKET\)\.getPublicUrl\(intent\.storage_path\)/);
  assert.match(reviewsRoute, /upload_intent_id: p\.intentId/);
  assert.match(reviewsRoute, /owner_id: actor\.userId/);
  assert.match(reviewsRoute, /mime_type: p\.mimeType/);
  assert.match(reviewsRoute, /file_size_bytes: p\.sizeBytes/);
  assert.match(reviewsRoute, /async function cleanupUnusedReviewMedia/);
  assert.match(reviewsRoute, /admin\.storage\.from\(REVIEW_MEDIA_BUCKET\)\.remove\(storagePaths\)/);
  assert.match(reviewsRoute, /recordAccountMediaCleanupJob/);
  assert.match(reviewsRoute, /status: "abandoned"/);
  assert.match(reviewsRoute, /cleanupUnusedReviewMedia\(writeDb, actor\.userId, validatedMedia\.media\)/);
  assert.match(reviewsRoute, /await writeDb\.from\("reviews"\)\.delete\(\)\.eq\("id", data\.id\)/);
  assert.doesNotMatch(reviewsRoute, /publicUrl:\s*item|storagePath:\s*item|photoUrl:\s*item/);
});

test("mobile post and avatar uploads use the authorized upload/finalize flow", () => {
  assert.match(mobileReviewMedia, /\/api\/mobile\/review-media\/upload-intent/);
  assert.match(mobileReviewMedia, /if \(mediaKind === "video"\) throw new Error\("Video uploads are temporarily unavailable"\)/);
  assert.match(mobileReviewMedia, /fileSizeBytes: body\.size/);
  assert.match(mobileReviewMedia, /\.from\(intent\.uploadBucket\)[\s\S]*\.upload\(intent\.uploadPath, body/);
  assert.match(mobileReviewMedia, /\/api\/mobile\/review-media\/finalize-upload/);
  assert.doesNotMatch(mobileReviewMedia, /\.from\("review-photos"\)\.upload/);
  assert.match(postService, /uploadReviewMedia\(\{\s+category: "post"/);
  assert.match(postService, /intentId: item\.intentId/);
  assert.doesNotMatch(postService, /storage\.from\("review-photos"\)\.upload/);
  assert.doesNotMatch(postService, /\.from\("reviews"\)[\s\S]{0,260}\.insert/);
});

test("review storage policies require a live owner-scoped upload intent and server-side media row finalization", () => {
  assert.match(migration, /create table if not exists public\.review_media_upload_intents/);
  assert.match(migration, /quarantine_bucket_id\s+text\s+not null default 'review-media-quarantine'/);
  assert.match(migration, /quarantine_storage_path text\s+not null unique/);
  assert.match(migration, /category in \('avatar', 'post'\)/);
  assert.match(migration, /media_type in \('image', 'video'\)/);
  assert.match(migration, /status in \('created', 'finalized', 'consumed', 'expired', 'rejected', 'abandoned'\)/);
  assert.match(migration, /file_size_bytes <= max_file_size_bytes/);
  assert.match(migration, /quarantine_storage_path ~ \('\^pending\/' \|\| user_id::text/);
  assert.match(migration, /\(category = 'avatar' and media_type = 'image' and storage_path ~ \('\^avatars\/' \|\| user_id::text/);
  assert.match(migration, /\(category = 'post' and storage_path ~ \('\^posts\/' \|\| user_id::text/);
  assert.match(migration, /alter table public\.review_media_upload_intents enable row level security/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /'review-media-quarantine'[\s\S]*false/);
  assert.match(migration, /drop policy if exists "Authenticated users can upload review photos"/);
  assert.match(migration, /bucket_id = 'review-media-quarantine'/);
  assert.match(migration, /intent\.quarantine_storage_path = storage\.objects\.name/);
  assert.match(migration, /intent\.user_id = auth\.uid\(\)/);
  assert.match(migration, /intent\.status = 'created'/);
  assert.match(migration, /intent\.expires_at > now\(\)/);
  assert.match(migration, /intent\.quarantine_storage_path like \('pending\/' \|\| auth\.uid\(\)::text \|\| '\/' \|\| intent\.id::text/);
  assert.match(migration, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.doesNotMatch(migration, /video\/mp4|video\/webm|video\/quicktime/);
  assert.match(migration, /public\.enforce_review_photo_upload_intent/);
  assert.match(migration, /v_intent\.status not in \('finalized', 'consumed'\)/);
  assert.match(migration, /v_intent\.category <> 'post'/);
  assert.match(migration, /new\.storage_path <> v_intent\.storage_path/);
  assert.match(migration, /new\.owner_id := v_intent\.user_id/);
  assert.match(migration, /review_media_requires_server_finalization/);
});

test("profile statistics are server-derived and profile posts use stable keyset pagination", () => {
  assert.match(migration, /create or replace function public\.profile_post_stats\(p_username text\)/);
  assert.match(migration, /public\.can_read_review_row/);
  assert.match(migration, /count\(\*\)::integer from visible_reviews/);
  assert.match(migration, /count\(distinct coalesce\(nullif\(visible_reviews\.restaurant_id/);
  assert.match(migration, /jsonb_array_elements\(coalesce\(review\.items, '\[\]'::jsonb\)\)/);
  assert.match(migration, /grant execute on function public\.profile_post_stats\(text\) to anon, authenticated, service_role/);
  assert.match(profileService, /const PROFILE_POST_PAGE_SIZE = 24/);
  assert.match(profileService, /\.rpc\("profile_post_stats"/);
  assert.match(profileService, /\.limit\(limit \+ 1\)/);
  assert.match(profileService, /order\("created_at", \{ ascending: false \}\)/);
  assert.match(profileService, /order\("id", \{ ascending: false \}\)/);
  assert.match(profileService, /created_at\.lt\.\$\{parsedCursor\.createdAt\},and\(created_at\.eq\.\$\{parsedCursor\.createdAt\},id\.lt\.\$\{parsedCursor\.id\}\)/);
  assert.match(profileService, /rowsWithExtra\.length > PROFILE_POST_PAGE_SIZE \? encodeProfilePostCursor\(rows\[rows\.length - 1\]\) : null/);
  assert.match(profileHooks, /useInfiniteQuery/);
  assert.match(profileHooks, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor/);
  assert.match(profileScreen, /fetchNextPage/);
  assert.match(profileScreen, /hasNextPage/);
  assert.match(profileScreen, /queryClient\.invalidateQueries\(\{ queryKey: \["profile"\] \}\)/);
  assert.match(createPostHook, /queryClient\.invalidateQueries\(\{ queryKey: \["profile"\] \}\)/);
  assert.match(profileScreen, /<FlatList/);
  assert.match(profileScreen, /ListHeaderComponent/);
  assert.match(profileScreen, /onEndReached=\{onEndReached\}/);
  assert.match(profileScreen, /RefreshControl/);
  assert.doesNotMatch(profileScreen, /<ProfilePager/);
  assert.doesNotMatch(profileScreen, /scrollEnabled=\{false\}/);
});

test("profile post pagination covers empty, full first page, next-page, and large-list mechanics", () => {
  const rows = Array.from({ length: 500 }, (_, index) => ({
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 500 - index)).toISOString(),
    id: `${String(500 - index).padStart(4, "0")}`
  }));
  function page(inputRows, cursor = null, limit = 24) {
    const filtered = cursor
      ? inputRows.filter((row) => row.created_at < cursor.created_at || (row.created_at === cursor.created_at && row.id < cursor.id))
      : inputRows;
    const rowsWithExtra = filtered.slice(0, limit + 1);
    const visible = rowsWithExtra.slice(0, limit);
    return {
      nextCursor: rowsWithExtra.length > limit ? visible.at(-1) : null,
      visible
    };
  }

  assert.equal(page([]).visible.length, 0, "empty profiles should return an empty page");
  assert.equal(page(rows.slice(0, 24)).nextCursor, null, "exactly 24 posts should not advertise another page");
  assert.deepEqual(page(rows.slice(0, 25)).nextCursor, rows[23], "25 posts should cursor after the 24th row");

  const seen = new Set();
  let cursor = null;
  let loaded = 0;
  for (let i = 0; i < 30; i += 1) {
    const result = page(rows, cursor);
    for (const row of result.visible) {
      assert.equal(seen.has(row.id), false, `duplicate post ${row.id}`);
      seen.add(row.id);
    }
    loaded += result.visible.length;
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  assert.equal(loaded, 500, "500 posts should load without missing rows");
});

test("username changes are centralized in one authenticated database transaction", () => {
  assert.match(migration, /create unique index if not exists profiles_username_lower_unique_idx/);
  assert.match(migration, /create or replace function public\.update_current_username\(p_username text\)/);
  assert.match(migration, /security definer\s+set search_path = public/i);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/);
  assert.match(migration, /where profile\.id = v_uid\s+for update/);
  assert.match(migration, /username_invalid/);
  assert.match(migration, /username_taken/);
  assert.match(migration, /profile_not_found/);
  assert.match(migration, /execute format\('update public\.%I set %I = \$1 where %I = \$2'/);
  assert.match(migration, /revoke all on function public\.update_current_username\(text\) from anon/);
  assert.match(migration, /grant execute on function public\.update_current_username\(text\) to authenticated/);
  assert.match(usernameRoute, /\.rpc\("update_current_username", \{ p_username: nextUsername \}\)/);
  assert.match(usernameRoute, /code === "23505"/);
  assert.match(usernameRoute, /code === "22023"/);
  assert.match(usernameRoute, /code === "28000"/);
  assert.doesNotMatch(usernameRoute, /USERNAME_TABLES|for \(const table|Promise\.all\(/);
});

test("post and account deletion remove only owner-scoped storage and fail closed on storage errors", () => {
  assert.match(reviewDeleteRoute, /getRouteActor\(_req\)/);
  assert.match(reviewDeleteRoute, /review\.reviewer_name !== actor\.actorName/);
  assert.match(reviewDeleteRoute, /isOwnedReviewMediaPath\(path, actor\.userId\)/);
  assert.match(reviewDeleteRoute, /removeStorageObjectsOrQueue\(admin/);
  assert.match(reviewDeleteRoute, /error: "Could not update review"/);
  assertOrder(
    reviewDeleteRoute,
    "const cleanup = await removeStorageObjectsOrQueue",
    ".delete()",
    "post media must be removed before the review row is deleted"
  );
  assert.match(engagementService, /fetch\(apiUrl\(`\/api\/reviews\/\$\{encodeURIComponent\(input\.postId\)\}`\)/);
  assert.match(engagementService, /Authorization: `Bearer \$\{token\}`/);

  assert.match(deleteAccountRoute, /\.rpc\("shared_memory_account_media_paths"/);
  assert.match(deleteAccountRoute, /\.rpc\("review_media_account_storage_paths"/);
  assert.match(deleteAccountRoute, /`avatars\/\$\{user\.id\}\/`/);
  assert.match(deleteAccountRoute, /`posts\/\$\{user\.id\}\/`/);
  assert.match(deleteAccountRoute, /`pending\/\$\{user\.id\}\/`/);
  assert.match(deleteAccountRoute, /publicReviewMediaPathFromUrl\(profile\?\.avatar_url/);
  assert.match(deleteAccountRoute, /isOwnedReviewMediaPath\(avatarUrlPath, user\.id\)/);
  assert.match(deleteAccountRoute, /removeStorageObjectsOrQueue\(admin/);
  assert.match(deleteAccountRoute, /cleanupPending/);
  assertOrder(
    deleteAccountRoute,
    "const reviewCleanup = await removeStorageObjectsOrQueue(admin, {",
    'supabase.rpc("delete_current_account")',
    "account media cleanup must happen before database account deletion"
  );
});

test("cleanup jobs have an operational protected worker and paginated storage enumeration", () => {
  assert.match(migration, /next_retry_at\s+timestamptz not null default now\(\)/);
  assert.match(migration, /status in \('pending', 'running', 'succeeded', 'failed'\)/);
  assert.match(cleanupHelper, /function isOwnedAccountStoragePath/);
  assert.match(cleanupHelper, /visitedPrefixes = new Set<string>\(\)/);
  assert.match(cleanupHelper, /\.storage\.from\(bucketId\)\.list\(prefix/);
  assert.match(cleanupHelper, /offset,/, "storage cleanup enumeration must paginate through the Storage API");
  assert.doesNotMatch(cleanupHelper, /\.schema\("storage"\)/);
  assert.match(cleanupHelper, /recordAccountMediaCleanupJob/);
  assert.match(cleanupHelper, /runAccountMediaCleanupJobs/);
  assert.match(cleanupHelper, /status: "running"/);
  assert.match(cleanupHelper, /status: "succeeded"/);
  assert.match(cleanupHelper, /status: "failed"/);
  assert.match(cleanupWorkerRoute, /ACCOUNT_MEDIA_CLEANUP_SECRET/);
  assert.match(cleanupWorkerRoute, /MEMORY_UPLOAD_CLEANUP_SECRET/);
  assert.match(cleanupWorkerRoute, /runAccountMediaCleanupJobs\(createAdminClient\(\), limit\)/);
  assert.match(cleanupWorkerRoute, /status: 404/);
});
