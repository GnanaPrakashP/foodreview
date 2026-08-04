import { useLocalSearchParams, useRouter } from "expo-router";
import { PenLine, Star, Utensils } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { MemoryComposerHeader } from "@/components/memories/MemoryComposerHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useAddMemoryDishMutation } from "@/hooks/useMemories";
import { requestMemoryRoomTab } from "@/services/memoryCaptureSession";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

export default function AddMemoryDishScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const roomId = typeof params.id === "string" ? params.id : "";
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const addDish = useAddMemoryDishMutation(roomId);
  const noteInputRef = useRef<TextInput>(null);
  const [dishName, setDishName] = useState("");
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(0);
  const canAdd = Boolean(roomId && dishName.trim()) && !addDish.isPending;

  const close = useCallback(() => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/memories/[id]", params: { id: roomId } });
  }, [roomId, router]);

  function submitDish() {
    if (!canAdd) return;
    // Fire and leave. The mutation writes the dish into the room before the
    // request goes out, so Chat already has the card when it appears; waiting
    // for the insert only held this screen open on "Adding…".
    addDish.mutateAsync({
      dishName: dishName.trim(),
      note: note.trim() || undefined,
      rating: rating || null
    }).catch((error) => {
      // This screen is gone by now, so the failure has to speak for itself. The
      // mutation has already rolled its optimistic card back out of the room.
      Alert.alert(
        "Could not add dish",
        error instanceof Error ? error.message : "Please try again."
      );
    });
    Keyboard.dismiss();
    // The dish lands in the chat as its own row, so that is where the room
    // must go — the same handoff media uses. A `tab` param cannot do this on
    // its own: the room is still mounted underneath and `back()` does not
    // remount it. The param below only covers a cold entry with nothing to
    // pop. See requestMemoryRoomTab.
    requestMemoryRoomTab(roomId, "chat");
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/memories/[id]", params: { id: roomId, tab: "chat" } });
  }

  return (
    <Screen padded={false} style={styles.screen}>
      <MemoryComposerHeader
        actionDisabled={!canAdd}
        actionLabel={addDish.isPending ? "Adding…" : "Add"}
        actionVariant="boxed"
        onAction={submitDish}
        onClose={close}
        showDivider={false}
        title=""
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.content}
      >
        <View style={styles.fieldLine}>
          <Utensils size={20} color={themeColors.orange} strokeWidth={1.9} />
          <TextInput
            autoCapitalize="words"
            autoFocus
            blurOnSubmit={false}
            editable={!addDish.isPending}
            onChangeText={setDishName}
            onSubmitEditing={() => noteInputRef.current?.focus()}
            placeholder="Dish name"
            placeholderTextColor={themeColors.muted}
            returnKeyType="next"
            style={styles.fieldInput}
            value={dishName}
          />
        </View>

        <View style={[styles.fieldLine, styles.noteLine]}>
          <PenLine size={18} color={themeColors.muted} strokeWidth={1.9} />
          <TextInput
            editable={!addDish.isPending}
            multiline
            onChangeText={setNote}
            placeholder="Note (optional)"
            placeholderTextColor={themeColors.muted}
            ref={noteInputRef}
            style={[styles.fieldInput, styles.noteInput]}
            textAlignVertical="top"
            value={note}
          />
        </View>

        <View style={styles.ratingLine}>
          <Text style={styles.ratingLabel}>{rating ? `${rating}/5` : "Rate dish"}</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                accessibilityLabel={`Rate ${star} out of 5`}
                accessibilityRole="button"
                accessibilityState={{ selected: star <= rating }}
                disabled={addDish.isPending}
                hitSlop={7}
                key={star}
                onPress={() => setRating(rating === star ? 0 : star)}
                style={styles.starButton}
              >
                <Star
                  color={themeColors.orange}
                  fill={star <= rating ? themeColors.orange : "transparent"}
                  size={22}
                  strokeWidth={1.8}
                />
              </Pressable>
            ))}
          </View>
        </View>

        {addDish.error ? <Text style={styles.error}>{addDish.error.message}</Text> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    screen: {
      paddingBottom: 0
    },
    content: {
      flex: 1,
      paddingHorizontal: spacing.lg
    },
    fieldLine: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: spacing.s,
      minHeight: 58,
      paddingVertical: 15
    },
    fieldInput: {
      ...fontStyles.bold,
      color: c.cream,
      flex: 1,
      fontSize: 15,
      minWidth: 0,
      padding: 0
    },
    noteLine: {
      alignItems: "flex-start"
    },
    noteInput: {
      minHeight: 72,
      paddingTop: 1
    },
    ratingLine: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 64
    },
    ratingLabel: {
      ...fontStyles.bold,
      color: c.muted,
      fontSize: 14
    },
    stars: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8
    },
    starButton: {
      alignItems: "center",
      height: 36,
      justifyContent: "center",
      width: 30
    },
    error: {
      ...fontStyles.semiBold,
      color: c.dangerSoft,
      fontSize: 13,
      paddingTop: spacing.md
    }
  });
}
