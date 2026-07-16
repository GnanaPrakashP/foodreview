import { type Href, Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import {
  AUTHENTICATED_ROUTE_NAMES,
  ONBOARDING_ROUTE_NAME,
  resolveAuthNavigationState
} from "@/navigation/authNavigationPolicy";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { isProfileComplete } from "@/utils/profileCompleteness";

const SLIDE_OVER_OPTIONS = {
  presentation: "transparentModal",
  animation: "none",
  gestureEnabled: false,
  contentStyle: { backgroundColor: "transparent" }
} as const;

const SLIDE_OVER_ROUTES = new Set<string>([
  "restaurants/[placeId]",
  "restaurants/by-name/[restaurant]",
  "dishes/[dish]",
  "people/[username]",
  "notifications",
  "memories/[id]/dish/[dishId]",
  "profile/circle",
  "profile/settings",
  "profile/settings/edit",
  "profile/settings/security",
  "profile/settings/notifications",
  "profile/settings/blocked",
  "profile/settings/liked",
  "profile/settings/saved",
  "profile/settings/comments",
  "profile/settings/help",
  "profile/settings/about",
  "profile/settings/privacy",
  "profile/settings/terms"
]);

const CAMERA_ROUTES = new Set<string>(["memories/[id]/camera", "share/camera"]);

function protectedScreenOptions(name: string) {
  if (name === "(tabs)") return { animation: "none" } as const;
  if (CAMERA_ROUTES.has(name)) return { animation: "fade", animationDuration: 150 } as const;
  if (SLIDE_OVER_ROUTES.has(name)) return SLIDE_OVER_OPTIONS;
  return undefined;
}

export function AuthGate() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const profile = useSessionStore((state) => state.profile);
  const pendingProtectedRoute = useSessionStore((state) => state.pendingProtectedRoute);
  const clearPendingProtectedRoute = useSessionStore((state) => state.clearPendingProtectedRoute);
  const navigationState = resolveAuthNavigationState({
    hasCompleteProfile: isProfileComplete(profile),
    isAuthenticated,
    isReady
  });

  useEffect(() => {
    if (navigationState !== "signed_in" || !pendingProtectedRoute) return;
    clearPendingProtectedRoute();
    router.replace(pendingProtectedRoute as Href);
  }, [clearPendingProtectedRoute, navigationState, pendingProtectedRoute, router]);

  if (navigationState === "loading") {
    return <View testID="auth-bootstrap-shell" style={{ backgroundColor: themeColors.bg, flex: 1 }} />;
  }

  const initialRouteName = navigationState === "signed_out"
    ? "(auth)"
    : navigationState === "onboarding"
        ? ONBOARDING_ROUTE_NAME
        : "(tabs)";

  return (
    <Stack
      initialRouteName={initialRouteName}
      screenOptions={{
        headerShown: false,
        animation: "fade",
        contentStyle: { backgroundColor: themeColors.bg }
      }}
    >
      <Stack.Protected guard={navigationState === "signed_out"}>
        <Stack.Screen name="(auth)" options={{ animation: "none" }} />
        <Stack.Screen name="auth/callback" />
      </Stack.Protected>

      <Stack.Protected guard={navigationState === "onboarding"}>
        <Stack.Screen name={ONBOARDING_ROUTE_NAME} options={{ gestureEnabled: false }} />
      </Stack.Protected>

      <Stack.Protected guard={navigationState === "signed_in"}>
        {AUTHENTICATED_ROUTE_NAMES.map((name) => (
          <Stack.Screen key={name} name={name} options={protectedScreenOptions(name)} />
        ))}
      </Stack.Protected>
    </Stack>
  );
}
