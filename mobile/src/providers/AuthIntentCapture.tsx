import * as Linking from "expo-linking";
import { useEffect } from "react";
import { safeProtectedPathFromLinkParts } from "@/navigation/authNavigationPolicy";
import { authSchemeForEnvironment } from "@/config/releaseEnvironment";
import { useSessionStore } from "@/stores/sessionStore";

function protectedPathFromUrl(url: string) {
  const parsed = Linking.parse(url);
  return safeProtectedPathFromLinkParts(parsed, {
    allowExpo: __DEV__,
    customScheme: authSchemeForEnvironment()
  });
}

export function AuthIntentCapture() {
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const isReady = useSessionStore((state) => state.isReady);
  const rememberProtectedRoute = useSessionStore((state) => state.rememberProtectedRoute);

  useEffect(() => {
    if (!isReady || isAuthenticated) return;
    let alive = true;
    const capture = (url: string) => {
      if (!alive) return;
      const path = protectedPathFromUrl(url);
      if (path) rememberProtectedRoute(path);
    };

    void Linking.getInitialURL().then((url) => {
      if (url) capture(url);
    }).catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) => capture(url));

    return () => {
      alive = false;
      subscription.remove();
    };
  }, [isAuthenticated, isReady, rememberProtectedRoute]);

  return null;
}
