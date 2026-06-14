import { MapPin } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { SectionLabel } from "@/components/display";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { usePublicFeedQuery } from "@/hooks/useFeeds";
import { useThemePreference } from "@/hooks/useThemePreference";
import { spacing } from "@/theme";

export default function HungryScreen() {
  const feed = usePublicFeedQuery();
  const { themeColors } = useThemePreference();

  return (
    <Screen
      rightAccessory={<MapPin size={20} color={themeColors.cream} strokeWidth={2} />}
      scroll
      title="Hungry"
    >
      <View style={styles.stack}>
        <SectionLabel>Real public picks</SectionLabel>
        <PostFeed
          emptyMessage="When public food posts exist, Hungry will use them as the starting point for nearby decisions."
          emptyTitle="No hungry picks yet"
          errorMessage={feed.error?.message}
          isError={feed.isError}
          isLoading={feed.isLoading}
          onRetry={() => feed.refetch()}
          posts={feed.data?.posts}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md
  }
});
