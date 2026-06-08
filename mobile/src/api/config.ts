import Constants from "expo-constants";
import { Platform } from "react-native";

type ConstantsWithHosts = typeof Constants & {
  manifest?: {
    debuggerHost?: string;
    hostUri?: string;
  } | null;
  manifest2?: {
    extra?: {
      expoClient?: {
        hostUri?: string;
      };
      expoGo?: {
        debuggerHost?: string;
      };
    };
  } | null;
};

function hostnameFromExpoHost(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0] ?? "";
}

function expoDevServerHostname() {
  const constants = Constants as ConstantsWithHosts;
  const candidates = [
    constants.expoConfig?.hostUri,
    constants.manifest?.hostUri,
    constants.manifest?.debuggerHost,
    constants.manifest2?.extra?.expoClient?.hostUri,
    constants.manifest2?.extra?.expoGo?.debuggerHost
  ];

  return candidates.map(hostnameFromExpoHost).find(Boolean) ?? "";
}

function normalizeApiBaseUrl(value: string) {
  if (Platform.OS === "web") {
    const currentHost = globalThis.location?.hostname;
    if (!currentHost || !/^(localhost|127\.0\.0\.1)$/.test(currentHost)) return value;

    try {
      const url = new URL(value);
      url.hostname = currentHost;
      return url.toString().replace(/\/$/, "");
    } catch {
      return value;
    }
  }

  try {
    const url = new URL(value);
    const expoHost = expoDevServerHostname();
    if (expoHost && !/^(localhost|127\.0\.0\.1)$/.test(expoHost)) {
      url.hostname = expoHost;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall through to Android emulator localhost normalization.
  }

  if (Platform.OS !== "android") return value;
  return value.replace("://localhost", "://10.0.2.2").replace("://127.0.0.1", "://10.0.2.2");
}

export const apiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? "");

export function apiUrl(path: string) {
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
