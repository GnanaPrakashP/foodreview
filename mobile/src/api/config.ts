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

type RuntimeProcessGlobal = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function runtimeEnvValue(name: string) {
  return (globalThis as RuntimeProcessGlobal).process?.env?.[name];
}

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

function isLoopbackHostname(value: string) {
  return value === "localhost" || value === "127.0.0.1";
}

function shouldUseAndroidEmulatorHost(value: string) {
  return value === "localhost";
}

function normalizeApiBaseUrl(value: string) {
  if (Platform.OS === "web") {
    const currentHost = globalThis.location?.hostname;
    if (!currentHost || !isLoopbackHostname(currentHost)) return value;

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

    if (!isLoopbackHostname(url.hostname)) {
      return url.toString().replace(/\/$/, "");
    }

    const expoHost = expoDevServerHostname();
    if (expoHost && !isLoopbackHostname(expoHost)) {
      url.hostname = expoHost;
      return url.toString().replace(/\/$/, "");
    }

    if (Platform.OS === "android" && shouldUseAndroidEmulatorHost(url.hostname)) {
      url.hostname = "10.0.2.2";
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    if (Platform.OS !== "android") return value;
    return value.replace("://localhost", "://10.0.2.2");
  }
}

export const apiBaseUrl = normalizeApiBaseUrl(runtimeEnvValue("EXPO_PUBLIC_API_BASE_URL") ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "");

export function apiUrl(path: string) {
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
