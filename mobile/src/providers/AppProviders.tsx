import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PropsWithChildren, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthBootstrap } from "@/providers/AuthBootstrap";
import { AuthGate } from "@/providers/AuthGate";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000
          }
        }
      })
  );

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap>
          {children}
          <AuthGate />
        </AuthBootstrap>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
