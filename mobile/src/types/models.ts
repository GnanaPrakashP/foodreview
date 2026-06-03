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
};

export type FeedPage = {
  posts: ReviewPost[];
  viewerName: string;
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
  reputation: UserProfileReputation;
  posts: ReviewPost[];
};

export type UserTier = {
  tierName: string;
  tierLevel: string | null;
  displayName: string;
  minScore: number;
  maxScore: number | null;
  nextTierName: string | null;
  progressPercent: number;
  isMaxTier: boolean;
};

export type PermanentBadge = {
  badgeId: string;
  badgeType: string;
  badgeName: string;
  badgeDescription: string;
  badgeIcon: string;
  badgeCategory: string;
  earnedAt: string;
  metadata?: Record<string, unknown>;
};

export type UserProfileReputation = {
  tier: UserTier;
  profileScore: number;
  permanentBadges: PermanentBadge[];
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
  createdAt: string;
};

export type MemoryPhoto = {
  id: string;
  roomId: string;
  uploaderName: string;
  publicUrl: string;
  storagePath: string;
  createdAt: string;
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
  createdAt: string;
  participants: MemoryParticipant[];
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
  latestMessage: string | null;
  createdAt: string;
};
