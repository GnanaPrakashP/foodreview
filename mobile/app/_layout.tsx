import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { AppProviders } from "@/providers/AppProviders";
import { colors, useCircleBitesFonts } from "@/theme";

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
        </Stack>
      </KeyboardProvider>
    </AppProviders>
  );
}
