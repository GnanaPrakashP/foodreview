import { useCallback, useEffect, useState } from "react";
import { Camera, type PermissionResponse } from "expo-camera";

export function useInAppCameraPermissions(enabled: boolean) {
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const requestPermission = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const current = await Camera.getCameraPermissionsAsync();
      if (current.granted) {
        setPermission(current);
        return current;
      }

      const requested = await Camera.requestCameraPermissionsAsync();
      setPermission(requested);
      return requested;
    } catch {
      setError("Could not check camera permission.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void requestPermission();
  }, [enabled, requestPermission]);

  return {
    denied: Boolean(permission && !permission.granted),
    error,
    granted: Boolean(permission?.granted),
    loading,
    permission,
    requestPermission
  };
}
