import { create } from "zustand";

type CommentCountUpdater = (updater: (count: number) => number) => void;

type CommentsSheetState = {
  postId: string | null;
  onCommentCountChange: CommentCountUpdater | null;
  openCommentsSheet: (postId: string, onCommentCountChange: CommentCountUpdater) => void;
  closeCommentsSheet: () => void;
};

// The comments sheet is hosted once at the app root (PostCommentsSheetHost) as a
// plain in-tree overlay instead of per-card RN Modals: on Android a Modal gets
// its own window, and the per-frame keyboard callbacks the composer needs to
// track the IME only reach the main window's KeyboardProvider.
export const useCommentsSheetStore = create<CommentsSheetState>((set) => ({
  postId: null,
  onCommentCountChange: null,
  openCommentsSheet: (postId, onCommentCountChange) => set({ postId, onCommentCountChange }),
  closeCommentsSheet: () => set({ postId: null, onCommentCountChange: null })
}));
