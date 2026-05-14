"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, ImagePlus, X } from "lucide-react";

const MAX_PHOTOS = 4;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const POST_ASPECT_RATIO = 4 / 5;
const CROP_OUTPUT_WIDTH = 1080;
const CROP_OUTPUT_HEIGHT = 1350;
const ACCEPTED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Magic-byte signatures for accepted image types
const MAGIC: [number[], string][] = [
  [[0xff, 0xd8, 0xff], "JPEG"],
  [[0x89, 0x50, 0x4e, 0x47], "PNG"],
  [[0x52, 0x49, 0x46, 0x46], "WebP"],   // also need bytes 8-11 = WEBP
  [[0x47, 0x49, 0x46], "GIF"],
];

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CropSession = {
  file: File;
  objectUrl: string;
  crop: CropRect | null;
};

type CropInteraction = {
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startCrop: CropRect;
  imageWidth: number;
  imageHeight: number;
  scale: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInitialCrop(width: number, height: number): CropRect {
  const cropWidth = Math.min(width, height * POST_ASPECT_RATIO);
  const cropHeight = cropWidth / POST_ASPECT_RATIO;
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

function getCroppedFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}-4x5.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function passedMagicBytes(file: File): Promise<boolean> {
  const buf = await file.slice(0, 12).arrayBuffer();
  const b = new Uint8Array(buf);
  for (const [sig] of MAGIC) {
    if (sig.every((byte, i) => b[i] === byte)) {
      // Extra WebP check
      if (sig[0] === 0x52) {
        return b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
      }
      return true;
    }
  }
  return false;
}

interface PhotoUploadProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  error?: string;
}

