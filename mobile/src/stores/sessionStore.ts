import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { ActorProfile } from "@/types/models";

type SessionState = {
  session: Session | null;
  profile: ActorProfile | null;
  isAuthenticated: boolean;
  isReady: boolean;
  pendingProtectedRoute: string | null;
  setReady: () => void;
  beginTransition: () => void;
  setSession: (session: Session | null, profile: ActorProfile | null) => void;
  setProfile: (profile: ActorProfile | null) => void;
  rememberProtectedRoute: (route: string) => void;
  clearPendingProtectedRoute: () => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  profile: null,
  isAuthenticated: false,
  isReady: false,
  pendingProtectedRoute: null,
  setReady: () => set({ isReady: true }),
  beginTransition: () => set({ session: null, profile: null, isAuthenticated: false, isReady: false }),
  setSession: (session, profile) => set({ session, profile, isAuthenticated: Boolean(session), isReady: true }),
  setProfile: (profile) => set({ profile }),
  rememberProtectedRoute: (pendingProtectedRoute) => set({ pendingProtectedRoute }),
  clearPendingProtectedRoute: () => set({ pendingProtectedRoute: null }),
  clearSession: () => set({ session: null, profile: null, isAuthenticated: false, isReady: true })
}));
