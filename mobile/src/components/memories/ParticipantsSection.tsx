import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MemoryInput } from "@/components/memories/MemoryInput";
import type { AsyncState } from "@/components/memories/types";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { MemoryParticipant } from "@/types/models";

export function ParticipantsSection({
  onChange,
  onSubmit,
  participants,
  value,
  mutation
}: {
  onChange: (value: string) => void;
  onSubmit: () => void;
  participants: MemoryParticipant[];
  value: string;
  mutation: AsyncState;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Participants</Text>
      <View style={styles.peopleWrap}>
        {participants.map((item) => (
          <View key={item.id} style={styles.personChip}>
            <Text style={styles.personText}>@{item.username}</Text>
          </View>
        ))}
      </View>
      <View style={styles.inlineForm}>
        <MemoryInput autoCapitalize="none" onChangeText={onChange} placeholder="Add username" surface="field" value={value} />
        <Pressable disabled={mutation.isPending} onPress={onSubmit} style={styles.iconButton}>
          <Ionicons name="person-add-outline" size={18} color={colors.dark.white} />
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
  peopleWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  personChip: {
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.s,
    paddingVertical: 7
  },
  personText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 12
  },
  inlineForm: {
    flexDirection: "row",
    gap: spacing.sm
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    justifyContent: "center",
    width: 48
  },
  error: {
    ...fontStyles.regular,
    color: colors.dark.dangerSoft,
    fontSize: 13,
    lineHeight: 19
  }
});
