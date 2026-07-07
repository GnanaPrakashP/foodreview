import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

test("mobile saved-post and block writes go through trusted API routes", () => {
  const engagement = source("mobile/src/services/engagement.ts");
  const settings = source("mobile/src/services/settings.ts");
  const blocksRoute = source("app/api/mobile/blocks/route.ts");
  const wishlistRoute = source("app/api/wishlist/route.ts");

  assert.match(engagement, /authorizedJson\("\/api\/wishlist"/);
  assert.doesNotMatch(engagement, /from\("wishlist"\)[\s\S]*\.insert/);
  assert.doesNotMatch(engagement, /from\("wishlist"\)[\s\S]*\.delete/);
  assert.match(wishlistRoute, /getRouteActor\(req\)/);
  assert.doesNotMatch(wishlistRoute, /getRouteActor\(\)/);
  assert.match(settings, /authorizedSettingsJson\("\/api\/mobile\/blocks"/);
  assert.doesNotMatch(settings, /from\("blocked_users"\)[\s\S]*\.upsert/);
  assert.match(blocksRoute, /getRouteActor\(\)/);
  assert.match(blocksRoute, /from\("blocked_users"\)/);
  assert.match(blocksRoute, /invalidateSocialCachesForNames\(\[actor\.actorName, target\.username\]\)/);
});

test("mobile reporting is available for posts comments and profiles", () => {
  const reportService = source("mobile/src/services/reports.ts");
  const reportHook = source("mobile/src/hooks/useReports.ts");
  const reportingUtil = source("mobile/src/utils/reporting.ts");
  const postCard = source("mobile/src/components/posts/PostCard.tsx");
  const reviewDetail = source("mobile/app/reviews/[id].tsx");
  const profile = source("mobile/app/people/[username].tsx");
  const reportsRoute = source("app/api/reports/route.ts");

  assert.match(reportService, /apiUrl\("\/api\/reports"\)/);
  assert.match(reportService, /targetType: input\.targetType/);
  assert.match(reportHook, /useReportContentMutation/);
  assert.match(reportingUtil, /chooseReportReason/);
  assert.match(postCard, /Report post/);
  assert.match(postCard, /reportTarget\("review", post\.id, "post"\)/);
  assert.match(postCard, /Report profile/);
  assert.match(postCard, /reportTarget\("profile", targetUsername, "profile"\)/);
  assert.match(postCard, /Block @/);
  assert.match(reviewDetail, /Report comment/);
  assert.match(reviewDetail, /targetType: "comment"/);
  assert.match(profile, /Report profile/);
  assert.match(profile, /targetType: "profile"/);
  assert.match(reportsRoute, /error\.code === "23505"/);
});

test("mobile production safety files are present", () => {
  assert.ok(existsSync(new URL("../mobile/src/services/reports.ts", import.meta.url)));
  assert.ok(existsSync(new URL("../mobile/src/hooks/useReports.ts", import.meta.url)));
  assert.ok(existsSync(new URL("../mobile/src/utils/reporting.ts", import.meta.url)));
  assert.ok(existsSync(new URL("../app/api/mobile/blocks/route.ts", import.meta.url)));
});
