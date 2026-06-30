import { UserMinus } from "lucide-react-native";
import { useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { useMyCircleQuery, useRemoveCircleMemberMutation } from "@/hooks/useCircle";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

function initialsForName(displayName: string, username: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || username.slice(0, 2).toUpperCase();
}

export default function ProfileCircleScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: "/profile" });
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
    <ProfileSubScreen
      contentGap={spacing.sm}
      onBack={close}
      slideStyle={slideStyle}
      themeColors={themeColors}
      title="Circle"
      titleWeight="bold"
    >
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
        <View>
          {members.map((member) => (
            <View key={member.username} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberAvatarText}>{initialsForName(member.displayName, member.username)}</Text>
              </View>
              <View style={styles.memberCopy}>
                <Text numberOfLines={1} style={styles.memberName}>{member.displayName}</Text>
                <Text numberOfLines={1} style={styles.memberHandle}>@{member.username}</Text>
              </View>
              <Pressable
                accessibilityLabel={`Remove ${member.displayName || member.username} from circle`}
                accessibilityRole="button"
                disabled={removeMember.isPending}
                onPress={() => confirmRemove(member.username, member.displayName)}
                style={({ pressed }) => [
                  styles.removeButton,
                  pressed && styles.pressed,
                  removeMember.isPending && styles.removeButtonDisabled
                ]}
              >
                <UserMinus size={15} color={themeColors.dangerSoft} strokeWidth={2.2} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ProfileSubScreen>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    memberRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: spacing.md,
      minHeight: 76,
      paddingHorizontal: 2,
      paddingVertical: 0
    },
    memberAvatar: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: radius.pill,
      height: 42,
      justifyContent: "center",
      width: 42
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
    removeButton: {
      alignItems: "center",
      backgroundColor: c.dangerDim,
      borderColor: c.dangerBorder,
      borderRadius: radius.md,
      borderWidth: 1,
      height: 34,
      justifyContent: "center",
      width: 34
    },
    pressed: {
      opacity: 0.65
    },
    removeButtonDisabled: {
      opacity: 0.6
    }
  });
}
