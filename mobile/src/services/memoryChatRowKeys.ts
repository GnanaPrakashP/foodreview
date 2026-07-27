import type { MemoryMessage } from "@/types/models";
import { memoryMessageLogicalKey } from "@/services/memoryMessageReconciliation.mjs";

/**
 * React identity is persisted client identity, not session memory. This keeps
 * the same bubble mounted through optimistic, retry, realtime, and HTTP ack.
 */
export function memoryChatRowKey(message: MemoryMessage | string) {
  return typeof message === "string" ? message : memoryMessageLogicalKey(message);
}
