import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const home = source("mobile/app/(tabs)/index.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const carousel = source("mobile/src/components/posts/HomeMediaCarousel.tsx");
const cover = source("mobile/src/components/posts/HomeMediaCover.tsx");
const avatar = source("mobile/src/components/posts/HomeAuthorAvatar.tsx");
const reactionButton = source("mobile/src/components/reactions/ReactionButton.tsx");
const recyclingState = source("mobile/src/components/posts/useFixedGeometryRecyclingState.ts");
const diagnostic = source("mobile/src/components/posts/recycledPostCardDiagnostic.tsx");

test("recycled PostCard stages are development-only children of the recycling-list A/B", () => {
  assert.match(
    home,
    /const HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED = __DEV__ &&\s+process\.env\.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "recycling-list"/
  );
  assert.match(
    home,
    /HOME_RECYCLING_SUBTREE_TRACE_ENABLED = HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED &&\s+process\.env\.EXPO_PUBLIC_HOME_RECYCLING_SUBTREE_TRACE === "1"/
  );
  assert.match(home, /diagnosticRecyclingPostCardStage=\{HOME_RECYCLING_POST_CARD_STAGE\}/);
  assert.match(home, /diagnosticRecyclingSubtreeTrace=\{HOME_RECYCLING_SUBTREE_TRACE_ENABLED\}/);
  assert.match(feed, /diagnosticRecyclingPostCardStage=\{recyclingListDiagnosticsEnabled/);
});

test("the staged matrix includes isolated removals, a static baseline, and one-section restoration", () => {
  for (const stage of [
    "full",
    "media-placeholder",
    "feedback-placeholder",
    "svg-placeholders",
    "text-placeholders",
    "static-geometry",
    "restore-header-fixed-text",
    "restore-header-precomputed-two-line",
    "restore-header-single-line",
    "restore-header",
    "restore-content",
    "restore-media",
    "restore-actions",
    "restore-feedback",
    "stable-svg-identity",
    "single-line-text"
  ]) {
    assert.match(diagnostic, new RegExp(`"${stage}"`));
  }
  assert.match(diagnostic, /if \(stage === "media-placeholder"\) return \{ \.\.\.allReal, media: "placeholder" \}/);
  assert.match(diagnostic, /if \(stage === "feedback-placeholder"\) return \{ \.\.\.allReal, feedback: "placeholder" \}/);
  assert.match(diagnostic, /if \(stage === "svg-placeholders"\) return \{ \.\.\.allReal, svgMode: "placeholder" \}/);
  assert.match(diagnostic, /if \(stage === "text-placeholders"\) return \{ \.\.\.allReal, textMode: "placeholder" \}/);
  assert.match(
    diagnostic,
    /if \(stage === "restore-header-fixed-text"\)[\s\S]*header: "real", svgMode: "real", textMode: "placeholder"/
  );
  assert.match(
    diagnostic,
    /if \(stage === "restore-header-precomputed-two-line"\)[\s\S]*header: "real", precomputeHeaderTime: true, svgMode: "real", textMode: "real"/
  );
  assert.match(
    diagnostic,
    /if \(stage === "restore-header-single-line"\)[\s\S]*header: "real",[\s\S]*precomputeHeaderTime: true,[\s\S]*svgMode: "real",[\s\S]*textMode: "single-line"/
  );
});

test("one recycled cell records stable identity, rebinds, effects, commits, keys, and branch changes", () => {
  for (const marker of [
    "CB_HOME_RECYCLED_CELL_MOUNT",
    "CB_HOME_RECYCLED_CELL_UNMOUNT",
    "CB_HOME_RECYCLED_SUBTREE_TRACE_BEGIN",
    "CB_HOME_RECYCLED_SUBTREE_TRACE_SETTLED"
  ]) {
    assert.match(`${feed}\n${diagnostic}`, new RegExp(marker));
  }
  for (const field of [
    "assignmentEffectCleanups",
    "assignmentEffects",
    "branchChanges",
    "commits",
    "keyChanges",
    "mounts",
    "nativeRootChanges",
    "rebinds",
    "renders",
    "unmounts"
  ]) {
    assert.match(diagnostic, new RegExp(field));
  }
});

test("recycling keeps mapped children and feedback identity stable while exposing conditional media branches", () => {
  assert.match(postCard, /const feedbackKey = diagnosticRecycling[\s\S]*\? "recycled-feedback"/);
  assert.match(postCard, /key=\{feedbackKey\}/);
  assert.match(carousel, /key=\{getMappingKey\(page\.key, index\)\}/);
  assert.match(postCard, /key=\{getMappingKey\(tag, index\)\}/);
  assert.match(postCard, /useFixedGeometryRecyclingState\(\(\) => post\.likedByMe, \[recyclingStateScope\]\)/);
  assert.match(avatar, /useFixedGeometryRecyclingState<string \| null>/);
  assert.match(cover, /const \[source, setSource\] = useFixedGeometryRecyclingState/);
  assert.match(reactionButton, /recyclingAssignmentRef\.current !== recyclingKey/);
  assert.match(recyclingState, /setRecyclingState\(nextState, true\)/);
  assert.match(carousel, /homeCarouselPageKey\(postId, 0\)/);
  assert.match(carousel, /expectedCount > 1 \? `pager:\$\{expectedCount\}` : "single-page"/);
  assert.match(postCard, /primaryMedia\?\.homeDelivery/);
  assert.match(postCard, /primaryMedia\.mediaType === "video"/);
});

test("diagnostic placeholders retain native geometry and interaction roots without remote assets", () => {
  for (const component of [
    "RecycledHeaderPlaceholder",
    "RecycledContentPlaceholder",
    "RecycledMediaPlaceholder",
    "RecycledActionsPlaceholder",
    "RecycledFeedbackPlaceholder"
  ]) {
    assert.match(postCard, new RegExp(`function ${component}`));
  }
  assert.match(postCard, /style=\{styles\.mediaWrap\}/);
  assert.match(postCard, /includeDots=\{totalMediaCount > 1\}/);
  assert.match(postCard, /<Pressable[\s\S]*onPress=\{onLike\}/);
  assert.doesNotMatch(diagnostic, /publicUrl|thumbnailUrl|feedUrl|posterUrl|playbackUrl/);
});

test("the candidate engine keeps the real PostCard plan and a FlatList fallback", () => {
  assert.match(diagnostic, /if \(stage === "full"\) return allReal/);
  assert.match(postCard, /const diagnosticPlan = diagnosticRecycling\s+\? recycledPostCardDiagnosticPlan/);
  assert.match(feed, /if \(recyclingListEnabled\)[\s\S]*<FlashList/);
  assert.match(feed, /return \(\s+<FlatList/);
});
