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
const feedHook = source("mobile/src/hooks/useFeeds.ts");
const feedService = source("mobile/src/services/feeds.ts");
const circleFeedRoute = source("app/api/feed/circle/route.ts");

test("mobile Taste Trust feedback labels match the web contract", () => {
  assert.deepEqual(optionLabels(mobileTasteTrust), optionLabels(webTasteTrust));
  assert.deepEqual(optionLabels(mobileTasteTrust), [
    "Helpful",
    "Disagree"
  ]);
});

test("mobile Taste Trust feedback goes through the existing server endpoint", () => {
  assert.match(mobileTasteTrust, /authorizedJson<FeedbackPayload>/);
  assert.match(mobileTasteTrust, /`\/api\/taste-trust\/feedback\?postId=\$\{encodeURIComponent\(postId\)\}`/);
  assert.match(mobileTasteTrust, /"\/api\/taste-trust\/feedback"/);
  assert.match(mobileTasteTrust, /method:\s*"POST"/);
  assert.match(mobileTasteTrust, /method:\s*"DELETE"/);
  assert.match(mobileTasteTrust, /timeoutMs: 10_000/);
  assert.match(mobileTasteTrust, /function feedbackLabelFromEngagement/);
  assert.match(mobileTasteTrust, /function summaryFromEngagement/);
  assert.match(mobileTasteTrust, /if \(payload\?\.engagement\)/);
  assert.doesNotMatch(mobileTasteTrust, /legacyFeedbackLabelMap/);
  assert.doesNotMatch(mobileTasteTrust, /apiUrl/);
  assert.doesNotMatch(mobileTasteTrust, /Authorization:\s*`Bearer \$\{token\}`/);
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
  assert.match(reactionTypes, /\{ accessibilityName: "Helpful", label: "Helpful", type: "mustTry" \}/);
  assert.match(reactionTypes, /\{ accessibilityName: "Disagree", label: "Disagree", type: "notWorthIt" \}/);
  assert.doesNotMatch(reactionTypes, /crave|quote|Crave|Quote/);
  assert.match(postCard, /reactionFeedbackLabelByType: Record<FoodReactionType, TasteTrustFeedbackLabel>/);
  assert.match(postCard, /function optimisticTasteTrustState/);
  assert.match(postCard, /const selectedReaction = reactionTypeForFeedbackLabel\(selectedLabel\)/);
  assert.match(postCard, /const reactionCounts = foodReactionCountsFor\(summary\)/);
  assert.match(postCard, /function foodReactionTotalFor\(summary: PostTasteTrustSummary\)/);
  assert.match(postCard, /visualTasteTrustState\?\.summary \?\? feedbackQuery\.data\?\.summary \?\? fallbackTasteTrustState\.summary/);
  assert.match(postCard, /const targetUsername = post\.reviewerUsername \|\| post\.reviewerName/);
  assert.match(postCard, /const isOwnPost = Boolean\(viewerName\) && targetUsername\.toLowerCase\(\) === viewerName\.toLowerCase\(\)/);
  assert.match(postCard, /function initialCircleRequestStatus\(\s*circleRequestStatus: ReviewPost\["circleRequestStatus"\],\s*isPublicDiscovery: ReviewPost\["isPublicDiscovery"\]\s*\)/);
  assert.match(postCard, /if \(circleRequestStatus === "pending" \|\| circleRequestStatus === "joined"\) return circleRequestStatus/);
  assert.match(postCard, /return isPublicDiscovery \? "idle" : "joined"/);
  assert.match(postCard, /function optimisticCircleRequestStatus\(post: ReviewPost\): "pending" \| "joined"/);
  assert.match(postCard, /return post\.circleRequestAccountType === "public" \? "joined" : "pending"/);
  assert.match(postCard, /function circleRequestLabel\(status: CircleRequestVisualStatus\)/);
  assert.match(postCard, /const \[requestInteracted, setRequestInteracted\] = useState\(false\)/);
  assert.match(postCard, /requestStatus !== "joined" \|\| requestInteracted/);
  assert.match(postCard, /const requestInFlightRef = useRef\(false\)/);
  assert.match(postCard, /desiredRequestStatusRef\.current = nextStatus/);
  assert.match(postCard, /if \(desiredRequestStatusRef\.current !== syncedRequestStatusRef\.current\)/);
  assert.match(postCard, /useSetCircleAccessStatusMutation/);
  assert.doesNotMatch(postCard, /disabled=\{requestStatus !== "idle" \|\| requestCircleMutation\.isPending\}/);
  assert.match(postCard, /<Text style=\{styles\.sharedContext\}>shared a spot<\/Text>/);
  assert.doesNotMatch(postCard, /post\.feedContextLabel \?\? "shared a spot"/);
  assert.match(postCard, /<Text style=\{styles\.actionText\}>\{foodReactionTotal\}<\/Text>/);
  assert.doesNotMatch(postCard, /<Text style=\{styles\.actionText\}>\{post\.items\.length\}<\/Text>/);
  assert.match(postCard, /<ReactionBar\s+counts=\{reactionCounts\}\s+onReact=\{reactToFood\}\s+selectedReaction=\{selectedReaction\}\s+\/>/);
  assert.doesNotMatch(postCard, /You cannot react to your own post\./);
  assert.match(postCard, /Log in to react to this post\./);
  assert.doesNotMatch(postCard, /Do you agree\?/);
  assert.doesNotMatch(postCard, /Requesting/);
});

