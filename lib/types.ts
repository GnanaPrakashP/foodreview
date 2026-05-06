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
export type CircleRelationshipState = "NONE" | "PENDING" | "CIRCLE_ONE_WAY" | "CIRCLE_MUTUAL";

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
          account_type: AccountType;
          created_at: string;
        };
        Insert: {
          id: string;
          first_name: string;
          last_name: string;
          username: string;
          avatar_url?: string | null;
          account_type?: AccountType;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          username?: string;
          avatar_url?: string | null;
          account_type?: AccountType;
          created_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          reviewer_name: string;
          restaurant_name: string;
          area: string | null;
          items: FoodItem[];
          body: string | null;
          photo_url: string | null;
          photo_urls: string[];
          visibility: Visibility;
          created_at: string;
        };
        Insert: {
          id?: string;
          reviewer_name: string;
          restaurant_name: string;
          area?: string | null;
          items: FoodItem[];
          body?: string | null;
          photo_url?: string | null;
          photo_urls?: string[];
          visibility?: Visibility;
          created_at?: string;
        };
        Update: {
          id?: string;
          reviewer_name?: string;
          restaurant_name?: string;
          area?: string | null;
          items?: FoodItem[];
          body?: string | null;
          photo_url?: string | null;
          photo_urls?: string[];
          visibility?: Visibility;
          created_at?: string;
        };
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
          recipient_name: string;
          actor_name: string;
          type: Notification["type"];
          post_id?: string | null;
          restaurant_name?: string | null;
          content?: string | null;
          read?: boolean;
          created_at?: string;
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

export type Review = Database["public"]["Tables"]["reviews"]["Row"];

export interface Comment {
  id: string;
  post_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_name: string;
  actor_name: string;
  type: "like" | "comment" | "also_commented" | "circle_request" | "circle_accepted" | "circle_added" | "circle_post";
  post_id: string | null;
  restaurant_name: string | null;
  content: string | null;
  read: boolean;
  created_at: string;
}
