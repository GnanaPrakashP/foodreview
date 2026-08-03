import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import { removeMemoryMessageProjections } from "@/services/memoryMessageReconciliation.mjs";
import type { MemoryRoom } from "@/types/models";

// Process-lifetime tombstones fence room refreshes that captured an optimistic
// snapshot before the user discarded it. SQLite remains the durable outbox;
// these identities only bridge the short race until its delete has committed.
const dismissedMemoryOutboxIds = new Set<string>();
registerSensitiveResourceCleanup(() => dismissedMemoryOutboxIds.clear());

export function markDismissedMemoryOutboxMessage(identity: string) {
  dismissedMemoryOutboxIds.add(identity);
}

export function isDismissedMemoryOutboxMessage(identity?: string | null) {
  return Boolean(identity && dismissedMemoryOutboxIds.has(identity));
}

export function withoutDismissedMemoryOutboxMessages(room: MemoryRoom) {
  return removeMemoryMessageProjections(room, dismissedMemoryOutboxIds);
}
