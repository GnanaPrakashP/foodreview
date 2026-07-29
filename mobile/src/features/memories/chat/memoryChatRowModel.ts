import type {
  MemoryDish,
  MemoryMessage,
  MemoryPhoto,
  MemoryRoom
} from "@/types/models";
import { memoryChatRowKey } from "@/services/memoryChatRowKeys";
import { compareMemoryMessages } from "@/services/memoryMessageReconciliation.mjs";
import { formatDisplayDate, formatDisplayTime } from "@/utils/datetime";

export type ChatRowDirection = "incoming" | "outgoing";

export type ChatRowItemType =
  | "audio"
  | "date"
  | "dish"
  | "incoming-reply-text"
  | "incoming-text"
  | "outgoing-reply-text"
  | "outgoing-text"
  | "system"
  | "unread"
  | "visual-media";

export type LightweightReplyPreview = {
  authorLabel: string;
  body: string;
  logicalMessageId: string;
};

export type LightweightMediaPreview = {
  blurhash: string | null;
  durationMs: number | null;
  height: number | null;
  id: string;
  kind: "audio" | "image" | "video";
  posterUrl: string | null;
  thumbnailUrl: string | null;
  url: string;
  width: number | null;
};

export type ChatGroupingMetadata = {
  showSender: boolean;
  showTail: boolean;
  spacing: "break" | "grouped";
};

export type ChatRowViewModel = {
  accessibilityLabel: string;
  authorName: string;
  body: string;
  clientId: string | null;
  createdAt: string;
  deliveryState:
    | "failed"
    | "pending"
    | "processing"
    | "processing_delayed"
    | "processing_failed"
    | "rejected"
    | "retrying"
    | "sent"
    | "uploading";
  direction: ChatRowDirection;
  grouping: ChatGroupingMetadata;
  itemType: ChatRowItemType;
  key: string;
  logicalMessageId: string;
  media: readonly LightweightMediaPreview[];
  replyPreview: LightweightReplyPreview | null;
  senderLabel: string;
  sourceId: string;
  sourceType: "dish" | "media" | "message" | "system";
  timestampLabel: string;
};

type TimelineItem =
  | { createdAt: string; id: string; type: "dish"; value: MemoryDish }
  | { createdAt: string; id: string; type: "media"; value: MemoryPhoto }
  | { createdAt: string; id: string; type: "message"; value: MemoryMessage };

type CachedRow = {
  row: ChatRowViewModel;
  signature: string;
};

function mediaKind(media: MemoryPhoto): LightweightMediaPreview["kind"] {
  if (media.mediaType === "audio") return "audio";
  if (media.mediaType === "video") return "video";
  return "image";
}

function mediaPreview(media: MemoryPhoto): LightweightMediaPreview {
  return {
    blurhash: media.blurhash ?? null,
    durationMs: media.durationMs ?? null,
    height: media.imageHeight,
    id: media.id,
    kind: mediaKind(media),
    posterUrl: media.posterUrl ?? null,
    thumbnailUrl: media.thumbnailUrl ?? null,
    url: media.publicUrl,
    width: media.imageWidth
  };
}

function timelineSender(item: TimelineItem) {
  if (item.type === "message") return item.value.authorName;
  if (item.type === "media") return item.value.uploaderName;
  return item.value.addedBy;
}

function timelineSenderLabel(item: TimelineItem) {
  if (item.type === "message") return item.value.authorDisplayName;
  if (item.type === "media") return item.value.uploaderDisplayName;
  return item.value.addedByDisplayName;
}

function dayKey(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    : value.slice(0, 10);
}

function normalizedDeliveryState(
  state: MemoryMessage["deliveryStatus"]
): ChatRowViewModel["deliveryState"] {
  return state ?? "sent";
}

function itemTypeForMessage(
  message: MemoryMessage,
  direction: ChatRowDirection
): ChatRowItemType {
  const audioOnly =
    message.attachments.length > 0 &&
    message.attachments.every((attachment) => attachment.mediaType === "audio");
  if (audioOnly) return "audio";
  if (message.attachments.some((attachment) => attachment.mediaType !== "audio")) {
    return "visual-media";
  }
  if (message.replyToMessage) {
    return direction === "outgoing"
      ? "outgoing-reply-text"
      : "incoming-reply-text";
  }
  return direction === "outgoing" ? "outgoing-text" : "incoming-text";
}

