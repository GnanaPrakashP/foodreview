import * as FileSystem from "expo-file-system/legacy";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope
} from "@/security/cacheOwnership";

const PRIVATE_ROOT = `${FileSystem.cacheDirectory ?? ""}circlebites-private/v2`;
let activeOwnerScope: string | null = null;

function requireScope(scope: string | null | undefined) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_account_file_scope");
  return scope;
}

function ownerDirectory(scope: string) {
  return `${PRIVATE_ROOT}/${requireScope(scope)}`;
}

function safeExtension(uri: string) {
  const source = uri.split(/[?#]/, 1)[0] ?? "";
  const match = source.match(/\.([A-Za-z0-9]{1,8})$/);
  return match ? `.${match[1].toLowerCase()}` : ".bin";
}

function isDisposableAppCacheUri(uri: string) {
  return Boolean(FileSystem.cacheDirectory && uri.startsWith(FileSystem.cacheDirectory));
}

export function setAccountFileOwnerScope(scope: string | null) {
  activeOwnerScope = scope ? requireScope(scope) : null;
}

export function accountFileDirectoryForScope(scope: string) {
  return ownerDirectory(scope);
}

export async function ensureAccountFileDirectory(scope: string) {
  const directory = ownerDirectory(scope);
  if (!FileSystem.cacheDirectory) throw new Error("account_file_cache_unavailable");
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

export async function stageAccountFile(uri: string, category: string) {
  if (!uri) throw new Error("account_file_source_missing");
  const scope = requireScope(activeOwnerScope);
  const ownerGeneration = getActiveCacheGeneration();
  if (getActiveCacheOwner()?.scope !== scope || !isCacheGenerationActive(ownerGeneration)) {
    throw new Error("account_file_owner_inactive");
  }
  const directory = await ensureAccountFileDirectory(scope);
  if (uri.startsWith(`${directory}/`)) {
    if (getActiveCacheOwner()?.scope !== scope || !isCacheGenerationActive(ownerGeneration)) {
      throw new Error("account_file_owner_changed");
    }
    return uri;
  }
  const safeCategory = category.replace(/[^a-z0-9_-]/gi, "-").slice(0, 24) || "file";
  const destination = `${directory}/${safeCategory}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExtension(uri)}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  if (getActiveCacheOwner()?.scope !== scope || !isCacheGenerationActive(ownerGeneration)) {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
    if (isDisposableAppCacheUri(uri)) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
    throw new Error("account_file_owner_changed");
  }
  // Camera, picker, manipulator, compressor, and thumbnail libraries commonly
  // leave their output in the app cache. Once ownership is established by the
  // scoped copy, remove that unowned cache entry so a later account cannot find it.
  if (isDisposableAppCacheUri(uri)) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  return destination;
}

export async function discardTemporaryAccountFile(uri: string | null | undefined) {
  if (!uri || !isDisposableAppCacheUri(uri)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

export async function clearAccountFiles(scope: string) {
  const directory = ownerDirectory(scope);
  await FileSystem.deleteAsync(directory, { idempotent: true });
}

export async function accountFileCount(scope: string) {
  try {
    return (await FileSystem.readDirectoryAsync(ownerDirectory(scope))).length;
  } catch {
    return 0;
  }
}
