import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropsWithChildren, useState } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { AuthBootstrap } from "@/providers/AuthBootstrap";
import { AuthGate } from "@/providers/AuthGate";
import { DevAutoLogin } from "@/providers/DevAutoLogin";
import { PushNotificationBootstrap } from "@/providers/PushNotificationBootstrap";

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

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap>
          {children}
          <PushNotificationBootstrap />
          <DevAutoLogin />
          <AuthGate />
        </AuthBootstrap>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
