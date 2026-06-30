import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

const LAST_UPDATED = "Last updated: June 2026";

const sections = [
  {
    title: "What we collect",
    body: "We collect your name, email address, and the food reviews you post. Photos you upload are stored securely. We do not sell your data to any third party."
  },
  {
    title: "How we use it",
    body: "Your data is used solely to power the CircleBites experience, showing your reviews to your circle and letting you discover what friends are eating."
  },
  {
    title: "Deleting your data",
    body: "You can delete your account at any time from settings. This permanently removes your profile and all your reviews from our systems."
  },
  {
    title: "Contact",
    body: "Questions? Email us at privacy@circlebites.app"
  }
];

export default function PrivacyPolicyScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <ProfileSubScreen
      contentGap={spacing.lg}
      onBack={close}
      slideStyle={slideStyle}
      subtitle={LAST_UPDATED}
      themeColors={themeColors}
      title="Privacy Policy"
    >
      <View style={styles.content}>
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.heading}>{section.title}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}
      </View>
    </ProfileSubScreen>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    content: {
      gap: spacing.lg
    },
    section: {
      gap: spacing.sm
    },
    heading: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: 15,
      lineHeight: 19
    },
    body: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 14,
      lineHeight: 22
    }
  });
}
