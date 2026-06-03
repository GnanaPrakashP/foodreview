import { usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { useSessionStore } from "@/stores/sessionStore";

const signedOutRoutes = new Set(["/login", "/signup", "/auth/callback"]);

export function AuthGate() {
  const router = useRouter();
  const pathname = usePathname();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const profile = useSessionStore((state) => state.profile);

  useEffect(() => {
    if (!isReady) return;

    if (!isAuthenticated) {
      if (!signedOutRoutes.has(pathname)) router.replace("/login");
      return;
    }

    if (signedOutRoutes.has(pathname)) {
      router.replace(profile ? "/" : "/onboarding/profile");
    }
  }, [isAuthenticated, isReady, pathname, profile, router]);

  return null;
}
