import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { CameraScreen } from "@/components/memories/camera/CameraScreen";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  MEMORY_VIDEO_CAPTURE_BITRATE,
  MEMORY_VIDEO_CAPTURE_QUALITY
} from "@/constants/memoryMediaPolicy";
import { useMemoryRoomQuery } from "@/hooks/useMemories";
import { saveMemoryCapture } from "@/services/memoryCaptureSession";
import {
  createMemoryRoomJourneySession,
  recordMemoryRoomJourney
} from "@/services/memoryRoomJourneyDiagnostics.mjs";

export default function MemoryCameraRoute() {
  const params = useLocalSearchParams<{
    id: string;
    journeyRunId?: string;
    roomSessionId?: string;
  }>();
  const router = useRouter();
  const roomId = typeof params.id === "string" ? params.id : "";
  const journeySession = useMemo(() => createMemoryRoomJourneySession({
    initialTab: "overview",
    journeyRunId: params.journeyRunId,
    roomSessionId: params.roomSessionId
  }), [params.journeyRunId, params.roomSessionId]);
  const room = useMemoryRoomQuery(roomId, journeySession);
  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "CAMERA_OPENED", {
      screenState: "camera",
      tab: "overview"
    });
  }, [journeySession]);

  if (!roomId) {
    return (
      <Screen>
        <MemoryCenterState body="Memory room not found" title="Could not open camera" />
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
        <MemoryCenterState body="Memory room not found" title="Could not open camera" />
      </Screen>
    );
  }

  return (
    <CameraScreen
      // A room clip is watched in a chat bubble and has to come back quickly;
      // the worker's time tracks source bytes almost linearly.
      videoBitrate={MEMORY_VIDEO_CAPTURE_BITRATE}
      videoQuality={MEMORY_VIDEO_CAPTURE_QUALITY}
      onClose={() => {
        recordMemoryRoomJourney(journeySession, "CAMERA_CANCELLED", {
          screenState: "usable",
          tab: "overview"
        });
        router.back();
      }}
      onCapture={(asset) => {
        recordMemoryRoomJourney(journeySession, "CAMERA_CAPTURED", {
          screenState: "preview",
          tab: "overview"
        });
        const capture = saveMemoryCapture(asset);
        router.push({
          pathname: "/memories/[id]/preview",
          params: {
            captureId: capture.id,
            id: roomId,
            journeyRunId: journeySession.journeyRunId,
            roomSessionId: journeySession.roomSessionId
          }
        });
      }}
    />
  );
}
