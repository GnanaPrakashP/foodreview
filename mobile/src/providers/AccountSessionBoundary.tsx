import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropsWithChildren, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { initializeInstallationBoundary, supabase } from "@/api/supabase";
import { getAccountLifecycleStatus, logout } from "@/services/auth";
import { actorFromProfile, getProfileForVerifiedUserId } from "@/services/profiles";
import {
  cleanupCurrentLocalData,
  localDataDiagnostics,
  prepareLocalDataForOwner,
  prepareSignedOutLocalData
} from "@/services/localDataIsolation";
import {
  loadAccountProfileCache,
  saveAccountProfileCache,
  clearAccountProfileCache
} from "@/services/accountProfileCache";
import { useSessionStore } from "@/stores/sessionStore";
import { reconcilePendingMediaUploads } from "@/services/mediaPipeline";
import { getRuntimeActivitySnapshot, subscribeRuntimeActivity } from "@/performance/runtimeActivity";
import { recordPerformanceSample } from "@/performance/mobilePerformance";
import {
  captureMobileError,
  clearMobileTelemetryIdentity,
  recordMobileFlow,
  safeMobileErrorCode
} from "@/observability/mobileTelemetry";
import { cacheOwnerForUserId, getActiveCacheOwner } from "@/security/cacheOwnership";
import { clearSavedUserLocationForScope } from "@/services/userLocation";
import { clearOccasionCorrectionsForScope } from "@/features/occasions/occasionStorage";
import { isProfileComplete } from "@/utils/profileCompleteness";

const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;
const AUTH_VALIDATION_TIMEOUT_MS = 8_000;

function within<T>(promise: PromiseLike<T>, timeoutMs: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(code)), timeoutMs);
    Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

function createAccountQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 2 * 60 * 60_000,
        networkMode: "online",
        refetchOnMount: true,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        retry: (failureCount) => failureCount < 1,
        staleTime: 5 * 60_000
      }
    }
  });
}

function sessionIsLocallyValid(session: Session) {
  return typeof session.expires_at === "number" && session.expires_at * 1000 > Date.now();
}

function isAuthoritativeAuthFailure(error: { message?: string; status?: number } | null | undefined) {
  return error?.status === 401 || error?.status === 403 ||
    /invalid.*(jwt|token|session)|jwt.*expired|session.*missing|user.*not.*found/i.test(error?.message ?? "");
}

type Host = {
  client: QueryClient;
  ownerUserId: string | null;
};

