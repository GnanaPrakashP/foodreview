import { Stack } from "expo-router";
import { colors } from "@/theme";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.dark.bg },
        headerTintColor: colors.dark.cream,
        contentStyle: { backgroundColor: colors.dark.bg }
      }}
    />
  );
}
