import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope,
  LOCAL_DATA_SCHEMA_VERSION
} from "@/security/cacheOwnership";
import { createLocalMMKV } from "@/security/localMMKV";
import { discardOwnedAccountFile, isOwnedAccountFileUri } from "@/services/accountFileStore";

export type PendingMediaUploadState =
  | "prepared"
  | "intent_created"
  | "source_uploaded"
  | "processing"
  | "processing_delayed"
  | "processing_failed"
  | "ready";

export type PendingMediaUploadRecord = {
  accessClass: "public_post" | "circle_post" | "private_post" | "memory_private";
  audioPolicy: "preserve" | "strip";
  assetId: string | null;
  createdAt: number;
  cropRect: { height: number; targetAspect?: number | null; width: number; x: number; y: number };
  durationMs: number | null;
  expiresAt: string | null;
  fileSizeBytes: number;
  height: number | null;
  lastCheckedAt: number | null;
  localUploadId: string;
  mediaKind: "image" | "video";
  memoryAttachment: {
    assetCount: number;
    batchId: string;
    body: string;
    clientCreatedAt: string;
    clientOrderKey: string;
    clientSequence: number;
    position: number;
    replyToMessageId: string | null;
    roomId: string;
  } | null;
  mimeType: string;
  ownerScope: string;
  preparedUri: string;
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
  sourceUri: string;
  state: PendingMediaUploadState;
  surface: "memory" | "post";
  uploadBucket: string | null;
  uploadPath: string | null;
  width: number | null;
  readyResult: {
    fileSizeBytes: number;
    height: number | null;
    mimeType: string;
    width: number | null;
  } | null;
  serverAttachedAt: number | null;
};

const KEY = "pending-uploads";
const MAX_RECORDS = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const stores = new Map<string, ReturnType<typeof createLocalMMKV>>();

function storeFor(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_media_upload_owner");
  let store = stores.get(scope);
  if (!store) {
    store = createLocalMMKV(`circlebites.media-upload.v${LOCAL_DATA_SCHEMA_VERSION}.${scope}`);
    stores.set(scope, store);
  }
  return store;
}

function activeContext() {
  const owner = getActiveCacheOwner();
  const generation = getActiveCacheGeneration();
  if (!owner || !isCacheGenerationActive(generation)) throw new Error("media_upload_owner_inactive");
  return { generation, owner };
}

