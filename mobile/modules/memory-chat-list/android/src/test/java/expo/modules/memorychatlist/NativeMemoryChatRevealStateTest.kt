package expo.modules.memorychatlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMemoryChatRevealStateTest {
  private fun readyRows() = NativeMemoryChatRevealSnapshot(
    adapterRows = 50,
    anchorApplied = true,
    anchorVisible = true,
    attachedMessageCells = 8,
    boundsReady = true,
    expectedRows = 50,
    firstVisiblePosition = 42,
    lastVisiblePosition = 49,
    visibleCellInsideViewport = true
  )

  @Test
  fun revealsRowsOnlyAfterEveryAnchorAndVisibilityCondition() {
    val gate = NativeMemoryChatRevealGate()
    val generation = gate.nextGeneration()

    assertEquals(
      NativeMemoryChatRevealDecision.REVEAL_ROWS,
      gate.evaluate(generation, finalAttempt = false, readyRows())
    )
    assertTrue(gate.commitReveal(generation))
    assertFalse(gate.commitReveal(generation))
  }

  @Test
  fun adapterBeforeLayoutAndLayoutBeforeAdapterBothWait() {
    val gate = NativeMemoryChatRevealGate()
    val generation = gate.nextGeneration()

    assertEquals(
      NativeMemoryChatRevealDecision.WAIT,
      gate.evaluate(
        generation,
        finalAttempt = false,
        readyRows().copy(boundsReady = false)
      )
    )
    assertEquals(
      NativeMemoryChatRevealDecision.WAIT,
      gate.evaluate(
        generation,
        finalAttempt = false,
        readyRows().copy(adapterRows = 0, attachedMessageCells = 0)
      )
    )
  }

  @Test
  fun emptyRoomHasASeparateValidRevealPath() {
    val gate = NativeMemoryChatRevealGate()
    val generation = gate.nextGeneration()

    assertEquals(
      NativeMemoryChatRevealDecision.REVEAL_EMPTY,
      gate.evaluate(
        generation,
        finalAttempt = false,
        NativeMemoryChatRevealSnapshot(
          adapterRows = 0,
          anchorApplied = true,
          anchorVisible = false,
          attachedMessageCells = 0,
          boundsReady = true,
          expectedRows = 0,
          firstVisiblePosition = -1,
          lastVisiblePosition = -1,
          visibleCellInsideViewport = false
        )
      )
    )
  }

  @Test
  fun staleRoomOrUnmountGenerationCannotReveal() {
    val gate = NativeMemoryChatRevealGate()
    val stale = gate.nextGeneration()
    gate.invalidate()

    assertEquals(
      NativeMemoryChatRevealDecision.STALE,
      gate.evaluate(stale, finalAttempt = true, readyRows())
    )
    assertFalse(gate.commitReveal(stale))
  }

  @Test
  fun boundedFinalAttemptFailsInsteadOfRevealingWrongAnchor() {
    val gate = NativeMemoryChatRevealGate()
    val generation = gate.nextGeneration()

    assertEquals(
      NativeMemoryChatRevealDecision.FAIL,
      gate.evaluate(
        generation,
        finalAttempt = true,
        readyRows().copy(anchorVisible = false)
      )
    )
  }

  @Test
  fun alphaOneCannotBeCommittedWithoutVisibleMessageCells() {
    val gate = NativeMemoryChatRevealGate()
    val generation = gate.nextGeneration()

    assertEquals(
      NativeMemoryChatRevealDecision.FAIL,
      gate.evaluate(
        generation,
        finalAttempt = true,
        readyRows().copy(
          attachedMessageCells = 0,
          visibleCellInsideViewport = false
        )
      )
    )
  }
}
