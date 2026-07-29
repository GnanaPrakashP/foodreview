export type MemoryChatProjectionTransition = {
  affectedRows: number;
  kind: "empty" | "full" | "insert" | "update";
};

export class MemoryChatIncrementalProjectionStore<TMessage = unknown, TRow = unknown> {
  lastTransition: Readonly<MemoryChatProjectionTransition>;
  clear(): void;
  project(input: {
    buildFull: () => TRow[];
    buildOwnTextRow: (message: TMessage) => TRow | null;
    dependencies: readonly unknown[];
    messageIdentity: (message: TMessage) => string;
    messages: TMessage[];
    rowIdentity: (row: TRow) => string;
  }): TRow[];
}
