package expo.modules.memorychatlist

internal enum class NativeMemoryChatRevealDecision {
  FAIL,
  REVEAL_EMPTY,
  REVEAL_ROWS,
  STALE,
  WAIT
}

internal data class NativeMemoryChatRevealSnapshot(
  val adapterRows: Int,
  val anchorApplied: Boolean,
  val anchorVisible: Boolean,
  val attachedMessageCells: Int,
  val boundsReady: Boolean,
  val expectedRows: Int,
  val firstVisiblePosition: Int,
  val lastVisiblePosition: Int,
  val visibleCellInsideViewport: Boolean
)

/**
 * Content-free reveal decision state. Android owns measurement and anchoring;
 * this gate only makes the reveal preconditions and stale-generation handling
 * executable in local JVM tests.
 */
internal class NativeMemoryChatRevealGate {
  private var generation = 0L
  private var revealedGeneration = Long.MIN_VALUE

  fun nextGeneration(): Long {
    generation += 1
    return generation
  }

  fun invalidate() {
    generation += 1
  }

  fun isCurrent(candidate: Long) = candidate == generation

  fun evaluate(
    candidate: Long,
    finalAttempt: Boolean,
    snapshot: NativeMemoryChatRevealSnapshot
  ): NativeMemoryChatRevealDecision {
    if (!isCurrent(candidate)) return NativeMemoryChatRevealDecision.STALE
    if (
      snapshot.expectedRows == 0 &&
      snapshot.adapterRows == 0 &&
      snapshot.boundsReady &&
      snapshot.anchorApplied
    ) {
      return NativeMemoryChatRevealDecision.REVEAL_EMPTY
    }
    if (
      snapshot.expectedRows > 0 &&
      snapshot.adapterRows == snapshot.expectedRows &&
      snapshot.boundsReady &&
      snapshot.anchorApplied &&
      snapshot.anchorVisible &&
      snapshot.attachedMessageCells > 0 &&
      snapshot.firstVisiblePosition >= 0 &&
      snapshot.lastVisiblePosition >= snapshot.firstVisiblePosition &&
      snapshot.visibleCellInsideViewport
    ) {
      return NativeMemoryChatRevealDecision.REVEAL_ROWS
    }
    return if (finalAttempt) {
      NativeMemoryChatRevealDecision.FAIL
    } else {
      NativeMemoryChatRevealDecision.WAIT
    }
  }

  fun commitReveal(candidate: Long): Boolean {
    if (!isCurrent(candidate) || revealedGeneration == candidate) return false
    revealedGeneration = candidate
    return true
  }
}
