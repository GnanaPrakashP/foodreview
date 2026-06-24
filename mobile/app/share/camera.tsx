import { useRouter } from "expo-router";
import { CameraScreen } from "@/components/memories/camera/CameraScreen";
import { setPendingPostCapture } from "@/services/postCaptureSession";

export default function ShareCameraRoute() {
  const router = useRouter();

  return (
    <CameraScreen
      onCapture={(asset) => {
        setPendingPostCapture(asset);
        router.back();
      }}
      onClose={() => router.back()}
    />
  );
}
