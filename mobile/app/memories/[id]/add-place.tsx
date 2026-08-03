import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { MemoryComposerHeader } from "@/components/memories/MemoryComposerHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  useCreateMemoryStopMutation,
  useMemoryRoomQuery,
  useUpdateMemoryStopMutation
} from "@/hooks/useMemories";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import {
  autocompletePlaces,
  createPlacesSessionToken,
  type PlaceSuggestion
} from "@/services/places";
import { fontStyles, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

export default function AddMemoryPlaceScreen() {
  const params = useLocalSearchParams<{ id: string; stopId?: string }>();
  const router = useRouter();
  const roomId = typeof params.id === "string" ? params.id : "";
  const stopId = typeof params.stopId === "string" ? params.stopId : "";
  const editing = Boolean(stopId);
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const createStop = useCreateMemoryStopMutation(roomId);
  const updateStop = useUpdateMemoryStopMutation(roomId);
  const room = useMemoryRoomQuery(editing ? roomId : "");
  const canonicalStop = editing
    ? room.data?.stops.find((stop) => stop.id === stopId) ?? null
    : null;
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const sessionToken = useRef(createPlacesSessionToken());
  const hydratedStopId = useRef("");
  const originalPlace = useRef<PlaceSuggestion | null>(null);
  const pending = createStop.isPending || updateStop.isPending;

  useEffect(() => {
    if (!editing || !canonicalStop || hydratedStopId.current === canonicalStop.id) return;
    const initialPlace: PlaceSuggestion = {
      mainText: canonicalStop.name,
      placeId: canonicalStop.placeId ?? "",
      secondaryText: canonicalStop.note ?? "",
      text: [canonicalStop.name, canonicalStop.note].filter(Boolean).join(", ")
    };
    hydratedStopId.current = canonicalStop.id;
    originalPlace.current = initialPlace;
    setSelectedPlace(initialPlace);
    setQuery(initialPlace.mainText);
  }, [canonicalStop, editing]);

  useEffect(() => {
    const input = query.trim();
    if (input.length < 2 || (selectedPlace && input === selectedPlace.mainText)) {
      setSuggestions([]);
      setSearching(false);
      setSearchAttempted(false);
      setSearchError("");
      return undefined;
    }

    let alive = true;
    setSearching(true);
    setSearchAttempted(false);
    setSearchError("");
    const timeout = setTimeout(async () => {
      try {
        const nextSuggestions = await autocompletePlaces(input, sessionToken.current);
        if (!alive) return;
        setSuggestions(nextSuggestions);
        setSearchAttempted(true);
      } catch {
        if (!alive) return;
        setSuggestions([]);
        setSearchAttempted(true);
        setSearchError("Could not search places right now.");
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);

    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, [query, selectedPlace]);

  function selectPlace(suggestion: PlaceSuggestion) {
    if (pending) return;
    setSelectedPlace(suggestion);
    setQuery(suggestion.mainText);
    setSuggestions([]);
    setSearchAttempted(false);
    setSearchError("");
    Keyboard.dismiss();
  }

  const dirty = editing && originalPlace.current
    ? selectedPlace?.mainText.trim() !== originalPlace.current.mainText.trim() ||
      selectedPlace?.secondaryText.trim() !== originalPlace.current.secondaryText.trim() ||
      selectedPlace?.placeId !== originalPlace.current.placeId
    : Boolean(selectedPlace);
  const canAdd = Boolean(roomId && selectedPlace && (!editing || dirty)) && !pending;

  async function addPlace() {
    if (!canAdd || !selectedPlace) return;
    try {
      const placeInput = {
        name: selectedPlace.mainText.trim(),
        note: selectedPlace.secondaryText.trim() || undefined,
        // Kept so the Table card can open this exact venue in Maps rather than
        // running a text search over the two display lines.
        placeId: selectedPlace.placeId || undefined,
        stopType: canonicalStop?.stopType ?? "other" as const
      };
      if (editing) {
        await updateStop.mutateAsync({ ...placeInput, stopId });
      } else {
        await createStop.mutateAsync(placeInput);
      }
      Keyboard.dismiss();
      router.back();
    } catch {
      // The mutation error is rendered below the search results.
    }
  }

  const closeWithoutSaving = useCallback(() => {
    Keyboard.dismiss();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ pathname: "/memories/[id]", params: { id: roomId } });
  }, [roomId, router]);

  const requestClose = useCallback(() => {
    if (pending) return;
    if (!dirty) {
      closeWithoutSaving();
      return;
    }
    Alert.alert("Discard changes?", "Your place changes have not been saved.", [
      { style: "cancel", text: "Keep editing" },
      { onPress: closeWithoutSaving, style: "destructive", text: "Discard" }
    ]);
  }, [closeWithoutSaving, dirty, pending]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]));

  const hasSearchableQuery = query.trim().length >= 2;

  return (
    <Screen padded={false} style={styles.screen}>
      <MemoryComposerHeader
        actionDisabled={!canAdd}
        actionLabel={pending ? (editing ? "Updating…" : "Adding…") : (editing ? "Update" : "Add")}
        actionVariant="boxed"
        onAction={() => void addPlace()}
        onClose={requestClose}
        showDivider={false}
        title={editing ? "Edit place" : ""}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.content}
      >
        <View style={styles.placeLine}>
          <Ionicons name="location-outline" size={20} color={themeColors.orange} />
          <TextInput
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            editable={!pending}
            onChangeText={(value) => {
              setQuery(value);
              setSelectedPlace(null);
            }}
            placeholder="Place name"
            placeholderTextColor={themeColors.muted}
            returnKeyType="search"
            style={styles.placeInput}
            value={query}
          />
        </View>

        {selectedPlace?.secondaryText ? (
          <View style={styles.selectedPlaceLocation}>
            <Ionicons name="location-outline" size={15} color={themeColors.muted} />
            <Text numberOfLines={2} style={styles.selectedPlaceLocationText}>
              {selectedPlace.secondaryText}
            </Text>
          </View>
        ) : null}

        {hasSearchableQuery ? (
          <ScrollView
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.results}
          >
            {searching ? (
              <View style={styles.searchStatus}>
                <ActivityIndicator color={themeColors.orange} size="small" />
                <Text style={styles.searchStatusText}>Searching places…</Text>
              </View>
            ) : null}
            {!searching && searchError ? (
              <View style={styles.searchStatus}>
                <Text style={styles.errorText}>{searchError}</Text>
              </View>
            ) : null}
            {!searching && !searchError && searchAttempted && suggestions.length === 0 ? (
              <View style={styles.searchStatus}>
                <Text style={styles.searchStatusText}>No places found</Text>
              </View>
            ) : null}
            {!searching ? suggestions.map((suggestion) => {
              return (
                <Pressable
                  accessibilityLabel={`Select ${suggestion.mainText}`}
                  accessibilityRole="button"
                  disabled={pending}
                  key={suggestion.placeId}
                  onPressIn={() => selectPlace(suggestion)}
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                >
                  <Ionicons name="location-outline" size={19} color={themeColors.muted} />
                  <View style={styles.resultText}>
                    <Text numberOfLines={1} style={styles.resultTitle}>{suggestion.mainText}</Text>
                    {suggestion.secondaryText ? (
                      <Text numberOfLines={1} style={styles.resultAddress}>{suggestion.secondaryText}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={themeColors.muted} />
                </Pressable>
              );
            }) : null}
          </ScrollView>
        ) : null}

        {createStop.error || updateStop.error ? (
          <Text style={styles.createError}>{(createStop.error ?? updateStop.error)?.message}</Text>
        ) : null}
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
    placeLine: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: spacing.s,
      paddingHorizontal: 0,
      paddingVertical: 14
    },
    placeInput: {
      ...fontStyles.bold,
      color: c.cream,
      flex: 1,
      fontSize: 14,
      minWidth: 0,
      padding: 0
    },
    selectedPlaceLocation: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 7,
      paddingBottom: 4,
      paddingTop: 9
    },
    selectedPlaceLocationText: {
      ...fontStyles.medium,
      color: c.muted,
      flex: 1,
      fontSize: 12,
      lineHeight: 16
    },
    results: {
      flex: 1
    },
    resultsContent: {
      paddingBottom: spacing.xl
    },
    searchStatus: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 58,
      paddingHorizontal: spacing.s
    },
    searchStatusText: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 13
    },
    errorText: {
      ...fontStyles.semiBold,
      color: c.dangerSoft,
      fontSize: 13
    },
    resultRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 66,
      paddingHorizontal: spacing.s,
      paddingVertical: 10
    },
    resultRowPressed: {
      backgroundColor: c.orangeDim
    },
    resultText: {
      flex: 1,
      minWidth: 0
    },
    resultTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 14,
      lineHeight: 18
    },
    resultAddress: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 3
    },
    createError: {
      ...fontStyles.semiBold,
      color: c.dangerSoft,
      fontSize: 13,
      paddingTop: spacing.md
    }
  });
}