export function AccountSessionBoundary({ children }: PropsWithChildren) {
  const [host, setHost] = useState<Host | null>(null);
  const hostRef = useRef<Host | null>(null);
  const queueRef = useRef(Promise.resolve());
  const boundaryStartedAtRef = useRef(Date.now());
  const readyRecordedRef = useRef(false);

  useEffect(() => {
    if (!host || readyRecordedRef.current) return;
    readyRecordedRef.current = true;
    recordPerformanceSample("app.account_boundary_ready", {
      durationMs: Date.now() - boundaryStartedAtRef.current
    });
  }, [host]);

  useEffect(() => {
    let alive = true;
    let initialResolved = false;
    let bufferedSession: Session | null | undefined;
    let tokenExpiryTimeout: ReturnType<typeof setTimeout> | null = null;

    const refreshExpiredSession = async (): Promise<{
      authoritativeFailure: boolean;
      session: Session | null;
    }> => {
      try {
        const { data, error } = await within(
          supabase.auth.refreshSession(),
          AUTH_BOOTSTRAP_TIMEOUT_MS,
          "auth_refresh_timeout"
        );
        if (error) {
          return {
            authoritativeFailure: isAuthoritativeAuthFailure(error),
            session: null
          };
        }
        return {
          authoritativeFailure: false,
          session: data.session && sessionIsLocallyValid(data.session) ? data.session : null
        };
      } catch (error) {
        return {
          authoritativeFailure: isAuthoritativeAuthFailure(
            error && typeof error === "object" ? error as { message?: string; status?: number } : null
          ),
          session: null
        };
      }
    };

    async function recoverExpiredSession(ownerHost: Host, reason: "foreground" | "timer") {
      if (hostRef.current !== ownerHost) return;
      const previousProfile = useSessionStore.getState().profile;
      const refresh = await refreshExpiredSession();
      if (hostRef.current !== ownerHost) return;
      let authoritativeFailure = refresh.authoritativeFailure;
      if (refresh.session) {
        try {
          const lifecycle = await within(
            getAccountLifecycleStatus(refresh.session.access_token),
            AUTH_VALIDATION_TIMEOUT_MS,
            "account_status_timeout"
          );
          const lifecycleMatchesSession =
            (lifecycle === "active" && Boolean(previousProfile) && isProfileComplete(previousProfile)) ||
            (lifecycle === "incomplete" && Boolean(previousProfile) && !isProfileComplete(previousProfile)) ||
            (lifecycle === "missing" && !previousProfile);
          if (!lifecycleMatchesSession) {
            authoritativeFailure = true;
            throw new Error("refreshed_account_unavailable");
          }
          useSessionStore.getState().setSession(refresh.session, previousProfile);
          scheduleTokenExpiry(refresh.session, ownerHost);
          if (alive) setHost(ownerHost);
          recordMobileFlow("auth.token_refresh", 0, "success", { reason });
          return;
        } catch (error) {
          authoritativeFailure = authoritativeFailure ||
            (error instanceof Error && error.message === "account_status_unauthenticated");
          if (!authoritativeFailure) {
            // Authentication succeeded but lifecycle validation was temporarily
            // unavailable. Keep the owner-scoped replica mounted and retry.
            useSessionStore.getState().setSession(refresh.session, previousProfile);
            scheduleTokenExpiry(refresh.session, ownerHost);
            if (alive) setHost(ownerHost);
            recordMobileFlow("auth.token_refresh", 0, "failure", {
              reason,
              replica_retained: true
            });
            return;
          }
        }
      }
      if (!authoritativeFailure) {
        // A timeout, offline device, or temporary auth outage must not erase
        // the durable replica. Keep the current owner mounted and retry later.
        if (alive) setHost(ownerHost);
        tokenExpiryTimeout = setTimeout(() => {
          queueRef.current = queueRef.current.then(() => recoverExpiredSession(ownerHost, "timer"));
        }, 30_000);
        recordMobileFlow("auth.token_refresh", 0, "failure", {
          reason,
          replica_retained: true
        });
        return;
      }
      setHost(null);
      useSessionStore.getState().beginTransition();
      await cleanupCurrentLocalData("token_expired", ownerHost.client).catch(() => {});
      await logout().catch(() => {});
      await transition(null);
      recordMobileFlow("auth.token_refresh", 0, "failure", { reason });
    }

    const scheduleTokenExpiry = (session: Session, ownerHost: Host) => {
      if (tokenExpiryTimeout) clearTimeout(tokenExpiryTimeout);
      const expiresAt = (session.expires_at ?? 0) * 1000;
      const delay = Math.max(0, Math.min(expiresAt - Date.now() + 250, 2_147_000_000));
      tokenExpiryTimeout = setTimeout(() => {
        queueRef.current = queueRef.current.then(async () => {
          if (hostRef.current !== ownerHost) return;
          const latestSession = useSessionStore.getState().session;
          if (latestSession && sessionIsLocallyValid(latestSession)) {
            scheduleTokenExpiry(latestSession, ownerHost);
            return;
          }
          await recoverExpiredSession(ownerHost, "timer");
        });
      }, delay);
    };

    const transition = async (session: Session | null) => {
      const transitionStartedAt = Date.now();
      let resolutionPhase = "start";
      if (!alive) return;
      if (tokenExpiryTimeout) {
        clearTimeout(tokenExpiryTimeout);
        tokenExpiryTimeout = null;
      }
      const current = hostRef.current;
      if (current && current.ownerUserId === (session?.user.id ?? null)) {
        if (session) {
          const state = useSessionStore.getState();
          useSessionStore.getState().setSession(session, state.profile);
          scheduleTokenExpiry(session, current);
        }
        return;
      }

      setHost(null);
      useSessionStore.getState().beginTransition();
      const nextClient = createAccountQueryClient();

      try {
        if (session && !sessionIsLocallyValid(session)) {
          resolutionPhase = "expired_session_refresh";
          const refresh = await refreshExpiredSession();
          if (refresh.session) {
            await transition(refresh.session);
            return;
          }
          if (!refresh.authoritativeFailure) {
            // On a cold offline start there is no safe authenticated host to
            // mount yet, but the previous owner's durable files remain intact.
            // A later successful login reopens the same owner-scoped replica.
            useSessionStore.getState().clearSession();
            const retainedHost = { client: nextClient, ownerUserId: null };
            hostRef.current = retainedHost;
            if (alive) setHost(retainedHost);
            recordMobileFlow("auth.session_resolution", Date.now() - transitionStartedAt, "failure", {
              replica_retained: true,
              state: "offline_expired"
            });
            return;
          }
        }
        if (!session || !sessionIsLocallyValid(session)) {
          resolutionPhase = "signed_out_cleanup";
          await prepareSignedOutLocalData(nextClient, current?.client);
          if (session) await logout();
          useSessionStore.getState().clearSession();
          clearMobileTelemetryIdentity();
          const nextHost = { client: nextClient, ownerUserId: null };
          hostRef.current = nextHost;
          if (alive) setHost(nextHost);
          recordMobileFlow("auth.session_resolution", Date.now() - transitionStartedAt, "success", { state: "signed_out" });
          return;
        }

        resolutionPhase = "owner_local_data";
        const hydrationStartedAt = Date.now();
        const { owner, ownerChanged } = await prepareLocalDataForOwner(session.user.id, nextClient, current?.client);
        recordPerformanceSample("app.cache_hydration", {
          durationMs: Date.now() - hydrationStartedAt
        });
        let profile = null;
        let profileLookupFailed = false;
        let lifecycle: Awaited<ReturnType<typeof getAccountLifecycleStatus>> | null = null;
        resolutionPhase = "identity_validation";
        const identityResult = await Promise.allSettled([
          within(
            supabase.auth.getUser(session.access_token),
            AUTH_VALIDATION_TIMEOUT_MS,
            "auth_identity_timeout"
          )
        ]);
        const identity = identityResult[0].status === "fulfilled" ? identityResult[0].value : null;
        if (!identity) {
          profileLookupFailed = true;
        } else if (identity.error) {
          if (isAuthoritativeAuthFailure(identity.error)) throw new Error("authoritative_session_invalid");
          profileLookupFailed = true;
        } else if (!identity.data.user || identity.data.user.id !== session.user.id) {
          throw new Error("authoritative_owner_mismatch");
        } else {
          resolutionPhase = "profile_lifecycle_validation";
          const [profileResult, lifecycleResult] = await Promise.allSettled([
            within(
              getProfileForVerifiedUserId(session.user.id),
              AUTH_VALIDATION_TIMEOUT_MS,
              "profile_validation_timeout"
            ),
            within(
              getAccountLifecycleStatus(session.access_token),
              AUTH_VALIDATION_TIMEOUT_MS,
              "account_status_timeout"
            )
          ]);
          if (profileResult.status === "fulfilled") profile = profileResult.value;
          else profileLookupFailed = true;
          if (lifecycleResult.status === "fulfilled") lifecycle = lifecycleResult.value;
          else if (
            lifecycleResult.reason instanceof Error &&
            lifecycleResult.reason.message === "account_status_unauthenticated"
          ) {
            throw new Error("authoritative_session_invalid");
          }
        }

        if (lifecycle === "deleting") throw new Error("authoritative_account_frozen");
        if (
          lifecycle === "active" &&
          (!profile || !isProfileComplete(actorFromProfile(profile))) &&
          !profileLookupFailed
        ) throw new Error("authoritative_profile_mismatch");
        if (lifecycle === "incomplete" && !profile && !profileLookupFailed) {
          throw new Error("authoritative_profile_mismatch");
        }
        if (lifecycle === "missing" && profile) throw new Error("authoritative_owner_mismatch");
        if (!profile && !profileLookupFailed && lifecycle !== "missing") throw new Error("account_status_unavailable");

        const resolvedActor = profile
          ? actorFromProfile(profile)
          : profileLookupFailed && lifecycle !== "missing"
            ? await loadAccountProfileCache(owner.scope)
            : null;
        const actor = lifecycle === "incomplete" && resolvedActor
          ? { ...resolvedActor, profileComplete: false }
          : resolvedActor;
        // The authenticated account-status endpoint is authoritative for a new
        // account. If it says the profile is missing, a failed direct profile
        // lookup must still keep the valid session in onboarding. Existing
        // accounts continue to fail closed unless their owner-scoped cache can
        // be restored.
        if (profileLookupFailed && lifecycle !== "missing" && !actor) {
          throw new Error("offline_owner_profile_unavailable");
        }
        if (actor) await saveAccountProfileCache(owner.scope, actor).catch(() => {});

        resolutionPhase = "session_commit";
        useSessionStore.getState().setSession(session, actor);
        const nextHost = { client: nextClient, ownerUserId: owner.userId };
        hostRef.current = nextHost;
        scheduleTokenExpiry(session, nextHost);
        if (alive) setHost(nextHost);
        recordMobileFlow("auth.session_resolution", Date.now() - transitionStartedAt, "success", {
          cache_owner_changed: ownerChanged,
          state: isProfileComplete(actor) ? "active" : "onboarding"
        });
        void reconcilePendingMediaUploads().catch(() => {});
      } catch (error) {
        if (__DEV__) {
          console.error("CB_AUTH_SESSION_RESOLUTION_FAILED", {
            code: safeMobileErrorCode(error),
            phase: resolutionPhase
          });
          void localDataDiagnostics()
            .then((diagnostics) => console.error("CB_LOCAL_DATA_DIAGNOSTICS", diagnostics))
            .catch(() => {});
        }
        const reason = error instanceof Error && error.message === "authoritative_owner_mismatch"
          ? "owner_mismatch"
          : error instanceof Error && error.message === "authoritative_account_frozen"
            ? "account_frozen"
            : "session_invalid";
        await cleanupCurrentLocalData(reason, nextClient).catch(() => {});
        await logout().catch(() => {});
        const signedOutClient = createAccountQueryClient();
        await prepareSignedOutLocalData(signedOutClient, nextClient).catch(() => {});
        useSessionStore.getState().clearSession();
        clearMobileTelemetryIdentity();
        recordMobileFlow("auth.session_resolution", Date.now() - transitionStartedAt, "failure", { reason });
        captureMobileError("auth.session_resolution_failed", error, { reason });
        const nextHost = { client: signedOutClient, ownerUserId: null };
        hostRef.current = nextHost;
        if (alive) setHost(nextHost);
      }
    };

    const enqueue = (session: Session | null) => {
      queueRef.current = queueRef.current.then(() => transition(session)).catch(() => transition(null));
    };

    const validateForegroundAccount = () => {
      const current = hostRef.current;
      const session = useSessionStore.getState().session;
      if (!current?.ownerUserId || !session) return;
      const stillCurrent = () => (
        hostRef.current === current &&
        useSessionStore.getState().session?.user.id === current.ownerUserId
      );
      if (!sessionIsLocallyValid(session)) {
        queueRef.current = queueRef.current.then(async () => {
          if (!stillCurrent()) return;
          await recoverExpiredSession(current, "foreground");
        });
        return;
      }
      void getAccountLifecycleStatus(session.access_token)
        .then((status) => {
          if (status === "active" && stillCurrent()) {
            void reconcilePendingMediaUploads().catch(() => {});
          }
          if (status === "incomplete" && stillCurrent()) {
            const currentProfile = useSessionStore.getState().profile;
            useSessionStore.getState().setSession(
              session,
              currentProfile ? { ...currentProfile, profileComplete: false } : null
            );
            return;
          }
          if (
            status === "active" ||
            (status === "missing" && !useSessionStore.getState().profile) ||
            !stillCurrent()
          ) return;
          queueRef.current = queueRef.current.then(async () => {
            if (!stillCurrent()) return;
            setHost(null);
            useSessionStore.getState().beginTransition();
            await cleanupCurrentLocalData(status === "deleting" ? "account_frozen" : "session_invalid", current.client);
            await logout().catch(() => {});
            await transition(null);
          });
        })
        .catch((error) => {
          if (!(error instanceof Error) || error.message !== "account_status_unauthenticated") return;
          queueRef.current = queueRef.current.then(async () => {
            if (!stillCurrent()) return;
            setHost(null);
            useSessionStore.getState().beginTransition();
            await cleanupCurrentLocalData("session_invalid", current.client);
            await logout().catch(() => {});
            await transition(null);
          });
        });
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        // Witoh is OTP/Google only. Reject any legacy recovery session
        // before it can mount an account-owned cache or protected route.
        bufferedSession = null;
        void logout().catch(() => {});
        if (initialResolved) enqueue(null);
        return;
      }
      if (!initialResolved) {
        bufferedSession = session;
        return;
      }
      if (session && getRuntimeActivitySnapshot().isForeground) {
        void supabase.auth.startAutoRefresh();
      }
      if (!session) {
        const current = hostRef.current;
        if (
          current?.ownerUserId &&
          getActiveCacheOwner()?.userId === current.ownerUserId
        ) {
          queueRef.current = queueRef.current.then(() => recoverExpiredSession(current, "timer"));
          return;
        }
        setHost(null);
        useSessionStore.getState().beginTransition();
      }
      enqueue(session);
    });
    const unsubscribeRuntimeActivity = subscribeRuntimeActivity((next, previous) => {
      if (!next.isForeground) {
        void supabase.auth.stopAutoRefresh();
        return;
      }
      if (!previous.isForeground) {
        void supabase.auth.startAutoRefresh();
        validateForegroundAccount();
      }
    });
    if (getRuntimeActivitySnapshot().isForeground) void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();

    initializeInstallationBoundary()
      .then(async ({ orphanedUserId }) => {
        if (orphanedUserId) {
          const orphanedScope = cacheOwnerForUserId(orphanedUserId).scope;
          await Promise.all([
            clearAccountProfileCache(orphanedScope),
            clearSavedUserLocationForScope(orphanedScope),
            clearOccasionCorrectionsForScope(orphanedScope)
          ]);
        }
        return within(supabase.auth.getSession(), AUTH_BOOTSTRAP_TIMEOUT_MS, "auth_restore_timeout");
      })
      .then(({ data }) => {
        const resolvedSession = bufferedSession === undefined ? data.session : bufferedSession;
        initialResolved = true;
        enqueue(resolvedSession);
      })
      .catch((error) => {
        captureMobileError("auth.initial_session_read_failed", error);
        initialResolved = true;
        // Session storage could not be read or refreshed. Do not interpret a
        // timeout as authorization to erase an owner-scoped durable replica.
        useSessionStore.getState().clearSession();
        const retainedHost = { client: createAccountQueryClient(), ownerUserId: null };
        hostRef.current = retainedHost;
        if (alive) setHost(retainedHost);
      });

    return () => {
      alive = false;
      if (tokenExpiryTimeout) clearTimeout(tokenExpiryTimeout);
      authListener.subscription.unsubscribe();
      unsubscribeRuntimeActivity();
      void supabase.auth.stopAutoRefresh();
      hostRef.current?.client.clear();
    };
  }, []);

  if (!host) return <View style={{ backgroundColor: "#0e0b08", flex: 1 }} />;
  return <QueryClientProvider client={host.client}>{children}</QueryClientProvider>;
}
