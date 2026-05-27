export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type FoodItem = {
  name: string;
  rating: number;
};

export type AccountType = "private" | "public";
export type Visibility = "public" | "circle" | "me";
export type StoryVisibility = "public" | "circle";
export type ReviewMediaType = "image" | "video";
export type CircleRelationshipState = "NONE" | "PENDING" | "CIRCLE_ONE_WAY" | "CIRCLE_MUTUAL";
export type TasteTrustLevel =
  | "New Reviewer"
  | "Low Trust"
  | "Mixed Trust"
  | "Growing Trust"
  | "Trusted"
  | "Highly Trusted";

export type ReviewMedia = {
  public_url: string;
  media_type: ReviewMediaType;
  storage_path?: string | null;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
  position?: number | null;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
          avatar_url: string | null;
          bio: string | null;
          account_type: AccountType;
          trust_score: number;
          trust_level: TasteTrustLevel;
          confirmed_recommendations_count: number;
          positive_confirmations_count: number;
          negative_confirmations_count: number;
          total_feedback_points: number;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
          avatar_url?: string | null;
          bio?: string | null;
          account_type?: AccountType;
          trust_score?: number;
          trust_level?: TasteTrustLevel;
          confirmed_recommendations_count?: number;
          positive_confirmations_count?: number;
          negative_confirmations_count?: number;
          total_feedback_points?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          username?: string;
          avatar_url?: string | null;
          bio?: string | null;
          account_type?: AccountType;
          trust_score?: number;
          trust_level?: TasteTrustLevel;
          confirmed_recommendations_count?: number;
          positive_confirmations_count?: number;
          negative_confirmations_count?: number;
          total_feedback_points?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          reviewer_name: string;
          restaurant_id: string | null;
          restaurant_name: string;
          area: string | null;
          restaurant_address: string | null;
          restaurant_lat: number | null;
          restaurant_lng: number | null;
          items: FoodItem[];
          body: string | null;
          tags: string[];
          photo_url: string | null;
          photo_urls: string[];
          visibility: Visibility;
          deleted_at: string | null;
          hidden_at: string | null;
          reported_at: string | null;
          status: "active" | "deleted" | "hidden" | "reported" | "removed";
          created_at: string;
        };
        Insert: {
          id?: string;
          reviewer_name: string;
          restaurant_id?: string | null;
          restaurant_name: string;
          area?: string | null;
          restaurant_address?: string | null;
          restaurant_lat?: number | null;
          restaurant_lng?: number | null;
          items: FoodItem[];
          body?: string | null;
          tags?: string[];
          photo_url?: string | null;
          photo_urls?: string[];
          visibility?: Visibility;
          deleted_at?: string | null;
          hidden_at?: string | null;
          reported_at?: string | null;
          status?: "active" | "deleted" | "hidden" | "reported" | "removed";
          created_at?: string;
        };
        Update: {
          id?: string;
          reviewer_name?: string;
          restaurant_id?: string | null;
          restaurant_name?: string;
          area?: string | null;
          restaurant_address?: string | null;
          restaurant_lat?: number | null;
          restaurant_lng?: number | null;
          items?: FoodItem[];
          body?: string | null;
          tags?: string[];
          photo_url?: string | null;
          photo_urls?: string[];
          visibility?: Visibility;
          deleted_at?: string | null;
          hidden_at?: string | null;
          reported_at?: string | null;
          status?: "active" | "deleted" | "hidden" | "reported" | "removed";
          created_at?: string;
        };
        Relationships: [];
      };
      stories: {
        Row: Story;
        Insert: {
          id?: string;
          author_name: string;
          media_url: string;
          storage_path?: string | null;
          caption?: string | null;
          visibility?: StoryVisibility;
          status?: "active" | "deleted" | "hidden" | "reported" | "removed";
          created_at?: string;
          expires_at?: string;
          deleted_at?: string | null;
          hidden_at?: string | null;
          reported_at?: string | null;
        };
        Update: Partial<Story>;
        Relationships: [];
      };
      circle_requests: {
        Row: {
          id: string;
          sender_name: string;
          receiver_name: string;
          status: "pending" | "accepted" | "rejected";
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_name: string;
          receiver_name: string;
          status?: "pending" | "accepted" | "rejected";
          created_at?: string;
        };
        Update: {
          id?: string;
          sender_name?: string;
          receiver_name?: string;
          status?: "pending" | "accepted" | "rejected";
          created_at?: string;
        };
        Relationships: [];
      };
      circle_memberships: {
        Row: {
          id: string;
          user_name: string;
          member_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_name: string;
          member_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_name?: string;
          member_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: Notification;
        Insert: {
          id?: string;
          recipient_user_id?: string | null;
          actor_user_id?: string | null;
          recipient_name: string;
          actor_name?: string | null;
          type: Notification["type"];
          title?: string | null;
          message?: string | null;
          entity_type?: Notification["entity_type"];
          entity_id?: string | null;
          metadata?: Json;
          is_read?: boolean;
          post_id?: string | null;
          restaurant_name?: string | null;
          content?: string | null;
          read?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Notification>;
        Relationships: [];
      };
      likes: {
        Row: {
          id: string;
          post_id: string;
          user_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          user_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          user_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      comments: {
        Row: Comment;
        Insert: {
          id?: string;
          post_id: string;
          user_name: string;
          content: string;
          created_at?: string;
        };
        Update: Partial<Comment>;
        Relationships: [];
      };
      recommendation_feedback: {
        Row: {
          id: string;
          post_id: string;
          reviewer_user_id: string;
          feedback_user_id: string;
          place_id: string | null;
          dish_id: string | null;
          feedback_label: string;
          feedback_value: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          reviewer_user_id: string;
          feedback_user_id: string;
          place_id?: string | null;
          dish_id?: string | null;
          feedback_label: string;
          feedback_value: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          reviewer_user_id?: string;
          feedback_user_id?: string;
          place_id?: string | null;
          dish_id?: string | null;
          feedback_label?: string;
          feedback_value?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_tried_items: {
        Row: {
          id: string;
          user_id: string;
          place_id: string | null;
          dish_id: string | null;
          source_post_id: string | null;
          source_user_id: string | null;
          feedback_id: string | null;
          tried_status: "tried";
          visibility: "private" | "circle" | "public";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          place_id?: string | null;
          dish_id?: string | null;
          source_post_id?: string | null;
          source_user_id?: string | null;
          feedback_id?: string | null;
          tried_status?: "tried";
          visibility?: "private" | "circle" | "public";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          place_id?: string | null;
          dish_id?: string | null;
          source_post_id?: string | null;
          source_user_id?: string | null;
          feedback_id?: string | null;
          tried_status?: "tried";
          visibility?: "private" | "circle" | "public";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_reputation: {
        Row: {
          user_id: string;
          profile_score: number;
          tier_display_name: string;
          current_weekly_streak: number;
          best_weekly_streak: number;
          current_monthly_streak: number;
          best_monthly_streak: number;
          last_weekly_active_period: string | null;
          last_monthly_active_period: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          profile_score?: number;
          tier_display_name?: string;
          current_weekly_streak?: number;
          best_weekly_streak?: number;
          current_monthly_streak?: number;
          best_monthly_streak?: number;
          last_weekly_active_period?: string | null;
          last_monthly_active_period?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          profile_score?: number;
          tier_display_name?: string;
          current_weekly_streak?: number;
          best_weekly_streak?: number;
          current_monthly_streak?: number;
          best_monthly_streak?: number;
          last_weekly_active_period?: string | null;
          last_monthly_active_period?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_badges: {
        Row: {
          id: string;
          user_id: string;
          badge_id: string;
          badge_type: string;
          badge_name: string;
          badge_description: string | null;
          badge_icon: string | null;
          badge_category: string | null;
          earned_at: string;
          metadata: Json;
        };
        Insert: {
          id?: string;
          user_id: string;
          badge_id: string;
          badge_type: string;
          badge_name: string;
          badge_description?: string | null;
          badge_icon?: string | null;
          badge_category?: string | null;
          earned_at?: string;
          metadata?: Json;
        };
        Update: {
          id?: string;
          user_id?: string;
          badge_id?: string;
          badge_type?: string;
          badge_name?: string;
          badge_description?: string | null;
          badge_icon?: string | null;
          badge_category?: string | null;
          earned_at?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      post_visit_attributions: {
        Row: {
          id: string;
          post_id: string;
          source_user_id: string;
          visitor_user_id: string;
          restaurant_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          source_user_id: string;
          visitor_user_id: string;
          restaurant_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          source_user_id?: string;
          visitor_user_id?: string;
          restaurant_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      wishlist: {
        Row: {
          id: string;
          user_name: string;
          restaurant_name: string;
          post_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_name: string;
          restaurant_name: string;
          post_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_name?: string;
          restaurant_name?: string;
          post_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

export type Review = Database["public"]["Tables"]["reviews"]["Row"] & {
  media_items?: ReviewMedia[];
};

export interface Story {
  id: string;
  author_name: string;
  media_url: string;
  storage_path: string | null;
  caption: string | null;
  visibility: StoryVisibility;
  status: "active" | "deleted" | "hidden" | "reported" | "removed";
  created_at: string;
  expires_at: string;
  deleted_at: string | null;
  hidden_at: string | null;
  reported_at: string | null;
}

export interface Comment {
  id: string;
  post_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_user_id: string | null;
  actor_user_id: string | null;
  recipient_name: string;
  actor_name: string | null;
  type:
    | "like"
    | "comment"
    | "also_commented"
    | "circle_request"
    | "circle_accepted"
    | "circle_added"
    | "circle_post"
    | "CIRCLE_REQUEST_RECEIVED"
    | "CIRCLE_REQUEST_ACCEPTED"
    | "CIRCLE_REQUEST_REJECTED"
    | "ADDED_TO_CIRCLE"
    | "MUTUAL_CIRCLE_CREATED"
    | "POST_LIKED"
    | "POST_COMMENTED"
    | "THREAD_REPLY"
    | "CIRCLE_POST_CREATED"
    | "COMMON_RESTAURANT_SCORE_UPDATED"
    | "SYSTEM_ANNOUNCEMENT";
  title: string | null;
  message: string | null;
  entity_type: "USER" | "POST" | "RESTAURANT" | "CIRCLE_REQUEST" | "SYSTEM" | null;
  entity_id: string | null;
  metadata: Json;
  is_read: boolean;
  post_id: string | null;
  restaurant_name: string | null;
  content: string | null;
  read: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
