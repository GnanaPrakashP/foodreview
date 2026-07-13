import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("web review media uses visibility-aware generic upload intents and disables the legacy post path", () => {
  const form = source("components/reviews/ReviewForm.tsx");
  const legacyUpload = source("app/api/mobile/review-media/upload-intent/route.ts");
  const legacyFinalize = source("app/api/mobile/review-media/finalize-upload/route.ts");

  assert.match(form, /\/api\/media\/upload-intent/);
  assert.match(form, /\/api\/media\/finalize-upload/);
  assert.match(form, /intendedVisibility: visibility/);
  assert.match(form, /intent\.uploadBucket/);
  assert.match(form, /assetId: item\.assetId/);
  assert.doesNotMatch(form, /\/api\/photos\/moderate/);
  assert.doesNotMatch(form, /\/api\/videos\/moderate/);
  assert.doesNotMatch(form, /\.from\("review-photos"\)[\s\S]{0,160}\.upload/);
  assert.match(legacyUpload, /body\?\.category === "post"[\s\S]+status: 410/);
  assert.match(legacyFinalize, /intent\.category === "post"[\s\S]+status: 410/);
});

test("feeds share FoodReview-native enrichment assembly", () => {
  const helper = source("lib/server/feed-assembly.ts");
  const publicFeed = source("app/api/feed/public/route.ts");
  const circleFeed = source("lib/circle-feed.ts");

  assert.match(helper, /export async function buildFeedAssemblyMaps/);
  assert.match(helper, /db\.rpc\("mobile_post_engagement_v1"/);
  assert.doesNotMatch(helper, /from\("likes"\)|from\("comments"\)|from\("wishlist"\)/);
  assert.match(helper, /p_viewer_user_id: options\.viewerUserId \?\? null/);
  assert.match(helper, /buildProfileDisplayMap/);
  assert.match(publicFeed, /buildFeedAssemblyMaps\(db, reviews/);
  assert.match(circleFeed, /buildFeedAssemblyMaps\(readDb, allReviews/);
  assert.match(circleFeed, /includeTasteTrust: true/);
});

test("engagement mutations own notifications and mobile clients use API routes", () => {
  const likesRoute = source("app/api/likes/route.ts");
  const commentsRoute = source("app/api/comments/route.ts");
  const commentDeleteRoute = source("app/api/comments/[id]/route.ts");
  const eventsRoute = source("app/api/notifications/events/route.ts");
  const mobileEngagement = source("mobile/src/services/engagement.ts");
  const mobileComments = source("mobile/src/services/comments.ts");

  assert.match(likesRoute, /createPostLikeNotification/);
  assert.match(likesRoute, /removeLikeNotification/);
  assert.match(commentsRoute, /canActorReadPost/);
  assert.match(commentsRoute, /createPostCommentNotifications/);
  assert.match(commentDeleteRoute, /removeCommentNotification/);
  assert.match(eventsRoute, /SERVER_OWNED_ENGAGEMENT_EVENTS/);
  assert.match(eventsRoute, /Engagement notifications are handled by mutation routes/);
  assert.match(mobileEngagement, /authorizedJson(?:<[^>]+>)?\("\/api\/likes"/);
  assert.match(mobileComments, /authorizedJson as authorizedApiJson/);
  assert.match(mobileComments, />\("\/api\/comments", \{/);
  assert.match(mobileComments, /`\/api\/comments\/\$\{encodeURIComponent\(input\.commentId\)\}`/);
  assert.doesNotMatch(mobileEngagement, /\.from\("likes"\)[\s\S]{0,220}\.(insert|delete)/);
  assert.doesNotMatch(mobileComments, /\.from\("comments"\)[\s\S]{0,220}\.(insert|delete)/);
});

test("reports and cleanup are native FoodReview protected interfaces", () => {
  const reportRoute = source("app/api/reports/route.ts");
  const moderationRoute = source("app/api/internal/moderation/reports/route.ts");
  const cleanupRoute = source("app/api/internal/review-media-cleanup/route.ts");
  const cleanupHelper = source("lib/server/review-media-cleanup.ts");
  const schema = source("supabase/schema.sql");

  assert.match(reportRoute, /content_reports/);
  assert.match(reportRoute, /canActorReadPost/);
  assert.match(reportRoute, /reporter_id: actor\.userId/);
  assert.match(moderationRoute, /x-moderation-operator-secret/);
  assert.match(moderationRoute, /MODERATION_OPERATOR_SECRET/);
  assert.match(cleanupRoute, /x-review-media-cleanup-secret/);
  assert.match(cleanupRoute, /REVIEW_MEDIA_CLEANUP_SECRET/);
  assert.match(cleanupRoute, /runReviewMediaCleanup/);
  assert.match(cleanupHelper, /status", "created"/);
  assert.match(cleanupHelper, /status: "expired"/);
  assert.match(cleanupHelper, /status: "abandoned"/);
  assert.match(cleanupHelper, /runAccountMediaCleanupJobs/);
  assert.match(schema, /create table if not exists public\.content_reports/);
  assert.match(schema, /target_type in \('review', 'comment', 'profile', 'media'\)/);
  assert.match(schema, /Users can create own content reports/);
});
