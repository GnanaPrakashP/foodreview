import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import {
  MemoryCenterState,
  MemoryStatsGrid,
  MessagesSection,
  ParticipantsSection,
  PhotosSection
} from "@/components/memories/MemoryDetailSections";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  useAddMemoryMessageMutation,
  useAddMemoryParticipantMutation,
  useAddMemoryPhotoMutation,
  useMemoryRoomQuery
} from "@/hooks/useMemories";
import { pickPostImageFromGallery } from "@/services/mediaPicker";
import { spacing } from "@/theme";
import { formatDisplayDate } from "@/utils/datetime";

export default function MemoryDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = params.id ?? "";
  const room = useMemoryRoomQuery(roomId);
  const addParticipant = useAddMemoryParticipantMutation(roomId);
  const addMessage = useAddMemoryMessageMutation(roomId);
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const [participant, setParticipant] = useState("");
  const [message, setMessage] = useState("");
  const [photoError, setPhotoError] = useState("");

  async function submitParticipant() {
    try {
      await addParticipant.mutateAsync(participant);
      setParticipant("");
    } catch {
      // Rendered from mutation state.
    }
  }

  async function submitMessage() {
    try {
      await addMessage.mutateAsync(message);
      setMessage("");
    } catch {
      // Rendered from mutation state.
    }
  }

  async function submitPhoto() {
    setPhotoError("");
    const result = await pickPostImageFromGallery();
    if (result.error) {
      setPhotoError(result.error);
      return;
    }
    if (!result.asset) return;
    try {
      await addPhoto.mutateAsync({
        roomId,
        imageUri: result.asset.uri,
        imageMimeType: result.asset.mimeType
      });
    } catch {
      // Rendered from mutation state.
    }
  }

  if (room.isLoading) {
    return (
      <Screen>
        <MemoryCenterState loading />
      </Screen>
    );
  }

  if (room.isError || !room.data) {
    return (
      <Screen>
        <MemoryCenterState
          body={room.error?.message ?? "Memory room not found"}
          buttonLabel="Go back"
          onPress={() => router.back()}
          title="Could not load memory"
        />
      </Screen>
    );
  }

  const data = room.data;

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <MemoryRouteHeader
            kicker="Memory room"
            onBack={() => router.back()}
            subtitle={`${data.area || "No area"} - ${formatDisplayDate(data.visitDate)}`}
            title={data.restaurantName}
          />

          <MemoryStatsGrid
            messageCount={data.messages.length}
            participantCount={data.participants.length}
            photoCount={data.photos.length}
          />

          <ParticipantsSection
            mutation={{
              errorMessage: addParticipant.error?.message,
              isError: addParticipant.isError,
              isPending: addParticipant.isPending
            }}
            onChange={setParticipant}
            onSubmit={submitParticipant}
            participants={data.participants}
            value={participant}
          />

          <PhotosSection
            mutation={{
              errorMessage: addPhoto.error?.message,
              isError: addPhoto.isError,
              isPending: addPhoto.isPending
            }}
            onAddPhoto={submitPhoto}
            photoError={photoError}
            photos={data.photos}
          />

          <MessagesSection
            messages={data.messages}
            mutation={{
              errorMessage: addMessage.error?.message,
              isError: addMessage.isError,
              isPending: addMessage.isPending
            }}
            onChange={setMessage}
            onSubmit={submitMessage}
            value={message}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: 120
  }
});
