import type { MemoryMessage, MemoryRoom } from "@/types/models";

export function memoryMessageClientCreatedAt(message: MemoryMessage): string;
export function memoryMessageServerId(message: MemoryMessage): string | null;
export function memoryMessageLogicalKey(message: MemoryMessage): string;
export function compareMemoryMessages(first: MemoryMessage, second: MemoryMessage): number;
export function sortMemoryMessages(messages: MemoryMessage[]): MemoryMessage[];
export function mergeMemoryMessage(existing: MemoryMessage, incoming: MemoryMessage): MemoryMessage;
export function upsertMemoryMessage(messages: MemoryMessage[], incoming: MemoryMessage): MemoryMessage[];
export function mergeMemoryMessageSnapshot(currentMessages: MemoryMessage[], snapshotMessages: MemoryMessage[]): MemoryMessage[];
export function removeMemoryMessage(messages: MemoryMessage[], identity: string): MemoryMessage[];
export function findMemoryMessage(messages: MemoryMessage[], identity: string): MemoryMessage | undefined;
export function removeMemoryMessageProjections(room: MemoryRoom, identities: Iterable<string>): MemoryRoom;
