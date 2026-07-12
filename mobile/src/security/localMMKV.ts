import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

function nativeCachePath() {
  if (Platform.OS === "web") return undefined;
  if (!FileSystem.cacheDirectory) throw new Error("local_mmkv_cache_unavailable");
  const filesystemPath = decodeURI(FileSystem.cacheDirectory).replace(/^file:\/\//, "").replace(/\/$/, "");
  return `${filesystemPath}/circlebites-mmkv-v2`;
}

/**
 * Creates security/account MMKV files in the OS cache area. This keeps them out
 * of iOS backup without requiring an unchecked native project and keeps Android
 * aligned with the explicit backup exclusions.
 */
export function createLocalMMKV(id: string) {
  const path = nativeCachePath();
  return createMMKV(path ? { id, path } : { id });
}
