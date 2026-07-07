import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const reviewDetail = source("mobile/app/reviews/[id].tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
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
  assert.match(commentsService, /authorizedJson<CommentRow>\("\/api\/comments"/);
  assert.match(commentsService, /`\/api\/comments\/\$\{encodeURIComponent\(input\.commentId\)\}`/);
  assert.doesNotMatch(commentsService, /\.from\("comments"\)[\s\S]{0,220}\.(insert|delete)/);
  assert.doesNotMatch(commentsService, /async function viewerName/);
  assert.doesNotMatch(commentsService, /await viewerName\(\)/);
  assert.match(commentsHook, /setQueryData<PostComment\[]>\(commentKeys\.post\(postId\)/);
  assert.doesNotMatch(commentsHook, /feedKeys\.(circle|public|review)/);
  assert.doesNotMatch(commentsHook, /profileKeys\.currentPage/);
});

test("feed post comments open as a bottom sheet instead of navigating to a post detail screen", () => {
  assert.match(postCard, /const \[commentsOpen, setCommentsOpen\] = useState\(false\)/);
  assert.match(postCard, /accessibilityState=\{\{ expanded: commentsOpen \}\}/);
  assert.match(postCard, /onPress=\{\(\) => setCommentsOpen\(\(open\) => !open\)\}/);
  assert.match(postCard, /<PostCommentsSheet/);
  assert.match(postCard, /<Modal animationType="none"/);
  assert.match(postCard, /withTiming\(0/);
  assert.match(postCard, /commentsModalBackdrop/);
  assert.match(postCard, /commentsSheet/);
  assert.match(postCard, /usePostCommentsQuery\(postId\)/);
  assert.match(postCard, /useAddPostCommentMutation\(postId\)/);
  assert.match(postCard, /useDeletePostCommentMutation\(postId\)/);
  assert.doesNotMatch(postCard, /pathname: "\/reviews\/\[id\]"/);
});
