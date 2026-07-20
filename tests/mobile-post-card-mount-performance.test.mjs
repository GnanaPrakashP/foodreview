import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const postCard = source("mobile/src/components/posts/PostCard.tsx");
const avatar = source("mobile/src/components/posts/HomeAuthorAvatar.tsx");
const reactionBar = source("mobile/src/components/reactions/ReactionBar.tsx");
const reactionButton = source("mobile/src/components/reactions/ReactionButton.tsx");
const reactionTypes = source("mobile/src/components/reactions/reactionTypes.ts");

function block(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source block: ${start}`);
  return text.slice(startIndex, endIndex);
}

test("production header uses one two-line text layout tree with an accessible author span", () => {
  const header = block(postCard, "const PostCardHeaderMetadata", "const PostCardContent");
  assert.match(header, /const node = \(\s*<Text numberOfLines=\{textMode === "single-line" \? 1 : 2\} style=\{styles\.headerMetadata\}>/);
  assert.match(header, /accessibilityLabel=\{authorAccessibilityLabel\}[\s\S]*accessibilityRole="button"[\s\S]*onPress=\{onOpenProfile\}/);
  assert.match(header, /\{displayedAuthorName\}[\s\S]* • [\s\S]*\{displayedCreatedAtLabel\}[\s\S]*shared a spot/);
  assert.doesNotMatch(header, /<Pressable/);
  assert.doesNotMatch(header, /<View/);
  assert.match(postCard, /headerMetadata:[\s\S]*height: 33/);
  assert.match(postCard, /textMode=\{diagnosticPlan\?\.textMode \?\? "real"\}/);
  assert.match(postCard, /<Pressable[\s\S]*accessibilityLabel=\{`Open \$\{post\.authorName\}'s profile`\}[\s\S]*<HomeAuthorAvatar/);
});

test("restaurant content and four main actions are memoized without changing controls or geometry", () => {
  const content = block(postCard, "const PostCardContent", "const PostCardActions");
  const actions = block(postCard, "const PostCardActions", "export const PostCard");
  assert.match(content, /memo\(function PostCardContent/);
  assert.match(content, /onPress=\{onOpenRestaurant\}/);
  assert.match(content, /onPress=\{onOpenMaps\}/);
  assert.match(content, /displayedItems\.map\(\(item, index\)/);
  assert.doesNotMatch(content, /onLayout|useEffect|useState/);
  assert.match(actions, /memo\(function PostCardActions/);
  assert.equal((actions.match(/<Pressable/g) ?? []).length, 4);
  assert.equal((actions.match(/accessibilityRole="button"/g) ?? []).length, 4);
  for (const icon of ["Heart", "MessageCircle", "Utensils", "Bookmark", "Share2"]) {
    assert.match(actions, new RegExp(`<${icon}\\b`));
  }
  assert.match(actions, />\{likeCount\}<\/Text>/);
  assert.match(actions, />\{commentCount\}<\/Text>/);
  assert.match(actions, />\{foodReactionTotal\}<\/Text>/);
  assert.doesNotMatch(actions, /likeCount\s*\?|commentCount\s*\?|foodReactionTotal\s*\?/);
});

test("equivalent post and feedback DTO values do not schedule mount-time display updates", () => {
  assert.match(postCard, /if \(likeIntentStateEqual\(likeQueue\.getSyncedResult\(\), incoming\)\) return/);
  assert.match(postCard, /if \(bookmarkIntentStateEqual\(bookmarkQueue\.getSyncedResult\(\), incoming\)\) return/);
  assert.match(postCard, /if \(tasteTrustVisualStateEqual\(reactionQueue\.getSyncedResult\(\), incoming\)\) return/);
  assert.match(postCard, /if \(tasteTrustVisualStateEqual\(displayedState, nextState\)\) return current/);
  assert.doesNotMatch(postCard, /setVisualTasteTrustState\(undefined\)/);
  assert.match(postCard, /setCommentCount\(\(current\) => current === post\.commentCount \? current : post\.commentCount\)/);
});

test("reaction controls stay independent while only user-triggered count changes animate natively", () => {
  assert.match(reactionTypes, /accessibilityName: "Helpful"/);
  assert.match(reactionTypes, /accessibilityName: "Disagree"/);
  assert.match(reactionBar, /const ReactionBarItem = memo/);
  assert.match(reactionBar, /export const ReactionBar = memo/);
  assert.match(reactionButton, /export const ReactionButton = memo/);
  assert.match(reactionButton, /const labelStyle = useMemo/);
  assert.match(reactionButton, /<Text numberOfLines=\{1\} style=\{labelStyle\}>/);
  assert.equal((reactionButton.match(/<Animated\.Text/g) ?? []).length, 1);
  assert.match(reactionButton, /const userTriggered = previousCountAnimationRevision\.current !== countAnimationRevision/);
  assert.match(reactionButton, /if \(!userTriggered\)[\s\S]*countScale\.setValue\(1\)[\s\S]*countOpacity\.setValue\(1\)[\s\S]*return/);
  assert.equal((reactionButton.match(/useNativeDriver: true/g) ?? []).length, 2);
  assert.doesNotMatch(reactionButton, /useNativeDriver: false|onLayout|android_ripple/);
  assert.match(postCard, /if \(meta\.source === "optimistic"\) countAnimationRevisionRef\.current \+= 1/);
});

test("avatar image state is isolated from its fixed memoized initials shell", () => {
  const shell = block(avatar, "export const HomeAuthorAvatar", "const styles");
  assert.match(avatar, /const HomeAuthorAvatarImage = memo/);
  assert.match(shell, /export const HomeAuthorAvatar = memo/);
  assert.match(shell, /<Text style=\{styles\.initials\}>\{initials \|\| "\?"\}<\/Text>/);
  assert.match(shell, /<HomeAuthorAvatarImage/);
  assert.doesNotMatch(shell, /setLoadedIdentity|setFailedIdentity|onLoad=|onError=/);
  assert.match(avatar, /if \(previous\.identity === identity && previous\.revision === avatarCacheRevision\) return/);
  assert.match(avatar, /root:[\s\S]*height: 38[\s\S]*width: 38/);
});

test("production mount pass introduces no measurement correction and diagnostics remain opt-in", () => {
  for (const auditedSource of [postCard, avatar, reactionBar, reactionButton]) {
    assert.doesNotMatch(auditedSource, /onLayout=/);
  }
  assert.match(postCard, /if \(!__DEV__\) return null/);
  assert.match(postCard, /mediaWrap:[\s\S]*aspectRatio: HOME_MEDIA_ASPECT_RATIO[\s\S]*width: HOME_VIEWPORT_WIDTH/);
  assert.match(reactionButton, /minHeight: 44/);
});
