import { focusManager } from "@tanstack/react-query";
import { PropsWithChildren, useEffect } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { AccountSessionBoundary } from "@/providers/AccountSessionBoundary";
import { AuthGate } from "@/providers/AuthGate";
import { DevAutoLogin } from "@/providers/DevAutoLogin";
import { PushNotificationBootstrap } from "@/providers/PushNotificationBootstrap";
import { UserLocationBootstrap } from "@/providers/UserLocationBootstrap";

export function AppProviders({ children }: PropsWithChildren) {
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
      <AccountSessionBoundary>{providerContent}</AccountSessionBoundary>
    </SafeAreaProvider>
  );
}
