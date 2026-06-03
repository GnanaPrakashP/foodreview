import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { AsyncState } from "@/components/memories/types";
import { colors, fontStyles, radius, spacing } from "@/theme";
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
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Photos</Text>
        <Pressable disabled={mutation.isPending} onPress={onAddPhoto} style={styles.addPhotoButton}>
          <Ionicons name="image-outline" size={17} color={colors.dark.white} />
          <Text style={styles.addPhotoText}>{mutation.isPending ? "Adding..." : "Add photo"}</Text>
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
        <Text style={styles.emptyInline}>No photos yet.</Text>
      )}
      {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
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
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  sectionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 17
  },
  addPhotoButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: spacing.s,
    paddingVertical: 9
  },
  addPhotoText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
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
    backgroundColor: colors.dark.surface,
    borderRadius: radius.md,
    width: "100%"
  },
  photoUser: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11
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
