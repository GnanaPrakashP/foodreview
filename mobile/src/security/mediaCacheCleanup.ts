type CacheClear = () => Promise<boolean>;

export async function clearImageCachesWithRetry(
  clearMemory: CacheClear,
  clearDisk: CacheClear,
  maxAttempts = 2
) {
  let memoryCleared = false;
  let diskCleared = false;
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    const results: [PromiseSettledResult<boolean>, PromiseSettledResult<boolean>] = await Promise.allSettled([
      memoryCleared ? Promise.resolve(true) : clearMemory(),
      diskCleared ? Promise.resolve(true) : clearDisk()
    ]) as [PromiseSettledResult<boolean>, PromiseSettledResult<boolean>];
    const memory = results[0];
    const disk = results[1];
    memoryCleared = memoryCleared || (memory.status === "fulfilled" && memory.value === true);
    diskCleared = diskCleared || (disk.status === "fulfilled" && disk.value === true);
    if (memoryCleared && diskCleared) return { attempts: attempt, diskCleared, memoryCleared };
  }
  throw new Error(!memoryCleared && !diskCleared
    ? "image_memory_and_disk_cache_cleanup_failed"
    : !memoryCleared
      ? "image_memory_cache_cleanup_failed"
      : "image_disk_cache_cleanup_failed");
}
