import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

function optionLabels(src) {
  return [...src.matchAll(/\{\s*label:\s*"([^"]+)",\s*value:\s*-?[0-9.]+\s*\}/g)].map((match) => match[1]);
}

const webTasteTrust = source("lib/taste-trust.ts");
const mobileTasteTrust = source("mobile/src/services/tasteTrust.ts");
const mobileTasteTrustHook = source("mobile/src/hooks/useTasteTrust.ts");
const mobileEngagementHook = source("mobile/src/hooks/useEngagement.ts");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const reactionBar = source("mobile/src/components/reactions/ReactionBar.tsx");
const reactionButton = source("mobile/src/components/reactions/ReactionButton.tsx");
const reactionIcons = source("mobile/src/components/reactions/reactionIcons.tsx");
const reactionTypes = source("mobile/src/components/reactions/reactionTypes.ts");
const reviewDetail = source("mobile/app/reviews/[id].tsx");
const postFeed = source("mobile/src/components/feeds/PostFeed.tsx");
const feedService = source("mobile/src/services/feeds.ts");

test("mobile Taste Trust feedback labels match the web contract", () => {
  assert.deepEqual(optionLabels(mobileTasteTrust), optionLabels(webTasteTrust));
  assert.deepEqual(optionLabels(mobileTasteTrust), [
    "Must Try",
    "Not Worth It"
  ]);
});

test("mobile Taste Trust feedback goes through the existing server endpoint", () => {
  assert.match(mobileTasteTrust, /apiUrl\(`\/api\/taste-trust\/feedback\?postId=\$\{encodeURIComponent\(postId\)\}`\)/);
  assert.match(mobileTasteTrust, /apiUrl\("\/api\/taste-trust\/feedback"\)/);
  assert.match(mobileTasteTrust, /method:\s*"POST"/);
  assert.match(mobileTasteTrust, /method:\s*"DELETE"/);
  assert.match(mobileTasteTrust, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(mobileTasteTrust, /legacyFeedbackLabelMap/);
  assert.match(mobileTasteTrust, /\["strongly agree", "Must Try"\]/);
  assert.match(mobileTasteTrust, /\["strongly disagree", "Not Worth It"\]/);
  assert.doesNotMatch(mobileTasteTrust, /\.from\("recommendation_feedback"\)/);
  assert.doesNotMatch(mobileTasteTrust, /\.from\("user_tried_items"\)/);
});

test("mobile feed cards render the two MVP reaction options", () => {
  assert.match(postCard, /function TasteTrustFeedback/);
  assert.doesNotMatch(postCard, /showTasteTrustFeedback/);
  assert.match(postCard, /<TasteTrustFeedback\s+feedbackState=\{feedbackQuery\.data\}\s+isAuthenticated=\{isAuthenticated\}\s+onVisualStateChange=\{setVisualTasteTrustState\}\s+post=\{post\}\s+viewerName=\{viewerName\}\s+\/>/);
  assert.match(postCard, /const isAuthenticated = useSessionStore\(\(state\) => state\.isAuthenticated\)/);
  assert.match(postCard, /const canSubmit = isAuthenticated && Boolean\(viewerName\) && !isPrivatePost/);
  assert.match(postCard, /if \(isPrivatePost\) return null/);
  assert.match(reviewDetail, /<PostCard post=\{post\.data\} \/>/);
  assert.doesNotMatch(postFeed, /showTasteTrustFeedback/);
  assert.match(reactionTypes, /export type FoodReactionType = "mustTry" \| "notWorthIt"/);
  assert.match(reactionTypes, /\{ accessibilityName: "Must Try", label: "Must Try", type: "mustTry" \}/);
  assert.match(reactionTypes, /\{ accessibilityName: "Not Worth It", label: "Not Worth It", type: "notWorthIt" \}/);
  assert.doesNotMatch(reactionTypes, /crave|quote|Crave|Quote/);
  assert.match(postCard, /reactionFeedbackLabelByType: Record<FoodReactionType, TasteTrustFeedbackLabel>/);
  assert.match(postCard, /function optimisticTasteTrustState/);
  assert.match(postCard, /const selectedReaction = reactionTypeForFeedbackLabel\(selectedLabel\)/);
  assert.match(postCard, /const reactionCounts = foodReactionCountsFor\(summary\)/);
  assert.match(postCard, /function foodReactionTotalFor\(summary: PostTasteTrustSummary\)/);
  assert.match(postCard, /visualTasteTrustState\?\.summary \?\? feedbackQuery\.data\?\.summary \?\? EMPTY_POST_TASTE_TRUST_SUMMARY/);
  assert.match(postCard, /const targetUsername = post\.reviewerUsername \|\| post\.reviewerName/);
  assert.match(postCard, /const isOwnPost = Boolean\(viewerName\) && targetUsername\.toLowerCase\(\) === viewerName\.toLowerCase\(\)/);
  assert.match(postCard, /<Text style=\{styles\.sharedContext\}>shared a spot<\/Text>/);
  assert.doesNotMatch(postCard, /post\.feedContextLabel \?\? "shared a spot"/);
  assert.match(postCard, /<Text style=\{styles\.actionText\}>\{foodReactionTotal\}<\/Text>/);
  assert.doesNotMatch(postCard, /<Text style=\{styles\.actionText\}>\{post\.items\.length\}<\/Text>/);
  assert.match(postCard, /<ReactionBar\s+counts=\{reactionCounts\}\s+onReact=\{reactToFood\}\s+selectedReaction=\{selectedReaction\}\s+\/>/);
  assert.doesNotMatch(postCard, /You cannot react to your own post\./);
  assert.match(postCard, /Log in to react to this post\./);
  assert.doesNotMatch(postCard, /Do you agree\?/);
});

test("mobile circle feed labels use current copy and compact section spacing", () => {
  assert.match(feedService, /"Suggested for you"/);
  assert.match(feedService, /"Circles you're in"/);
  assert.doesNotMatch(feedService, /"New from your circle"/);
  assert.match(postFeed, /paddingTop: spacing\.xs/);
});

test("mobile post cards only route explicit tap targets", () => {
  assert.match(postCard, /import \{ Alert, Linking, Pressable, StyleSheet, Text, View \} from "react-native"/);
  assert.match(postCard, /function openProfile\(\)/);
  assert.match(postCard, /pathname: "\/people\/\[username\]"/);
  assert.match(postCard, /function openRestaurant\(\)/);
  assert.match(postCard, /pathname: "\/restaurants\/\[placeId\]"/);
  assert.match(postCard, /pathname: "\/restaurants\/by-name\/\[restaurant\]"/);
  assert.match(postCard, /function openMaps\(\)/);
  assert.match(postCard, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(postCard, /onPress=\{openProfile\}/);
  assert.match(postCard, /onPress=\{openRestaurant\}/);
  assert.match(postCard, /onPress=\{openMaps\}/);
  assert.doesNotMatch(postCard, /function openPost\(\)/);
  assert.doesNotMatch(postCard, /onPress=\{openPost\}/);
  assert.doesNotMatch(postCard, /router\.push\(\{\s*pathname: "\/reviews\/\[id\]"/);
  assert.match(postCard, /<View style=\{styles\.body\}>/);
  assert.match(postCard, /<View style=\{styles\.mediaWrap\}>/);
  assert.match(postCard, /receiverName: targetUsername/);
});

test("mobile reaction row uses premium animated two-pill buttons", () => {
  assert.match(reactionIcons, /import Svg, \{ G, Path \} from "react-native-svg"/);
  assert.match(reactionIcons, /export function MustTryReactionIcon/);
  assert.match(reactionIcons, /export function NotWorthItReactionIcon/);
  assert.match(reactionIcons, /reactionIcons = \{/);
  assert.match(reactionIcons, /mustTry: MustTryReactionIcon/);
  assert.match(reactionIcons, /notWorthIt: NotWorthItReactionIcon/);
  assert.doesNotMatch(reactionIcons, /CraveReaction|QuoteReaction|crave|quote/i);
  assert.doesNotMatch(reactionIcons, /🔥|😋|👎|💬/);
  assert.match(reactionButton, /Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\)/);
  assert.doesNotMatch(reactionButton, /pressScale|toValue: 0\.94|toValue: 1\.08/);
  assert.match(reactionButton, /shadowOpacity: activeProgress\.interpolate/);
  assert.match(reactionButton, /Animated\.spring\(countScale/);
  assert.match(reactionButton, /mustTry: \{\s+accent: "#F05A28"/);
  assert.match(reactionButton, /notWorthIt: \{\s+accent: "#B45353"/);
  assert.match(reactionButton, /minHeight: 44/);
  assert.match(reactionButton, /accessibilityRole="button"/);
  assert.match(reactionButton, /accessibilityState=\{\{ disabled, selected \}\}/);
  assert.match(reactionButton, /\$\{accessibilityName\} reaction, \$\{voteLabel\(count\)\}/);
  assert.match(reactionBar, /foodReactionDefinitions\.map/);
  assert.match(reactionBar, /onPress=\{\(\) => onReact\(reaction\.type\)\}/);
  assert.match(reactionBar, /gap: 12/);
  assert.doesNotMatch(postCard, /Do you agree\?/);
});

test("mobile Taste Trust hooks leave visual optimism to the post card without refreshing feed surfaces", () => {
  assert.match(mobileTasteTrustHook, /usePostTasteTrustQuery/);
  assert.match(mobileTasteTrustHook, /useSubmitPostTasteTrustMutation/);
  assert.match(mobileTasteTrustHook, /useRemovePostTasteTrustMutation/);
  assert.match(postCard, /function optimisticTasteTrustState/);
  assert.match(postCard, /const \[visualTasteTrustState, setVisualTasteTrustState\] = useState<TasteTrustFeedbackState \| undefined>\(\)/);
  assert.match(postCard, /desiredFeedbackLabelRef\.current = label/);
  assert.match(postCard, /if \(desiredFeedbackLabelRef\.current !== syncedFeedbackStateRef\.current\.myFeedbackLabel\)/);
  assert.doesNotMatch(mobileTasteTrustHook, /function optimisticState/);
  assert.doesNotMatch(mobileTasteTrustHook, /queryClient\.setQueryData/);
  assert.doesNotMatch(mobileTasteTrustHook, /feedKeys\./);
  assert.doesNotMatch(mobileTasteTrustHook, /profileKeys\./);
  assert.doesNotMatch(mobileTasteTrustHook, /invalidateQueries/);
});

test("mobile social taps use Pixelfed-style optimistic updates without pending locks or feed refetches", () => {
  assert.doesNotMatch(postCard, /if \(likeMutation\.isPending\) return/);
  assert.doesNotMatch(postCard, /if \(bookmarkMutation\.isPending\) return/);
  assert.doesNotMatch(postCard, /const busy = submitFeedback\.isPending \|\| removeFeedback\.isPending/);
  assert.doesNotMatch(postCard, /disabled=\{busy\}/);
  assert.match(postCard, /const likedRef = useRef\(post\.likedByMe\)/);
  assert.match(postCard, /const bookmarkRequestSeq = useRef\(0\)/);
  assert.match(postCard, /if \(requestId === likeRequestSeq\.current\)/);
  assert.match(postCard, /hasLocalReactionInteraction\.current = true/);
  assert.match(postCard, /const reactionInFlightRef = useRef\(false\)/);
  assert.match(mobileEngagementHook, /export function useTogglePostLikeMutation\(\)[\s\S]*mutationFn: \(input: ToggleLikeInput\) => togglePostLike\(input\)[\s\S]*\}\);/);
  assert.match(mobileEngagementHook, /export function useTogglePostBookmarkMutation\(\)[\s\S]*mutationFn: \(input: ToggleBookmarkInput\) => togglePostBookmark\(input\)[\s\S]*\}\);/);
  assert.doesNotMatch(mobileEngagementHook, /useTogglePostLikeMutation\(\)[\s\S]{0,220}onSettled/);
  assert.doesNotMatch(mobileEngagementHook, /useTogglePostBookmarkMutation\(\)[\s\S]{0,220}onSettled/);
});
