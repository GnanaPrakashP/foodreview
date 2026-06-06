import type { ReactNode } from "react";
import { Image } from "expo-image";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge, useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fontStyles, spacing } from "@/theme";

const logoSource = require("../../../assets/circlebites-logo.png");

type AuthShellProps = {
  children: ReactNode;
  contentHorizontalPadding?: number;
  contentTopPadding?: number;
  edges?: Edge[];
  showGlow?: boolean;
  showHero?: boolean;
};

export function AuthShell({
  children,
  contentHorizontalPadding,
  contentTopPadding,
  edges = ["top", "bottom"],
  showGlow = true,
  showHero = true
}: AuthShellProps) {
  const insets = useSafeAreaInsets();
  const topPadding = contentTopPadding ?? spacing.xl;
  const horizontalPadding = contentHorizontalPadding ?? spacing.lg;

  return (
    <SafeAreaView edges={edges} style={styles.shell}>
      {showGlow ? <View pointerEvents="none" style={styles.topGlow} /> : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        style={styles.keyboardView}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom: spacing.xxl + insets.bottom,
              paddingHorizontal: horizontalPadding,
              paddingTop: topPadding + insets.top
            }
          ]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {showHero ? <AuthHero /> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthHero() {
  return (
    <View style={styles.hero}>
      <View style={styles.logo}>
        <Image source={logoSource} style={styles.logoImage} contentFit="cover" />
      </View>
      <Text style={styles.wordmark}>CircleBites</Text>
      <Text style={styles.tagline}>What's your circle eating?</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.dark.bg,
    flex: 1
  },
  keyboardView: {
    flex: 1
  },
  topGlow: {
    alignSelf: "center",
    backgroundColor: colors.dark.orangeDim,
    borderBottomLeftRadius: 260,
    borderBottomRightRadius: 260,
    height: 210,
    opacity: 0.86,
    position: "absolute",
    top: 0,
    width: "130%"
  },
  content: {
    alignItems: "center",
    flexGrow: 1,
    gap: 24,
    justifyContent: "center"
  },
  hero: {
    alignItems: "center",
    maxWidth: 400,
    width: "100%"
  },
  logo: {
    alignItems: "center",
    height: 86,
    justifyContent: "center",
    marginBottom: 18,
    width: 86
  },
  logoImage: {
    borderRadius: 16,
    height: 72,
    width: 72
  },
  wordmark: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 34,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 6
  },
  tagline: {
    ...fontStyles.semiBoldItalic,
    color: colors.dark.orange,
    fontSize: 18,
    letterSpacing: 0.1,
    lineHeight: 23
  }
});
