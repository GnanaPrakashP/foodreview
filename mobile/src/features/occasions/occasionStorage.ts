import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { normalizeOccasionText } from "./normalizeOccasionText";
import { isOccasionType, type OccasionCorrection, type OccasionType } from "./occasionTypes";

const STORAGE_PREFIX = "table_memory_occasion_corrections";
const MAX_CORRECTIONS = 80;

function storageKey(userName: string) {
  return `${STORAGE_PREFIX}:${normalizeOccasionText(userName)}`;
}

function safeParseCorrections(value: string | null): OccasionCorrection[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is OccasionCorrection => (
      typeof item?.normalizedText === "string" &&
      isOccasionType(item?.type) &&
      typeof item?.updatedAt === "string"
    ));
  } catch {
    return [];
  }
}

async function readItem(key: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function writeItem(key: string, value: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function loadOccasionCorrections(userName: string | null | undefined): Promise<OccasionCorrection[]> {
  if (!userName) return [];
  try {
    return safeParseCorrections(await readItem(storageKey(userName)));
  } catch {
    return [];
  }
}

export async function saveOccasionCorrection({
  phrase,
  type,
  userName
}: {
  phrase: string;
  type: OccasionType;
  userName: string | null | undefined;
}) {
  const normalizedText = normalizeOccasionText(phrase);
  if (!userName || !normalizedText || type === "unknown") return;

  const key = storageKey(userName);
  const current = await loadOccasionCorrections(userName);
  const next: OccasionCorrection = {
    normalizedText,
    type,
    updatedAt: new Date().toISOString()
  };
  const merged = [
    next,
    ...current.filter((item) => item.normalizedText !== normalizedText)
  ].slice(0, MAX_CORRECTIONS);

  try {
    await writeItem(key, JSON.stringify(merged));
  } catch {
    // Occasion corrections improve personalization only; the memory itself still saves without them.
  }
}
