import { DarkTheme, DefaultTheme, ThemeProvider, type Theme } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { LogBox, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { configureReanimatedLogger, ReanimatedLogLevel } from "react-native-reanimated";
import { PostCommentsSheetHost } from "@/components/posts/PostCommentsSheet";
import { AppProviders } from "@/providers/AppProviders";
import { AuthGate } from "@/providers/AuthGate";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { useWitohFonts } from "@/theme";
import { wrapRootLayout } from "@/observability/mobileTelemetry";
import { isProfileComplete } from "@/utils/profileCompleteness";

configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false
});

// expo-router internally calls navigate with the deprecated object signature
// (fires on dismissTo/replace); the banner is noise until the library updates.
LogBox.ignoreLogs(["Passing an object as the argument to 'navigate' is deprecated"]);

const ANDROID_EDGE_TO_EDGE_MIN_VERSION = 30;
const IS_ANDROID_EDGE_TO_EDGE = Platform.OS === "android" && Number(Platform.Version) >= ANDROID_EDGE_TO_EDGE_MIN_VERSION;

function AuthenticatedSurfaceHosts() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const profile = useSessionStore((state) => state.profile);
  if (!isReady || !isAuthenticated || !isProfileComplete(profile)) return null;
  return <PostCommentsSheetHost />;
}

function RootLayout() {
  const [fontsLoaded] = useWitohFonts();
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
    <GestureHandlerRootView style={{ backgroundColor: themeColors.bg, flex: 1 }}>
    <AppProviders>
      <KeyboardProvider
        navigationBarTranslucent={IS_ANDROID_EDGE_TO_EDGE}
        preserveEdgeToEdge={IS_ANDROID_EDGE_TO_EDGE}
        statusBarTranslucent={IS_ANDROID_EDGE_TO_EDGE}
      >
        <StatusBar
          backgroundColor="transparent"
          hidden={false}
          style={resolvedTheme === "light" ? "dark" : "light"}
          translucent={IS_ANDROID_EDGE_TO_EDGE}
        />
        <ThemeProvider value={navigationTheme}>
          <AuthGate />
          {/* In-tree overlay host for post comments: must live in the main
              window (not a RN Modal) so the composer can track the keyboard
              per-frame via the root KeyboardProvider. */}
          <AuthenticatedSurfaceHosts />
        </ThemeProvider>
      </KeyboardProvider>
    </AppProviders>
    </GestureHandlerRootView>
  );
}

export default wrapRootLayout(RootLayout);
