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
