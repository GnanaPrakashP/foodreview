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
const circleFeedRoute = source("app/api/feed/circle/route.ts");
const latestPostEngagement = source("mobile/src/state/latestPostEngagement.ts");

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
  assert.match(postCard, /function TasteTrustFeedbackComponent/);
  assert.doesNotMatch(postCard, /showTasteTrustFeedback/);
  assert.match(postCard, /const feedbackKey = diagnosticRecycling[\s\S]*\? "recycled-feedback"[\s\S]*: diagnosticPlan\?\.stableSvgIdentity \? "stable-feedback" : post\.id/);
  assert.match(postCard, /<TasteTrustFeedback[\s\S]*feedbackState=\{feedbackQuery\.data\}[\s\S]*isAuthenticated=\{isAuthenticated\}[\s\S]*key=\{feedbackKey\}[\s\S]*onVisualStateChange=\{handleVisualTasteTrustState\}[\s\S]*post=\{post\}[\s\S]*viewerName=\{viewerName\}/);
  assert.match(postCard, /const isAuthenticated = useSessionStore\(\(state\) => state\.isAuthenticated\)/);
  assert.match(postCard, /const canSubmit = isAuthenticated && Boolean\(viewerName\) && !isPrivatePost/);
  assert.match(postCard, /const node = isPrivatePost \? null : \(/);
  assert.match(reviewDetail, /<PostCard loadDetailEngagement mediaActive post=\{post\.data\} \/>/);
  assert.doesNotMatch(postFeed, /showTasteTrustFeedback/);
  assert.match(reactionTypes, /export type FoodReactionType = "mustTry" \| "notWorthIt"/);
  assert.match(reactionTypes, /\{ accessibilityName: "Helpful", label: "Helpful", type: "mustTry" \}/);
  assert.match(reactionTypes, /\{ accessibilityName: "Disagree", label: "Disagree", type: "notWorthIt" \}/);
  assert.doesNotMatch(reactionTypes, /crave|quote|Crave|Quote/);
  assert.match(postCard, /reactionFeedbackLabelByType: Record<FoodReactionType, TasteTrustFeedbackLabel>/);
  assert.match(latestPostEngagement, /export function optimisticReactionIntentState/);
  assert.match(postCard, /const selectedReaction = reactionTypeForFeedbackLabel\(selectedLabel\)/);
  assert.match(postCard, /const reactionCounts = useMemo\(\(\) => foodReactionCountsFor\(summary\), \[summary\]\)/);
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
  assert.match(postCard, /const \[requestInteracted, setRequestInteracted\] = useFixedGeometryRecyclingState\(false, \[recyclingStateScope\]\)/);
  assert.match(postCard, /requestStatus !== "joined" \|\| requestInteracted/);
  assert.match(postCard, /const requestInFlightRef = useRef\(false\)/);
  assert.match(postCard, /desiredRequestStatusRef\.current = nextStatus/);
  assert.match(postCard, /if \(desiredRequestStatusRef\.current !== syncedRequestStatusRef\.current\)/);
  assert.match(postCard, /useSetCircleAccessStatusMutation/);
  assert.doesNotMatch(postCard, /disabled=\{requestStatus !== "idle" \|\| requestCircleMutation\.isPending\}/);
  assert.match(postCard, /<Text style=\{styles\.sharedContext\}>\{textMode === "single-line" \? " · shared a spot" : "\\nshared a spot"\}<\/Text>/);
  assert.doesNotMatch(postCard, /post\.feedContextLabel \?\? "shared a spot"/);
  assert.match(postCard, /<Text style=\{styles\.actionText\}>\{foodReactionTotal\}<\/Text>/);
  assert.doesNotMatch(postCard, /<Text style=\{styles\.actionText\}>\{post\.items\.length\}<\/Text>/);
  assert.match(postCard, /<ReactionBar\s+counts=\{reactionCounts\}\s+countAnimationRevision=\{countAnimationRevisionRef\.current\}\s+diagnosticPlainIcons=\{diagnosticPlainIcons\}\s+onReact=\{reactToFood\}\s+recyclingKey=\{diagnosticRecycling \? post\.id : undefined\}\s+selectedReaction=\{selectedReaction\}\s+\/>/);
  assert.doesNotMatch(postCard, /You cannot react to your own post\./);
  assert.match(postCard, /Log in to react to this post\./);
  assert.doesNotMatch(postCard, /Do you agree\?/);
  assert.doesNotMatch(postCard, /Requesting/);
});