function recordIsValid(record: Partial<PendingMediaUploadRecord>, scope: string): record is PendingMediaUploadRecord {
  const surface = record.surface ?? "post";
  const hasServerIdentity = typeof record.assetId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.assetId) &&
    record.uploadBucket === "media-sources" &&
    typeof record.uploadPath === "string" &&
    new RegExp(`^sources/${surface}/[0-9a-f-]{36}/${record.assetId}/original\\.[a-z0-9]{1,8}$`, "i").test(record.uploadPath) &&
    !record.uploadPath.includes("..");
  const memoryAttachment = record.memoryAttachment;
  const memoryCreatedAt = memoryAttachment ? Date.parse(memoryAttachment.clientCreatedAt) : Number.NaN;
  const hasValidMemoryAttachment = Boolean(
    memoryAttachment &&
    /^[0-9a-f-]{36}$/i.test(memoryAttachment.roomId) &&
    /^[A-Za-z0-9._:-]{16,128}$/.test(memoryAttachment.batchId) &&
    typeof memoryAttachment.body === "string" &&
    memoryAttachment.body.length <= 1000 &&
    Number.isFinite(memoryCreatedAt) &&
    memoryCreatedAt <= Date.now() + 5 * 60_000 &&
    Number.isSafeInteger(memoryAttachment.clientSequence) &&
    memoryAttachment.clientSequence >= 0 &&
    typeof memoryAttachment.clientOrderKey === "string" &&
    memoryAttachment.clientOrderKey.length >= 16 &&
    memoryAttachment.clientOrderKey.length <= 200 &&
    /^[\x20-\x7E]+$/.test(memoryAttachment.clientOrderKey) &&
    memoryAttachment.clientOrderKey.endsWith(`:${memoryAttachment.batchId}`) &&
    Number.isSafeInteger(memoryAttachment.position) &&
    memoryAttachment.position >= 0 &&
    Number.isSafeInteger(memoryAttachment.assetCount) &&
    memoryAttachment.assetCount >= 1 &&
    memoryAttachment.assetCount <= 10 &&
    memoryAttachment.position < memoryAttachment.assetCount &&
    (
      memoryAttachment.replyToMessageId === null ||
      /^[0-9a-f-]{36}$/i.test(memoryAttachment.replyToMessageId)
    )
  );
  const state = record.state ?? "";
  return record.schemaVersion === LOCAL_DATA_SCHEMA_VERSION &&
    record.ownerScope === scope &&
    typeof record.localUploadId === "string" &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    typeof record.fileSizeBytes === "number" &&
    Number.isSafeInteger(record.fileSizeBytes) &&
    record.fileSizeBytes > 0 &&
    typeof record.sourceUri === "string" &&
    typeof record.preparedUri === "string" &&
    isOwnedAccountFileUri(record.sourceUri, scope) &&
    isOwnedAccountFileUri(record.preparedUri, scope) &&
    ["public_post", "circle_post", "private_post", "memory_private"].includes(record.accessClass ?? "") &&
    (
      record.audioPolicy === "preserve" ||
      (surface === "post" && record.mediaKind === "video" && record.audioPolicy === "strip")
    ) &&
    (surface === "post" || surface === "memory") &&
    (
      (surface === "post" && record.accessClass !== "memory_private" && memoryAttachment == null) ||
      (surface === "memory" && record.accessClass === "memory_private" && hasValidMemoryAttachment)
    ) &&
    Boolean(record.cropRect) &&
    typeof record.cropRect?.x === "number" &&
    typeof record.cropRect?.y === "number" &&
    typeof record.cropRect?.width === "number" &&
    typeof record.cropRect?.height === "number" &&
    record.cropRect.x >= 0 && record.cropRect.y >= 0 &&
    record.cropRect.width > 0 && record.cropRect.height > 0 &&
    record.cropRect.x + record.cropRect.width <= 1.001 &&
    record.cropRect.y + record.cropRect.height <= 1.001 &&
    (record.durationMs === null || (typeof record.durationMs === "number" && record.durationMs >= 0)) &&
    ["image", "video"].includes(record.mediaKind ?? "") &&
    typeof record.mimeType === "string" &&
    /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm))$/.test(record.mimeType) &&
    ["prepared", "intent_created", "source_uploaded", "processing", "processing_delayed", "processing_failed", "ready"].includes(state) &&
    (record.serverAttachedAt === null || (
      typeof record.serverAttachedAt === "number" && Number.isFinite(record.serverAttachedAt)
    )) &&
    (state === "prepared"
      ? record.assetId === null && record.uploadBucket === null && record.uploadPath === null
      : hasServerIdentity) &&
    (state !== "ready" || Boolean(record.readyResult));
}