export default function PhotoUpload({ files, onFilesChange, error }: PhotoUploadProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);
  const [cropInteraction, setCropInteraction] = useState<CropInteraction | null>(null);

  async function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;

    const slots = MAX_PHOTOS - files.length - cropQueue.length - (cropSession ? 1 : 0);
    if (slots <= 0) return;

    const accepted: File[] = [];
    const errors: string[] = [];

    for (const file of Array.from(incoming).slice(0, slots)) {
      if (!ACCEPTED_MIME.has(file.type)) {
        errors.push(`${file.name}: not an image`);
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        errors.push(`${file.name}: exceeds 5 MB`);
        continue;
      }
      if (!(await passedMagicBytes(file))) {
        errors.push(`${file.name}: invalid image`);
        continue;
      }
      accepted.push(file);
    }

    if (errors.length) {
      // Surface first error via native alert — keeps this component dependency-free
      alert(errors[0]);
    }
    if (accepted.length) {
      setCropQueue((current) => [...current, ...accepted]);
    }
  }

  function openCamera() {
    setShowSourceMenu(false);
    cameraRef.current?.click();
  }

  function openGallery() {
    setShowSourceMenu(false);
    galleryRef.current?.click();
  }

  function remove(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  function startCropInteraction(mode: CropInteraction["mode"], event: React.PointerEvent) {
    const image = cropImageRef.current;
    if (!image || !cropSession?.crop) return;

    event.preventDefault();
    event.stopPropagation();

    setCropInteraction({
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: cropSession.crop,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      scale: image.clientWidth / image.naturalWidth,
    });
  }

  function cancelCrop() {
    setCropInteraction(null);
    setCropSession(null);
  }

  async function useCroppedPhoto() {
    const image = cropImageRef.current;
    if (!image || !cropSession?.crop || files.length >= MAX_PHOTOS) return;

    const canvas = document.createElement("canvas");
    canvas.width = CROP_OUTPUT_WIDTH;
    canvas.height = CROP_OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      alert("Could not prepare photo");
      return;
    }

    const { x, y, width, height } = cropSession.crop;
    context.drawImage(
      image,
      x,
      y,
      width,
      height,
      0,
      0,
      CROP_OUTPUT_WIDTH,
      CROP_OUTPUT_HEIGHT
    );

    const blob = await canvasToBlob(canvas, 0.9);
    if (!blob) {
      alert("Could not prepare photo");
      return;
    }

    const croppedFile = new File([blob], getCroppedFileName(cropSession.file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    if (croppedFile.size > MAX_SIZE_BYTES) {
      alert("Cropped photo exceeds 5 MB");
      return;
    }

    onFilesChange([...files, croppedFile]);
    setCropInteraction(null);
    setCropSession(null);
  }

  useEffect(() => {
    if (!showSourceMenu) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && sourceMenuRef.current && !sourceMenuRef.current.contains(target)) {
        setShowSourceMenu(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showSourceMenu]);

  useEffect(() => {
    if (cropSession || cropQueue.length === 0) return;

    const [nextFile, ...remaining] = cropQueue;
    setCropQueue(remaining);
    setCropSession({
      file: nextFile,
      objectUrl: URL.createObjectURL(nextFile),
      crop: null,
    });
  }, [cropQueue, cropSession]);

  useEffect(() => {
    if (!cropSession) return;
    return () => URL.revokeObjectURL(cropSession.objectUrl);
  }, [cropSession]);

  useEffect(() => {
    if (!cropInteraction) return;
    const interaction = cropInteraction;

    function handlePointerMove(event: PointerEvent) {
      setCropSession((session) => {
        if (!session?.crop) return session;

        const dx = (event.clientX - interaction.startClientX) / interaction.scale;
        const dy = (event.clientY - interaction.startClientY) / interaction.scale;
        const start = interaction.startCrop;

        if (interaction.mode === "move") {
          return {
            ...session,
            crop: {
              ...start,
              x: clamp(start.x + dx, 0, interaction.imageWidth - start.width),
              y: clamp(start.y + dy, 0, interaction.imageHeight - start.height),
            },
          };
        }

        const maxWidth = Math.min(
          interaction.imageWidth - start.x,
          (interaction.imageHeight - start.y) * POST_ASPECT_RATIO
        );
        const minWidth = Math.min(maxWidth, Math.max(120, maxWidth * 0.32));
        const projectedDeltaWidth = (dx + dy * POST_ASPECT_RATIO) / 2;
        const nextWidth = clamp(start.width + projectedDeltaWidth, minWidth, maxWidth);

        return {
          ...session,
          crop: {
            ...start,
            width: nextWidth,
            height: nextWidth / POST_ASPECT_RATIO,
          },
        };
      });
    }

    function handlePointerUp() {
      setCropInteraction(null);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    };
  }, [cropInteraction]);

  const canAddMore = files.length < MAX_PHOTOS;
  const maxReached = !canAddMore;
  const cropImage = cropImageRef.current;
  const cropScale =
    cropImage && cropSession?.crop ? cropImage.clientWidth / cropImage.naturalWidth : 1;
  const cropStyle = cropSession?.crop
    ? {
        left: `${cropSession.crop.x * cropScale}px`,
        top: `${cropSession.crop.y * cropScale}px`,
        width: `${cropSession.crop.width * cropScale}px`,
        height: `${cropSession.crop.height * cropScale}px`,
      }
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

      {/* Thumbnails grid */}
      {files.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
            gap: "8px",
          }}
        >
          {files.map((file, i) => (
            <div
              key={i}
              style={{
                position: "relative",
                borderRadius: "12px",
                overflow: "hidden",
                aspectRatio: "4/5",
                background: "var(--card)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={URL.createObjectURL(file)}
                alt={`Photo ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                style={{
                  position: "absolute",
                  top: "6px",
                  right: "6px",
                  background: "rgba(0,0,0,0.65)",
                  border: "none",
                  color: "white",
                  borderRadius: "50%",
                  width: "22px",
                  height: "22px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                }}
                aria-label="Remove photo"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      <div ref={sourceMenuRef} style={{ position: "relative" }}>
        <button
          type="button"
          aria-expanded={showSourceMenu}
          aria-haspopup="menu"
          disabled={maxReached}
          onClick={() => {
            if (!canAddMore) return;
            setShowSourceMenu((open) => !open);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            width: "100%",
            height: files.length > 0 ? "52px" : "118px",
            borderRadius: "14px",
            border: "2px dashed var(--border)",
            background: "var(--card)",
            color: "var(--muted)",
            fontSize: "13px",
            cursor: maxReached ? "default" : "pointer",
            opacity: maxReached ? 0.68 : 1,
            flexDirection: files.length > 0 ? "row" : "column",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <ImagePlus size={files.length > 0 ? 18 : 30} strokeWidth={1.6} />
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
            <span>{files.length > 0 && !maxReached ? "Add more" : "Add photos"}</span>
            {maxReached && (
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>4 per post</span>
            )}
          </span>
        </button>

        {canAddMore && showSourceMenu && (
          <div
            role="menu"
            aria-label="Photo options"
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "absolute",
              top: "50%",
              right: "12px",
              transform: "translateY(-50%)",
              width: "min(calc(100% - 24px), 206px)",
              minWidth: "168px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "12px",
              padding: "5px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
              zIndex: 15,
            }}
          >
            <div style={{ display: "grid", gap: "6px" }}>
              <button
                type="button"
                role="menuitem"
                onClick={openCamera}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  width: "100%",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  color: "var(--cream)",
                  padding: "8px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: "28px", height: "28px", borderRadius: "9px", background: "var(--orange-dim)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Camera size={15} strokeWidth={1.8} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "12px", fontWeight: 700 }}>Camera</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--muted)" }}>Take a new photo</span>
                </span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={openGallery}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  width: "100%",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  color: "var(--cream)",
                  padding: "8px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: "28px", height: "28px", borderRadius: "9px", background: "rgba(232,168,48,0.12)", color: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <ImageIcon size={15} strokeWidth={1.8} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "12px", fontWeight: 700 }}>Photo library</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "10px", color: "var(--muted)" }}>Choose from gallery</span>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {cropSession && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Crop photo"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.78)",
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "520px",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              padding: "14px",
              display: "grid",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <h2 style={{ margin: 0, color: "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800 }}>
                Adjust photo
              </h2>
              <button
                type="button"
                onClick={cancelCrop}
                aria-label="Close crop"
                style={{
                  width: "30px",
                  height: "30px",
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  background: "var(--surface)",
                  color: "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <X size={15} strokeWidth={2.2} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                overflow: "hidden",
                borderRadius: "12px",
                background: "var(--surface)",
                maxHeight: "64vh",
              }}
            >
              <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={cropImageRef}
                  src={cropSession.objectUrl}
                  alt="Selected photo"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setCropSession((session) =>
                      session && !session.crop
                        ? { ...session, crop: getInitialCrop(image.naturalWidth, image.naturalHeight) }
                        : session
                    );
                  }}
                  style={{
                    display: "block",
                    maxWidth: "100%",
                    maxHeight: "64vh",
                    width: "auto",
                    height: "auto",
                    userSelect: "none",
                  }}
                  draggable={false}
                />
                {cropStyle && (
                  <div
                    onPointerDown={(event) => startCropInteraction("move", event)}
                    style={{
                      position: "absolute",
                      ...cropStyle,
                      border: "2px solid var(--orange)",
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.48)",
                      cursor: "move",
                      touchAction: "none",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: "33.333% 0 auto 0",
                        borderTop: "1px solid rgba(255,255,255,0.42)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: "66.666% 0 auto 0",
                        borderTop: "1px solid rgba(255,255,255,0.42)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: "0 auto 0 33.333%",
                        borderLeft: "1px solid rgba(255,255,255,0.42)",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: "0 auto 0 66.666%",
                        borderLeft: "1px solid rgba(255,255,255,0.42)",
                      }}
                    />
                    <button
                      type="button"
                      aria-label="Resize crop"
                      onPointerDown={(event) => startCropInteraction("resize", event)}
                      style={{
                        position: "absolute",
                        right: "-8px",
                        bottom: "-8px",
                        width: "18px",
                        height: "18px",
                        borderRadius: "6px",
                        border: "2px solid var(--card)",
                        background: "var(--orange)",
                        cursor: "nwse-resize",
                        padding: 0,
                        touchAction: "none",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={cancelCrop}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--cream)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={useCroppedPhoto}
                disabled={!cropSession.crop}
                style={{
                  border: "none",
                  background: "var(--orange)",
                  color: "white",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  fontSize: "13px",
                  fontWeight: 800,
                  cursor: cropSession.crop ? "pointer" : "default",
                  opacity: cropSession.crop ? 1 : 0.7,
                  fontFamily: "'Syne', sans-serif",
                }}
              >
                Use photo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => addFiles(e.target.files)}
        onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => addFiles(e.target.files)}
        onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
      />

      {error && (
        <p style={{ fontSize: "12px", color: "#EF4444", marginTop: "2px" }}>{error}</p>
      )}
    </div>
  );
}