test("mobile Circle payload omits unused section-label copy and keeps compact spacing", () => {
  assert.doesNotMatch(circleFeedRoute, /feedContextLabel|feedSectionLabel|"Suggested for you"|"Circles you're in"/);
  assert.match(postFeed, /paddingTop: spacing\.xs/);
});

test("mobile post cards only route explicit tap targets", () => {
  const profileNavigation = readFileSync("mobile/src/navigation/profileNavigation.ts", "utf8");
  assert.match(postCard, /Share,[\s\S]*Pressable,[\s\S]*StyleSheet,[\s\S]*Text,[\s\S]*View[\s\S]*from "react-native"/);
  assert.match(postCard, /const openProfile = useCallback\(\(\) =>/);
  assert.match(postCard, /openProfileRoute\(\{ queryClient, router, username: targetUsername, viewerUsername: viewerName \}\)/);
  assert.match(profileNavigation, /pathname: "\/people\/\[username\]"/);
  assert.match(postCard, /const openRestaurant = useCallback\(\(\) =>/);
  assert.match(postCard, /pathname: "\/restaurants\/\[placeId\]"/);
  assert.match(postCard, /pathname: "\/restaurants\/by-name\/\[restaurant\]"/);
  assert.match(postCard, /const openMaps = useCallback\(\(\) =>/);
  assert.match(postCard, /https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.match(postCard, /onPress=\{openProfile\}/);
  assert.match(postCard, /onOpenRestaurant=\{openRestaurant\}/);
  assert.match(postCard, /onPress=\{onOpenRestaurant\}/);
  assert.match(postCard, /onOpenMaps=\{openMaps\}/);
  assert.match(postCard, /onPress=\{onOpenMaps\}/);
  assert.doesNotMatch(postCard, /function openPost\(\)/);
  assert.doesNotMatch(postCard, /onPress=\{openPost\}/);
  assert.doesNotMatch(postCard, /router\.push\(\{\s*pathname: "\/reviews\/\[id\]"/);
  assert.match(postCard, /<View style=\{styles\.body\}>/);
  assert.match(postCard, /<View style=\{styles\.mediaWrap\}>/);
  assert.match(postCard, /receiverName: targetUsername/);
});

test("mobile reaction row keeps premium two-pill buttons with user-only native count animation", () => {
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
  assert.match(reactionButton, /shadowOpacity: selected \? 0\.18 : 0/);
  assert.match(reactionButton, /Animated\.spring\(countScale/);
  assert.match(reactionButton, /if \(!userTriggered\)/);
  assert.equal((reactionButton.match(/useNativeDriver: true/g) ?? []).length, 2);
  assert.doesNotMatch(reactionButton, /useNativeDriver: false/);
  assert.match(reactionButton, /mustTry: \{\s+accent: "#F05A28"/);
  assert.match(reactionButton, /notWorthIt: \{\s+accent: "#B45353"/);
  assert.match(reactionButton, /minHeight: 44/);
  assert.match(reactionButton, /accessibilityRole="button"/);
  assert.match(reactionButton, /accessibilityState=\{accessibilityState\}/);
  assert.match(reactionButton, /\$\{accessibilityName\} reaction, \$\{voteLabel\(count\)\}/);
  assert.match(reactionBar, /foodReactionDefinitions\.map/);
  assert.match(reactionBar, /const handlePress = useCallback\(\(\) => onReact\(reaction\.type\)/);
  assert.match(reactionBar, /gap: 12/);
  assert.doesNotMatch(postCard, /Do you agree\?/);
});

test("reaction emoji and pill selected styling update atomically", () => {
  assert.doesNotMatch(reactionButton, /activeProgress|duration: selected \? 180 : 140/);
  assert.match(reactionButton, /backgroundColor: selected \? palette\.fill : themeColors\.surface/);
  assert.match(reactionButton, /borderColor: selected \? palette\.accent : themeColors\.border/);
  assert.match(reactionButton, /color: selected \? palette\.accent : themeColors\.mutedStrong/);
  assert.match(reactionButton, /const iconColor = selected \? palette\.accent : themeColors\.mutedStrong/);
  assert.match(reactionButton, /fillColor=\{selected \? palette\.accent : "transparent"\}/);
});

test("mobile Taste Trust hooks patch Circle cache without refreshing feed surfaces", () => {
  assert.match(mobileTasteTrustHook, /usePostTasteTrustQuery/);
  assert.match(mobileTasteTrustHook, /useSubmitPostTasteTrustMutation/);
  assert.match(mobileTasteTrustHook, /useRemovePostTasteTrustMutation/);
  assert.match(mobileTasteTrustHook, /export function displayPostTasteTrustState/);
  assert.match(mobileTasteTrustHook, /queryClient\.setQueryData\(tasteTrustKeys\.post\(postId\), state\)/);
  assert.match(mobileTasteTrustHook, /patchCachedPostEngagementFields/);
  assert.match(feedHook, /export function patchCachedPostById/);
  assert.match(feedHook, /queryClient\.setQueriesData<unknown>/);
  assert.match(feedHook, /scope === "feed" \|\| scope === "profile" \|\| scope === "settings"/);
  assert.match(feedHook, /Array\.isArray\(current\.pages\)/);
  assert.match(feedHook, /Array\.isArray\(current\.posts\)/);
  assert.match(mobileTasteTrustHook, /state\.myFeedbackLabel === "Helpful"/);
  assert.match(mobileTasteTrustHook, /mustTryCount: state\.summary\.feedback_counts\.Helpful/);
  assert.match(mobileTasteTrustHook, /notWorthItCount: state\.summary\.feedback_counts\.Disagree/);
  assert.doesNotMatch(mobileTasteTrustHook, /likedByMe: state\.engagement\.likedByMe/);
  assert.match(postCard, /new LatestIntentQueue<TasteTrustFeedbackLabel \| null, TasteTrustFeedbackState>/);
  assert.match(postCard, /const \[scopedVisualTasteTrustState, setScopedVisualTasteTrustState\] = useFixedGeometryRecyclingState</);
  assert.match(postCard, /if \(tasteTrustVisualStateEqual\(displayedState, nextState\)\) return current/);
  assert.match(postCard, /reactionQueue\.setDesiredIntent\(label\)/);
  assert.match(latestPostEngagement, /Intermediate responses become the next request's/);
  assert.doesNotMatch(mobileTasteTrustHook, /function optimisticState/);
  assert.doesNotMatch(mobileTasteTrustHook, /profileKeys\./);
  assert.doesNotMatch(mobileTasteTrustHook, /invalidateQueries/);
});

test("mobile social taps use Pixelfed-style optimistic updates without pending locks or feed refetches", () => {
  assert.doesNotMatch(postCard, /if \(likeMutation\.isPending\) return/);
  assert.doesNotMatch(postCard, /if \(bookmarkMutation\.isPending\) return/);
  assert.doesNotMatch(postCard, /const busy = submitFeedback\.isPending \|\| removeFeedback\.isPending/);
  assert.doesNotMatch(postCard, /disabled=\{busy\}/);
  assert.match(postCard, /new LatestIntentQueue<boolean, LikeIntentState>/);
  assert.match(postCard, /new LatestIntentQueue<boolean, BookmarkIntentState>/);
  assert.match(postCard, /likeQueue\.setDesiredIntent/);
  assert.match(postCard, /bookmarkQueue\.setDesiredIntent/);
  assert.match(latestPostEngagement, /private drainPromise: Promise<void> \| null = null/);
  assert.match(latestPostEngagement, /requestIsStillCurrent/);
  assert.match(mobileEngagementHook, /export function useTogglePostLikeMutation\(\)[\s\S]*mutationFn: \(input: ToggleLikeInput\) => togglePostLike\(input\)[\s\S]*\}\);/);
  assert.match(mobileEngagementHook, /export function useTogglePostBookmarkMutation\(\)[\s\S]*mutationFn: \(input: ToggleBookmarkInput\) => togglePostBookmark\(input\)[\s\S]*\}\);/);
  assert.match(mobileEngagementHook, /export function displayPostLikeState/);
  assert.match(mobileEngagementHook, /export function commitPostLikeState/);
  assert.match(mobileEngagementHook, /export function displayPostBookmarkState/);
  assert.match(mobileEngagementHook, /export function commitPostBookmarkState/);
  assert.doesNotMatch(mobileEngagementHook, /restorePostCaches|snapshots/);
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
