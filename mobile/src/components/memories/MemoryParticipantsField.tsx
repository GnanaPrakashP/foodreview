import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMyCircleQuery } from "@/hooks/useCircle";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

const USERNAME_PATTERN = /^[a-z0-9_]+$/;

function normalize(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

type MemoryParticipantsFieldProps = {
  colors?: ReturnType<typeof themeColorsFor>;
  onChange: (usernames: string[]) => void;
  value: string[];
};

export function MemoryParticipantsField({ colors: providedColors, onChange, value }: MemoryParticipantsFieldProps) {
  const { themeColors: defaultColors } = useThemePreference();
  const colors = providedColors ?? defaultColors;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const circle = useMyCircleQuery();
  const [query, setQuery] = useState("");

  const members = circle.data?.members ?? [];
  const selected = new Set(value);
  const normalizedQuery = normalize(query);

  const nameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) map.set(member.username, member.displayName);
    return map;
  }, [members]);

  const suggestions = members
    .filter((member) => !selected.has(member.username))
    .filter((member) =>
      normalizedQuery === ""
        ? true
        : member.username.toLowerCase().includes(normalizedQuery) || member.displayName.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, 6);

  const canAddTyped =
    normalizedQuery.length > 1 &&
    USERNAME_PATTERN.test(normalizedQuery) &&
    !selected.has(normalizedQuery) &&
    !suggestions.some((member) => member.username === normalizedQuery);

  function add(username: string) {
    const next = normalize(username);
    if (!next || selected.has(next)) return;
    onChange([...value, next]);
    setQuery("");
  }

  function remove(username: string) {
    onChange(value.filter((item) => item !== username));
  }

  return (
    <View style={styles.wrap}>
      {value.length > 0 ? (
        <View style={styles.tokens}>
          {value.map((username) => (
            <Pressable
              accessibilityHint="Removes this person"
              accessibilityLabel={`Remove @${username}`}
              accessibilityRole="button"
              key={username}
              onPress={() => remove(username)}
              style={styles.token}
            >
              <Text numberOfLines={1} style={styles.tokenText}>
                {nameFor.get(username) ?? `@${username}`}
              </Text>
              <Ionicons color={colors.orange} name="close" size={14} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons color={colors.muted} name="search" size={17} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          onSubmitEditing={() => (canAddTyped ? add(normalizedQuery) : undefined)}
          placeholder="Who is at the table?"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          style={styles.searchInput}
          value={query}
        />
      </View>

      {circle.isLoading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.muted} size="small" />
          <Text style={styles.statusText}>Loading your circle…</Text>
        </View>
      ) : null}

      {!circle.isLoading && suggestions.length === 0 && !canAddTyped ? (
        <Text style={styles.statusText}>
          {normalizedQuery ? "No matches in your circle." : "Start typing to find friends."}
        </Text>
      ) : null}

      {suggestions.length > 0 || canAddTyped ? (
        <View style={styles.suggestions}>
          {suggestions.map((member, index) => (
            <Pressable
              accessibilityRole="button"
              key={member.username}
              onPress={() => add(member.username)}
              style={[styles.suggestion, index === 0 && styles.suggestionFirst]}
            >
              <View style={styles.suggestionText}>
                <Text numberOfLines={1} style={styles.suggestionName}>
                  {member.displayName}
                </Text>
                <Text numberOfLines={1} style={styles.suggestionUsername}>
                  @{member.username}
                </Text>
              </View>
              <Ionicons color={colors.orange} name="add" size={18} />
            </Pressable>
          ))}
          {canAddTyped ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => add(normalizedQuery)}
              style={[styles.suggestion, suggestions.length === 0 && styles.suggestionFirst]}
            >
              <Text numberOfLines={1} style={styles.suggestionName}>
                Add @{normalizedQuery}
              </Text>
              <Ionicons color={colors.orange} name="add" size={18} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.sm
    },
    tokens: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm
    },
    token: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orange,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexDirection: "row",
      gap: 6,
      maxWidth: 220,
      paddingHorizontal: 12,
      paddingVertical: 7
    },
    tokenText: {
      ...fontStyles.bold,
      color: c.orange,
      flexShrink: 1,
      fontSize: 13
    },
    searchRow: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.s,
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    searchInput: {
      ...fontStyles.medium,
      color: c.cream,
      flex: 1,
      fontSize: 15,
      padding: 0
    },
    statusRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: 2
    },
    statusText: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      paddingHorizontal: 2
    },
    suggestions: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      overflow: "hidden"
    },
    suggestion: {
      alignItems: "center",
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    suggestionFirst: {
      borderTopWidth: 0
    },
    suggestionText: {
      flex: 1,
      gap: 1
    },
    suggestionName: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 14
    },
    suggestionUsername: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 12
    }
  });
}
