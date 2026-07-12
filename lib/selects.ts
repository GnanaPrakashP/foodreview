export const REVIEW_SELECT = [
  "id",
  "reviewer_name",
  "restaurant_id",
  "restaurant_name",
  "area",
  "restaurant_address",
  "restaurant_lat",
  "restaurant_lng",
  "items",
  "body",
  "tags",
  "photo_url",
  "photo_urls",
  "review_photos(media_asset_id, public_url, media_type, position)",
  "visibility",
  "deleted_at",
  "hidden_at",
  "reported_at",
  "status",
  "created_at",
].join(", ");

export const COMMENT_SELECT = "id, post_id, user_name, content, created_at";

export const NOTIFICATION_SELECT = [
  "id",
  "recipient_user_id",
  "actor_user_id",
  "recipient_name",
  "actor_name",
  "type",
  "title",
  "message",
  "entity_type",
  "entity_id",
  "metadata",
  "is_read",
  "post_id",
  "restaurant_name",
  "content",
  "read",
  "created_at",
  "updated_at",
  "deleted_at",
].join(", ");

export const LEGACY_NOTIFICATION_SELECT = [
  "id",
  "recipient_name",
  "actor_name",
  "type",
  "post_id",
  "restaurant_name",
  "content",
  "read",
  "created_at",
].join(", ");

export const NOTIFICATION_OWNERSHIP_SELECT = "id, recipient_user_id, recipient_name";