test("mobile circle feed labels use current copy and compact section spacing", () => {
  assert.match(circleFeedRoute, /"Suggested for you"/);
  assert.match(circleFeedRoute, /"Circles you're in"/);
  assert.doesNotMatch(circleFeedRoute, /"New from your circle"/);
  assert.match(postFeed, /paddingTop: spacing\.xs/);
});

test("mobile post cards only route explicit tap targets", () => {
  assert.match(postCard, /Share,[\s\S]*Pressable,[\s\S]*StyleSheet,[\s\S]*Text,[\s\S]*View[\s\S]*from "react-native"/);
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
  assert.match(reactionIcons, /export function HelpfulReactionIcon/);
  assert.match(reactionIcons, /export function NotWorthItReactionIcon/);
  assert.match(reactionIcons, /reactionIcons = \{/);
  assert.match(reactionIcons, /mustTry: HelpfulReactionIcon/);
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

test("mobile Taste Trust hooks patch Circle cache without refreshing feed surfaces", () => {
  assert.match(mobileTasteTrustHook, /usePostTasteTrustQuery/);
  assert.match(mobileTasteTrustHook, /useSubmitPostTasteTrustMutation/);
  assert.match(mobileTasteTrustHook, /useRemovePostTasteTrustMutation/);
  assert.match(mobileTasteTrustHook, /useQueryClient/);
  assert.match(mobileTasteTrustHook, /queryClient\.setQueryData\(tasteTrustKeys\.post\(postId\), state\)/);
  assert.match(mobileTasteTrustHook, /patchCachedPostEngagementFields/);
  assert.match(feedHook, /export function patchCachedPostById/);
  assert.match(feedHook, /queryClient\.setQueriesData<unknown>/);
  assert.match(feedHook, /scope === "feed" \|\| scope === "profile"/);
  assert.match(feedHook, /Array\.isArray\(current\.pages\)/);
  assert.match(feedHook, /Array\.isArray\(current\.posts\)/);
  assert.match(mobileTasteTrustHook, /foodReaction: state\.engagement\.foodReaction/);
  assert.match(mobileTasteTrustHook, /mustTryCount: state\.engagement\.mustTryCount/);
  assert.match(mobileTasteTrustHook, /notWorthItCount: state\.engagement\.notWorthItCount/);
  assert.doesNotMatch(mobileTasteTrustHook, /likedByMe: state\.engagement\.likedByMe/);
  assert.match(postCard, /function optimisticTasteTrustState/);
  assert.match(postCard, /const \[visualTasteTrustState, setVisualTasteTrustState\] = useState<TasteTrustFeedbackState \| undefined>\(\)/);
  assert.match(postCard, /desiredFeedbackLabelRef\.current = label/);
  assert.match(postCard, /if \(desiredFeedbackLabelRef\.current !== syncedFeedbackStateRef\.current\.myFeedbackLabel\)/);
  assert.doesNotMatch(mobileTasteTrustHook, /function optimisticState/);
  assert.doesNotMatch(mobileTasteTrustHook, /profileKeys\./);
  assert.doesNotMatch(mobileTasteTrustHook, /invalidateQueries/);
});

test("mobile social taps use Pixelfed-style optimistic updates without pending locks or feed refetches", () => {
  assert.doesNotMatch(postCard, /if \(likeMutation\.isPending\) return/);
  assert.doesNotMatch(postCard, /if \(bookmarkMutation\.isPending\) return/);
  assert.doesNotMatch(postCard, /const busy = submitFeedback\.isPending \|\| removeFeedback\.isPending/);
  assert.doesNotMatch(postCard, /disabled=\{busy\}/);
  assert.match(postCard, /const likedRef = useRef\(post\.likedByMe\)/);
  assert.match(postCard, /const desiredLikedRef = useRef\(post\.likedByMe\)/);
  assert.match(postCard, /const likeInFlightRef = useRef\(false\)/);
  assert.match(postCard, /const desiredBookmarkedRef = useRef\(post\.bookmarkedByMe\)/);
  assert.match(postCard, /const bookmarkInFlightRef = useRef\(false\)/);
  assert.match(postCard, /if \(desiredLikedRef\.current !== syncedLikedRef\.current\)/);
  assert.match(postCard, /if \(desiredBookmarkedRef\.current !== syncedBookmarkedRef\.current\)/);
  assert.match(postCard, /hasLocalReactionInteraction\.current = true/);
  assert.match(postCard, /const reactionInFlightRef = useRef\(false\)/);
  assert.match(mobileEngagementHook, /export function useTogglePostLikeMutation\(\)[\s\S]*mutationFn: \(input: ToggleLikeInput\) => togglePostLike\(input\)[\s\S]*\}\);/);
  assert.match(mobileEngagementHook, /export function useTogglePostBookmarkMutation\(\)[\s\S]*mutationFn: \(input: ToggleBookmarkInput\) => togglePostBookmark\(input\)[\s\S]*\}\);/);
  assert.match(mobileEngagementHook, /patchCachedPostEngagementFields\(queryClient, \{[\s\S]*likedByMe: engagement\.likedByMe[\s\S]*likeCount: engagement\.likeCount/);
  assert.match(mobileEngagementHook, /patchCachedPostEngagementFields\(queryClient, \{[\s\S]*bookmarkedByMe: engagement\.bookmarkedByMe/);
  assert.doesNotMatch(mobileEngagementHook, /foodReaction: engagement\.foodReaction/);
  assert.match(mobileEngagementHook, /useSetCircleAccessStatusMutation/);
  assert.match(mobileEngagementHook, /cancelCircleAccess/);
  assert.match(mobileEngagementHook, /leaveCircleAccess/);
  const likeMutationBlock = mobileEngagementHook.match(/export function useTogglePostLikeMutation\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(likeMutationBlock, /bookmarkedByMe: engagement\.bookmarkedByMe/);
  assert.doesNotMatch(mobileEngagementHook, /useTogglePostLikeMutation\(\)[\s\S]{0,220}onSettled/);
  assert.doesNotMatch(mobileEngagementHook, /useTogglePostBookmarkMutation\(\)[\s\S]{0,220}onSettled/);
  assert.doesNotMatch(mobileEngagementHook, /useRequestCircleAccessMutation\(\)[\s\S]*onSettled/);
});
