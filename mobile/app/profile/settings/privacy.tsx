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
    title: "What we collect",
    body: "CircleBites processes account and profile details, email, posts, photos, short videos, dish and restaurant selections, optional location, Circle relationships, blocks and reports, private Memory participants/messages/media/voice notes, notification preferences and push tokens."
  },
  {
    title: "How we use it",
    body: "We use this data to authenticate you, provide public/private sharing, operate Memories, recommend food, deliver notifications, prevent abuse, moderate reported content, support users and keep the service reliable. We do not sell personal data."
  },
  {
    title: "Location and device permissions",
    body: "Location is optional and requested only when you choose nearby discovery. Camera, photo-library and microphone access is requested only when you use the related capture, upload or voice-message feature. Notification permission is optional."
  },
  {
    title: "Private sharing and local storage",
    body: "Circle and Just me media use access-controlled storage. Memories are available only to current room participants, subject to blocking and deletion rules. The app keeps owner-scoped caches, pending uploads and drafts on this device for offline use and recovery; they are excluded from app backup and cleared during account-ending transitions. Already downloaded system cache bytes and already issued short-lived links may remain briefly."
  },
  {
    title: "Service providers and diagnostics",
    body: "Supabase provides authentication, database and Storage services; Expo provides push delivery and build services; Sentry receives privacy-filtered crash and performance diagnostics; and restaurant, media-processing or moderation providers process bounded requests when those features are used. Telemetry excludes message bodies, review text, media paths, signed URLs, push tokens and account identifiers."
  },
  {
    title: "Retention, moderation and safety",
    body: "Active content remains until you delete it or your account, subject to moderation. Temporary uploads, operational records and local caches use bounded retention. Reports, security records and provider backups may remain for their documented retention period where needed for recovery, fraud prevention or legal obligations."
  },
  {
    title: "Deleting your data",
    body: "You can request deletion from Profile > Settings > Security & Account. The app signs you out after the request is accepted, and a retryable background process removes owned database records and media. Some safety records and encrypted provider backups may remain until their stated retention expires. Contact support if deletion remains pending."
  },
  {
    title: "Children and your choices",
    body: "CircleBites is not intended for children under 13. You may deny optional permissions, change notification settings, remove content, leave Memories, block accounts and request account deletion."
  },
  {
    title: "Contact",
    body: "Privacy questions: privacy@circlebites.in. Support and deletion help: hello@circlebites.in. Canonical policy: https://www.circlebites.in/privacy"
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
