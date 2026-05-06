"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PhotoUpload from "@/components/reviews/PhotoUpload";
import type { FoodItem, Review } from "@/lib/types";
import { getVisitPrompt } from "@/lib/visits";
import { UtensilsCrossed, Star, X, Search, MapPin, Globe, Users, Lock } from "lucide-react";
import type { Visibility } from "@/lib/types";

/* ─── helpers ────────────────────────────────────── */

function emptyItem(): FoodItem {
  return { name: "", rating: 0 };
}

const RATING_LABELS: Record<number, string> = {
  1: "Bad", 2: "Okay", 3: "Good", 4: "Great", 5: "Amazing",
};

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

/* ─── Dish row with per-row autocomplete ─────────── */

function DishRow({
  item,
  allDishNames,
  onChange,
  onRemove,
  showRemove,
}: {
  item: FoodItem;
  allDishNames: string[];
  onChange: (field: keyof FoodItem, value: string | number) => void;
  onRemove: () => void;
  showRemove: boolean;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleInput(v: string) {
    onChange("name", v);
    if (v.trim().length > 0) {
      const q = v.toLowerCase();
      const matches = allDishNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 5);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }

  function pick(name: string) {
    onChange("name", name);
    setShowSuggestions(false);
    inputRef.current?.blur();
  }

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
        <UtensilsCrossed size={16} strokeWidth={1.8} color="var(--muted)" style={{ flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          placeholder="e.g. Mutton Biryani"
          value={item.name}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => item.name.trim() && setShowSuggestions(suggestions.length > 0)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
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

      {showSuggestions && (
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
            zIndex: 20,
          }}
        >
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={() => pick(s)}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--border)",
                padding: "11px 14px",
                color: "var(--cream)",
                fontSize: "14px",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Search size={12} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── main form ──────────────────────────────────── */

export default function ReviewForm() {
  const router = useRouter();

  const [reviewerName] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("fc_my_name") ?? "" : ""
  );
  const [restaurantName, setRestaurantName] = useState("");
  const [existingVisitCount, setExistingVisitCount] = useState<number | null>(null);

  const [items, setItems] = useState<FoodItem[]>([emptyItem()]);
  const [allDishNames, setAllDishNames] = useState<string[]>([]);

  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  // Load autocomplete dish names once
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("reviews")
        .select("items")
        .limit(300)
        .returns<Pick<Review, "items">[]>();
      const names = new Set<string>();
      for (const r of data ?? []) {
        for (const it of (r.items as FoodItem[])) {
          if (it.name.trim()) names.add(it.name.trim());
        }
      }
      setAllDishNames(Array.from(names));
    }
    load();
  }, []);

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

  function validate() {
    const e: Record<string, string> = {};
    if (!restaurantName.trim()) e.restaurantName = "Restaurant name is required.";
    if (items.filter((it) => it.name.trim()).length === 0) e.items = "Add at least one dish.";
    if (body.trim() && body.trim().length < 5) e.body = "One-liner must be at least 5 characters.";
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

    const supabase = createClient();

    try {
      let photoUrl: string | null = null;
      if (photoFile) {
        const ext = photoFile.name.split(".").pop();
        const path = `public/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("review-photos")
          .upload(path, photoFile, { upsert: false });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("review-photos").getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      // Normalize dish names via fuse.js — prevents "chicken" and "chiken" counting separately
      const rawItems = items.filter((it) => it.name.trim());
      const { default: Fuse } = await import("fuse.js");
      const fuse = new Fuse(allDishNames, { threshold: 0.15, includeScore: true });
      const allItems = rawItems.map((it) => {
        const results = fuse.search(it.name);
        if (results.length > 0 && (results[0].score ?? 1) <= 0.15) {
          return { ...it, name: results[0].item };
        }
        return it;
      });

      const { data: review, error: insertError } = await (supabase as any)
        .from("reviews")
        .insert({
          reviewer_name: reviewerName.trim(),
          restaurant_name: restaurantName.trim(),
          items: allItems,
          body: body.trim() || null,
          photo_url: photoUrl,
          visibility,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // Notify people who can see this post in their Circle feed.
      const poster = reviewerName.trim();
      const { data: circleData } = await supabase
        .from("circle_memberships")
        .select("member_name")
        .eq("user_name", poster)
        .returns<{ member_name: string }[]>();

      const circleMembers = (circleData ?? []).map((row) => row.member_name);

      if (circleMembers.length > 0) {
        await (supabase as any).from("notifications").insert(
          circleMembers.map((member) => ({
            recipient_name: member,
            actor_name: poster,
            type: "circle_post",
            post_id: review.id,
            restaurant_name: restaurantName.trim(),
          }))
        );
      }

      router.push(`/reviews/${review.id}`);
      router.refresh();
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>

      {/* 1 — Photo */}
      <div className="px-5 pb-4">
        <FieldLabel optional>Photo</FieldLabel>
        <PhotoUpload onFileSelect={setPhotoFile} />
      </div>

      {/* 2 — Restaurant */}
      <div className="px-5 pb-4">
        <FieldLabel>Restaurant</FieldLabel>
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
          <MapPin size={16} strokeWidth={1.8} color="var(--muted)" style={{ flexShrink: 0 }} />
          <input
            type="text"
            placeholder="e.g. Bawarchi"
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--cream)", fontSize: "14px", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}
          />
        </div>
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
              allDishNames={allDishNames}
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
          style={{ width: "100%", background: submitting ? "var(--muted)" : "var(--orange)", color: "white", border: "none", borderRadius: "16px", padding: "16px", fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", letterSpacing: "0.3px" }}
        >
          {submitting ? "Posting…" : "Post it"}
        </button>
      </div>
    </form>
  );
}
