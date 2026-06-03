import { supabase } from "@/api/supabase";
import { getCurrentUserProfile } from "@/services/profiles";
import type { FoodItem, Visibility } from "@/types/models";

export type CreatePostInput = {
  imageUri: string;
  imageMimeType?: string | null;
  restaurantName: string;
  dishName: string;
  dishes?: FoodItem[];
  caption: string;
  rating: number;
  recommended: boolean;
  tags?: string[];
  visibility: Visibility;
};

export type CreatePostResult = {
  id: string;
};

function validateInput(input: CreatePostInput) {
  if (!input.imageUri) throw new Error("Choose an image");
  if (!input.restaurantName.trim()) throw new Error("Restaurant name is required");
  const dishes = normalizedDishes(input);
  if (dishes.length === 0) throw new Error("Add at least one dish");
  if (dishes.some((dish) => !Number.isFinite(dish.rating) || dish.rating < 1 || dish.rating > 5)) {
    throw new Error("Select a rating");
  }
  if (input.caption.trim() && input.caption.trim().length < 5) {
    throw new Error("Caption must be at least 5 characters");
  }
}

function normalizedDishes(input: CreatePostInput): FoodItem[] {
  const dishes = input.dishes?.length
    ? input.dishes
    : [{ name: input.dishName, rating: input.rating }];

  return dishes
    .map((dish) => ({
      name: dish.name.trim(),
      rating: Number(dish.rating)
    }))
    .filter((dish) => dish.name);
}

function extensionFor(uri: string, mimeType?: string | null) {
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext;
  return "jpg";
}

async function blobFromUri(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected image");
  return response.blob();
}

async function uploadPostImage(input: CreatePostInput, userId: string) {
  const ext = extensionFor(input.imageUri, input.imageMimeType);
  const contentType = input.imageMimeType || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  const path = `public/mobile/${userId}/${Date.now()}.${ext}`;
  const blob = await blobFromUri(input.imageUri);

  const { error } = await supabase.storage
    .from("review-photos")
    .upload(path, blob, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("review-photos").getPublicUrl(path);
  return {
    publicUrl: data.publicUrl,
    storagePath: path
  };
}

export async function createPost(input: CreatePostInput): Promise<CreatePostResult> {
  validateInput(input);

  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in before posting");

  const uploaded = await uploadPostImage(input, profile.id);
  const tags = [
    input.recommended ? "Recommended" : "Not recommended",
    ...(input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  ];

  const { data, error } = await supabase
    .from("reviews")
    .insert({
      reviewer_name: profile.username,
      restaurant_name: input.restaurantName.trim(),
      items: normalizedDishes(input),
      body: input.caption.trim() || null,
      tags,
      visibility: input.visibility,
      photo_url: uploaded.publicUrl,
      photo_urls: [uploaded.publicUrl],
      status: "active"
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(error.message);
  return { id: data.id };
}
