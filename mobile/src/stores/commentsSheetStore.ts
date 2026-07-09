import { create } from "zustand";

type CommentCountUpdater = (updater: (count: number) => number) => void;

type CommentsSheetState = {
  postId: string | null;
  postAuthorName: string | null;
  onCommentCountChange: CommentCountUpdater | null;
  openCommentsSheet: (postId: string, onCommentCountChange: CommentCountUpdater, postAuthorName?: string | null) => void;
  closeCommentsSheet: () => void;
};

// The comments sheet is hosted once at the app root (PostCommentsSheetHost) as a
// plain in-tree overlay instead of per-card RN Modals: on Android a Modal gets
// its own window, and the per-frame keyboard callbacks the composer needs to
// track the IME only reach the main window's KeyboardProvider.
export const useCommentsSheetStore = create<CommentsSheetState>((set) => ({
  postId: null,
  postAuthorName: null,
  onCommentCountChange: null,
  openCommentsSheet: (postId, onCommentCountChange, postAuthorName = null) => set({
    postAuthorName,
    postId,
    onCommentCountChange
  }),
  closeCommentsSheet: () => set({ postAuthorName: null, postId: null, onCommentCountChange: null })
}));
