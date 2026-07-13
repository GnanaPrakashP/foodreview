import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const reviewDetail = source("mobile/app/reviews/[id].tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const commentsSheet = source("mobile/src/components/posts/PostCommentsSheet.tsx");
const commentsSheetStore = source("mobile/src/stores/commentsSheetStore.ts");
const mobileLayout = source("mobile/app/_layout.tsx");
const commentsHook = source("mobile/src/hooks/useComments.ts");
const commentsService = source("mobile/src/services/comments.ts");

test("review detail screen presents comments as a production mobile surface", () => {
  assert.match(reviewDetail, /KeyboardStickyView/);
  assert.match(reviewDetail, /from "react-native-keyboard-controller"/);
  assert.match(reviewDetail, /KeyboardController\.setInputMode\(AndroidSoftInputModes\.SOFT_INPUT_ADJUST_RESIZE\)/);
  assert.match(reviewDetail, /KeyboardController\.setDefaultMode\(\)/);
  assert.match(reviewDetail, /<ScrollView[\s\S]*ref=\{scrollRef\}/);
  assert.match(reviewDetail, /composerSticky/);
  assert.match(reviewDetail, /composerShell/);
  assert.match(reviewDetail, /commentsCountPill/);
  assert.match(reviewDetail, /commentCountLabel\(displayedCommentCount\)/);
  assert.match(reviewDetail, /function renderComments\(\)/);
  assert.match(reviewDetail, /commentsStatusRow/);
  assert.match(reviewDetail, /emptyComments/);
  assert.match(reviewDetail, /retryCommentsTitle/);
  assert.match(reviewDetail, /MoreHorizontal/);
  assert.match(reviewDetail, /accessibilityLabel=\{isOwnComment \? "Delete comment" : "Comment options"\}/);
});

test("review detail composer supports proper writing states", () => {
  assert.match(reviewDetail, /const COMMENT_LIMIT = 500/);
  assert.match(reviewDetail, /maxLength=\{COMMENT_LIMIT\}/);
  assert.match(reviewDetail, /multiline/);
  assert.match(reviewDetail, /characterCount/);
  assert.match(reviewDetail, /canSendComment/);
  assert.match(reviewDetail, /ActivityIndicator color=\{themeColors\.white\} size="small"/);
  assert.match(reviewDetail, /shouldScrollToCommentsEndRef/);
  assert.doesNotMatch(reviewDetail, /onSubmitEditing=\{submitComment\}/);
});

test("mobile comment writes still go through trusted API routes", () => {
  assert.match(commentsService, /authorizedApiJson<CommentsApiResponse>/);
  assert.match(commentsService, /new URLSearchParams\(\{ postId, limit: "30" \}\)/);
  assert.match(commentsService, /`\/api\/comments\?\$\{params\.toString\(\)\}`/);
  assert.match(commentsService, /authorizedApiJson<CommentRow & \{[\s\S]*engagement\?: PostEngagementState;[\s\S]*profileMap\?: Record<string, string>;[\s\S]*\}>/);
  assert.match(commentsService, /mapComment\(data, data\.profileMap\?\.\[data\.user_name\] \?\? data\.user_name\)/);
  assert.match(commentsService, /`\/api\/comments\/\$\{encodeURIComponent\(input\.commentId\)\}`/);
  assert.doesNotMatch(commentsService, /\.from\("comments"\)/);
  assert.doesNotMatch(commentsService, /async function viewerName/);
  assert.doesNotMatch(commentsService, /await viewerName\(\)/);
  assert.match(commentsHook, /setQueryData<InfiniteData<CommentsPage>>\(commentKeys\.post\(postId\)/);
  assert.match(commentsHook, /patchCachedPostEngagementFields/);
  assert.match(commentsHook, /commentCount: comment\.engagement\.commentCount/);
  assert.match(commentsHook, /commentCount: result\.engagement\.commentCount/);
  assert.doesNotMatch(commentsHook, /profileKeys\.currentPage/);
});

test("feed post comments open as a bottom sheet instead of navigating to a post detail screen", () => {
  assert.match(postCard, /useCommentsSheetStore/);
  assert.match(postCard, /const commentsOpen = useCommentsSheetStore\(\(state\) => state\.postId === post\.id\)/);
  assert.match(postCard, /const openCommentsSheet = useCommentsSheetStore\(\(state\) => state\.openCommentsSheet\)/);
  assert.match(postCard, /const closeCommentsSheet = useCommentsSheetStore\(\(state\) => state\.closeCommentsSheet\)/);
  assert.match(postCard, /accessibilityState=\{\{ expanded: commentsOpen \}\}/);
  assert.match(postCard, /openCommentsSheet\(post\.id, setCommentCount, post\.reviewerUsername \|\| post\.reviewerName\)/);
  assert.match(commentsSheet, /export function PostCommentsSheetHost\(\)/);
  assert.match(commentsSheet, /const postId = useCommentsSheetStore\(\(state\) => state\.postId\)/);
  assert.match(commentsSheet, /const postAuthorName = useCommentsSheetStore\(\(state\) => state\.postAuthorName\)/);
  assert.match(commentsSheet, /usePostCommentsQuery\(postId\)/);
  assert.match(commentsSheet, /useAddPostCommentMutation\(postId\)/);
  assert.match(commentsSheet, /useDeletePostCommentMutation\(postId\)/);
  assert.match(commentsSheet, /const visibleName = comment\.authorName \|\| comment\.userName/);
  assert.match(commentsSheet, /const canDeleteComment = isOwnComment \|\| sameUsername\(postAuthorName, viewerName\)/);
  assert.match(commentsSheet, /Trash2/);
  assert.doesNotMatch(commentsSheet, /MoreHorizontal/);
  assert.match(commentsSheet, /withTiming\(0/);
  assert.match(commentsSheet, /commentsModalBackdrop/);
  assert.match(commentsSheet, /commentsSheet/);
  assert.match(commentsSheetStore, /postAuthorName: string \| null/);
  assert.match(commentsSheetStore, /openCommentsSheet: \(postId, onCommentCountChange, postAuthorName = null\) => set/);
  assert.match(mobileLayout, /<PostCommentsSheetHost \/>/);
  assert.doesNotMatch(postCard, /pathname: "\/reviews\/\[id\]"/);
});
