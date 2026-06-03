import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "@/providers/AppProviders";
import { colors, useCircleBitesFonts } from "@/theme";

export default function RootLayout() {
  const [fontsLoaded] = useCircleBitesFonts();

  if (!fontsLoaded) return null;

  return (
    <AppProviders>
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
        <Stack.Screen name="onboarding/profile" />
      </Stack>
    </AppProviders>
  );
}
