import { useLocalSearchParams, useRouter } from "expo-router";
import { Briefcase, Heart, MoreHorizontal, Users, Utensils, type LucideIcon } from "lucide-react-native";
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
import { fontStyles, radius, spacing } from "@/theme";

type CreateOccasionOption = {
  accent: string;
  accentBackground: string;
  Icon: LucideIcon;
  label: string;
  title: string;
  type: OccasionType;
};

const CREATE_OCCASION_OPTIONS: CreateOccasionOption[] = [
  {
    accent: "#B66DFF",
    accentBackground: "rgba(182, 109, 255, 0.16)",
    Icon: Utensils,
    label: "Food",
    title: "Food",
    type: "casual"
  },
  {
    accent: "#FF7AAD",
    accentBackground: "rgba(255, 122, 173, 0.16)",
    Icon: Heart,
    label: "Date",
    title: "Date night",
    type: "date_night"
  },
  {
    accent: "#39D4C5",
    accentBackground: "rgba(57, 212, 197, 0.14)",
    Icon: Users,
    label: "Friends",
    title: "Friends",
    type: "friends_hangout"
  },
  {
    accent: "#FFBB4D",
    accentBackground: "rgba(255, 187, 77, 0.15)",
    Icon: Briefcase,
    label: "Work",
    title: "Work meal",
    type: "work_meal"
  },
  {
    accent: "#AFA7A0",
    accentBackground: "rgba(245, 237, 216, 0.10)",
    Icon: MoreHorizontal,
    label: "Other",
    title: "Other",
    type: "unknown"
  }
];

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
  const [selectedOccasionType, setSelectedOccasionType] = useState<OccasionType>("casual");
  const [visitDate, setVisitDate] = useState("");
  const [sourcePostId, setSourcePostId] = useState(params.sourcePostId ?? "");
  const [participants, setParticipants] = useState<string[]>([]);
  const fromPost = mode === "post";
  const fromPostDeepLink = Boolean(params.sourcePostId);
  const selectedOccasion = CREATE_OCCASION_OPTIONS.find((option) => option.type === selectedOccasionType) ?? CREATE_OCCASION_OPTIONS[0];

  async function submit() {
    try {
      const result = await createRoom.mutateAsync({
        restaurantName,
        area,
        occasion: occasionTitle.trim() || selectedOccasion.title,
        occasionConfidence: 1,
        occasionConfirmedByUser: true,
        occasionType: selectedOccasion.type,
        themeKey: getOccasionTheme(selectedOccasion.type).id,
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
              onSelect={setSelectedOccasionType}
              onTitleChange={setOccasionTitle}
              selectedType={selectedOccasionType}
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
  onSelect,
  onTitleChange,
  selectedType,
  styles,
  titleValue
}: {
  colors: ReturnType<typeof themeColorsFor>;
  onSelect: (type: OccasionType) => void;
  onTitleChange: (value: string) => void;
  selectedType: OccasionType;
  styles: ReturnType<typeof createStyles>;
  titleValue: string;
}) {
  const selectedOption = CREATE_OCCASION_OPTIONS.find((option) => option.type === selectedType) ?? CREATE_OCCASION_OPTIONS[0];
  const SelectedIcon = selectedOption.Icon;

  return (
    <View style={styles.occasionPicker}>
      <View style={styles.occasionTitleRow}>
        <SelectedIcon size={20} color={selectedOption.accent} strokeWidth={1.9} />
        <TextInput
          onChangeText={onTitleChange}
          placeholder="Name this memory"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          style={styles.occasionTitleInput}
          value={titleValue}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.occasionPickerContent}
      >
        {CREATE_OCCASION_OPTIONS.map((option) => (
          <CreateOccasionButton
            active={selectedType === option.type}
            colors={colors}
            key={option.type}
            onPress={() => onSelect(option.type)}
            option={option}
            styles={styles}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function CreateOccasionButton({
  active,
  colors,
  onPress,
  option,
  styles
}: {
  active: boolean;
  colors: ReturnType<typeof themeColorsFor>;
  onPress: () => void;
  option: CreateOccasionOption;
  styles: ReturnType<typeof createStyles>;
}) {
  const Icon = option.Icon;
  const iconColor = active ? option.accent : colors.muted;

  return (
    <Pressable
      accessibilityLabel={option.label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.occasionChoice}
    >
      <View
        style={[
          styles.occasionIconButton,
          active && styles.occasionIconButtonActive,
          active && {
            backgroundColor: option.accentBackground,
            borderColor: option.accent
          }
        ]}
      >
        <Icon color={iconColor} size={26} strokeWidth={active ? 2.4 : 2} />
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.86}
        numberOfLines={1}
        style={[
          styles.occasionChoiceLabel,
          active && {
            color: option.accent
          }
        ]}
      >
        {option.label}
      </Text>
    </Pressable>
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
      gap: spacing.base,
      padding: spacing.lg,
      paddingBottom: 110
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
