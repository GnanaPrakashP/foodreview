import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MemoryInput } from "@/components/memories/MemoryInput";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCreateMemoryRoomMutation } from "@/hooks/useMemories";
import { colors, fontStyles, radius, spacing } from "@/theme";

function splitUsernames(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function CreateMemoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sourcePostId?: string;
    restaurantName?: string;
    area?: string;
  }>();
  const createRoom = useCreateMemoryRoomMutation();
  const [mode, setMode] = useState<"manual" | "post">(params.sourcePostId ? "post" : "manual");
  const [restaurantName, setRestaurantName] = useState(params.restaurantName ?? "");
  const [area, setArea] = useState(params.area ?? "");
  const [visitDate, setVisitDate] = useState("");
  const [sourcePostId, setSourcePostId] = useState(params.sourcePostId ?? "");
  const [participants, setParticipants] = useState("");

  async function submit() {
    try {
      const result = await createRoom.mutateAsync({
        restaurantName,
        area,
        visitDate,
        sourcePostId: mode === "post" ? sourcePostId : undefined,
        participantUsernames: splitUsernames(participants)
      });
      router.replace({ pathname: "/memories/[id]", params: { id: result.id } });
    } catch {
      // Rendered from mutation state.
    }
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <MemoryRouteHeader kicker="Create" onBack={() => router.back()} title="Table Memory" />

          <View style={styles.segmentRow}>
            <SegmentButton active={mode === "manual"} label="Manual" onPress={() => setMode("manual")} />
            <SegmentButton active={mode === "post"} label="From post" onPress={() => setMode("post")} />
          </View>

          {mode === "post" ? (
            <MemoryInput
              autoCapitalize="none"
              onChangeText={setSourcePostId}
              placeholder="Source post UUID"
              value={sourcePostId}
            />
          ) : null}

          <MemoryInput
            onChangeText={setRestaurantName}
            placeholder={mode === "post" ? "Restaurant name override (optional)" : "Restaurant name"}
            value={restaurantName}
          />
          <MemoryInput onChangeText={setArea} placeholder="Area or location" value={area} />
          <MemoryInput onChangeText={setVisitDate} placeholder="Visit date, e.g. 2026-06-03" value={visitDate} />
          <MemoryInput
            autoCapitalize="none"
            multiline
            onChangeText={setParticipants}
            placeholder="Friends by username, comma separated"
            tall
            value={participants}
          />

          {createRoom.isError ? <Text style={styles.error}>{createRoom.error.message}</Text> : null}

          <Pressable disabled={createRoom.isPending} onPress={submit} style={[styles.button, createRoom.isPending && styles.buttonDisabled]}>
            <Text style={styles.buttonText}>{createRoom.isPending ? "Creating..." : "Create table memory"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active && styles.segmentActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: 110
  },
  segmentRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  segment: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 13
  },
  segmentActive: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orange
  },
  segmentText: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 14
  },
  segmentTextActive: {
    color: colors.dark.orange
  },
  error: {
    ...fontStyles.regular,
    color: colors.dark.dangerSoft,
    fontSize: 13,
    lineHeight: 19
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    justifyContent: "center",
    minHeight: 52
  },
  buttonDisabled: {
    opacity: 0.7
  },
  buttonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 15
  }
});
