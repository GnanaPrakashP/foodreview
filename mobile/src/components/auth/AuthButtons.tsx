import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
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
  variant?: "primary" | "secondary";
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
      icon={<GoogleMark />}
      label="Continue with Google"
      loading={loading}
      onPress={onPress}
      variant="primary"
    />
  );
}

function GoogleMark() {
  return (
    <Svg height={20} viewBox="0 0 24 24" width={20}>
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C4 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 4 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </Svg>
  );
}

export function EmailAuthButton({ disabled, loading, onPress }: Omit<AuthButtonProps, "children">) {
  return (
    <AuthMethodButton
      disabled={disabled}
      icon={<Ionicons name="mail-sharp" size={20} color={colors.dark.orange} />}
      label="Continue with Email"
      loading={loading}
      onPress={onPress}
    />
  );
}

export function AuthMethodButton({
  disabled,
  icon,
  label,
  loading,
  onPress,
  variant = "secondary"
}: AuthMethodButtonProps) {
  const isPrimary = variant === "primary";

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.methodButton,
        isPrimary && styles.methodButtonPrimary,
        (disabled || loading) && styles.buttonDisabled
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.dark.bg : colors.dark.cream} />
      ) : (
        <>
          <View style={styles.methodIcon}>{icon}</View>
          <Text style={[styles.methodButtonText, isPrimary && styles.methodButtonTextPrimary]}>{label}</Text>
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
    backgroundColor: "rgba(245, 237, 216, 0.06)",
    borderColor: "rgba(245, 237, 216, 0.18)",
    borderRadius: 16,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: 15,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 13
  },
  methodButtonPrimary: {
    backgroundColor: colors.dark.white,
    borderColor: "rgba(255, 255, 255, 0.92)",
    shadowColor: "#000",
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 20
  },
  methodIcon: {
    alignItems: "center",
    justifyContent: "center"
  },
  methodButtonText: {
    ...fontStyles.bold,
    color: colors.dark.white,
    fontSize: 16,
    textAlign: "center"
  },
  methodButtonTextPrimary: {
    color: "#1F2933"
  },
  buttonDisabled: {
    opacity: 0.72
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginVertical: spacing.md
  },
  dividerLine: {
    backgroundColor: "rgba(245, 237, 216, 0.16)",
    flex: 1,
    height: 1
  },
  dividerText: {
    ...fontStyles.semiBold,
    color: "rgba(245, 237, 216, 0.55)",
    fontSize: 12,
    textTransform: "uppercase"
  }
});
