import { PropsWithChildren } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { RuntimeActivityCoordinator } from "@/performance/runtimeActivity";
import { AccountSessionBoundary } from "@/providers/AccountSessionBoundary";
import { AuthIntentCapture } from "@/providers/AuthIntentCapture";
import { PushNotificationBootstrap } from "@/providers/PushNotificationBootstrap";
import { UserLocationBootstrap } from "@/providers/UserLocationBootstrap";
import { useSessionStore } from "@/stores/sessionStore";
import { isProfileComplete } from "@/utils/profileCompleteness";

function AuthenticatedRuntimeBootstrap() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const profile = useSessionStore((state) => state.profile);
  if (!isReady || !isAuthenticated || !isProfileComplete(profile)) return null;
  return (
    <>
      <UserLocationBootstrap />
      <PushNotificationBootstrap />
    </>
  );
}

export function AppProviders({ children }: PropsWithChildren) {
  const providerContent = (
    <>
      {children}
      <AuthIntentCapture />
      <AuthenticatedRuntimeBootstrap />
    </>
  );

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <RuntimeActivityCoordinator>
        <AccountSessionBoundary>{providerContent}</AccountSessionBoundary>
      </RuntimeActivityCoordinator>
    </SafeAreaProvider>
  );
}
