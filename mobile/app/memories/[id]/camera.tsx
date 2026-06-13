import { useLocalSearchParams } from "expo-router";
import { CameraScreen } from "@/components/memories/camera/CameraScreen";
import { MemoryCenterState } from "@/components/memories/MemoryDetailSections";
import { AppScreen as Screen } from "@/components/ui/AppScreen";

export default function MemoryCameraRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const roomId = typeof params.id === "string" ? params.id : "";

  if (!roomId) {
    return (
      <Screen>
        <MemoryCenterState body="Memory room not found" title="Could not open camera" />
      </Screen>
    );
  }

  return <CameraScreen roomId={roomId} />;
}
