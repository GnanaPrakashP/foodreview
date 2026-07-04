import { useLocalSearchParams, useRouter } from "expo-router";
import { PenLine } from "lucide-react-native";
import { type ReactNode, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MemoryDateField } from "@/components/memories/MemoryDateField";
import { MemoryInput } from "@/components/memories/MemoryInput";
import { MemoryParticipantsField } from "@/components/memories/MemoryParticipantsField";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { getOccasionTheme } from "@/features/occasions/occasionThemes";
import type { OccasionType } from "@/features/occasions/occasionTypes";
import { useCreateMemoryRoomMutation } from "@/hooks/useMemories";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, screenLayout, spacing } from "@/theme";

const DEFAULT_MEMORY_OCCASION_TITLE = "Occasion";
const DEFAULT_MEMORY_OCCASION_TYPE: OccasionType = "casual";

export default function CreateMemoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sourcePostId?: string;
    restaurantName?: string;
    area?: string;
  }>();
  const createRoom = useCreateMemoryRoomMutation();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [mode, setMode] = useState<"manual" | "post">(params.sourcePostId ? "post" : "manual");
  const [restaurantName, setRestaurantName] = useState(params.restaurantName ?? "");
  const [area, setArea] = useState(params.area ?? "");
  const [occasionTitle, setOccasionTitle] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [sourcePostId, setSourcePostId] = useState(params.sourcePostId ?? "");
  const [participants, setParticipants] = useState<string[]>([]);
  const fromPost = mode === "post";
  const fromPostDeepLink = Boolean(params.sourcePostId);

  async function submit() {
    try {
      const result = await createRoom.mutateAsync({
        restaurantName,
        area,
        occasion: occasionTitle.trim() || DEFAULT_MEMORY_OCCASION_TITLE,
        occasionConfidence: 1,
        occasionConfirmedByUser: true,
        occasionType: DEFAULT_MEMORY_OCCASION_TYPE,
        themeKey: getOccasionTheme(DEFAULT_MEMORY_OCCASION_TYPE).id,
        visitDate,
        sourcePostId: fromPost ? sourcePostId : undefined,
        participantUsernames: participants
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
          <MemoryRouteHeader kicker="Create" onBack={() => router.back()} themeColors={themeColors} title="Table Memory" />

          {__DEV__ ? (
            <View style={styles.segmentRow}>
              <SegmentButton active={mode === "manual"} label="Manual" onPress={() => setMode("manual")} styles={styles} />
              <SegmentButton active={mode === "post"} label="From post" onPress={() => setMode("post")} styles={styles} />
            </View>
          ) : null}

          {fromPostDeepLink ? (
            <View style={styles.postNote}>
              <Text style={styles.postNoteText}>Creating this table memory from your post.</Text>
            </View>
          ) : null}

          {fromPost && !fromPostDeepLink && __DEV__ ? (
            <Field label="Source post" styles={styles}>
              <MemoryInput autoCapitalize="none" onChangeText={setSourcePostId} placeholder="Source post UUID" value={sourcePostId} />
            </Field>
          ) : null}

          <Field label="Memory" styles={styles}>
            <CreateOccasionPicker
              colors={themeColors}
              onTitleChange={setOccasionTitle}
              styles={styles}
              titleValue={occasionTitle}
            />
          </Field>

          <Field label="Restaurant" styles={styles}>
            <MemoryInput
              onChangeText={setRestaurantName}
              placeholder={mode === "post" ? "Restaurant name override (optional)" : "Restaurant name"}
              value={restaurantName}
            />
          </Field>

          <Field label="Area" styles={styles}>
            <MemoryInput onChangeText={setArea} placeholder="Neighborhood or city" value={area} />
          </Field>

          <Field label="Visit date" styles={styles}>
            <MemoryDateField colors={themeColors} onChange={setVisitDate} value={visitDate} />
          </Field>

          <Field label="Guests" styles={styles}>
            <MemoryParticipantsField colors={themeColors} onChange={setParticipants} value={participants} />
          </Field>

          {createRoom.isError ? <Text style={styles.error}>{createRoom.error.message}</Text> : null}

          <View style={styles.footer}>
            <Pressable disabled={createRoom.isPending} onPress={submit} style={[styles.button, createRoom.isPending && styles.buttonDisabled]}>
              <Text style={styles.buttonText}>{createRoom.isPending ? "Creating..." : "Create table memory"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function CreateOccasionPicker({
  colors,
  onTitleChange,
  styles,
  titleValue
}: {
  colors: ReturnType<typeof themeColorsFor>;
  onTitleChange: (value: string) => void;
  styles: ReturnType<typeof createStyles>;
  titleValue: string;
}) {
  return (
    <View style={styles.occasionPicker}>
      <View style={styles.occasionTitleRow}>
        <PenLine size={20} color={colors.orange} strokeWidth={1.9} />
        <TextInput
          onChangeText={onTitleChange}
          placeholder="Occasion name"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          style={styles.occasionTitleInput}
          value={titleValue}
        />
      </View>
    </View>
  );
}

function Field({
  children,
  label,
  styles
}: {
  children: ReactNode;
  label: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
  styles
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.segment, active && styles.segmentActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    keyboard: {
      flex: 1
    },
    content: {
      gap: screenLayout.headerContentGap,
      padding: spacing.lg,
      paddingBottom: 110,
      paddingTop: screenLayout.topGap
    },
    fieldGroup: {
      gap: spacing.sm
    },
    fieldLabel: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 12,
      letterSpacing: 0.6,
      textTransform: "uppercase"
    },
    postNote: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.card,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    postNoteText: {
      ...fontStyles.medium,
      color: c.cream,
      fontSize: 13,
      lineHeight: 18
    },
    footer: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      marginTop: spacing.sm,
      paddingTop: spacing.base
    },
    segmentRow: {
      flexDirection: "row",
      gap: spacing.sm
    },
    segment: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.input,
      borderWidth: 1,
      flex: 1,
      paddingVertical: 13
    },
    segmentActive: {
      backgroundColor: c.orangeDim,
      borderColor: c.orange
    },
    segmentText: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 14
    },
    segmentTextActive: {
      color: c.orange
    },
    error: {
      ...fontStyles.regular,
      color: c.dangerSoft,
      fontSize: 13,
      lineHeight: 19
    },
    occasionPicker: {
      gap: spacing.sm,
      paddingTop: 2
    },
    occasionTitleRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: spacing.s,
      paddingHorizontal: 0,
      paddingVertical: 14
    },
    occasionTitleInput: {
      ...fontStyles.bold,
      color: c.cream,
      flex: 1,
      fontSize: 14,
      minWidth: 0,
      padding: 0
    },
    occasionPickerContent: {
      gap: spacing.md,
      paddingRight: 2
    },
    occasionChoice: {
      alignItems: "center",
      gap: 7,
      width: 62
    },
    occasionIconButton: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: 29,
      borderWidth: 1,
      height: 58,
      justifyContent: "center",
      width: 58
    },
    occasionIconButtonActive: {
      borderWidth: 2
    },
    occasionChoiceLabel: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16,
      maxWidth: 62,
      textAlign: "center"
    },
    button: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: radius.input,
      justifyContent: "center",
      minHeight: 52
    },
    buttonDisabled: {
      opacity: 0.7
    },
    buttonText: {
      ...fontStyles.extraBold,
      color: c.white,
      fontSize: 15
    }
  });
}
