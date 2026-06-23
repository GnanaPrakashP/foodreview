import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

const DAY_MS = 86_400_000;

function toISODate(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseISODate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function formatDisplay(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function relativeLabel(date: Date): "Today" | "Yesterday" | null {
  const diffDays = Math.round((startOfToday().getTime() - date.getTime()) / DAY_MS);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return null;
}

type MemoryDateFieldProps = {
  colors?: ReturnType<typeof themeColorsFor>;
  onChange: (isoDate: string) => void;
  value: string;
};

export function MemoryDateField({ colors: providedColors, onChange, value }: MemoryDateFieldProps) {
  const { themeColors: defaultColors, resolvedTheme } = useThemePreference();
  const colors = providedColors ?? defaultColors;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);

  const today = startOfToday();
  const selected = parseISODate(value);
  const relative = selected ? relativeLabel(selected) : null;

  function commit(date: Date) {
    onChange(toISODate(date));
  }

  function handleChange(event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === "android") {
      setShow(false);
      if (event.type === "set" && date) commit(date);
      return;
    }
    if (date) setDraft(date);
  }

  function openPicker() {
    setDraft(selected ?? today);
    setShow(true);
  }

  function confirmIOS() {
    if (draft) commit(draft);
    setShow(false);
  }

  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" onPress={openPicker} style={styles.field}>
        <Ionicons color={selected ? colors.orange : colors.muted} name="calendar-outline" size={18} />
        <Text numberOfLines={1} style={[styles.fieldText, !selected && styles.placeholder]}>
          {selected ? formatDisplay(selected) : "When did you go?"}
        </Text>
        <Ionicons color={colors.muted} name="chevron-down" size={16} />
      </Pressable>

      <View style={styles.chips}>
        <QuickChip active={relative === "Today"} label="Today" onPress={() => commit(today)} styles={styles} />
        <QuickChip
          active={relative === "Yesterday"}
          label="Yesterday"
          onPress={() => commit(new Date(today.getTime() - DAY_MS))}
          styles={styles}
        />
      </View>

      {Platform.OS === "android" && show ? (
        <DateTimePicker maximumDate={today} mode="date" onChange={handleChange} value={selected ?? today} />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal animationType="fade" onRequestClose={() => setShow(false)} transparent visible={show}>
          <Pressable onPress={() => setShow(false)} style={styles.backdrop}>
            <Pressable onPress={() => {}} style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Pressable hitSlop={8} onPress={() => setShow(false)}>
                  <Text style={styles.sheetCancel}>Cancel</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>Visit date</Text>
                <Pressable hitSlop={8} onPress={confirmIOS}>
                  <Text style={styles.sheetDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                display="spinner"
                maximumDate={today}
                mode="date"
                onChange={handleChange}
                textColor={colors.cream}
                themeVariant={resolvedTheme}
                value={draft ?? today}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

function QuickChip({
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
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.sm
    },
    field: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.s,
      paddingHorizontal: 14,
      paddingVertical: 13
    },
    fieldText: {
      ...fontStyles.medium,
      color: c.cream,
      flex: 1,
      fontSize: 15
    },
    placeholder: {
      color: c.muted
    },
    chips: {
      flexDirection: "row",
      gap: spacing.sm
    },
    chip: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: spacing.base,
      paddingVertical: 7
    },
    chipActive: {
      backgroundColor: c.orangeDim,
      borderColor: c.orange
    },
    chipText: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 13
    },
    chipTextActive: {
      color: c.orange
    },
    backdrop: {
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      flex: 1,
      justifyContent: "flex-end"
    },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      paddingBottom: spacing.xl
    },
    sheetHeader: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.md
    },
    sheetTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 15
    },
    sheetCancel: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 15
    },
    sheetDone: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 15
    }
  });
}
