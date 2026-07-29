package expo.modules.memorychatlist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeMemoryChatCellStateTest {
  private fun row(
    body: String = "hello",
    key: String = "message:1",
    reply: NativeMemoryChatReplyPreview? = null
  ) = NativeMemoryChatRow(
    accessibilityLabel = "A, $body, 10:30",
    authorName = "a",
    body = body,
    createdAt = "2026-07-29T10:30:00.000Z",
    deliveryState = "failed",
    direction = "incoming",
    grouping = NativeMemoryChatGrouping(
      showSender = true,
      showTail = true,
      spacing = "break"
    ),
    itemType = if (reply == null) "incoming-text" else "incoming-reply-text",
    key = key,
    logicalMessageId = key,
    replyPreview = reply,
    senderLabel = "A",
    sourceId = "1",
    timestampLabel = "10:30"
  )

  @Test
  fun resetClearsEveryContentBearingField() {
    val state = NativeMemoryChatReusableState()
    state.bind(
      row(
        reply = NativeMemoryChatReplyPreview(
          authorLabel = "B",
          body = "private reply",
          logicalMessageId = "message:0"
        )
      ),
      true
    )
    assertTrue(state.selected)
    assertEquals("private reply", state.replyBody)

    state.reset()

    assertEquals("", state.accessibilityLabel)
    assertEquals("", state.body)
    assertEquals("sent", state.deliveryState)
    assertEquals("", state.key)
    assertEquals("", state.replyAuthor)
    assertEquals("", state.replyBody)
    assertFalse(state.selected)
  }

  @Test
  fun stableIdentityIgnoresMutableContentButDiffFingerprintDoesNot() {
    val before = row(body = "pending")
    val after = row(body = "confirmed")
    assertEquals(
      nativeMemoryChatStableId(before.key),
      nativeMemoryChatStableId(after.key)
    )
    assertNotEquals(
      nativeMemoryChatFingerprint(before),
      nativeMemoryChatFingerprint(after)
    )
  }

  @Test
  fun distinctLogicalRowsHaveDistinctFixtureIds() {
    assertNotEquals(
      nativeMemoryChatStableId("message:1"),
      nativeMemoryChatStableId("message:2")
    )
  }
}
