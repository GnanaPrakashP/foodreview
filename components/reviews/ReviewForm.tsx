"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PhotoUpload, { type ReviewUploadFile } from "@/components/reviews/PhotoUpload";
import type { FoodItem } from "@/lib/types";
import { getVisitPrompt } from "@/lib/visits";
import { Utensils, Star, X, Store, MapPin, Globe, Users, Lock, Tag } from "lucide-react";
import type { Visibility } from "@/lib/types";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import { getStoredActorName } from "@/lib/browser-actor";
import {
  TRENDING_LOCATION_LABEL_STORAGE_KEY,
  TRENDING_LOCATION_LAT_STORAGE_KEY,
  TRENDING_LOCATION_LNG_STORAGE_KEY,
} from "@/lib/trending-location";

/* ─── helpers ────────────────────────────────────── */

function emptyItem(): FoodItem {
  return { name: "", rating: 0 };
}

const RATING_LABELS: Record<number, string> = {
  1: "Bad", 2: "Okay", 3: "Good", 4: "Great", 5: "Amazing",
};

type RestaurantSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

type ModeratedPhoto = {
  publicUrl: string;
  storagePath: string;
  width: number;
  height: number;
  sizeBytes: number;
  mediaType?: "image";
};

type ModeratedMedia = ModeratedPhoto | {
  publicUrl: string;
  storagePath: string;
  width: null;
  height: null;
  sizeBytes: number;
  durationSeconds: number;
  mediaType: "video";
};

type ReviewInsertPayload = {
  restaurantName: string;
  restaurantId?: string | null;
  restaurantAddress?: string | null;
  restaurantLat?: number | null;
  restaurantLng?: number | null;
  restaurant_id?: string | null;
  area?: string | null;
  restaurant_address?: string | null;
  restaurant_lat?: number | null;
  restaurant_lng?: number | null;
  items: FoodItem[];
  body: string | null;
  photoUrl: string | null;
  photos?: ModeratedPhoto[];
  media?: ModeratedMedia[];
  visibility: Visibility;
  tags?: string[];
};

type PlaceDetails = {
  placeId: string;
  name: string;
  formattedAddress: string;
  shortFormattedAddress: string;
  latitude: number | null;
  longitude: number | null;
};

const REVIEW_TAG_OPTIONS = [
  "Hidden gem",
  "Worth the hype",
  "Comfort food",
  "Budget friendly",
  "Date night",
  "Spicy",
  "Sweet tooth",
  "Big portions",
  "Must try",
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}

function isMissingOptionalReviewColumn(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /schema cache|column/i.test(message)
    && /\b(restaurant_id|area|restaurant_address|restaurant_lat|restaurant_lng|tags)\b/i.test(message)
  );
}

function withoutRichPlaceDetails(payload: ReviewInsertPayload): ReviewInsertPayload {
  const {
    restaurantAddress: _restaurantAddressCamel,
    restaurantLat: _restaurantLatCamel,
    restaurantLng: _restaurantLngCamel,
    restaurant_address: _restaurantAddress,
    restaurant_lat: _restaurantLat,
    restaurant_lng: _restaurantLng,
    tags: _tags,
    ...nextPayload
  } = payload;
  return nextPayload;
}

function withoutPlaceMetadata(payload: ReviewInsertPayload): ReviewInsertPayload {
  const {
    restaurantId: _restaurantIdCamel,
    restaurantAddress: _restaurantAddressCamel,
    restaurantLat: _restaurantLatCamel,
    restaurantLng: _restaurantLngCamel,
    restaurant_id: _restaurantId,
    area: _area,
    restaurant_address: _restaurantAddress,
    restaurant_lat: _restaurantLat,
    restaurant_lng: _restaurantLng,
    ...nextPayload
  } = payload;
  return nextPayload;
}

/* ─── sub-components ─────────────────────────────── */

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label
      style={{
        fontSize: "10px",
        fontWeight: 600,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: "1px",
        display: "block",
        marginBottom: "8px",
      }}
    >
      {children}
      {optional && (
        <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: "6px", textTransform: "none", letterSpacing: 0, fontSize: "10px" }}>
          optional
        </span>
      )}
    </label>
  );
}

