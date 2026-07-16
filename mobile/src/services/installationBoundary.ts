import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { clearInstallScopedSecureState } from "@/services/installIdentity";

const INSTALLATION_MARKER_CONTENT = "circlebites-installation-v1";
const INSTALLATION_MARKER_NAME = ".circlebites-installation-v1";
const SUPABASE_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InstallationBoundaryResult = {
  freshInstallation: boolean;
  orphanedUserId: string | null;
};

type InstallationBoundaryDependencies = {
  clearPersistedAuth: () => Promise<void>;
  hasLegacyInstallationEvidence: (userId: string) => boolean | Promise<boolean>;
  readPersistedSession: () => Promise<string | null>;
};

function persistedSessionUserId(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } };
    const userId = typeof parsed.user?.id === "string" ? parsed.user.id.trim().toLowerCase() : "";
    return SUPABASE_USER_ID.test(userId) ? userId : null;
  } catch {
    return null;
  }
}

async function markerExists(markerPath: string) {
  const info = await FileSystem.getInfoAsync(markerPath);
  if (!info.exists || info.isDirectory) return false;
  try {
    return await FileSystem.readAsStringAsync(markerPath) === INSTALLATION_MARKER_CONTENT;
  } catch {
    return false;
  }
}

/**
 * SecureStore maps to Keychain on iOS and may outlive uninstall. This marker is
 * deliberately stored in the ordinary application sandbox, which survives an
 * upgrade and Android cache clearing but is removed by uninstall/clear-data.
 */
export async function enforceInstallationBoundary(
  dependencies: InstallationBoundaryDependencies
): Promise<InstallationBoundaryResult> {
  if (Platform.OS === "web") return { freshInstallation: false, orphanedUserId: null };

  const root = FileSystem.documentDirectory;
  if (!root) {
    await dependencies.clearPersistedAuth().catch(() => {});
    await clearInstallScopedSecureState().catch(() => {});
    throw new Error("installation_marker_unavailable");
  }

  const markerPath = `${root}${INSTALLATION_MARKER_NAME}`;
  if (await markerExists(markerPath)) {
    return { freshInstallation: false, orphanedUserId: null };
  }

  // Capture only the immutable owner UUID needed to remove surviving
  // owner-scoped Keychain values. Never expose or log the session itself.
  const orphanedUserId = persistedSessionUserId(await dependencies.readPersistedSession().catch(() => null));
  if (
    orphanedUserId
    && await Promise.resolve(dependencies.hasLegacyInstallationEvidence(orphanedUserId)).catch(() => false)
  ) {
    await FileSystem.writeAsStringAsync(markerPath, INSTALLATION_MARKER_CONTENT);
    return { freshInstallation: false, orphanedUserId: null };
  }
  await dependencies.clearPersistedAuth();
  await clearInstallScopedSecureState();
  await FileSystem.writeAsStringAsync(markerPath, INSTALLATION_MARKER_CONTENT);
  return { freshInstallation: true, orphanedUserId };
}
