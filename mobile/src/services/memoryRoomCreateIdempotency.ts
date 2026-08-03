type MemoryRoomCreateRequest = {
  fingerprint: string;
  idempotencyKey: string;
};

type MemoryRoomCreateIdempotencyOptions = {
  capacity?: number;
  createKey: () => string;
};

export function createMemoryRoomIdempotencyCoordinator({
  capacity = 32,
  createKey
}: MemoryRoomCreateIdempotencyOptions) {
  const pending = new Map<string, string>();

  function begin(payload: unknown): MemoryRoomCreateRequest {
    const fingerprint = JSON.stringify(payload);
    const existing = pending.get(fingerprint);
    if (existing) return { fingerprint, idempotencyKey: existing };

    const idempotencyKey = createKey();
    pending.set(fingerprint, idempotencyKey);
    while (pending.size > Math.max(1, capacity)) {
      const oldest = pending.keys().next().value as string | undefined;
      if (!oldest) break;
      pending.delete(oldest);
    }
    return { fingerprint, idempotencyKey };
  }

  function complete(request: MemoryRoomCreateRequest) {
    if (pending.get(request.fingerprint) === request.idempotencyKey) {
      pending.delete(request.fingerprint);
    }
  }

  return { begin, complete };
}