function signatureForRow(row: ChatRowViewModel) {
  return JSON.stringify([
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
    row.key,
    row.logicalMessageId,
    row.media,
    row.replyPreview,
    row.senderLabel,
    row.sourceId,
    row.sourceType,
    row.timestampLabel
  ]);
}

function stableRow(
  cache: Map<string, CachedRow>,
  next: ChatRowViewModel
): ChatRowViewModel {
  const signature = signatureForRow(next);
  const existing = cache.get(next.key);
  if (existing?.signature === signature) return existing.row;
  cache.set(next.key, { row: next, signature });
  return next;
}

/**
 * Room-owned incremental projection. It returns a new ordered array for the
 * list, but preserves the object identity of every unchanged row. A delivery
 * update replaces only that logical row; grouping changes can replace at most
 * its two neighbours.
 */
export class MemoryChatRowModelStore {
  private cache = new Map<string, CachedRow>();
  private roomId: string | null = null;

  clear() {
    this.cache.clear();
    this.roomId = null;
  }

  project(
    room: MemoryRoom,
    myUsername: string,
    unreadAnchorMessageId?: string | null
  ): ChatRowViewModel[] {
    if (this.roomId !== room.id) {
      this.cache.clear();
      this.roomId = room.id;
    }

    const timeline: TimelineItem[] = [
      ...room.messages.map((message): TimelineItem => ({
        createdAt: message.createdAt,
        id: `message:${messageChatIdentity(message)}`,
        type: "message",
        value: message
      })),
      ...room.photos
        .filter((photo) => !photo.messageId)
        .map((photo): TimelineItem => ({
          createdAt: photo.createdAt,
          id: `media:${photo.id}`,
          type: "media",
          value: photo
        })),
      ...room.dishes.map((dish): TimelineItem => ({
        createdAt: dish.createdAt,
        id: `dish:${dish.id}`,
        type: "dish",
        value: dish
      }))
    ];

    const sorted = timeline
      .sort((left, right) => {
        if (left.type === "message" && right.type === "message") {
          return -compareMemoryMessages(left.value, right.value);
        }
        return (
          new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime() ||
          right.id.localeCompare(left.id)
        );
      })
      .filter((item) => {
        if (item.type === "message") {
          return Boolean(item.value.body.trim()) || item.value.attachments.length > 0;
        }
        if (item.type === "media") return Boolean(item.value.publicUrl);
        return true;
      });

    const rows: ChatRowViewModel[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const item = sorted[index];
      const older = sorted[index + 1] ?? null;
      const newer = sorted[index - 1] ?? null;
      const sender = timelineSender(item);
      const mine = sender === myUsername;
      const direction: ChatRowDirection = mine ? "outgoing" : "incoming";
      const groupedWithOlder = Boolean(
        older &&
        older.type !== "dish" &&
        item.type !== "dish" &&
        timelineSender(older) === sender &&
        dayKey(older.createdAt) === dayKey(item.createdAt)
      );
      const groupedWithNewer = Boolean(
        newer &&
        newer.type !== "dish" &&
        item.type !== "dish" &&
        timelineSender(newer) === sender &&
        dayKey(newer.createdAt) === dayKey(item.createdAt)
      );
      const grouping: ChatGroupingMetadata = {
        showSender: !mine && !groupedWithOlder,
        showTail: !groupedWithNewer,
        spacing: groupedWithNewer ? "grouped" : "break"
      };

      let row: ChatRowViewModel;
      if (item.type === "message") {
        const message = item.value;
        const reply = message.replyToMessage;
        const key = memoryChatRowKey(message);
        row = {
          accessibilityLabel: [
            message.authorDisplayName,
            message.body.trim() || "Message",
            formatDisplayTime(message.createdAt),
            normalizedDeliveryState(message.deliveryStatus) === "sent"
              ? ""
              : normalizedDeliveryState(message.deliveryStatus)
          ].filter(Boolean).join(", "),
          authorName: message.authorName,
          body: message.body.trim(),
          clientId: message.clientId,
          createdAt: message.createdAt,
          deliveryState: normalizedDeliveryState(message.deliveryStatus),
          direction,
          grouping,
          itemType: itemTypeForMessage(message, direction),
          key,
          logicalMessageId: key,
          media: message.attachments.map(mediaPreview),
          replyPreview: reply
            ? {
              authorLabel: reply.authorDisplayName,
              body: reply.body.trim() || "Message",
              logicalMessageId: reply.id
            }
            : null,
          senderLabel: message.authorDisplayName,
          sourceId: message.id,
          sourceType: "message",
          timestampLabel: formatDisplayTime(message.createdAt)
        };
      } else if (item.type === "media") {
        const media = item.value;
        row = {
          accessibilityLabel: `${media.uploaderDisplayName}, Media, ${formatDisplayTime(media.createdAt)}`,
          authorName: media.uploaderName,
          body: "",
          clientId: null,
          createdAt: media.createdAt,
          deliveryState: "sent",
          direction,
          grouping,
          itemType: media.mediaType === "audio" ? "audio" : "visual-media",
          key: `media:${media.id}`,
          logicalMessageId: `media:${media.id}`,
          media: [mediaPreview(media)],
          replyPreview: null,
          senderLabel: media.uploaderDisplayName,
          sourceId: media.id,
          sourceType: "media",
          timestampLabel: formatDisplayTime(media.createdAt)
        };
      } else {
        const dish = item.value;
        row = {
          accessibilityLabel: `${dish.addedByDisplayName} added ${dish.dishName}`,
          authorName: dish.addedBy,
          body: `${dish.addedByDisplayName} added ${dish.dishName}`,
          clientId: null,
          createdAt: dish.createdAt,
          deliveryState: "sent",
          direction,
          grouping: {
            showSender: false,
            showTail: false,
            spacing: "break"
          },
          itemType: "dish",
          key: `dish:${dish.id}`,
          logicalMessageId: `dish:${dish.id}`,
          media: [],
          replyPreview: null,
          senderLabel: dish.addedByDisplayName,
          sourceId: dish.id,
          sourceType: "dish",
          timestampLabel: formatDisplayTime(dish.createdAt)
        };
      }

      rows.push(stableRow(this.cache, row));

      if (
        unreadAnchorMessageId &&
        item.type === "message" &&
        item.value.id === unreadAnchorMessageId
      ) {
        const unreadRow: ChatRowViewModel = {
          accessibilityLabel: "Unread messages",
          authorName: "",
          body: "Unread messages",
          clientId: null,
          createdAt: item.createdAt,
          deliveryState: "sent",
          direction: "incoming",
          grouping: {
            showSender: false,
            showTail: false,
            spacing: "break"
          },
          itemType: "unread",
          key: `unread:${unreadAnchorMessageId}`,
          logicalMessageId: `unread:${unreadAnchorMessageId}`,
          media: [],
          replyPreview: null,
          senderLabel: "",
          sourceId: unreadAnchorMessageId,
          sourceType: "system",
          timestampLabel: ""
        };
        rows.push(stableRow(this.cache, unreadRow));
      }

      if (older && dayKey(older.createdAt) !== dayKey(item.createdAt)) {
        const dateKey = dayKey(item.createdAt);
        const dateRow: ChatRowViewModel = {
          accessibilityLabel: formatDisplayDate(item.createdAt),
          authorName: "",
          body: formatDisplayDate(item.createdAt),
          clientId: null,
          createdAt: item.createdAt,
          deliveryState: "sent",
          direction: "incoming",
          grouping: {
            showSender: false,
            showTail: false,
            spacing: "break"
          },
          itemType: "date",
          key: `date:${dateKey}`,
          logicalMessageId: `date:${dateKey}`,
          media: [],
          replyPreview: null,
          senderLabel: "",
          sourceId: dateKey,
          sourceType: "system",
          timestampLabel: ""
        };
        rows.push(stableRow(this.cache, dateRow));
      }
    }

    const liveKeys = new Set(rows.map((row) => row.key));
    for (const key of this.cache.keys()) {
      if (!liveKeys.has(key)) this.cache.delete(key);
    }
    return rows;
  }
}

function messageChatIdentity(message: MemoryMessage) {
  return memoryChatRowKey(message);
}
