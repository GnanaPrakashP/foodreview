import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MemoryInput } from "@/components/memories/MemoryInput";
import type { AsyncState } from "@/components/memories/types";
import { colors, fontStyles, radius, spacing } from "@/theme";
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
          <Ionicons name="send" size={18} color={colors.dark.white} />
        </Pressable>
      </View>
      {mutation.isError ? <Text style={styles.error}>{mutation.errorMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md
  },
  sectionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 17
  },
  messages: {
    gap: spacing.sm
  },
  message: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
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
    color: colors.dark.orange,
    fontSize: 12
  },
  messageTime: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 11
  },
  messageBody: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    fontSize: 14,
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
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  emptyInline: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 19
  },
  error: {
    ...fontStyles.regular,
    color: colors.dark.dangerSoft,
    fontSize: 13,
    lineHeight: 19
  }
});
