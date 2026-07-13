import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { PropsWithChildren, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { supabase } from "@/api/supabase";
import { getAccountLifecycleStatus, logout } from "@/services/auth";
import { actorFromProfile, getProfileForVerifiedUserId } from "@/services/profiles";
import {
  cleanupCurrentLocalData,
  prepareLocalDataForOwner,
  prepareSignedOutLocalData
} from "@/services/localDataIsolation";
import {
  loadAccountProfileCache,
  saveAccountProfileCache
} from "@/services/accountProfileCache";
import { useSessionStore } from "@/stores/sessionStore";
import { reconcilePendingPostMediaUploads } from "@/services/mediaPipeline";
import { subscribeRuntimeActivity } from "@/performance/runtimeActivity";
import { recordPerformanceSample } from "@/performance/mobilePerformance";
import { captureMobileError, clearMobileTelemetryIdentity, recordMobileFlow } from "@/observability/mobileTelemetry";

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
  const router = useRouter();
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
          setHost(null);
          useSessionStore.getState().beginTransition();
          await cleanupCurrentLocalData("token_expired", ownerHost.client);
          await logout().catch(() => {});
          await transition(null);
        });
      }, delay);
    };

    const transition = async (session: Session | null) => {
      const transitionStartedAt = Date.now();
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
        if (!session || !sessionIsLocallyValid(session)) {
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

        const hydrationStartedAt = Date.now();
        const { owner, ownerChanged } = await prepareLocalDataForOwner(session.user.id, nextClient, current?.client);
        recordPerformanceSample("app.cache_hydration", {
          durationMs: Date.now() - hydrationStartedAt
        });
        let profile = null;
        let profileLookupFailed = false;
        let lifecycle: Awaited<ReturnType<typeof getAccountLifecycleStatus>> | null = null;
        const identity = await supabase.auth.getUser(session.access_token);
        if (identity.error) {
          if (isAuthoritativeAuthFailure(identity.error)) throw new Error("authoritative_session_invalid");
          profileLookupFailed = true;
        } else if (!identity.data.user || identity.data.user.id !== session.user.id) {
          throw new Error("authoritative_owner_mismatch");
        } else {
          const [profileResult, lifecycleResult] = await Promise.allSettled([
            getProfileForVerifiedUserId(session.user.id),
            getAccountLifecycleStatus(session.access_token)
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
        if (lifecycle === "active" && !profile && !profileLookupFailed) throw new Error("authoritative_profile_mismatch");
        if (lifecycle === "missing" && profile) throw new Error("authoritative_owner_mismatch");
        if (!profile && !profileLookupFailed && lifecycle !== "missing") throw new Error("account_status_unavailable");

        const actor = profile
          ? actorFromProfile(profile)
          : profileLookupFailed && lifecycle !== "missing"
            ? await loadAccountProfileCache(owner.scope)
            : null;
        if (profileLookupFailed && !actor) throw new Error("offline_owner_profile_unavailable");
        if (actor) await saveAccountProfileCache(owner.scope, actor).catch(() => {});

        useSessionStore.getState().setSession(session, actor);
        if (ownerChanged || (current?.ownerUserId && current.ownerUserId !== owner.userId)) {
          router.replace(actor ? "/" : "/onboarding/profile");
        }
        const nextHost = { client: nextClient, ownerUserId: owner.userId };
        hostRef.current = nextHost;
        scheduleTokenExpiry(session, nextHost);
        if (alive) setHost(nextHost);
        recordMobileFlow("auth.session_resolution", Date.now() - transitionStartedAt, "success", {
          cache_owner_changed: ownerChanged,
          state: actor ? "active" : "onboarding"
        });
        void reconcilePendingPostMediaUploads().catch(() => {});
      } catch (error) {
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
          setHost(null);
          useSessionStore.getState().beginTransition();
          await cleanupCurrentLocalData("token_expired", current.client);
          await logout().catch(() => {});
          await transition(null);
        });
        return;
      }
      void getAccountLifecycleStatus(session.access_token)
        .then((status) => {
          if (status === "active" && stillCurrent()) {
            void reconcilePendingPostMediaUploads().catch(() => {});
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!initialResolved) {
        bufferedSession = session;
        return;
      }
      enqueue(session);
    });
    const unsubscribeRuntimeActivity = subscribeRuntimeActivity((next, previous) => {
      if (next.isForeground && !previous.isForeground) validateForegroundAccount();
    });

    supabase.auth.getSession()
      .then(({ data }) => {
        initialResolved = true;
        enqueue(bufferedSession === undefined ? data.session : bufferedSession);
      })
      .catch(async (error) => {
        captureMobileError("auth.initial_session_read_failed", error);
        await logout().catch(() => {});
        initialResolved = true;
        enqueue(null);
      });

    return () => {
      alive = false;
      if (tokenExpiryTimeout) clearTimeout(tokenExpiryTimeout);
      authListener.subscription.unsubscribe();
      unsubscribeRuntimeActivity();
      hostRef.current?.client.clear();
    };
  }, [router]);

  if (!host) return <View style={{ backgroundColor: "#0e0b08", flex: 1 }} />;
  return <QueryClientProvider client={host.client}>{children}</QueryClientProvider>;
}
