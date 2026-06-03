import { PropsWithChildren, useEffect } from "react";
import { useAuthSessionListener, useAuthSnapshot } from "@/hooks/useAuth";
import { useSessionStore } from "@/stores/sessionStore";

export function AuthBootstrap({ children }: PropsWithChildren) {
  const setSession = useSessionStore((state) => state.setSession);
  const clearSession = useSessionStore((state) => state.clearSession);
  const setReady = useSessionStore((state) => state.setReady);
  const snapshot = useAuthSnapshot();

  useAuthSessionListener();

  useEffect(() => {
    if (!snapshot.isSuccess) return;
    if (!snapshot.data.session) {
      clearSession();
      return;
    }
    setSession(snapshot.data.session, snapshot.data.profile);
  }, [clearSession, setSession, snapshot.data, snapshot.isSuccess]);

  useEffect(() => {
    if (snapshot.isError) setReady();
  }, [setReady, snapshot.isError]);

  return children;
}
