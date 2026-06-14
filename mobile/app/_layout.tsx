import { DarkTheme, ThemeProvider, type Theme } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AppProviders } from "@/providers/AppProviders";
import { colors, useCircleBitesFonts } from "@/theme";

// Dark navigation theme so the navigator/window background is never the default
// white — otherwise a white frame flashes through during screen transitions.
const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.dark.bg,
    card: colors.dark.bg
  }
};

// Settings + every settings sub-screen present over the screen beneath them and
// drive their own Reanimated slide (see useSlideOverScreen). Native animation is
// disabled and the container is transparent so the screen underneath shows during
// the slide.
const SLIDE_OVER_OPTIONS = {
  presentation: "transparentModal",
  animation: "none",
  gestureEnabled: false,
  contentStyle: { backgroundColor: "transparent" }
} as const;

const SETTINGS_SLIDE_ROUTES = [
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

  if (!fontsLoaded) return null;

  return (
    <AppProviders>
      {/* Translucent flags are required on edge-to-edge Android: without them the
          reported keyboard height is offset by the navigation-bar height, which
          misplaces anything anchored to the keyboard (worst after back-button dismiss). */}
      <KeyboardProvider navigationBarTranslucent statusBarTranslucent>
        <StatusBar backgroundColor={colors.dark.bg} style="light" />
        <ThemeProvider value={navigationTheme}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "fade",
              contentStyle: { backgroundColor: colors.dark.bg }
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="auth/callback" />
            <Stack.Screen name="people/[username]" />
            <Stack.Screen name="onboarding/profile" />
            {/* Settings and its sub-screens present over the screen beneath them and
                drive their own Reanimated slide (useSlideOverScreen). Native
                animation is disabled because native transparentModal ignores
                slide_from_right/animationDuration (especially on iOS); the
                transparent container lets the screen underneath show during the slide. */}
            {SETTINGS_SLIDE_ROUTES.map((name) => (
              <Stack.Screen key={name} name={name} options={SLIDE_OVER_OPTIONS} />
            ))}
          </Stack>
        </ThemeProvider>
      </KeyboardProvider>
    </AppProviders>
  );
}
