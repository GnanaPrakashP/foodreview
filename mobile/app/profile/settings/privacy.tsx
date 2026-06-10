import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { colors, fontStyles, spacing } from "@/theme";

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
    body: "Questions? Email us at privacy@foodcircle.app"
  }
];

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <Screen padded={false} scroll style={{ gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="Privacy Policy" titleWeight="regular" subtitle="Last updated: May 2025" />
      <View style={styles.content}>
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.heading}>{section.title}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg
  },
  section: {
    gap: spacing.sm
  },
  heading: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 19
  },
  body: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: 14,
    lineHeight: 22
  }
});
