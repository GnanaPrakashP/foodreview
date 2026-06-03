import { Platform } from "react-native";

function normalizeApiBaseUrl(value: string) {
  if (Platform.OS !== "android") return value;
  return value.replace("://localhost", "://10.0.2.2").replace("://127.0.0.1", "://10.0.2.2");
}

export const apiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL ?? "");

export function apiUrl(path: string) {
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
