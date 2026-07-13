import { PropsWithChildren } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { RuntimeActivityCoordinator } from "@/performance/runtimeActivity";
import { AccountSessionBoundary } from "@/providers/AccountSessionBoundary";
import { AuthGate } from "@/providers/AuthGate";
import { DevAutoLogin } from "@/providers/DevAutoLogin";
import { PushNotificationBootstrap } from "@/providers/PushNotificationBootstrap";
import { UserLocationBootstrap } from "@/providers/UserLocationBootstrap";

export function AppProviders({ children }: PropsWithChildren) {
  const providerContent = (
    <>
      <UserLocationBootstrap />
      {children}
      <PushNotificationBootstrap />
      <DevAutoLogin />
      <AuthGate />
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
