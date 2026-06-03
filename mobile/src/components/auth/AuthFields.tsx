import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";

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
  return (
    <View style={[styles.inputWrap, error && styles.inputWrapError]}>
      <Ionicons name={icon} size={16} color={colors.dark.muted} />
      <TextInput
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.dark.muted}
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
  return (
    <View style={[styles.inputWrap, error && styles.inputWrapError]}>
      <Ionicons name="lock-closed-outline" size={16} color={colors.dark.muted} />
      <TextInput
        autoCapitalize="none"
        autoComplete="password"
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.dark.muted}
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

const styles = StyleSheet.create({
  inputWrap: {
    alignItems: "center",
    backgroundColor: colors.dark.authField,
    borderColor: colors.dark.authBorder,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.s,
    marginBottom: spacing.s,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  inputWrapError: {
    borderColor: colors.dark.danger
  },
  input: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 15,
    minWidth: 0,
    outlineColor: "transparent",
    outlineWidth: 0,
    padding: 0
  },
  toggleText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    letterSpacing: 0.3,
    lineHeight: 14
  }
});
