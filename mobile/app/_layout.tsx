import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AppProviders } from "@/providers/AppProviders";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useCircleBitesFonts } from "@/theme";

// The Explore detail screens, circle screen, settings, and every settings
// sub-screen present over the screen beneath them and drive their own custom
// slide. Native animation is disabled and
// the container is transparent so the screen underneath shows during the slide.
const SLIDE_OVER_OPTIONS = {
  presentation: "transparentModal",
  animation: "none",
  gestureEnabled: false,
  contentStyle: { backgroundColor: "transparent" }
} as const;

const SLIDE_OVER_ROUTES = [
  "restaurants/[placeId]",
  "restaurants/by-name/[restaurant]",
  "dishes/[dish]",
  "people/[username]",
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
];

export default function RootLayout() {
  const [fontsLoaded] = useCircleBitesFonts();
  const { resolvedTheme, themeColors } = useThemePreference();
  const navigationTheme = useMemo<Theme>(() => {
    const baseTheme = resolvedTheme === "light" ? DefaultTheme : DarkTheme;

    return {
      ...baseTheme,
      dark: resolvedTheme === "dark",
      colors: {
        ...baseTheme.colors,
        background: themeColors.bg,
        border: themeColors.border,
        card: themeColors.bg,
        notification: themeColors.orange,
        primary: themeColors.orange,
        text: themeColors.cream
      }
    };
  }, [resolvedTheme, themeColors]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <AppProviders>
      {/* Translucent flags are required on edge-to-edge Android: without them the
          reported keyboard height is offset by the navigation-bar height, which
          misplaces anything anchored to the keyboard (worst after back-button dismiss). */}
      <KeyboardProvider navigationBarTranslucent statusBarTranslucent>
        <StatusBar backgroundColor={themeColors.bg} style={resolvedTheme === "light" ? "dark" : "light"} />
        <ThemeProvider value={navigationTheme}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "fade",
              contentStyle: { backgroundColor: themeColors.bg }
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="auth/callback" />
            <Stack.Screen name="onboarding/profile" />
            {/* Camera opens with a snappier fade than the global default so it
                feels instant; a quick fade also hides the brief sensor warm-up. */}
            <Stack.Screen name="memories/[id]/camera" options={{ animation: "fade", animationDuration: 150 }} />
            <Stack.Screen name="share/camera" options={{ animation: "fade", animationDuration: 150 }} />
            {/* Settings and its sub-screens present over the screen beneath them and
                drive their own custom slide. Native
                animation is disabled because native transparentModal ignores
                slide_from_right/animationDuration (especially on iOS); the
                transparent container lets the screen underneath show during the slide. */}
            {SLIDE_OVER_ROUTES.map((name) => (
              <Stack.Screen key={name} name={name} options={SLIDE_OVER_OPTIONS} />
            ))}
          </Stack>
        </ThemeProvider>
      </KeyboardProvider>
    </AppProviders>
    </GestureHandlerRootView>
  );
}