function readRecords(scope: string) {
  const raw = storeFor(scope).getString(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Partial<PendingMediaUploadRecord>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((record): Partial<PendingMediaUploadRecord> => {
        const legacyAttachment = record.memoryAttachment;
        const legacyCreatedAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
          ? Math.max(0, Math.floor(record.createdAt))
          : 0;
        const memoryAttachment = legacyAttachment
          ? {
            ...legacyAttachment,
            clientCreatedAt: typeof legacyAttachment.clientCreatedAt === "string"
              ? legacyAttachment.clientCreatedAt
              : new Date(legacyCreatedAt).toISOString(),
            clientOrderKey: typeof legacyAttachment.clientOrderKey === "string"
              ? legacyAttachment.clientOrderKey
              : `${new Date(legacyCreatedAt).toISOString()}:${legacyAttachment.batchId}`,
            clientSequence: Number.isSafeInteger(legacyAttachment.clientSequence)
              ? legacyAttachment.clientSequence
              : legacyCreatedAt
          }
          : null;
        return {
          ...record,
          audioPolicy: record.audioPolicy ?? "preserve",
          memoryAttachment,
          serverAttachedAt: record.serverAttachedAt ?? null,
          surface: record.surface ?? "post"
        };
      })
      .filter((record): record is PendingMediaUploadRecord => recordIsValid(record, scope))
      .slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

function writeRecords(scope: string, records: PendingMediaUploadRecord[]) {
  storeFor(scope).set(KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

function assertStillActive(scope: string, generation: number) {
  if (getActiveCacheOwner()?.scope !== scope || !isCacheGenerationActive(generation)) {
    throw new Error("media_upload_owner_changed");
  }
}

export function pendingMediaUploads() {
  const { generation, owner } = activeContext();
  const records = readRecords(owner.scope);
  assertStillActive(owner.scope, generation);
  return records;
}

export function findPendingMediaUpload(
  sourceUri: string,
  mediaKind: "image" | "video",
  accessClass: PendingMediaUploadRecord["accessClass"],
  surface: PendingMediaUploadRecord["surface"]
) {
  return pendingMediaUploads().find((record) => (
    record.sourceUri === sourceUri &&
    record.mediaKind === mediaKind &&
    record.accessClass === accessClass &&
    record.surface === surface
  )) ?? null;
}

export function createPendingMediaUpload(input: Omit<PendingMediaUploadRecord, "createdAt" | "lastCheckedAt" | "localUploadId" | "ownerScope" | "readyResult" | "schemaVersion" | "serverAttachedAt" | "state">) {
  const { generation, owner } = activeContext();
  if (!isOwnedAccountFileUri(input.sourceUri, owner.scope) || !isOwnedAccountFileUri(input.preparedUri, owner.scope)) {
    throw new Error("media_upload_file_unowned");
  }
  const record: PendingMediaUploadRecord = {
    ...input,
    createdAt: Date.now(),
    lastCheckedAt: null,
    localUploadId: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
    ownerScope: owner.scope,
    readyResult: null,
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    serverAttachedAt: null,
    state: "prepared"
  };
  const records = readRecords(owner.scope).filter((item) => item.sourceUri !== input.sourceUri);
  const nextRecords = [record, ...records];
  writeRecords(owner.scope, nextRecords);
  for (const dropped of nextRecords.slice(MAX_RECORDS)) {
    if (dropped.preparedUri !== dropped.sourceUri) {
      void discardOwnedAccountFile(dropped.preparedUri, owner.scope).catch(() => {});
    }
    void discardOwnedAccountFile(dropped.sourceUri, owner.scope).catch(() => {});
  }
  assertStillActive(owner.scope, generation);
  return record;
}

export function updatePendingMediaUpload(localUploadId: string, patch: Partial<PendingMediaUploadRecord>) {
  const { generation, owner } = activeContext();
  let updated: PendingMediaUploadRecord | null = null;
  const records = readRecords(owner.scope).map((record) => {
    if (record.localUploadId !== localUploadId) return record;
    updated = { ...record, ...patch, ownerScope: owner.scope, schemaVersion: LOCAL_DATA_SCHEMA_VERSION };
    return updated;
  });
  if (!updated || !recordIsValid(updated, owner.scope)) throw new Error("media_upload_record_invalid");
  writeRecords(owner.scope, records);
  assertStillActive(owner.scope, generation);
  return updated;
}

export async function removePendingMediaUpload(localUploadId: string, removeFiles = true) {
  const { generation, owner } = activeContext();
  const records = readRecords(owner.scope);
  const record = records.find((item) => item.localUploadId === localUploadId);
  writeRecords(owner.scope, records.filter((item) => item.localUploadId !== localUploadId));
  if (removeFiles && record) {
    if (record.preparedUri !== record.sourceUri) {
      await discardOwnedAccountFile(record.preparedUri, owner.scope).catch(() => {});
    }
    await discardOwnedAccountFile(record.sourceUri, owner.scope).catch(() => {});
  }
  assertStillActive(owner.scope, generation);
}

export async function prunePendingMediaUploads() {
  const { generation, owner } = activeContext();
  const records = readRecords(owner.scope);
  const kept: PendingMediaUploadRecord[] = [];
  for (const record of records) {
    if (Date.now() - record.createdAt <= MAX_AGE_MS) kept.push(record);
    else {
      if (record.preparedUri !== record.sourceUri) {
        await discardOwnedAccountFile(record.preparedUri, owner.scope).catch(() => {});
      }
      await discardOwnedAccountFile(record.sourceUri, owner.scope).catch(() => {});
    }
  }
  writeRecords(owner.scope, kept);
  assertStillActive(owner.scope, generation);
  return kept;
}

export function clearMediaUploadRecoveryForScope(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_media_upload_owner");
  storeFor(scope).clearAll();
  stores.delete(scope);
}
