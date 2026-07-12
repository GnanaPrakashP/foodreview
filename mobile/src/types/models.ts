import type { Session } from "@supabase/supabase-js";
import type { OccasionType } from "@/features/occasions/occasionTypes";

export type Visibility = "public" | "circle" | "me";
export type AccountType = "public" | "private";
export type ReviewStatus = "active" | "deleted" | "hidden" | "reported" | "removed";

export type FoodItem = {
  canonicalDishId?: string | null;
  canonicalDishName?: string | null;
  canonicalDishSource?: string | null;
  dishClusterKey?: string | null;
  dishFamilyId?: string | null;
  dishFamilyName?: string | null;
  dishNormalizationConfidence?: number | null;
  name: string;
  rawDishName?: string;
  rating: number;
};

export type ReviewMedia = {
  accessClass: "public_post" | "circle_post" | "private_post" | "legacy_public";
  aspectRatio: number | null;
  expiresAt: string | null;
  height: number | null;
  publicUrl: string;
  mediaType: "image" | "video";
  mediaAssetId?: string | null;
  placeholder: string | null;
  posterUrl: string | null;
  position: number;
  thumbnailUrl: string | null;
  width: number | null;
};

export type Profile = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  accountType: AccountType;
  trustScore: number;
  trustLevel: string;
  confirmedRecommendationsCount: number;
  positiveConfirmationsCount: number;
  negativeConfirmationsCount: number;
  totalFeedbackPoints: number;
  createdAt: string;
};

export type ActorProfile = {
  userId: string;
  username: string;
  displayName: string;
  accountType: AccountType;
};

export type ReviewPost = {
  id: string;
  reviewerName: string;
  reviewerUsername: string;
  authorName: string;
  authorInitials: string;
  restaurantId: string | null;
  restaurantName: string;
  area: string | null;
  restaurantAddress: string | null;
  restaurantLat: number | null;
  restaurantLng: number | null;
  restaurantPrimaryType: string | null;
  restaurantTypes: string[];
  items: FoodItem[];
  body: string | null;
  tags: string[];
  media: ReviewMedia[];
  visibility: Visibility;
  status: ReviewStatus;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  bookmarkedByMe: boolean;
  circleRequestAccountType?: AccountType | null;
  circleRequestStatus?: "idle" | "loading" | "pending" | "joined";
  feedContextLabel?: string;
  feedSectionLabel?: string;
  isPublicDiscovery?: boolean;
  foodReaction?: "MUST_TRY" | "NOT_WORTH_IT" | null;
  mustTryCount?: number;
  notWorthItCount?: number;
};

export type FeedPage = {
  nextCursor?: string | null;
  posts: ReviewPost[];
  viewerName: string;
};

export type PostEngagementState = {
  postId: string;
  likedByMe: boolean;
  likeCount: number;
  bookmarkedByMe: boolean;
  commentCount: number;
  foodReaction: "MUST_TRY" | "NOT_WORTH_IT" | null;
  mustTryCount: number;
  notWorthItCount: number;
};

export type NotificationType =
  | "CIRCLE_REQUEST_RECEIVED"
  | "CIRCLE_REQUEST_ACCEPTED"
  | "CIRCLE_REQUEST_REJECTED"
  | "ADDED_TO_CIRCLE"
  | "MUTUAL_CIRCLE_CREATED"
  | "POST_LIKED"
  | "POST_COMMENTED"
  | "THREAD_REPLY"
  | "CIRCLE_POST_CREATED"
  | "TABLE_MEMORY_INVITE"
  | "COMMON_RESTAURANT_SCORE_UPDATED"
  | "ACHIEVEMENT_UNLOCKED"
  | "SYSTEM_ANNOUNCEMENT"
  | "circle_request"
  | "circle_accepted"
  | "circle_added"
  | "circle_post"
  | "like"
  | "comment"
  | "also_commented";

export type AppNotification = {
  id: string;
  recipientUserId: string | null;
  actorUserId: string | null;
  recipientName: string;
  actorName: string | null;
  actorDisplayName: string;
  actorAvatarUrl: string | null;
  type: NotificationType | string;
  title: string | null;
  message: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  isRead: boolean;
  postId: string | null;
  restaurantName: string | null;
  content: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  thumbnailUrl: string | null;
  displayMessage: string;
  destination:
    | { type: "notification" }
    | { type: "person"; username: string }
    | { type: "post"; postId: string };
  circleRequestStatus: "pending" | "accepted" | "rejected" | "none";
};

