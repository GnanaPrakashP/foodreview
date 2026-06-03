import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  getAuthSnapshot,
  login,
  logout,
  onAuthStateChange,
  resolveEmailAuthMode,
  sendPasswordReset,
  signInWithGoogle,
  signup,
  type LoginInput,
  type ResolveEmailAuthModeInput,
  type ResetPasswordInput,
  type SignupInput
} from "@/services/auth";
import { useSessionStore } from "@/stores/sessionStore";

export const authKeys = {
  snapshot: ["auth", "snapshot"] as const
};

export function useAuthSnapshot() {
  return useQuery({
    queryKey: authKeys.snapshot,
    queryFn: getAuthSnapshot
  });
}

export function useAuthSessionListener() {
  const queryClient = useQueryClient();
  const clearSession = useSessionStore((state) => state.clearSession);

  useEffect(() => {
    return onAuthStateChange(({ session }) => {
      if (!session) clearSession();
      queryClient.invalidateQueries({ queryKey: authKeys.snapshot });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    });
  }, [clearSession, queryClient]);
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: ({ session, profile }) => {
      setSession(session, profile);
      queryClient.invalidateQueries();
    }
  });
}

export function useGoogleLoginMutation() {
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);

  return useMutation({
    mutationFn: signInWithGoogle,
    onSuccess: ({ session, profile }) => {
      setSession(session, profile);
      queryClient.invalidateQueries();
    }
  });
}

export function useResolveEmailAuthModeMutation() {
  return useMutation({
    mutationFn: (input: ResolveEmailAuthModeInput) => resolveEmailAuthMode(input)
  });
}

export function useSignupMutation() {
  const queryClient = useQueryClient();
  const setSession = useSessionStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: SignupInput) => signup(input),
    onSuccess: ({ session, profile }) => {
      setSession(session, profile);
      queryClient.invalidateQueries();
    }
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  const clearSession = useSessionStore((state) => state.clearSession);

  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearSession();
      queryClient.clear();
    }
  });
}

export function usePasswordResetMutation() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => sendPasswordReset(input)
  });
}
