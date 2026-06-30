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
    title: "Using CircleBites",
    body: "CircleBites is a private food journal for you and your friends. You must be 13 or older to use the app. You are responsible for the content you post."
  },
  {
    title: "Your content",
    body: "You own what you post. By sharing a review you grant CircleBites a licence to display it to your circle. We will never use your content for advertising without your consent."
  },
  {
    title: "Acceptable use",
    body: "Do not post spam, false information, or content that harms others. We reserve the right to remove content or suspend accounts that violate these terms."
  },
  {
    title: "Contact",
    body: "Questions? Email us at hello@circlebites.app"
  }
];

export default function TermsOfServiceScreen() {
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
      title="Terms of Service"
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
