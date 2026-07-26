import { PropsWithChildren } from "react";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { RuntimeActivityCoordinator } from "@/performance/runtimeActivity";
import { AccountSessionBoundary } from "@/providers/AccountSessionBoundary";
import { AuthIntentCapture } from "@/providers/AuthIntentCapture";
import { MemoryRoomSyncBootstrap } from "@/providers/MemoryRoomSyncBootstrap";
import { PushNotificationBootstrap } from "@/providers/PushNotificationBootstrap";
import { ProfileHeaderPrefetchBootstrap } from "@/providers/ProfileHeaderPrefetchBootstrap";
import { UserLocationBootstrap } from "@/providers/UserLocationBootstrap";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserLocationStore } from "@/stores/userLocationStore";
import { isProfileComplete } from "@/utils/profileCompleteness";

function AuthenticatedRuntimeBootstrap() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const profile = useSessionStore((state) => state.profile);
  const startupLocationResolved = useUserLocationStore((state) => state.startupResolved);
  if (!isReady || !isAuthenticated || !isProfileComplete(profile)) return null;
  return (
    <>
      <UserLocationBootstrap />
      <MemoryRoomSyncBootstrap />
      {startupLocationResolved ? (
        <>
          <PushNotificationBootstrap />
          <ProfileHeaderPrefetchBootstrap />
        </>
      ) : null}
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
