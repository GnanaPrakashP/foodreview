import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { ActorProfile } from "@/types/models";

type SessionState = {
  session: Session | null;
  profile: ActorProfile | null;
  isAuthenticated: boolean;
  isReady: boolean;
  setReady: () => void;
  setSession: (session: Session | null, profile: ActorProfile | null) => void;
  setProfile: (profile: ActorProfile | null) => void;
  clearSession: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  profile: null,
  isAuthenticated: false,
  isReady: false,
  setReady: () => set({ isReady: true }),
  setSession: (session, profile) => set({ session, profile, isAuthenticated: Boolean(session), isReady: true }),
  setProfile: (profile) => set({ profile }),
  clearSession: () => set({ session: null, profile: null, isAuthenticated: false, isReady: true })
}));
