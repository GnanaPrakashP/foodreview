import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope,
  LOCAL_DATA_SCHEMA_VERSION
} from "@/security/cacheOwnership";
import { createLocalMMKV } from "@/security/localMMKV";
import { isOwnedAccountFileUri } from "@/services/accountFileStore";
import type { MediaCropRect } from "@/services/mediaPipeline";
import type { SelectedPlace } from "@/services/places";
import type { FoodItem, Visibility } from "@/types/models";

export type PersistedPostDraftMedia = {
  cropRect?: MediaCropRect | null;
  visibleRect?: MediaCropRect | null;
  duration?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mediaType: "image" | "video";
  mimeType?: string | null;
  muted?: boolean;
  uri: string;
  width?: number | null;
};

export type PersistedPostDraftDish = FoodItem & { key: string };

export type PersistedPostDraft = {
  caption: string;
  dishes: PersistedPostDraftDish[];
  mediaItems: PersistedPostDraftMedia[];
  ownerScope: string;
  restaurantName: string;
  restaurantPlace: SelectedPlace | null;
  savedAt: number;
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
  selectedTags: string[];
  soloStep: "review" | "details" | "preview";
  visibility: Visibility;
};

const DRAFT_KEY = "active-post-draft";
const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60_000;
const stores = new Map<string, ReturnType<typeof createLocalMMKV>>();

function storeFor(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_post_draft_owner");
  let store = stores.get(scope);
  if (!store) {
    store = createLocalMMKV(`circlebites.post-draft.v${LOCAL_DATA_SCHEMA_VERSION}.${scope}`);
    stores.set(scope, store);
  }
  return store;
}

function finiteNullable(value: unknown) {
  return value === null || value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function cropIsValid(value: MediaCropRect | null | undefined) {
  if (value == null) return true;
  return [value.x, value.y, value.width, value.height].every((part) => typeof part === "number" && Number.isFinite(part)) &&
    value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 &&
    value.x + value.width <= 1.001 && value.y + value.height <= 1.001;
}

function placeIsValid(value: SelectedPlace | null) {
  if (value === null) return true;
  return typeof value === "object" &&
    [value.formattedAddress, value.locationLabel, value.name, value.placeId, value.primaryType, value.shortFormattedAddress]
      .every((part) => typeof part === "string" && part.length <= 512) &&
    Array.isArray(value.types) && value.types.length <= 32 && value.types.every((part) => typeof part === "string" && part.length <= 80) &&
    finiteNullable(value.latitude) && finiteNullable(value.longitude);
}

function draftIsValid(value: Partial<PersistedPostDraft>, scope: string): value is PersistedPostDraft {
  return value.schemaVersion === LOCAL_DATA_SCHEMA_VERSION &&
    value.ownerScope === scope &&
    typeof value.savedAt === "number" && Number.isFinite(value.savedAt) && Date.now() - value.savedAt <= MAX_DRAFT_AGE_MS &&
    typeof value.caption === "string" && value.caption.length <= 4_000 &&
    typeof value.restaurantName === "string" && value.restaurantName.length <= 300 &&
    placeIsValid(value.restaurantPlace ?? null) &&
    Array.isArray(value.mediaItems) && value.mediaItems.length > 0 && value.mediaItems.length <= 4 &&
    value.mediaItems.every((media) =>
      Boolean(media) && ["image", "video"].includes(media.mediaType) &&
      typeof media.uri === "string" && isOwnedAccountFileUri(media.uri, scope) &&
      finiteNullable(media.duration) && finiteNullable(media.fileSize) && finiteNullable(media.height) && finiteNullable(media.width) &&
      cropIsValid(media.cropRect) && cropIsValid(media.visibleRect)
    ) &&
    Array.isArray(value.dishes) && value.dishes.length >= 1 && value.dishes.length <= 10 &&
    value.dishes.every((dish) => Boolean(dish) && typeof dish.key === "string" && dish.key.length <= 100 &&
      typeof dish.name === "string" && dish.name.length <= 200 && typeof dish.rating === "number" && dish.rating >= 0 && dish.rating <= 10) &&
    Array.isArray(value.selectedTags) && value.selectedTags.length <= 5 &&
    value.selectedTags.every((tag) => typeof tag === "string" && tag.length <= 80) &&
    ["review", "details", "preview"].includes(value.soloStep ?? "") &&
    ["public", "circle", "me"].includes(value.visibility ?? "");
}

function activeContext() {
  const owner = getActiveCacheOwner();
  const generation = getActiveCacheGeneration();
  if (!owner || !isCacheGenerationActive(generation)) throw new Error("post_draft_owner_inactive");
  return { generation, owner };
}

function assertStillActive(scope: string, generation: number) {
  if (getActiveCacheOwner()?.scope !== scope || !isCacheGenerationActive(generation)) {
    throw new Error("post_draft_owner_changed");
  }
}

export function loadActivePostDraft() {
  const { generation, owner } = activeContext();
  const store = storeFor(owner.scope);
  const raw = store.getString(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPostDraft>;
    if (!draftIsValid(parsed, owner.scope)) {
      store.remove(DRAFT_KEY);
      return null;
    }
    assertStillActive(owner.scope, generation);
    return parsed;
  } catch {
    store.remove(DRAFT_KEY);
    return null;
  }
}

export function saveActivePostDraft(input: Omit<PersistedPostDraft, "ownerScope" | "savedAt" | "schemaVersion">) {
  const { generation, owner } = activeContext();
  const draft: PersistedPostDraft = {
    ...input,
    ownerScope: owner.scope,
    savedAt: Date.now(),
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION
  };
  if (!draftIsValid(draft, owner.scope)) throw new Error("post_draft_invalid");
  storeFor(owner.scope).set(DRAFT_KEY, JSON.stringify(draft));
  assertStillActive(owner.scope, generation);
}

export function clearActivePostDraft() {
  const { generation, owner } = activeContext();
  storeFor(owner.scope).remove(DRAFT_KEY);
  assertStillActive(owner.scope, generation);
}

export function clearPostDraftForScope(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_post_draft_owner");
  storeFor(scope).clearAll();
  stores.delete(scope);
}
