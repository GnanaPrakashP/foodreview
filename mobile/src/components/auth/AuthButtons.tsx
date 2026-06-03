import { AntDesign, Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";

type AuthButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
};

type AuthMethodButtonProps = {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
};

export function AuthButton({ children, disabled, loading, onPress }: AuthButtonProps) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.orangeButton, (disabled || loading) && styles.orangeButtonDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={colors.dark.white} />
      ) : (
        <Text style={[styles.orangeButtonText, disabled && styles.orangeButtonTextDisabled]}>{children}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.ghostButton}>
      <Text style={styles.ghostButtonText}>{children}</Text>
    </Pressable>
  );
}

export function GoogleAuthButton({ disabled, loading, onPress }: Omit<AuthButtonProps, "children">) {
  return (
    <AuthMethodButton
      disabled={disabled}
      icon={<AntDesign name="google" size={20} color="#4285F4" />}
      label="Continue with Google"
      loading={loading}
      onPress={onPress}
    />
  );
}

export function EmailAuthButton({ disabled, loading, onPress }: Omit<AuthButtonProps, "children">) {
  return (
    <AuthMethodButton
      disabled={disabled}
      icon={<Ionicons name="mail-outline" size={22} color={colors.dark.cream} />}
      label="Continue with Email"
      loading={loading}
      onPress={onPress}
    />
  );
}

export function AuthMethodButton({ disabled, icon, label, loading, onPress }: AuthMethodButtonProps) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.methodButton, (disabled || loading) && styles.buttonDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={colors.dark.cream} />
      ) : (
        <>
          <View style={styles.methodIcon}>{icon}</View>
          <Text style={styles.methodButtonText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function AuthDivider() {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>or</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  orangeButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    justifyContent: "center",
    marginTop: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.base,
    paddingVertical: 14
  },
  orangeButtonDisabled: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderWidth: 1
  },
  orangeButtonText: {
    ...fontStyles.bold,
    color: colors.dark.white,
    fontSize: 15,
    letterSpacing: 0.2
  },
  orangeButtonTextDisabled: {
    color: colors.dark.muted
  },
  ghostButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: colors.dark.authBorder,
    borderRadius: radius.input,
    borderWidth: 1.5,
    justifyContent: "center",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md
  },
  ghostButtonText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 14
  },
  methodButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: colors.dark.authBorder,
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "flex-start",
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 13
  },
  methodIcon: {
    alignItems: "center",
    width: 34
  },
  methodButtonText: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 16,
    textAlign: "center"
  },
  buttonDisabled: {
    opacity: 0.72
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginVertical: spacing.base
  },
  dividerLine: {
    backgroundColor: colors.dark.authDivider,
    flex: 1,
    height: 1
  },
  dividerText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    textTransform: "uppercase"
  }
});
