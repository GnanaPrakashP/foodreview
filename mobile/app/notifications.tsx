import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { spacing } from "@/theme";

export default function NotificationsScreen() {
  const router = useRouter();

  return (
    <Screen padded={false}>
      <View style={styles.content}>
        <MemoryRouteHeader kicker="Circle" onBack={() => router.back()} title="Notifications" />
        <EmptyState
          icon="notifications-outline"
          message="Likes, comments, and circle activity will appear here."
          title="No notifications yet"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg
  }
});
