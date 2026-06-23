import { useLocalSearchParams } from "expo-router";
import { MemoryMediaCaptureScreen } from "@/components/memories/camera/MemoryMediaCaptureScreen";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMemoryRoomQuery } from "@/hooks/useMemories";

export default function MemoryCameraRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = typeof params.id === "string" ? params.id : "";
  const room = useMemoryRoomQuery(roomId);

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

  return <MemoryMediaCaptureScreen roomId={roomId} />;
}
