const ACTOR_NAME_KEY = "fc_my_name";
const DISPLAY_NAME_KEY = "fc_display_name";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readStorage(key: string): string {
  try {
    return storage()?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    storage()?.setItem(key, trimmed);
  } catch {
    // localStorage can be blocked in privacy modes; actor state still exists in React state.
  }
}

function removeStorage(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // Ignore blocked localStorage.
  }
}

export function getStoredActorName(): string {
  return readStorage(ACTOR_NAME_KEY);
}

export function getStoredDisplayName(): string {
  return readStorage(DISPLAY_NAME_KEY);
}

export function setStoredActorName(name: string) {
  writeStorage(ACTOR_NAME_KEY, name);
}

export function setStoredDisplayName(displayName: string) {
  writeStorage(DISPLAY_NAME_KEY, displayName);
}

export function clearStoredActor() {
  removeStorage(ACTOR_NAME_KEY);
  removeStorage(DISPLAY_NAME_KEY);
}

export function resolveActorName(initialName = ""): string {
  const name = initialName.trim() || getStoredActorName();
  if (name) setStoredActorName(name);
  return name;
}

export function resolveDisplayName(initialDisplayName = "", fallbackName = ""): string {
  const displayName = initialDisplayName.trim() || getStoredDisplayName() || fallbackName;
  if (displayName) setStoredDisplayName(displayName);
  return displayName;
}

export function syncStoredActor(actor: { name?: string | null; displayName?: string | null }) {
  if (actor.name) setStoredActorName(actor.name);
  if (actor.displayName) setStoredDisplayName(actor.displayName);
}
