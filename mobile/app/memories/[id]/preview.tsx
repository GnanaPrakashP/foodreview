import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { MediaPreviewScreen } from "@/components/memories/camera/MediaPreviewScreen";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMemoryRoomQuery } from "@/hooks/useMemories";
import { getMemoryCapture } from "@/services/memoryCaptureSession";
import {
  createMemoryRoomJourneySession,
  recordMemoryRoomJourney
} from "@/services/memoryRoomJourneyDiagnostics.mjs";

export default function MemoryMediaPreviewRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    captureId?: string;
    id: string;
    journeyRunId?: string;
    roomSessionId?: string;
  }>();
  const roomId = typeof params.id === "string" ? params.id : "";
  const captureId = typeof params.captureId === "string" ? params.captureId : "";
  const capture = captureId ? getMemoryCapture(captureId) : null;
  const journeySession = useMemo(() => createMemoryRoomJourneySession({
    initialTab: "overview",
    journeyRunId: params.journeyRunId,
    roomSessionId: params.roomSessionId
  }), [params.journeyRunId, params.roomSessionId]);
  const room = useMemoryRoomQuery(roomId, journeySession);
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "MEDIA_PREVIEW_OPENED", {
      screenState: "preview",
      tab: "overview"
    });
  }, [journeySession]);

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

  return <MediaPreviewScreen asset={capture} journeySession={journeySession} roomId={roomId} />;
}
