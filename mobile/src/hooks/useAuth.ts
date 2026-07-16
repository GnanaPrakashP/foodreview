import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  getAuthSnapshot,
  logout,
  onAuthStateChange,
  requestEmailOtp,
  signInWithGoogle,
  verifyEmailOtp,
  type EmailOtpRequestInput,
  type EmailOtpVerifyInput
} from "@/services/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { cleanupCurrentLocalData } from "@/services/localDataIsolation";
import { removePushTokenForCurrentInstall } from "@/services/notifications";

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
      if (!session) {
        void cleanupCurrentLocalData("session_invalid", queryClient).finally(clearSession);
      }
      queryClient.invalidateQueries({ queryKey: authKeys.snapshot });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    });
  }, [clearSession, queryClient]);
}

export function useGoogleLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signInWithGoogle,
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function useRequestEmailOtpMutation() {
  return useMutation({
    mutationFn: (input: EmailOtpRequestInput) => requestEmailOtp(input)
  });
}

export function useVerifyEmailOtpMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EmailOtpVerifyInput) => verifyEmailOtp(input),
    onSuccess: () => queryClient.invalidateQueries()
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  const beginTransition = useSessionStore((state) => state.beginTransition);
  const clearSession = useSessionStore((state) => state.clearSession);
  const clearPendingProtectedRoute = useSessionStore((state) => state.clearPendingProtectedRoute);
  const username = useSessionStore((state) => state.profile?.username ?? "");

  return useMutation({
    mutationFn: async () => {
      beginTransition();
      await removePushTokenForCurrentInstall(username).catch(() => {});
      await cleanupCurrentLocalData("explicit_logout", queryClient);
      await logout();
    },
    onSettled: () => {
      clearPendingProtectedRoute();
      clearSession();
      queryClient.clear();
    }
  });
}
