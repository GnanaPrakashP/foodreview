import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";

export function AuthCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    backgroundColor: colors.dark.authCard,
    borderColor: colors.dark.authBorder,
    borderRadius: 28,
    borderWidth: 1,
    maxWidth: 400,
    paddingHorizontal: 24,
    paddingVertical: 28,
    width: "100%"
  }
});
