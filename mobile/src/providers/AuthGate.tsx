import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { useSessionStore } from "@/stores/sessionStore";

const signedOutRoutes = new Set(["/login", "/signup", "/auth/callback", "/auth/recovery"]);

export function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const isAutoLoginPending = useSessionStore((state) => state.isAutoLoginPending);
  const profile = useSessionStore((state) => state.profile);

  useEffect(() => {
    if (!isReady) return;
    // Hold off on any routing while the dev auto-login finishes, otherwise the
    // brief signed-out window would flash the login screen before it lands.
    if (isAutoLoginPending) return;

    if (!isAuthenticated) {
      if (!signedOutRoutes.has(pathname)) router.replace("/login");
      return;
    }

    if (pathname === "/auth/recovery") return;
    if (signedOutRoutes.has(pathname)) {
      router.replace(profile ? "/" : "/onboarding/profile");
    }
  }, [isAuthenticated, isAutoLoginPending, isReady, pathname, profile, router]);

  return null;
}