export type NotificationsPage = {
  notifications: AppNotification[];
  unreadCount: number;
};

export type PostComment = {
  id: string;
  postId: string;
  userName: string;
  authorName: string;
  authorInitials: string;
  content: string;
  createdAt: string;
};

export type ProfileStats = {
  totalVisits: number;
  uniquePlaces: number;
  uniqueDishes: number;
};

export type ProfilePageData = {
  profile: Profile;
  displayName: string;
  stats: ProfileStats;
  circleCount: number;
  posts: ReviewPost[];
  nextPostsCursor: string | null;
};

export type ProfilePostsPage = {
  posts: ReviewPost[];
  nextCursor: string | null;
};

export type AuthSnapshot = {
  session: Session | null;
  profile: ActorProfile | null;
};

export type MemoryRoomStatus = "draft" | "published" | "archived";

export type MemoryParticipant = {
  id: string;
  username: string;
  displayName: string;
  role: "owner" | "participant";
  joinedAt: string;
};

export type MemoryMessage = {
  id: string;
  roomId: string;
  authorName: string;
  authorDisplayName: string;
  body: string;
  attachments: MemoryPhoto[];
  createdAt: string;
  deliveryStatus?: "pending" | "sent" | "failed";
  editedAt: string | null;
  replyToMessageId: string | null;
  replyToMessage: {
    id: string;
    authorDisplayName: string;
    body: string;
  } | null;
};

export type MemoryStopType = "restaurant" | "cafe" | "bar" | "bowling" | "movie" | "activity" | "other";

export type MemoryStop = {
  id: string;
  roomId: string;
  stopType: MemoryStopType;
  name: string;
  note: string | null;
  position: number;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: string;
};

export type MemoryDish = {
  id: string;
  roomId: string;
  stopId: string | null;
  addedBy: string;
  addedByDisplayName: string;
  dishName: string;
  averageRating: number | null;
  myRating: number | null;
  rating: number | null;
  ratingCount: number;
  ratings: MemoryDishRating[];
  note: string | null;
  createdAt: string;
};

export type MemoryDishRating = {
  id: string;
  roomId: string;
  dishId: string;
  ratedBy: string;
  ratedByDisplayName: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryPhoto = {
  id: string;
  roomId: string;
  stopId?: string | null;
  messageId: string | null;
  uploaderId?: string | null;
  uploaderName: string;
  uploaderDisplayName: string;
  publicUrl: string;
  storagePath: string;
  mediaType: "audio" | "image" | "video";
  imageWidth: number | null;
  imageHeight: number | null;
  durationMs?: number | null;
  moderationStatus?: "pending" | "approved" | "rejected" | null;
  position: number;
  createdAt: string;
  uploadProgress?: number | null;
};

export type MemoryRoom = {
  id: string;
  title: string;
  occasionType: OccasionType;
  occasionConfidence: number;
  occasionConfirmedByUser: boolean;
  themeKey: string;
  restaurantName: string;
  restaurantId: string | null;
  area: string | null;
  visitDate: string | null;
  sourcePostId: string | null;
  createdBy: string;
  status: MemoryRoomStatus;
  lastReadAt: string | null;
  createdAt: string;
  participants: MemoryParticipant[];
  stops: MemoryStop[];
  dishes: MemoryDish[];
  messages: MemoryMessage[];
  photos: MemoryPhoto[];
};

export type MemoryRoomSummary = {
  id: string;
  title: string;
  occasionType: OccasionType;
  occasionConfidence: number;
  occasionConfirmedByUser: boolean;
  themeKey: string;
  placeNames: string[];
  restaurantName: string;
  area: string | null;
  visitDate: string | null;
  sourcePostId: string | null;
  createdBy: string;
  participantCount: number;
  photoCount: number;
  dishCount: number;
  messageCount: number;
  unreadCount: number;
  latestMessage: string | null;
  latestActivityAt: string;
  createdAt: string;
};
