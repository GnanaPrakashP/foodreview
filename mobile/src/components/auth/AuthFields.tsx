import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

type AuthInputProps = {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "email" | "password" | "name" | "username";
  error?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  keyboardType?: "default" | "email-address";
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  placeholder: string;
  value: string;
};

type PasswordInputProps = Omit<AuthInputProps, "autoComplete" | "icon" | "keyboardType"> & {
  show: boolean;
  onToggle: () => void;
};

export function AuthInput({
  autoCapitalize = "none",
  autoComplete,
  error,
  icon,
  keyboardType = "default",
  onChangeText,
  onFocus,
  placeholder,
  value
}: AuthInputProps) {
  const [focused, setFocused] = useState(false);
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={[styles.inputWrap, focused && styles.inputWrapFocused, error && styles.inputWrapError]}>
      <Ionicons name={icon} size={16} color={themeColors.muted} />
      <TextInput
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        onBlur={() => setFocused(false)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={themeColors.muted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

export function PasswordInput({
  error,
  onChangeText,
  onFocus,
  onToggle,
  placeholder,
  show,
  value
}: PasswordInputProps) {
  const [focused, setFocused] = useState(false);
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={[styles.inputWrap, focused && styles.inputWrapFocused, error && styles.inputWrapError]}>
      <Ionicons name="lock-closed-outline" size={16} color={themeColors.muted} />
      <TextInput
        autoCapitalize="none"
        autoComplete="password"
        onChangeText={onChangeText}
        onBlur={() => setFocused(false)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={themeColors.muted}
        secureTextEntry={!show}
        style={styles.input}
        value={value}
      />
      <Pressable hitSlop={8} onPress={onToggle}>
        <Text style={styles.toggleText}>{show ? "Hide" : "Show"}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    inputWrap: {
      alignItems: "center",
      backgroundColor: c.authField,
      borderColor: c.authBorder,
      borderRadius: radius.input,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.s,
      marginBottom: spacing.s,
      paddingHorizontal: 14,
      paddingVertical: 13
    },
    inputWrapFocused: {
      borderColor: c.orangeBorder
    },
    inputWrapError: {
      borderColor: c.danger
    },
    input: {
      ...fontStyles.medium,
      color: c.cream,
      flex: 1,
      fontSize: typography.body,
      minWidth: 0,
      outlineColor: "transparent",
      outlineWidth: 0,
      padding: 0
    },
    toggleText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: typography.caption,
      letterSpacing: 0.3,
      lineHeight: 14
    }
  });
}
