"use client";

import { useRef, useState } from "react";

interface PhotoUploadProps {
  onFileSelect: (file: File | null) => void;
}

export default function PhotoUpload({ onFileSelect }: PhotoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");

  function handleFile(file: File | null) {
    setError("");
    if (!file) {
      setPreview(null);
      onFileSelect(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Only image files are accepted.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    onFileSelect(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0] ?? null);
  }

  function removePhoto() {
    setPreview(null);
    onFileSelect(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {preview ? (
        <div
          style={{
            position: "relative",
            borderRadius: "18px",
            overflow: "hidden",
            height: "200px",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Preview"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <button
            type="button"
            onClick={removePhoto}
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              background: "rgba(0,0,0,0.6)",
              border: "none",
              color: "white",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: "13px",
            }}
            aria-label="Remove photo"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          style={{
            height: "160px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            borderRadius: "18px",
            border: "2px dashed var(--border)",
            background: "var(--card)",
            color: "var(--muted)",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "32px" }}>📷</span>
          <span>Tap to add a photo</span>
          <span style={{ fontSize: "11px", color: "var(--border)" }}>PNG · JPG · WEBP · max 5 MB</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {error && (
        <p style={{ fontSize: "12px", color: "#EF4444" }}>{error}</p>
      )}
    </div>
  );
}