/* ─── Dish row ───────────────────────────────────── */

function DishRow({
  item,
  onChange,
  onRemove,
  showRemove,
}: {
  item: FoodItem;
  onChange: (field: keyof FoodItem, value: string | number) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <Utensils size={16} strokeWidth={1.8} color="var(--green)" style={{ flexShrink: 0 }} />
        <input
          type="text"
          placeholder="e.g. Mutton Biryani"
          value={item.name}
          onChange={(e) => onChange("name", e.target.value)}
          autoComplete="off"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontSize: "14px", minWidth: 0 }}
        />
        <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => onChange("rating", item.rating === star ? 0 : star)}
              title={RATING_LABELS[star]}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", lineHeight: 1, display: "flex", alignItems: "center" }}
            >
              <Star
                size={16}
                strokeWidth={1.8}
                color="var(--gold)"
                fill={star <= item.rating ? "var(--gold)" : "none"}
              />
            </button>
          ))}
        </div>
        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", flexShrink: 0, paddingLeft: "4px", display: "flex", alignItems: "center" }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── main form ──────────────────────────────────── */

export default function ReviewForm() {
  const router = useRouter();

  const [reviewerName] = useState(() => getStoredActorName());
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantArea, setRestaurantArea] = useState<string | null>(null);
  const [restaurantAddress, setRestaurantAddress] = useState<string | null>(null);
  const [restaurantLat, setRestaurantLat] = useState<number | null>(null);
  const [restaurantLng, setRestaurantLng] = useState<number | null>(null);
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<RestaurantSuggestion[]>([]);
  const [showRestaurantSuggestions, setShowRestaurantSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const [restaurantInputFocused, setRestaurantInputFocused] = useState(false);
  const [placesSessionToken, setPlacesSessionToken] = useState("");
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [userLocationLabel, setUserLocationLabel] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "granted" | "denied">("idle");
  const restaurantInputRef = useRef<HTMLInputElement>(null);
  const pickedRestaurantNameRef = useRef<string | null>(null);
  const [existingVisitCount, setExistingVisitCount] = useState<number | null>(null);

  const [items, setItems] = useState<FoodItem[]>([emptyItem()]);

  const [body, setBody] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [photoFiles, setPhotoFiles] = useState<ReviewUploadFile[]>([]);
  const [photoError, setPhotoError] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<"uploading" | "posting" | null>(null);
  const [serverError, setServerError] = useState("");

  // Start a Google Places session for restaurant autocomplete.
  useEffect(() => {
    setPlacesSessionToken(crypto.randomUUID());
  }, []);

  // Use location already set in discovery views — no new permission prompt.
  useEffect(() => {
    try {
      const lat = parseFloat(localStorage.getItem(TRENDING_LOCATION_LAT_STORAGE_KEY) ?? "");
      const lng = parseFloat(localStorage.getItem(TRENDING_LOCATION_LNG_STORAGE_KEY) ?? "");
      const label = localStorage.getItem(TRENDING_LOCATION_LABEL_STORAGE_KEY) ?? null;
      if (!isNaN(lat) && !isNaN(lng)) {
        setUserLat(lat);
        setUserLng(lng);
        setUserLocationLabel(label);
        setLocationStatus("granted");
      } else {
        setLocationStatus("denied");
      }
    } catch {
      setLocationStatus("denied");
    }
  }, []);

  useEffect(() => {
    const q = restaurantName.trim();
    if (q.length < 2 || pickedRestaurantNameRef.current?.trim().toLowerCase() === q.toLowerCase()) {
      setRestaurantSuggestions([]);
      setShowRestaurantSuggestions(false);
      setLoadingSuggestions(false);
      return;
    }

    // Show loading immediately so the dropdown opens with a spinner during the debounce wait.
    setLoadingSuggestions(true);

    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ input: q });
        if (placesSessionToken) params.set("sessionToken", placesSessionToken);
        if (userLat !== null) params.set("lat", String(userLat));
        if (userLng !== null) params.set("lng", String(userLng));
        const res = await fetch(`/api/places/autocomplete?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        setLastSearchedQuery(q);
        setLoadingSuggestions(false);
        if (!res.ok) return;
        const payload = (await res.json()) as { suggestions?: RestaurantSuggestion[] };
        const suggestions = (payload.suggestions ?? [])
          .filter((s) => s.placeId)
          .slice(0, 5);
        setRestaurantSuggestions(suggestions);
        setShowRestaurantSuggestions(suggestions.length > 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLastSearchedQuery(q);
        setLoadingSuggestions(false);
        setRestaurantSuggestions([]);
        setShowRestaurantSuggestions(false);
      }
    }, 300);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [restaurantName, placesSessionToken, userLat, userLng]);

  // Look up how many times this reviewer has been to this restaurant
  useEffect(() => {
    const name = reviewerName.trim();
    const rest = restaurantName.trim();
    if (!name || !rest) { setExistingVisitCount(null); return; }
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .eq("reviewer_name", name)
        .eq("restaurant_name", rest);
      setExistingVisitCount(count ?? 0);
    }, 400);
    return () => clearTimeout(t);
  }, [reviewerName, restaurantName]);

  function updateItem(index: number, field: keyof FoodItem, value: string | number) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag || selectedTags.includes(tag) || selectedTags.length >= 5) return;
    setSelectedTags((prev) => [...prev, tag]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  }

  async function pickRestaurant(suggestion: RestaurantSuggestion) {
    pickedRestaurantNameRef.current = suggestion.mainText;
    setRestaurantName(suggestion.mainText);
    setRestaurantId(suggestion.placeId);
    setRestaurantArea(suggestion.secondaryText || null);
    setRestaurantAddress(null);
    setRestaurantLat(null);
    setRestaurantLng(null);
    setShowRestaurantSuggestions(false);
    setRestaurantSuggestions([]);
    setErrors((prev) => {
      if (!prev.restaurantName) return prev;
      const next = { ...prev };
      delete next.restaurantName;
      return next;
    });
    restaurantInputRef.current?.blur();

    if (suggestion.placeId) {
      try {
        const params = new URLSearchParams({ placeId: suggestion.placeId });
        if (placesSessionToken) params.set("sessionToken", placesSessionToken);
        const res = await fetch(`/api/places/details?${params.toString()}`, { cache: "no-store" });
        if (res.ok) {
          const payload = (await res.json()) as { details?: PlaceDetails | null };
          const details = payload.details;
          if (details) {
            const resolvedName = details.name || suggestion.mainText;
            pickedRestaurantNameRef.current = resolvedName;
            setRestaurantName(resolvedName);
            setRestaurantId(details.placeId || suggestion.placeId);
            setRestaurantArea(details.shortFormattedAddress || suggestion.secondaryText || null);
            setRestaurantAddress(details.formattedAddress || null);
            setRestaurantLat(details.latitude);
            setRestaurantLng(details.longitude);
          }
        }
      } catch {
        // Autocomplete selection is still useful even if details lookup fails.
      }
    }

    setPlacesSessionToken(crypto.randomUUID());
  }

  function handleRestaurantInput(v: string) {
    pickedRestaurantNameRef.current = null;
    setRestaurantName(v);
    setRestaurantId(null);
    setRestaurantArea(null);
    setRestaurantAddress(null);
    setRestaurantLat(null);
    setRestaurantLng(null);
    setLastSearchedQuery("");
    setErrors((prev) => {
      if (!prev.restaurantName) return prev;
      const next = { ...prev };
      delete next.restaurantName;
      return next;
    });
  }

  function validate() {
    const e: Record<string, string> = {};
    const selectedRestaurantName = pickedRestaurantNameRef.current?.trim().toLowerCase();
    const currentRestaurantName = restaurantName.trim().toLowerCase();
    if (!restaurantName.trim()) {
      e.restaurantName = "Restaurant name is required.";
    } else if (!restaurantId || selectedRestaurantName !== currentRestaurantName) {
      e.restaurantName = "Select a restaurant from the dropdown list.";
    }
    if (items.filter((it) => it.name.trim()).length === 0) e.items = "Add at least one dish.";
    else if (items.some((it) => it.name.trim() && (!it.rating || it.rating <= 0))) e.items = "Rate every dish you add.";
    if (photoFiles.length === 0) e.media = "Add at least one photo or video.";
    if (body.trim() && body.trim().length < 5) e.body = "One-liner must be at least 5 characters.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setServerError("");
    setPhotoError("");

    const supabase = createClient();

    try {
      // --- Phase 1: upload media. Images go through moderation; videos are stored with their media type. ---
      let media: ModeratedMedia[] = [];
      const imageFiles = photoFiles.filter((file) => file.type.startsWith("image/"));
      const videoFiles = photoFiles.filter((file) => file.type.startsWith("video/"));

      if (imageFiles.length > 0) {
        setSubmitStep("uploading");

        const quarantinePaths: string[] = [];
        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i];
          const ext = file.name.split(".").pop() ?? "jpg";
          const path = `quarantine/${Date.now()}_${i}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from("review-photos")
            .upload(path, file, { upsert: false });
          if (uploadErr) throw new Error("Failed to upload photo for checking");
          quarantinePaths.push(path);
        }

        const moderateRes = await fetch("/api/photos/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quarantinePaths }),
        });
        const moderateJson = await moderateRes.json().catch(() => ({}));
        if (!moderateRes.ok) {
          throw new Error(moderateJson.error ?? "Photo check failed — please try different photos");
        }
        media = (moderateJson.photos as ModeratedPhoto[]).map((photo) => ({ ...photo, mediaType: "image" }));
      }

      if (videoFiles.length > 0) {
        setSubmitStep("uploading");
        const uploadedVideos: ModeratedMedia[] = [];
        for (let i = 0; i < videoFiles.length; i++) {
          const file = videoFiles[i];
          const ext = file.name.split(".").pop() ?? (file.type === "video/webm" ? "webm" : "mp4");
          const path = `public/${Date.now()}_${i}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from("review-photos")
            .upload(path, file, { contentType: file.type, upsert: false });
          if (uploadErr) throw new Error("Failed to upload video");
          const { data: urlData } = supabase.storage.from("review-photos").getPublicUrl(path);
          uploadedVideos.push({
            publicUrl: urlData.publicUrl,
            storagePath: path,
            width: null,
            height: null,
            sizeBytes: file.size,
            durationSeconds: file.durationSeconds ?? 0,
            mediaType: "video",
          });
        }
        media = [...media, ...uploadedVideos];
      }

      setSubmitStep("posting");
      const photoUrl = media[0]?.publicUrl ?? null;

      const allItems = items
        .filter((it) => it.name.trim())
        .map((it) => ({ name: it.name.trim(), rating: it.rating }));

      const reviewPayload: ReviewInsertPayload = {
        restaurantName: restaurantName.trim(),
        items: allItems,
        body: body.trim() || null,
        tags: selectedTags,
        photoUrl,
        photos: media.filter((item): item is ModeratedPhoto & { mediaType: "image" } => item.mediaType !== "video"),
        media,
        visibility,
      };
      if (restaurantId) reviewPayload.restaurantId = restaurantId;
      if (restaurantArea) reviewPayload.area = restaurantArea;
      if (restaurantAddress) reviewPayload.restaurantAddress = restaurantAddress;
      if (restaurantLat !== null) reviewPayload.restaurantLat = restaurantLat;
      if (restaurantLng !== null) reviewPayload.restaurantLng = restaurantLng;

      async function insertReview(payload: ReviewInsertPayload) {
        const response = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await response.json().catch(() => ({}));
        return {
          data: response.ok ? json : null,
          error: response.ok ? null : new Error(json.error || "Unable to save review"),
        };
      }

      let { data: review, error: insertError } = await insertReview(reviewPayload);

      if (insertError && isMissingOptionalReviewColumn(insertError)) {
        const retry = await insertReview(withoutRichPlaceDetails(reviewPayload));
        review = retry.data;
        insertError = retry.error;
      }

      if (insertError && isMissingOptionalReviewColumn(insertError)) {
        const retry = await insertReview(withoutPlaceMetadata(reviewPayload));
        review = retry.data;
        insertError = retry.error;
      }

      if (insertError) throw insertError;

      await fetch("/api/notifications/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "CIRCLE_POST_CREATED", reviewId: review.id, actorName: reviewerName.trim() }),
      }).catch(() => {});

      invalidateCachedJson("/api/feed/circle");
      invalidateCachedJson("/api/feed/public");
      invalidateCachedJson("/api/me");
      router.push(`/reviews/${review.id}`);
      router.refresh();
    } catch (err: unknown) {
      setServerError(errorMessage(err) || "Something went wrong.");
      setSubmitting(false);
      setSubmitStep(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>

      {/* 1 — Media */}
      <div className="px-5 pb-4">
        <FieldLabel>Media</FieldLabel>
        <PhotoUpload
          files={photoFiles}
          onFilesChange={(files) => {
            setPhotoFiles(files);
            if (files.length > 0) {
              setErrors((prev) => {
                if (!prev.media) return prev;
                const next = { ...prev };
                delete next.media;
                return next;
              });
            }
          }}
          error={photoError || errors.media}
        />
      </div>

      {/* 2 — Restaurant */}
      <div className="px-5 pb-4">
        <FieldLabel>Restaurant</FieldLabel>
        <div style={{ position: "relative" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              background: "var(--card)",
              border: `1px solid ${errors.restaurantName ? "#EF4444" : "var(--border)"}`,
              borderRadius: "14px",
              padding: "12px 14px",
            }}
          >
            <Store
              size={16}
              strokeWidth={1.8}
              color="var(--orange)"
              style={{ flexShrink: 0 }}
            />
            <input
              ref={restaurantInputRef}
              type="text"
              placeholder="e.g. Bawarchi"
              value={restaurantName}
              onChange={(e) => handleRestaurantInput(e.target.value)}
              onFocus={() => {
                setRestaurantInputFocused(true);
                if (restaurantSuggestions.length > 0) setShowRestaurantSuggestions(true);
              }}
              onBlur={() => setRestaurantInputFocused(false)}
              autoComplete="off"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontSize: "14px", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
            />
          </div>

          {/* Dropdown: loading, results, or empty-state hint */}
          {(() => {
            const q = restaurantName.trim();
            const isPicked = pickedRestaurantNameRef.current?.trim().toLowerCase() === q.toLowerCase();
            const showEmptyHint =
              !loadingSuggestions &&
              restaurantSuggestions.length === 0 &&
              q.length >= 2 &&
              !isPicked &&
              lastSearchedQuery.toLowerCase() === q.toLowerCase();
            const showDropdown =
              restaurantInputFocused &&
              (loadingSuggestions || showRestaurantSuggestions || showEmptyHint);
            if (!showDropdown) return null;
            return (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "14px",
                  overflow: "hidden",
                  zIndex: 25,
                }}
              >
                {loadingSuggestions ? (
                  <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        width: "12px",
                        height: "12px",
                        border: "2px solid var(--border)",
                        borderTopColor: "var(--muted)",
                        borderRadius: "50%",
                        animation: "spin 0.7s linear infinite",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", color: "var(--muted)" }}>
                      Searching…
                    </span>
                  </div>
                ) : showEmptyHint ? (
                  <div style={{ padding: "12px 14px" }}>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
                      No matches found. Try adding area or city,
                    </p>
                    <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
                      e.g.{" "}
                      <span style={{ color: "var(--cream)", fontStyle: "italic" }}>
                        &ldquo;{restaurantName.trim()} Bandra&rdquo;
                      </span>
                    </p>
                  </div>
                ) : (
                  restaurantSuggestions.map((s, i) => (
                    <button
                      key={`${s.placeId}-${i}`}
                      type="button"
                      onMouseDown={() => pickRestaurant(s)}
                      style={{
                        width: "100%",
                        background: "none",
                        border: "none",
                        borderBottom: i === restaurantSuggestions.length - 1 ? "none" : "1px solid var(--border)",
                        padding: "10px 12px",
                        color: "var(--cream)",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                      }}
                    >
                      <Store size={13} strokeWidth={2} color="var(--orange)" style={{ marginTop: "2px", flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "13px", color: "var(--cream)", lineHeight: 1.25 }}>
                          {s.mainText}
                        </p>
                        {s.secondaryText && (
                          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", lineHeight: 1.2, marginTop: "2px" }}>
                            {s.secondaryText}
                          </p>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            );
          })()}
        </div>

        {locationStatus === "granted" && !restaurantId && (
          <p style={{ fontSize: "10px", color: "var(--muted)", marginTop: "5px", display: "flex", alignItems: "center", gap: "3px" }}>
            <MapPin size={9} strokeWidth={2} />
            {userLocationLabel ? `Showing results near ${userLocationLabel} first` : "Showing nearby restaurants first"}
          </p>
        )}
        {restaurantArea && (
          <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>{restaurantArea}</p>
        )}
        {errors.restaurantName && (
          <p style={{ fontSize: "11px", color: "#EF4444", marginTop: "4px" }}>{errors.restaurantName}</p>
        )}
      </div>

      {/* 3 — Dishes */}
      <div className="px-5 pb-4">
        <FieldLabel>Dishes</FieldLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {items.map((item, i) => (
            <DishRow
              key={i}
              item={item}
              onChange={(field, value) => updateItem(i, field, value)}
              onRemove={() => removeItem(i)}
              showRemove={items.length > 1}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, emptyItem()])}
          style={{
            background: "none",
            border: "none",
            color: "var(--orange)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            padding: "16px 0 0",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--orange-dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "var(--orange)" }}>+</span>
          Add more dishes
        </button>
        {errors.items && (
          <p style={{ fontSize: "11px", color: "#EF4444", marginTop: "6px" }}>{errors.items}</p>
        )}
      </div>

      {/* 4 — One-liner (visit-aware) */}
      <div className="px-5 pb-4">
        {(() => {
          const visitPrompt = existingVisitCount !== null
            ? getVisitPrompt(existingVisitCount)
            : null;
          return (
            <>
              {/* Visit context banner */}
              {visitPrompt && existingVisitCount !== null && existingVisitCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    background: visitPrompt.isRegular
                      ? "var(--orange-dim)"
                      : "rgba(232,168,48,0.08)",
                    border: `1px solid ${visitPrompt.isRegular ? "rgba(240,96,48,0.3)" : "rgba(232,168,48,0.2)"}`,
                    borderRadius: "12px",
                    padding: "10px 13px",
                    marginBottom: "10px",
                  }}
                >
                  <span style={{ fontSize: "18px", flexShrink: 0 }}>
                    {visitPrompt.isRegular ? "🏆" : "🔁"}
                  </span>
                  <div>
                    <p style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: visitPrompt.isRegular ? "var(--orange)" : "var(--gold)",
                      marginBottom: "1px",
                    }}>
                      {visitPrompt.visitLabel}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {restaurantName}
                    </p>
                  </div>
                </div>
              )}

              <FieldLabel optional>
                {visitPrompt && existingVisitCount! > 0
                  ? visitPrompt.placeholder.split("?")[0] + "?"
                  : "Your one line"}
              </FieldLabel>
              <textarea
                placeholder={
                  visitPrompt
                    ? `"${visitPrompt.placeholder}"`
                    : 'Write something...'
                }
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={2}
                className="one-line-textarea"
                style={{
                  width: "100%",
                  background: "var(--card)",
                  border: `1px solid ${errors.body ? "#EF4444" : "var(--border)"}`,
                  borderRadius: "14px",
                  padding: "14px",
                  color: "var(--cream)",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: "14px",
                  lineHeight: "1.5",
                  outline: "none",
                  resize: "none",
                }}
              />
              {errors.body && (
                <p style={{ fontSize: "11px", color: "#EF4444", marginTop: "2px" }}>{errors.body}</p>
              )}
              <div style={{ marginTop: "12px" }}>
                <FieldLabel optional>Tags</FieldLabel>

                {/* Freeform tag input */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "14px",
                    padding: "10px 14px",
                    marginBottom: "10px",
                  }}
                >
                  <Tag size={14} strokeWidth={2} color="var(--orange)" style={{ flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder={selectedTags.length >= 5 ? "Max 5 tags reached" : "Type a tag and press Enter…"}
                    value={tagInput}
                    disabled={selectedTags.length >= 5}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(tagInput);
                      } else if (e.key === "," ) {
                        e.preventDefault();
                        addTag(tagInput);
                      } else if (e.key === "Backspace" && tagInput === "" && selectedTags.length > 0) {
                        removeTag(selectedTags[selectedTags.length - 1]);
                      }
                    }}
                    autoComplete="off"
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "var(--cream)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: "13px",
                    }}
                  />
                  {selectedTags.length > 0 && (
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--muted)", flexShrink: 0 }}>
                      {selectedTags.length}/5
                    </span>
                  )}
                </div>

                {/* Selected tags as dismissible pills */}
                {selectedTags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "10px" }}>
                    {selectedTags.map((tag) => (
                      <span
                        key={tag}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          background: "rgba(240,96,48,0.16)",
                          border: "1px solid rgba(240,96,48,0.45)",
                          borderRadius: "999px",
                          color: "var(--orange)",
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: "11px",
                          fontWeight: 800,
                          lineHeight: 1,
                          padding: "7px 10px",
                        }}
                      >
                        <Tag size={10} strokeWidth={2.2} />
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            color: "var(--orange)",
                            display: "flex",
                            alignItems: "center",
                            marginLeft: "2px",
                            opacity: 0.7,
                          }}
                        >
                          <X size={11} strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Preset suggestions */}
                {selectedTags.length < 5 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                    {REVIEW_TAG_OPTIONS.filter((tag) => !selectedTags.includes(tag)).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => addTag(tag)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: "999px",
                          color: "var(--cream)",
                          cursor: "pointer",
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: "11px",
                          fontWeight: 800,
                          lineHeight: 1,
                          padding: "8px 10px",
                          opacity: 0.85,
                        }}
                      >
                        <Tag size={10} strokeWidth={2.2} color="var(--muted)" />
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </div>


      {/* 5 — Visibility */}
      <div className="px-5 pb-4">
        <FieldLabel>Share with</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {([
            { value: "public",  icon: <Globe  size={18} strokeWidth={1.8} />, label: "Public",  sub: "Everyone" },
            { value: "circle",  icon: <Users  size={18} strokeWidth={1.8} />, label: "Circle",  sub: "Your friends" },
            { value: "me",      icon: <Lock   size={18} strokeWidth={1.8} />, label: "Just me", sub: "Private log" },
          ] as { value: Visibility; icon: React.ReactNode; label: string; sub: string }[]).map(({ value, icon, label, sub }) => {
            const active = visibility === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setVisibility(value)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  padding: "14px 8px",
                  background: active ? "var(--orange-dim)" : "var(--card)",
                  border: `1.5px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  borderRadius: "14px",
                  cursor: "pointer",
                  color: active ? "var(--orange)" : "var(--muted)",
                }}
              >
                {icon}
                <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "12px", color: active ? "var(--orange)" : "var(--cream)" }}>{label}</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--muted)" }}>{sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {serverError && (
        <div className="px-5 pb-4">
          <p style={{ fontSize: "13px", color: "#EF4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "12px", padding: "12px 14px" }}>
            {serverError}
          </p>
        </div>
      )}

      {/* 7 — Submit */}
      <div className="px-5 pb-6">
        <button
          type="submit"
          disabled={submitting}
          style={{ width: "100%", background: submitting ? "var(--muted)" : "var(--orange)", color: "white", border: "none", borderRadius: "16px", padding: "16px", fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", letterSpacing: "0.3px", lineHeight: 1 }}
        >
          <span style={{ display: "block", lineHeight: 1 }}>
            {submitStep === "uploading"
              ? "Checking and uploading your photos…"
              : submitStep === "posting"
              ? "Posting…"
              : "Post it"}
          </span>
        </button>
      </div>
    </form>
  );
}
