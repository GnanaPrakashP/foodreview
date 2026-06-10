import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { colors, fontStyles, spacing } from "@/theme";

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
    body: "Questions? Email us at hello@foodcircle.app"
  }
];

export default function TermsOfServiceScreen() {
  const router = useRouter();

  return (
    <Screen padded={false} scroll style={{ gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="Terms of Service" titleWeight="regular" subtitle="Last updated: May 2025" />
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
