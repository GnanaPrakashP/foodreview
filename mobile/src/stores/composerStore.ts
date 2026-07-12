import { create } from "zustand";

type ComposerState = {
  // True while the Post-a-Bite composer owns the Create tab (photos captured,
  // review/details/preview steps). The tab bar hides until the post is made
  // or the composer is abandoned.
  composing: boolean;
  reset: () => void;
  setComposing: (composing: boolean) => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  composing: false,
  reset: () => set({ composing: false }),
  setComposing: (composing) => set({ composing })
}));
