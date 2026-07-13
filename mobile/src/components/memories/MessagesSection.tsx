import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MemoryInput } from "@/components/memories/MemoryInput";
import type { AsyncState } from "@/components/memories/types";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryMessage } from "@/types/models";
import { formatDisplayTime } from "@/utils/datetime";

export function MessagesSection({
  messages,
  mutation,
  onChange,
  onSubmit,
  value
}: {
  messages: MemoryMessage[];
  mutation: AsyncState;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Messages</Text>
      <View style={styles.messages}>
        {messages.length > 0 ? messages.map((item) => (
          <View key={item.id} style={styles.message}>
            <View style={styles.messageHeader}>
              <Text style={styles.messageAuthor}>{item.authorDisplayName}</Text>
              <Text style={styles.messageTime}>{formatDisplayTime(item.createdAt)}</Text>
            </View>
            <Text style={styles.messageBody}>{item.body}</Text>
          </View>
        )) : <Text style={styles.emptyInline}>No messages yet.</Text>}
      </View>
      <View style={styles.messageForm}>
        <MemoryInput multiline onChangeText={onChange} placeholder="Message this memory..." surface="field" value={value} />
        <Pressable disabled={mutation.isPending} onPress={onSubmit} style={styles.sendButton}>
          <Ionicons name="send" size={18} color={themeColors.white} />
        </Pressable>
      </View>
      {mutation.isError ? <Text style={styles.error}>{mutation.errorMessage}</Text> : null}
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    section: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: spacing.md,
      padding: spacing.md
    },
    sectionTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.section
    },
    messages: {
      gap: spacing.sm
    },
    message: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.input,
      borderWidth: 1,
      padding: spacing.md
    },
    messageHeader: {
      flexDirection: "row",
      gap: spacing.md,
      justifyContent: "space-between"
    },
    messageAuthor: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: typography.caption
    },
    messageTime: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: typography.eyebrow
    },
    messageBody: {
      ...fontStyles.medium,
      color: c.cream,
      fontSize: typography.body,
      lineHeight: 20,
      marginTop: 6
    },
    messageForm: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: spacing.sm
    },
    sendButton: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: radius.input,
      height: 48,
      justifyContent: "center",
      width: 48
    },
    emptyInline: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: typography.caption,
      lineHeight: 19
    },
    error: {
      ...fontStyles.regular,
      color: c.dangerSoft,
      fontSize: typography.caption,
      lineHeight: 19
    }
  });
}
