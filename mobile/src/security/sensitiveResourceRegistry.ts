type SensitiveResourceCleanup = () => void | Promise<void>;

const cleanups = new Set<SensitiveResourceCleanup>();

export function registerSensitiveResourceCleanup(cleanup: SensitiveResourceCleanup) {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}

export async function clearRegisteredSensitiveResources() {
  const results = await Promise.allSettled(Array.from(cleanups, (cleanup) => cleanup()));
  return results.filter((result) => result.status === "rejected").length;
}
