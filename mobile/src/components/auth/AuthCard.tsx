import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";

export function AuthCard({ children }: { children: ReactNode }) {
  const { themeColors } = useThemePreference();
  return <View style={[styles.card, { backgroundColor: themeColors.authCard, borderColor: themeColors.authBorder }]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    borderRadius: 28,
    borderWidth: 1,
    maxWidth: 400,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: "100%"
  }
});
