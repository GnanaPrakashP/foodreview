package expo.modules.memorychatlist

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeMemoryChatResumeStateTest {
  private fun retainedHost() = NativeMemoryChatResumeSnapshot(
    adapterRows = 50,
    attached = true,
    expectedRows = 50,
    hasSettledLayout = true
  )

  @Test
  fun aProvenRetainedHostResumesWithoutAnotherRevealCycle() {
    assertEquals(
      NativeMemoryChatResumeDecision.RESUME,
      nativeMemoryChatResumeDecision(retainedHost())
    )
  }

  @Test
  fun aHostWhoseLayoutNeverSettledTakesTheColdPath() {
    assertEquals(
      NativeMemoryChatResumeDecision.REVEAL_CYCLE,
      nativeMemoryChatResumeDecision(
        retainedHost().copy(hasSettledLayout = false)
      )
    )
  }

  @Test
  fun aHostWarmedWhileInactiveResumesWithoutEverHavingBeenVisible() {
    // The warm path settles layout and anchor with alpha still at zero, so the
    // FIRST entry has to qualify as a resume exactly like a later one. Nothing
    // in the decision may depend on the host having been seen.
    assertEquals(
      NativeMemoryChatResumeDecision.RESUME,
      nativeMemoryChatResumeDecision(retainedHost())
    )
  }

  @Test
  fun aDetachedHostTakesTheColdPath() {
    assertEquals(
      NativeMemoryChatResumeDecision.REVEAL_CYCLE,
      nativeMemoryChatResumeDecision(retainedHost().copy(attached = false))
    )
  }

  @Test
  fun anInFlightRowUpdateTakesTheColdPath() {
    // Rows submitted but not yet applied: resuming here would reveal a list
    // whose adapter does not match what JavaScript believes it is showing.
    assertEquals(
      NativeMemoryChatResumeDecision.REVEAL_CYCLE,
      nativeMemoryChatResumeDecision(retainedHost().copy(adapterRows = 42))
    )
  }

  @Test
  fun anEmptyHostTakesTheColdPath() {
    assertEquals(
      NativeMemoryChatResumeDecision.REVEAL_CYCLE,
      nativeMemoryChatResumeDecision(
        retainedHost().copy(adapterRows = 0, expectedRows = 0)
      )
    )
  }

  @Test
  fun createdCellsAreCountedPerActivationNotCumulatively() {
    val metrics = NativeMemoryChatActivationMetrics()

    // Cold entry: the host builds one viewport of cells.
    metrics.onActivated(0)
    assertEquals(1, metrics.activations)
    assertEquals(17, metrics.createdThisActivation(17))

    // Second entry on a retained host: the pool supplied every cell, so this
    // activation created none. Cumulative createdCells is unchanged at 17.
    metrics.onActivated(17)
    assertEquals(2, metrics.activations)
    assertEquals(0, metrics.createdThisActivation(17))

    // Cells created later in the same activation still count against it.
    assertEquals(3, metrics.createdThisActivation(20))
  }

  @Test
  fun activationCountersNeverGoNegative() {
    val metrics = NativeMemoryChatActivationMetrics()
    metrics.onActivated(12)
    assertEquals(0, metrics.createdThisActivation(4))
  }
}
