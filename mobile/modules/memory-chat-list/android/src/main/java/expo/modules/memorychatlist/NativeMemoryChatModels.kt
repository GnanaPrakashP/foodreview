package expo.modules.memorychatlist

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class NativeMemoryChatGrouping(
  @Field val showSender: Boolean = false,
  @Field val showTail: Boolean = false,
  @Field val spacing: String = "break"
) : Record

class NativeMemoryChatReplyPreview(
  @Field val authorLabel: String = "",
  @Field val body: String = "",
  @Field val logicalMessageId: String = ""
) : Record

class NativeMemoryChatRow(
  @Field val accessibilityLabel: String = "",
  @Field val authorName: String = "",
  @Field val body: String = "",
  @Field val clientId: String? = null,
  @Field val createdAt: String = "",
  @Field val deliveryState: String = "sent",
  @Field val direction: String = "incoming",
  @Field val grouping: NativeMemoryChatGrouping = NativeMemoryChatGrouping(),
  @Field val itemType: String = "incoming-text",
  @Field val key: String = "",
  @Field val logicalMessageId: String = "",
  @Field val replyPreview: NativeMemoryChatReplyPreview? = null,
  @Field val senderLabel: String = "",
  @Field val sourceId: String = "",
  @Field val sourceType: String = "message",
  @Field val timestampLabel: String = ""
) : Record

class NativeMemoryChatAnchor(
  @Field val generation: Int = 0,
  @Field val kind: String = "latest",
  @Field val key: String = ""
) : Record

class NativeMemoryChatScrollCommand(
  @Field val generation: Int = 0,
  @Field val kind: String = "none",
  @Field val key: String = ""
) : Record

/**
 * Pure reusable-cell state used by the holder and local unit tests. Keeping the
 * reset contract free of Android UI classes makes stale reply/delivery/private
 * accessibility data executable as a JVM gate.
 */
internal class NativeMemoryChatReusableState {
  var accessibilityLabel = ""
    private set
  var body = ""
    private set
  var deliveryState = "sent"
    private set
  var key = ""
    private set
  var replyAuthor = ""
    private set
  var replyBody = ""
    private set
  var selected = false
    private set

  fun bind(row: NativeMemoryChatRow, isSelected: Boolean) {
    accessibilityLabel = row.accessibilityLabel
    body = row.body
    deliveryState = row.deliveryState
    key = row.key
    replyAuthor = row.replyPreview?.authorLabel.orEmpty()
    replyBody = row.replyPreview?.body.orEmpty()
    selected = isSelected
  }

  fun reset() {
    accessibilityLabel = ""
    body = ""
    deliveryState = "sent"
    key = ""
    replyAuthor = ""
    replyBody = ""
    selected = false
  }
}

internal fun nativeMemoryChatStableId(value: String): Long {
  var hash = -0x340d631b7bdddcdbL
  value.forEach {
    hash = hash xor it.code.toLong()
    hash *= 0x100000001b3L
  }
  return hash
}

internal fun nativeMemoryChatFingerprint(row: NativeMemoryChatRow) = listOf(
  row.accessibilityLabel,
  row.authorName,
  row.body,
  row.clientId,
  row.createdAt,
  row.deliveryState,
  row.direction,
  row.grouping.showSender,
  row.grouping.showTail,
  row.grouping.spacing,
  row.itemType,
  row.logicalMessageId,
  row.replyPreview?.authorLabel,
  row.replyPreview?.body,
  row.replyPreview?.logicalMessageId,
  row.senderLabel,
  row.sourceId,
  row.sourceType,
  row.timestampLabel
).joinToString("\u001f")
