import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

type AuthInputProps = {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: "email" | "password" | "name" | "username";
  error?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  keyboardType?: "default" | "email-address";
  maxLength?: number;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  placeholder: string;
  value: string;
  autoCorrect?: boolean;
  spellCheck?: boolean;
};

type OtpCodeInputProps = {
  error?: boolean;
  onChangeText: (value: string) => void;
  value: string;
};

export function AuthInput({
  autoCapitalize = "none",
  autoComplete,
  autoCorrect,
  error,
  icon,
  keyboardType = "default",
  maxLength,
  onChangeText,
  onFocus,
  placeholder,
  spellCheck,
  value
}: AuthInputProps) {
  const [focused, setFocused] = useState(false);
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={[styles.inputWrap, focused && styles.inputWrapFocused, error && styles.inputWrapError]}>
      <Ionicons name={icon} size={16} color={themeColors.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onChangeText={onChangeText}
        onBlur={() => setFocused(false)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={themeColors.muted}
        spellCheck={spellCheck}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

export function OtpCodeInput({ error, onChangeText, value }: OtpCodeInputProps) {
  const [focused, setFocused] = useState(false);
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const digits = value.replace(/\D/g, "").slice(0, 6);

  return (
    <View style={styles.otpWrap}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.otpBoxes}>
        {Array.from({ length: 6 }, (_, index) => (
          <View
            key={index}
            style={[
              styles.otpBox,
              focused && index === Math.min(digits.length, 5) && styles.otpBoxFocused,
              error && styles.otpBoxError
            ]}
          >
            <Text style={styles.otpDigit}>{digits[index] ?? ""}</Text>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Verification code"
        autoComplete="one-time-code"
        autoFocus
        caretHidden
        keyboardType="number-pad"
        maxLength={6}
        onBlur={() => setFocused(false)}
        onChangeText={(nextValue) => onChangeText(nextValue.replace(/\D/g, "").slice(0, 6))}
        onFocus={() => setFocused(true)}
        style={styles.otpHiddenInput}
        textContentType="oneTimeCode"
        value={digits}
      />
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
    otpWrap: {
      marginBottom: spacing.s,
      position: "relative"
    },
    otpBoxes: {
      flexDirection: "row",
      gap: 8,
      justifyContent: "space-between"
    },
    otpBox: {
      alignItems: "center",
      backgroundColor: c.authField,
      borderColor: c.authBorder,
      borderRadius: 12,
      borderWidth: 1,
      flex: 1,
      height: 54,
      justifyContent: "center",
      maxWidth: 50
    },
    otpBoxFocused: {
      borderColor: c.orangeBorder,
      borderWidth: 1.5
    },
    otpBoxError: {
      borderColor: c.danger
    },
    otpDigit: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 22,
      lineHeight: 26
    },
    otpHiddenInput: {
      bottom: 0,
      left: 0,
      opacity: 0.01,
      position: "absolute",
      right: 0,
      top: 0
    }
  });
}
