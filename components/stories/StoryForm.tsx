"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Globe, ImagePlus, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { invalidateCachedJson } from "@/lib/browser-api-cache";
import type { StoryVisibility } from "@/lib/types";

type ModeratedPhoto = {
  publicUrl: string;
  storagePath: string;
  width: number;
  height: number;
  sizeBytes: number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}

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

export default function StoryForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<StoryVisibility>("circle");
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState<"uploading" | "posting" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(nextFile: File | undefined) {
    setError("");
    if (!nextFile) return;
    if (!nextFile.type.startsWith("image/")) {
      setError("Choose an image for your story.");
      return;
    }
    if (nextFile.size > 5 * 1024 * 1024) {
      setError("Story photo must be 5 MB or smaller.");
      return;
    }
    setFile(nextFile);
  }

  async function uploadAndModerateStoryPhoto(): Promise<ModeratedPhoto> {
    if (!file) throw new Error("Add a photo for your story.");

    const supabase = createClient();
    const ext = file.name.split(".").pop() ?? "jpg";
    const quarantinePath = `quarantine/${Date.now()}_story_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("review-photos")
      .upload(quarantinePath, file, { upsert: false });

    if (uploadError) throw new Error("Failed to upload story photo for checking.");

    const moderateResponse = await fetch("/api/photos/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quarantinePaths: [quarantinePath] }),
    });
    const moderateJson = await moderateResponse.json().catch(() => ({}));
    if (!moderateResponse.ok) {
      throw new Error(moderateJson.error ?? "Photo check failed. Try a different photo.");
    }

    const photo = (moderateJson.photos as ModeratedPhoto[] | undefined)?.[0];
    if (!photo?.publicUrl) throw new Error("Photo processing failed.");
    return photo;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);
    try {
      setSubmitStep("uploading");
      const photo = await uploadAndModerateStoryPhoto();

      setSubmitStep("posting");
      const response = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl: photo.publicUrl,
          storagePath: photo.storagePath,
          caption,
          visibility,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Unable to create story.");

      invalidateCachedJson("/api/stories");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err) || "Something went wrong.");
      setSubmitting(false);
      setSubmitStep(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column" }}>
      <div className="px-5 pb-4">
        <FieldLabel>Photo</FieldLabel>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            width: "100%",
            aspectRatio: "9/14",
            maxHeight: "560px",
            border: `1.5px solid ${error && !file ? "#EF4444" : "var(--border)"}`,
            borderRadius: "18px",
            background: "var(--card)",
            color: "var(--muted)",
            overflow: "hidden",
            cursor: "pointer",
            padding: 0,
            position: "relative",
          }}
        >
          {previewUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Story preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <span style={{ position: "absolute", right: "12px", top: "12px", width: "34px", height: "34px", borderRadius: "50%", background: "rgba(0,0,0,0.62)", color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Camera size={17} strokeWidth={2.1} />
              </span>
            </>
          ) : (
            <span style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", fontFamily: "'DM Sans', sans-serif", fontSize: "13px" }}>
              <ImagePlus size={34} strokeWidth={1.6} />
              Add a story photo
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(event) => pickFile(event.target.files?.[0])}
          onClick={(event) => {
            (event.target as HTMLInputElement).value = "";
          }}
        />
        {file && (
          <button
            type="button"
            onClick={() => setFile(null)}
            style={{ marginTop: "10px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", borderRadius: "12px", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", width: "100%", fontFamily: "'DM Sans', sans-serif", fontSize: "13px", cursor: "pointer" }}
          >
            <X size={14} strokeWidth={2.2} />
            Remove photo
          </button>
        )}
      </div>

      <div className="px-5 pb-4">
        <FieldLabel optional>Caption</FieldLabel>
        <textarea
          value={caption}
          onChange={(event) => setCaption(event.target.value.slice(0, 180))}
          placeholder="What are you eating?"
          rows={3}
          style={{
            width: "100%",
            background: "var(--card)",
            border: "1px solid var(--border)",
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
        <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)", textAlign: "right", marginTop: "5px" }}>
          {caption.length}/180
        </p>
      </div>

      <div className="px-5 pb-4">
        <FieldLabel>Share with</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px" }}>
          {([
            { value: "circle", icon: <Users size={18} strokeWidth={1.8} />, label: "Circle", sub: "Your friends" },
            { value: "public", icon: <Globe size={18} strokeWidth={1.8} />, label: "Public", sub: "Everyone" },
          ] as { value: StoryVisibility; icon: React.ReactNode; label: string; sub: string }[]).map(({ value, icon, label, sub }) => {
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
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, fontSize: "12px", color: active ? "var(--orange)" : "var(--cream)" }}>{label}</span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--muted)" }}>{sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="px-5 pb-4">
          <p style={{ fontSize: "13px", color: "#EF4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "12px", padding: "12px 14px" }}>
            {error}
          </p>
        </div>
      )}

      <div className="px-5 pb-6">
        <button
          type="submit"
          disabled={submitting}
          style={{ width: "100%", background: submitting ? "var(--muted)" : "var(--orange)", color: "white", border: "none", borderRadius: "16px", padding: "16px", fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", letterSpacing: "0.3px", lineHeight: 1 }}
        >
          {submitStep === "uploading"
            ? "Checking photo..."
            : submitStep === "posting"
            ? "Sharing..."
            : "Share story"}
        </button>
      </div>
    </form>
  );
}
