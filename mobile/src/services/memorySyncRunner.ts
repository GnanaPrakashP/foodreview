export type CursorSyncPage = {
  hasMore?: boolean;
  syncCursor?: string;
};

export type CursorSyncResult<TState> = {
  hasMore: boolean;
  state: TState;
  syncCursor: string;
};

export async function runCursorSync<TState, TPage extends CursorSyncPage>(input: {
  fetchPage: (cursor: string) => Promise<TPage>;
  initialCursor: string;
  initialState: TState;
  isActive: () => boolean;
  maxPages: number;
  mergePage: (state: TState, page: TPage) => TState;
  persistPage: (page: TPage, state: TState, nextCursor: string) => Promise<void>;
  yieldEveryPages: number;
}): Promise<CursorSyncResult<TState>> {
  let state = input.initialState;
  let cursor = input.initialCursor;

  for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
    if (!input.isActive()) throw new Error("memory_sync_cancelled");
    const page = await input.fetchPage(cursor);
    const nextCursor = typeof page.syncCursor === "string" && /^\d+$/.test(page.syncCursor)
      ? page.syncCursor
      : null;
    if (!nextCursor) throw new Error("memory_sync_cursor_missing");
    if (page.hasMore === true && nextCursor === cursor) {
      throw new Error("memory_sync_cursor_did_not_advance");
    }

    const nextState = input.mergePage(state, page);
    if (!input.isActive()) throw new Error("memory_sync_cancelled");
    // persistPage owns the transaction that applies this page and its cursor.
    // Cursor/state advance in memory only after that transaction succeeds.
    await input.persistPage(page, nextState, nextCursor);
    state = nextState;
    cursor = nextCursor;

    if (page.hasMore !== true) return { hasMore: false, state, syncCursor: cursor };
    if ((pageIndex + 1) % input.yieldEveryPages === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  // The caller can yield between chunks and resume from this last committed
  // cursor. No page or tombstone is skipped and the UI thread is not monopolized.
  return { hasMore: true, state, syncCursor: cursor };
}
