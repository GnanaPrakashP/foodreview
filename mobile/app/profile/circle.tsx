import { Users } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMyCircleQuery, useRemoveCircleMemberMutation } from "@/hooks/useCircle";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

function accountTypeLabel(value: "private" | "public") {
  return value === "public" ? "Public account" : "Private account";
}

function initialsForName(displayName: string, username: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || username.slice(0, 2).toUpperCase();
}

export default function ProfileCircleScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const circle = useMyCircleQuery();
  const removeMember = useRemoveCircleMemberMutation();
  const members = circle.data?.members ?? [];

  function confirmRemove(username: string, displayName: string) {
    if (removeMember.isPending) return;
    Alert.alert("Remove from circle?", `Do you want to remove ${displayName || username} from your circle?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await removeMember.mutateAsync(username);
          } catch (error) {
            Alert.alert("Could not remove member", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  return (
    <Screen padded={false} scroll>
      <View style={styles.content}>
        <MemoryRouteHeader
          kicker="Profile"
          onBack={() => router.back()}
          subtitle={circle.data ? `${accountTypeLabel(circle.data.accountType)} · ${members.length} ${members.length === 1 ? "person" : "people"}` : undefined}
          themeColors={themeColors}
          title="My Circle"
        />

        {circle.isLoading ? (
          <LoadingState message="Fetching your circle." title="Loading circle" />
        ) : circle.isError ? (
          <ErrorState
            actionLabel="Try again"
            message={circle.error.message}
            onAction={() => circle.refetch()}
            title="Circle unavailable"
          />
        ) : members.length === 0 ? (
          <EmptyState
            icon="people-outline"
            message={circle.data?.accountType === "public" ? "No one has joined your circle yet." : "Add friends to build your circle."}
            title="Your circle is empty"
          />
        ) : (
          <View style={styles.memberList}>
            {members.map((member) => (
              <View key={member.username} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>{initialsForName(member.displayName, member.username)}</Text>
                </View>
                <View style={styles.memberCopy}>
                  <Text numberOfLines={1} style={styles.memberName}>{member.displayName}</Text>
                  <Text numberOfLines={1} style={styles.memberHandle}>@{member.username}</Text>
                </View>
                <View style={styles.memberPlaces}>
                  <Users size={13} color={themeColors.orange} strokeWidth={2.2} />
                  <Text style={styles.memberPlacesText}>
                    {member.placeCount} place{member.placeCount === 1 ? "" : "s"}
                  </Text>
                </View>
                <Pressable
                  disabled={removeMember.isPending}
                  onPress={() => confirmRemove(member.username, member.displayName)}
                  style={[styles.removeButton, removeMember.isPending && styles.removeButtonDisabled]}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    content: {
      gap: spacing.lg,
      padding: spacing.lg
    },
    memberList: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      overflow: "hidden"
    },
    memberRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: spacing.md,
      minHeight: 72,
      paddingHorizontal: spacing.md,
      paddingVertical: 12
    },
    memberAvatar: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: 19,
      height: 38,
      justifyContent: "center",
      width: 38
    },
    memberAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 12,
      lineHeight: 14
    },
    memberCopy: {
      flex: 1,
      minWidth: 0
    },
    memberName: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 15,
      lineHeight: 19
    },
    memberHandle: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 3
    },
    memberPlaces: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexDirection: "row",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 6
    },
    memberPlacesText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 11,
      lineHeight: 13
    },
    removeButton: {
      alignItems: "center",
      backgroundColor: c.dangerDim,
      borderColor: c.dangerBorder,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: "center",
      paddingHorizontal: 10,
      paddingVertical: 7
    },
    removeButtonDisabled: {
      opacity: 0.6
    },
    removeButtonText: {
      ...fontStyles.extraBold,
      color: c.dangerSoft,
      fontSize: 11,
      lineHeight: 13
    }
  });
}
