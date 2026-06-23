import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MediaCapture, type CapturedMedia } from "@/components/media/MediaCapture";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { saveMemoryCapture } from "@/services/memoryCaptureSession";
import { fontStyles, radius, spacing } from "@/theme";

/**
 * Photo capture for a Table Memory room. Reuses the shared MediaCapture surface
 * (live viewfinder + recents grid) so the room and the Post composer share one
 * experience, then hands the picked photo to the existing memory preview flow.
 */
export function MemoryMediaCaptureScreen({ roomId }: { roomId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { themeColors: c } = useThemePreference();
  const styles = useMemo(() => createStyles(c), [c]);

  function handleSelect(media: CapturedMedia) {
    const capture = saveMemoryCapture({
      height: media.height ?? null,
      mediaType: "image",
      mimeType: media.mimeType ?? null,
      source: media.source,
      uri: media.uri,
      width: media.width ?? null
    });
    router.push({
      pathname: "/memories/[id]/preview",
      params: { captureId: capture.id, id: roomId }
    });
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Close" onPress={() => router.back()} style={styles.close}>
          <ArrowLeft size={20} color={c.cream} strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.title}>Add photo</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <MediaCapture onSelect={handleSelect} />
      </ScrollView>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    screen: {
      backgroundColor: c.bg,
      flex: 1
    },
    header: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm
    },
    close: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 40,
      justifyContent: "center",
      marginLeft: -10,
      width: 40
    },
    title: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 17,
      lineHeight: 22
    },
    headerSpacer: {
      width: 40
    },
    content: {
      gap: spacing.base,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm
    }
  });
}
