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

export interface Database {
  public: {
    Tables: {
      reviews: {
        Row: {
          id: string;
          reviewer_name: string;
          restaurant_name: string;
          items: FoodItem[];
          body: string | null;
          photo_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reviewer_name: string;
          restaurant_name: string;
          items: FoodItem[];
          body?: string | null;
          photo_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          reviewer_name?: string;
          restaurant_name?: string;
          items?: FoodItem[];
          body?: string | null;
          photo_url?: string | null;
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
  type: "like" | "comment" | "also_commented";
  post_id: string;
  restaurant_name: string | null;
  content: string | null;
  read: boolean;
  created_at: string;
}
