package expo.modules.memorychatlist

import kotlin.math.max

internal enum class NativeMemoryChatRevealDecision {
  FAIL,
  REVEAL_EMPTY,
  REVEAL_ROWS,
  STALE,
  WAIT
}

internal enum class NativeMemoryChatResumeDecision {
  /** Already-built host: restoring visibility is the whole activation. */
  RESUME,
  /** Nothing reusable survives; run the full anchor/reveal handshake. */
  REVEAL_CYCLE
}

internal data class NativeMemoryChatResumeSnapshot(
  val adapterRows: Int,
  val attached: Boolean,
  val expectedRows: Int,
  /**
   * The reveal gate has passed at least once: measured bounds, applied anchor
   * and attached cells are all proven. Deliberately NOT "the user has seen
   * it" — a host warmed while Chat was inactive satisfies every precondition
   * without ever having been visible, and that is exactly the case that makes
   * the FIRST entry cheap rather than only later ones.
   */
  val hasSettledLayout: Boolean
)

/**
 * A settled host keeps its view tree, its measured layout and its scroll
 * position, so entering Chat should cost one alpha write. Running the reveal
 * handshake again would re-request layout and re-apply the entry anchor —
 * precisely the work retention and warming exist to avoid. Anything less than
 * a proven-complete host still takes the cold path.
 */
internal fun nativeMemoryChatResumeDecision(
  snapshot: NativeMemoryChatResumeSnapshot
): NativeMemoryChatResumeDecision = if (
  snapshot.hasSettledLayout &&
  snapshot.attached &&
  snapshot.expectedRows > 0 &&
  snapshot.adapterRows == snapshot.expectedRows
) {
  NativeMemoryChatResumeDecision.RESUME
} else {
  NativeMemoryChatResumeDecision.REVEAL_CYCLE
}

/**
 * Cells created during the CURRENT activation. This is the number that decides
 * whether retention plus recycling actually compose: a cold host creates one
 * viewport of cells on every entry, a retained one creates none after the
 * first because the pool and the attached cells both survived.
 */
internal class NativeMemoryChatActivationMetrics {
  var activations = 0
    private set
  private var createdAtActivationStart = 0

  fun onActivated(createdCells: Int) {
    activations += 1
    createdAtActivationStart = createdCells
  }

  fun createdThisActivation(createdCells: Int) =
    max(0, createdCells - createdAtActivationStart)
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

  fun current() = generation

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
