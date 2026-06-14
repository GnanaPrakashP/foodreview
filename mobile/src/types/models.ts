import type { Session } from "@supabase/supabase-js";

export type Visibility = "public" | "circle" | "me";
export type AccountType = "public" | "private";
export type ReviewStatus = "active" | "deleted" | "hidden" | "reported" | "removed";

export type FoodItem = {
  name: string;
  rating: number;
};

export type ReviewMedia = {
  publicUrl: string;
  mediaType: "image" | "video";
  position: number;
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
  authorName: string;
  authorInitials: string;
  restaurantId: string | null;
  restaurantName: string;
  area: string | null;
  restaurantAddress: string | null;
  restaurantLat: number | null;
  restaurantLng: number | null;
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
  circleRequestStatus?: "idle" | "loading" | "pending" | "joined";
  isPublicDiscovery?: boolean;
};

export type FeedPage = {
  posts: ReviewPost[];
  viewerName: string;
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

export type MemoryDish = {
  id: string;
  roomId: string;
  addedBy: string;
  addedByDisplayName: string;
  dishName: string;
  rating: number | null;
  note: string | null;
  createdAt: string;
};

export type MemoryPhoto = {
  id: string;
  roomId: string;
  messageId: string | null;
  uploaderName: string;
  uploaderDisplayName: string;
  publicUrl: string;
  storagePath: string;
  mediaType: "image" | "video";
  imageWidth: number | null;
  imageHeight: number | null;
  position: number;
  createdAt: string;
  uploadProgress?: number | null;
};

export type MemoryRoom = {
  id: string;
  title: string;
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
  dishes: MemoryDish[];
  messages: MemoryMessage[];
  photos: MemoryPhoto[];
};

export type MemoryRoomSummary = {
  id: string;
  title: string;
  restaurantName: string;
  area: string | null;
  visitDate: string | null;
  sourcePostId: string | null;
  createdBy: string;
  participantCount: number;
  photoCount: number;
  messageCount: number;
  unreadCount: number;
  latestMessage: string | null;
  latestActivityAt: string;
  createdAt: string;
};
