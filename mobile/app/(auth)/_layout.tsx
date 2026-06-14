import { Stack } from "expo-router";
import { useThemePreference } from "@/hooks/useThemePreference";

export default function AuthLayout() {
  const { themeColors } = useThemePreference();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.cream,
        contentStyle: { backgroundColor: themeColors.bg }
      }}
    />
  );
}
