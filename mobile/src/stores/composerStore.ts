import { create } from "zustand";

export type CreateLaunchTarget = "memory" | "post";
export type CreateFlowOrigin = "create" | "profile-memories" | "profile-posts";

type ComposerState = {
  // True while the Post-a-Bite composer owns the Create tab (photos captured,
  // review/details/preview steps). The tab bar hides until the post is made
  // or the composer is abandoned.
  composing: boolean;
  flowOrigin: CreateFlowOrigin;
  launchTarget: CreateLaunchTarget | null;
  beginFlow: (origin: CreateFlowOrigin) => void;
  clearLaunchTarget: () => void;
  finishFlow: () => void;
  requestLaunch: (target: CreateLaunchTarget, origin: CreateFlowOrigin) => void;
  reset: () => void;
  setComposing: (composing: boolean) => void;
};

export const useComposerStore = create<ComposerState>((set) => ({
  composing: false,
  flowOrigin: "create",
  launchTarget: null,
  beginFlow: (flowOrigin) => set({ flowOrigin, launchTarget: null }),
  clearLaunchTarget: () => set({ launchTarget: null }),
  finishFlow: () => set({ flowOrigin: "create", launchTarget: null }),
  requestLaunch: (launchTarget, flowOrigin) => set({ flowOrigin, launchTarget }),
  reset: () => set({ composing: false, flowOrigin: "create", launchTarget: null }),
  setComposing: (composing) => set({ composing })
}));
