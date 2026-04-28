"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import StarRating from "@/components/ui/StarRating";
import PhotoUpload from "@/components/reviews/PhotoUpload";
import type { FoodItem } from "@/lib/types";

function emptyItem(): FoodItem {
  return { name: "", rating: 0 };
}

export default function ReviewForm() {
  const router = useRouter();
  const supabase = createClient();

  const [reviewerName, setReviewerName] = useState("");
  const [items, setItems] = useState<FoodItem[]>([emptyItem()]);
  const [body, setBody] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  function updateItem(index: number, field: keyof FoodItem, value: string | number) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!reviewerName.trim()) e.reviewerName = "Your name is required.";
    if (!restaurantName.trim()) e.restaurantName = "Restaurant name is required.";
    const badItems = items.some((it) => !it.name.trim() || it.rating === 0);
    if (badItems) e.items = "Each item needs a name and a rating.";
    if (body.trim() && body.trim().length < 10)
      e.body = "Notes must be at least 10 characters if filled in.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setServerError("");

    try {
      let photoUrl: string | null = null;

      if (photoFile) {
        const ext = photoFile.name.split(".").pop();
        const path = `public/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("review-photos")
          .upload(path, photoFile, { upsert: false });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage
          .from("review-photos")
          .getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      const { data: review, error: insertError } = await supabase
        .from("reviews")
        .insert({
          reviewer_name: reviewerName.trim(),
          restaurant_name: restaurantName.trim(),
          items: items.map((it) => ({ name: it.name.trim(), rating: it.rating })),
          body: body.trim() || null,
          photo_url: photoUrl,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      router.push(`/reviews/${review.id}`);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setServerError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">

      {/* Food items */}
      <div className="flex flex-col gap-3">
        <label className="text-sm font-medium text-gray-700">Food Items</label>

        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Item name"
              value={item.name}
              onChange={(e) => updateItem(i, "name", e.target.value)}
              className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm bg-white text-gray-900 placeholder-gray-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition-colors"
            />
            <StarRating
              value={item.rating}
              onChange={(v) => updateItem(i, "rating", v)}
              size="md"
            />
            {items.length > 1 && (
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
                aria-label="Remove item"
              >
                ✕
              </button>
            )}
          </div>
        ))}

        {errors.items && (
          <p className="text-xs text-red-500">{errors.items}</p>
        )}

        <button
          type="button"
          onClick={addItem}
          className="self-start flex items-center gap-1.5 text-sm font-medium text-orange-500 hover:text-orange-600 transition-colors"
        >
          <span className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-orange-500 font-bold text-base leading-none">+</span>
          Add another item
        </button>
      </div>

      {/* Optional notes */}
      <Textarea
        label={<>Notes <span className="text-gray-400 font-normal">(optional)</span></>}
        placeholder="Anything else to add? Atmosphere, service, overall thoughts…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        error={errors.body}
      />

      {/* Restaurant */}
      <Input
        label="Restaurant"
        placeholder="e.g. Joe's Diner"
        value={restaurantName}
        onChange={(e) => setRestaurantName(e.target.value)}
        error={errors.restaurantName}
      />

      {/* Photo */}
      <PhotoUpload onFileSelect={setPhotoFile} />

      {/* Your name */}
      <Input
        label="Your name"
        placeholder="e.g. Sarah"
        value={reviewerName}
        onChange={(e) => setReviewerName(e.target.value)}
        error={errors.reviewerName}
      />

      {serverError && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {serverError}
        </p>
      )}

      <Button type="submit" loading={submitting} fullWidth>
        Post Review
      </Button>
    </form>
  );
}
