import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { ActorProfile } from "@/types/models";
import { devAutoLoginEnabled } from "@/providers/devAutoLoginConfig";

type SessionState = {
  session: Session | null;
  profile: ActorProfile | null;
  isAuthenticated: boolean;
  isReady: boolean;
  // True while the dev-only auto-login is still resolving. Routing should wait
  // for it so we never flash the login screen before the fresh sign-in lands.
  isAutoLoginPending: boolean;
  setReady: () => void;
  setSession: (session: Session | null, profile: ActorProfile | null) => void;
  setProfile: (profile: ActorProfile | null) => void;
  clearSession: () => void;
  resolveAutoLogin: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  profile: null,
  isAuthenticated: false,
  isReady: false,
  isAutoLoginPending: devAutoLoginEnabled,
  setReady: () => set({ isReady: true }),
  setSession: (session, profile) => set({ session, profile, isAuthenticated: Boolean(session), isReady: true }),
  setProfile: (profile) => set({ profile }),
  clearSession: () => set({ session: null, profile: null, isAuthenticated: false, isReady: true }),
  resolveAutoLogin: () => set({ isAutoLoginPending: false })
}));
