import { useLocalSearchParams, useRouter } from "expo-router";
import { MediaPreviewScreen } from "@/components/memories/camera/MediaPreviewScreen";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMemoryRoomQuery } from "@/hooks/useMemories";
import { getMemoryCapture } from "@/services/memoryCaptureSession";

export default function MemoryMediaPreviewRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ captureId?: string; id: string }>();
  const roomId = typeof params.id === "string" ? params.id : "";
  const captureId = typeof params.captureId === "string" ? params.captureId : "";
  const capture = captureId ? getMemoryCapture(captureId) : null;
  const room = useMemoryRoomQuery(roomId);

  if (!roomId || !capture) {
    return (
      <Screen>
        <MemoryCenterState
          body="Capture another photo or video for this room."
          buttonLabel="Back to camera"
          onPress={() => router.back()}
          title="Preview expired"
        />
      </Screen>
    );
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
          body="Memory room not found"
          buttonLabel="Back to camera"
          onPress={() => router.back()}
          title="Preview unavailable"
        />
      </Screen>
    );
  }

  return <MediaPreviewScreen asset={capture} roomId={roomId} />;
}
