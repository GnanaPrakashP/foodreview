import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

const LAST_UPDATED = "Last updated: July 14, 2026";

const sections = [
  {
    title: "Using CircleBites",
    body: "CircleBites lets people share food reviews and private Memories. You must be at least 13 and legally able to use the service. Keep your account secure and provide accurate registration information."
  },
  {
    title: "Your content",
    body: "You retain rights you have in your content. You grant CircleBites a limited licence to host, process, reproduce and display it only as needed to operate, secure and improve the service according to the visibility you select. You must have permission to upload the content."
  },
  {
    title: "Acceptable use",
    body: "Do not upload unlawful, infringing, deceptive, abusive or unsafe content; impersonate others; scrape the service; bypass access controls; or misuse reports, notifications or private rooms. We may restrict content or accounts to enforce these rules and protect users."
  },
  {
    title: "Moderation and reporting",
    body: "Users can report content and block accounts. Automated providers and authorised operators may review bounded content for safety. Decisions may be delayed, corrected or appealed through support; availability of a particular appeal route may depend on the decision and applicable law."
  },
  {
    title: "Service changes and availability",
    body: "Features may change and third-party services may be unavailable. We do not promise uninterrupted operation or that recommendations, restaurant details or user content are accurate. Use your own judgment for allergies, health and safety decisions."
  },
  {
    title: "Ending use",
    body: "You may stop using CircleBites or request account deletion in Settings. We may suspend access for serious or repeated violations. Content removal, operational retention and backup expiry follow the Privacy Policy."
  },
  {
    title: "Copyright and complaints",
    body: "Send copyright, safety or policy complaints with enough information to investigate to hello@circlebites.in. Do not send passwords, authentication tokens or unnecessary private content."
  },
  {
    title: "Contact",
    body: "Questions and support: hello@circlebites.in. Canonical terms: https://www.circlebites.in/terms. These terms require review by qualified counsel before store submission."
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
