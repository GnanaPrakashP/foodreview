import { useEffect, useRef } from "react";
import { login } from "@/services/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { devAutoLoginEmail, devAutoLoginEnabled, devAutoLoginPassword } from "@/providers/devAutoLoginConfig";

/**
 * Dev-only convenience: when the app starts without a session (after a device
 * restart, an Expo Go reinstall, or a cleared SecureStore), this signs in once
 * using the credentials from `mobile/.env` so you never have to tap through the
 * login screen by hand. If a persisted session was already restored it does
 * nothing but release the routing gate — no logout/login churn, which avoids
 * the stuck auth-transition overlay. Routing is held (via `isAutoLoginPending`)
 * until this resolves so the login screen never flashes. No-op in production
 * builds and when the dev credentials are unset.
 */
export function DevAutoLogin() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const resolveAutoLogin = useSessionStore((state) => state.resolveAutoLogin);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!devAutoLoginEnabled) return;
    // Wait until the account boundary has settled so we know whether a session exists.
    if (!isReady) return;
    if (attemptedRef.current) return;

    attemptedRef.current = true;

    // A persisted session was restored — keep it, just release the gate.
    if (isAuthenticated) {
      resolveAutoLogin();
      return;
    }

    // No session: sign in once from a clean signed-out state.
    login({ email: devAutoLoginEmail, password: devAutoLoginPassword })
      .then(() => {})
      .catch(() => {
        console.warn("[DevAutoLogin] automatic sign-in failed. Check local dev credentials.");
      })
      .finally(() => {
        // Release the routing gate whether or not sign-in succeeded.
        resolveAutoLogin();
      });
  }, [isAuthenticated, isReady, resolveAutoLogin]);

  return null;
}
