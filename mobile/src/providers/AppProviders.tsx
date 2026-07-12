import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { focusManager, QueryClient, QueryClientProvider, type Query } from "@tanstack/react-query";
import { PropsWithChildren, useEffect, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { AuthBootstrap } from "@/providers/AuthBootstrap";
import { AuthGate } from "@/providers/AuthGate";
import { DevAutoLogin } from "@/providers/DevAutoLogin";
import { PushNotificationBootstrap } from "@/providers/PushNotificationBootstrap";
import { UserLocationBootstrap } from "@/providers/UserLocationBootstrap";
import { queryCachePersister } from "@/providers/queryPersistence";

const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const QUERY_CACHE_BUSTER = "memory-cache-v1";

function shouldPersistQuery(query: Query) {
  return query.state.status === "success" && query.queryKey[0] === "memories";
}

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 30 * 60_000,
            refetchOnReconnect: false,
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 5 * 60_000
          }
        }
      })
  );

  // Refetch queries that opt into refetchOnWindowFocus/Reconnect when the app returns to
  // the foreground. React Native doesn't fire focus events on its own, so it must be wired
  // to AppState. This is what replaces the memory room's old 8s poll as the "catch up on
  // anything realtime missed while backgrounded" safety net.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
    });
    return () => subscription.remove();
  }, []);

  const providerContent = (
    <AuthBootstrap>
      <UserLocationBootstrap />
      {children}
      <PushNotificationBootstrap />
      <DevAutoLogin />
      <AuthGate />
    </AuthBootstrap>
  );

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {queryCachePersister ? (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            buster: QUERY_CACHE_BUSTER,
            dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
            maxAge: QUERY_CACHE_MAX_AGE_MS,
            persister: queryCachePersister
          }}
        >
          {providerContent}
        </PersistQueryClientProvider>
      ) : (
        <QueryClientProvider client={queryClient}>
          {providerContent}
        </QueryClientProvider>
      )}
    </SafeAreaProvider>
  );
}
