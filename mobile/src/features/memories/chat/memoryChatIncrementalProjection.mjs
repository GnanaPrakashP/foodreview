function sameReferenceSequence(previous, next) {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

/**
 * Keeps the production newest-first chat projection incremental for the
 * ordinary text-send path. Complex timeline changes deliberately fall back to
 * the canonical full projector; a newest text insert or its confirmation
 * replaces only the new row and, when necessary, its immediate neighbour.
 */
export class MemoryChatIncrementalProjectionStore {
  constructor() {
    this.dependencies = null;
    this.messages = null;
    this.rows = [];
    this.lastTransition = Object.freeze({ affectedRows: 0, kind: "empty" });
  }

  clear() {
    this.dependencies = null;
    this.messages = null;
    this.rows = [];
    this.lastTransition = Object.freeze({ affectedRows: 0, kind: "empty" });
  }

  project({
    buildFull,
    buildOwnTextRow,
    dependencies,
    messageIdentity,
    messages,
    rowIdentity
  }) {
    const dependenciesStable = Boolean(
      this.dependencies &&
      sameReferenceSequence(this.dependencies, dependencies)
    );

    if (dependenciesStable && this.messages) {
      const previousMessages = this.messages;
      const appendedNewest = (
        messages.length === previousMessages.length + 1 &&
        previousMessages.every((message, index) => message === messages[index])
      );
      if (appendedNewest) {
        const source = messages[messages.length - 1];
        const row = buildOwnTextRow(source);
        if (row) {
          this.messages = messages;
          this.rows = [row, ...this.rows];
          this.lastTransition = Object.freeze({ affectedRows: Math.min(2, this.rows.length), kind: "insert" });
          return this.rows;
        }
      }

      if (messages.length === previousMessages.length) {
        const changed = [];
        for (let index = 0; index < messages.length; index += 1) {
          if (messages[index] !== previousMessages[index]) changed.push(index);
          if (changed.length > 1) break;
        }
        if (
          changed.length === 1 &&
          messageIdentity(messages[changed[0]]) === messageIdentity(previousMessages[changed[0]])
        ) {
          const row = buildOwnTextRow(messages[changed[0]]);
          const projectedIndex = row
            ? this.rows.findIndex((candidate) => rowIdentity(candidate) === rowIdentity(row))
            : -1;
          if (row && projectedIndex >= 0) {
            const nextRows = [...this.rows];
            nextRows[projectedIndex] = row;
            this.messages = messages;
            this.rows = nextRows;
            this.lastTransition = Object.freeze({ affectedRows: 1, kind: "update" });
            return this.rows;
          }
        }
      }
    }

    this.dependencies = [...dependencies];
    this.messages = messages;
    this.rows = buildFull();
    this.lastTransition = Object.freeze({ affectedRows: this.rows.length, kind: "full" });
    return this.rows;
  }
}
