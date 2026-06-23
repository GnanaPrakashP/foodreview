import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { AsyncState } from "@/components/memories/types";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";
import type { MemoryPhoto } from "@/types/models";

export function PhotosSection({
  mutation,
  onAddPhoto,
  photoError,
  photos
}: {
  mutation: AsyncState;
  onAddPhoto: () => void;
  photoError?: string;
  photos: MemoryPhoto[];
}) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Media</Text>
        <Pressable disabled={mutation.isPending} onPress={onAddPhoto} style={styles.addPhotoButton}>
          <Ionicons name="image-outline" size={17} color={themeColors.white} />
          <Text style={styles.addPhotoText}>{mutation.isPending ? "Adding..." : "Add media"}</Text>
        </Pressable>
      </View>
      {photos.length > 0 ? (
        <FlatList
          contentContainerStyle={styles.photos}
          data={photos}
          horizontal
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.photoCard}>
              <Image source={{ uri: item.publicUrl }} style={styles.photo} contentFit="cover" />
              <Text style={styles.photoUser}>@{item.uploaderName}</Text>
            </View>
          )}
          showsHorizontalScrollIndicator={false}
        />
      ) : (
        <Text style={styles.emptyInline}>No media yet.</Text>
      )}
      {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
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
    sectionHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between"
    },
    sectionTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 17
    },
    addPhotoButton: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: radius.md,
      flexDirection: "row",
      gap: 5,
      paddingHorizontal: spacing.s,
      paddingVertical: 9
    },
    addPhotoText: {
      ...fontStyles.extraBold,
      color: c.white,
      fontSize: 12
    },
    photos: {
      gap: spacing.sm
    },
    photoCard: {
      gap: 6,
      width: 110
    },
    photo: {
      aspectRatio: 4 / 5,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      width: "100%"
    },
    photoUser: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 11
    },
    emptyInline: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19
    },
    error: {
      ...fontStyles.regular,
      color: c.dangerSoft,
      fontSize: 13,
      lineHeight: 19
    }
  });
}
