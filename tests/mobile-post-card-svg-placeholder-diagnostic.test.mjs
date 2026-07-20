import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const home = source("mobile/app/(tabs)/index.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const reactionBar = source("mobile/src/components/reactions/ReactionBar.tsx");
const reactionButton = source("mobile/src/components/reactions/ReactionButton.tsx");

function block(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source block: ${start}`);
  return text.slice(startIndex, endIndex);
}

test("svg placeholder A/B stays development-only on the real production Home route", () => {
  assert.match(
    postCard,
    /const HOME_SVG_PLACEHOLDER_AB_ENABLED = __DEV__ &&\s+process\.env\.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "svg-placeholders"/
  );

  const stagedModes = block(home, "const HOME_SCROLL_DIAGNOSTIC_MODES", "type HomeScrollDiagnosticMode");
  assert.doesNotMatch(stagedModes, /svg-placeholders/);

  const route = block(home, "export default function CircleScreen", "function HomeScrollDiagnostic");
  assert.match(route, /if \(HOME_SCROLL_DIAGNOSTIC_MODE\)[\s\S]*<HomeScrollDiagnostic/);
  assert.match(route, /return <ProductionCircleScreen \/>/);
});

test("the A/B marker is a same-size native View with no alternate icon technology", () => {
  const placeholder = block(postCard, "function PostCardSvgPlaceholder", "const reactionFeedbackLabelByType");
  assert.match(placeholder, /<View/);
  assert.match(placeholder, /pointerEvents="none"/);
  assert.match(placeholder, /backgroundColor: color, height: size, width: size/);
  assert.doesNotMatch(placeholder, /<Svg|<Image|<Text|<Animated|transition|transform/);
});

test("only the eight traced PostCard SVG positions select native placeholders", () => {
  const card = block(postCard, "function PostCardComponent", "const PostCardHeaderMetadata");
  const content = block(postCard, "const PostCardContent", "const PostCardActions");
  const actions = block(postCard, "const PostCardActions", "export const PostCard");

  assert.match(card, /const useSvgPlaceholders = HOME_SVG_PLACEHOLDER_AB_ENABLED \|\|/);
  assert.match(card, /useSvgPlaceholders \?[\s\S]*PostCardSvgPlaceholder[\s\S]*<MoreVertical\b/);
  assert.match(content, /svgPlaceholders \?[\s\S]*PostCardSvgPlaceholder[\s\S]*<MapPin\b/);
  assert.match(content, /svgPlaceholders \?[\s\S]*PostCardSvgPlaceholder[\s\S]*<Star\b/);

  for (const icon of ["Heart", "MessageCircle", "Utensils", "Bookmark", "Share2"]) {
    assert.match(
      actions,
      new RegExp(`svgPlaceholders \\?[\\s\\S]*PostCardSvgPlaceholder[\\s\\S]*<${icon}\\b`)
    );
  }

  assert.equal((actions.match(/<Pressable/g) ?? []).length, 4);
  assert.match(actions, />\{likeCount\}<\/Text>/);
  assert.match(actions, />\{commentCount\}<\/Text>/);
  assert.match(actions, />\{foodReactionTotal\}<\/Text>/);
});

test("Helpful and Disagree retain their controls and swap only their icon nodes", () => {
  assert.match(
    postCard,
    /<ReactionBar\s+counts=\{reactionCounts\}\s+countAnimationRevision=\{countAnimationRevisionRef\.current\}\s+diagnosticPlainIcons=\{diagnosticPlainIcons\}\s+onReact=\{reactToFood\}/
  );
  assert.match(reactionBar, /diagnosticPlainIcon=\{diagnosticPlainIcons\}/);
  assert.match(reactionButton, /<Pressable[\s\S]*accessibilityRole="button"[\s\S]*onPress=\{handlePress\}/);
  assert.match(reactionButton, /showDiagnosticPlainIcon \?[\s\S]*<View[\s\S]*<Icon/);
  assert.match(reactionButton, /diagnosticPlainIcon:[\s\S]*height: 20[\s\S]*width: 20/);
  assert.match(reactionButton, /<Text numberOfLines=\{1\} style=\{labelStyle\}>[\s\S]*\{label\}/);
  assert.match(reactionButton, /<Animated\.Text[\s\S]*\{count\}/);
});
