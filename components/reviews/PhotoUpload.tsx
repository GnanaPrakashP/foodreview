"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, ImagePlus, Play, Video, X } from "lucide-react";

const MAX_MEDIA = 4;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_VIDEO_DURATION_SECONDS = 10;
const POST_ASPECT_RATIO = 4 / 5;
const CROP_OUTPUT_WIDTH = 1080;
const CROP_OUTPUT_HEIGHT = 1350;
const ACCEPTED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ACCEPTED_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ACCEPTED_MIME = new Set([...ACCEPTED_IMAGE_MIME, ...ACCEPTED_VIDEO_MIME]);

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

export type ReviewUploadFile = File & {
  durationSeconds?: number;
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

async function passedVideoMagicBytes(file: File): Promise<boolean> {
  const buf = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const text = String.fromCharCode(...bytes);
  return text.includes("ftyp") || (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}

function getVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("invalid duration"));
        return;
      }
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("invalid video"));
    };
    video.src = objectUrl;
  });
}

interface PhotoUploadProps {
  files: ReviewUploadFile[];
  onFilesChange: (files: ReviewUploadFile[]) => void;
  error?: string;
}

export default function PhotoUpload({ files, onFilesChange, error }: PhotoUploadProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoCameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);
  const [cropInteraction, setCropInteraction] = useState<CropInteraction | null>(null);

  async function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;

    const slots = MAX_MEDIA - files.length - cropQueue.length - (cropSession ? 1 : 0);
    if (slots <= 0) return;

    const imagesForCrop: File[] = [];
    const videos: ReviewUploadFile[] = [];
    const errors: string[] = [];

    for (const file of Array.from(incoming).slice(0, slots)) {
      if (!ACCEPTED_MIME.has(file.type)) {
        errors.push(`${file.name}: choose an image or video`);
        continue;
      }
      if (ACCEPTED_IMAGE_MIME.has(file.type)) {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          errors.push(`${file.name}: image exceeds 5 MB`);
          continue;
        }
        if (!(await passedMagicBytes(file))) {
          errors.push(`${file.name}: invalid image`);
          continue;
        }
        imagesForCrop.push(file);
      } else if (ACCEPTED_VIDEO_MIME.has(file.type)) {
        if (file.size > MAX_VIDEO_SIZE_BYTES) {
          errors.push(`${file.name}: video exceeds 50 MB`);
          continue;
        }
        if (!(await passedVideoMagicBytes(file))) {
          errors.push(`${file.name}: invalid video`);
          continue;
        }
        let durationSeconds = 0;
        try {
          durationSeconds = await getVideoDurationSeconds(file);
        } catch {
          errors.push(`${file.name}: could not read video duration`);
          continue;
        }
        if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
          errors.push(`${file.name}: video must be 10 seconds or less`);
          continue;
        }
        Object.defineProperty(file, "durationSeconds", {
          value: durationSeconds,
          enumerable: true,
          configurable: true,
        });
        videos.push(file as ReviewUploadFile);
      }
    }

    if (errors.length) {
      // Surface first error via native alert — keeps this component dependency-free
      alert(errors[0]);
    }
    if (videos.length) {
      onFilesChange([...files, ...videos].slice(0, MAX_MEDIA));
    }
    if (imagesForCrop.length) {
      setCropQueue((current) => [...current, ...imagesForCrop]);
    }
  }

  function openCamera() {
    setShowSourceMenu(false);
    cameraRef.current?.click();
  }

  function openVideoCamera() {
    setShowSourceMenu(false);
    videoCameraRef.current?.click();
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
    if (!image || !cropSession?.crop || files.length >= MAX_MEDIA) return;

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

    if (croppedFile.size > MAX_IMAGE_SIZE_BYTES) {
      alert("Cropped photo exceeds 5 MB");
      return;
    }

    onFilesChange([...files, croppedFile]);
    setCropInteraction(null);
    setCropSession(null);
  }

  useEffect(() => {
    if (!showSourceMenu) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
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

  const canAddMore = files.length < MAX_MEDIA;
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
              {file.type.startsWith("video/") ? (
                <>
                  <video
                    src={URL.createObjectURL(file)}
                    muted
                    playsInline
                    preload="metadata"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <span style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(0,0,0,0.58)", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
                      <Play size={16} fill="currentColor" strokeWidth={0} />
                    </span>
                  </div>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={URL.createObjectURL(file)}
                  alt={`Media ${i + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
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
                aria-label="Remove media"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add button */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          aria-expanded={showSourceMenu}
          aria-haspopup="dialog"
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
            <span>{files.length > 0 && !maxReached ? "Add more" : "Add media"}</span>
            {maxReached && (
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>4 per post</span>
            )}
          </span>
        </button>

        {canAddMore && showSourceMenu && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add media"
            onClick={() => setShowSourceMenu(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.62)",
              zIndex: 70,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: "32rem",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderBottom: "none",
                borderRadius: "18px 18px 0 0",
                padding: "8px 8px calc(8px + env(safe-area-inset-bottom))",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 10px" }}>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "var(--cream)", margin: 0 }}>
                  Add media
                </p>
                <button
                  type="button"
                  onClick={() => setShowSourceMenu(false)}
                  aria-label="Close media options"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 9,
                    border: "1px solid var(--border)",
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
              <div style={{ display: "grid", gap: "7px" }}>
              <button
                type="button"
                onClick={openCamera}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  width: "100%",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  color: "var(--cream)",
                  padding: "11px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: "34px", height: "34px", borderRadius: "10px", background: "var(--orange-dim)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Camera size={17} strokeWidth={1.8} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700 }}>Take photo</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)" }}>Open camera for a fresh shot</span>
                </span>
              </button>

              <button
                type="button"
                onClick={openVideoCamera}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  color: "var(--cream)",
                  padding: "11px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(61,214,140,0.12)", color: "#3DD68C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Video size={17} strokeWidth={1.8} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700 }}>Record video</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)" }}>10 seconds max</span>
                </span>
              </button>

              <button
                type="button"
                onClick={openGallery}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  color: "var(--cream)",
                  padding: "11px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(232,168,48,0.12)", color: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <ImageIcon size={17} strokeWidth={1.8} />
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "13px", fontWeight: 700 }}>Choose from library</span>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "var(--muted)" }}>Photos and videos from your gallery</span>
                </span>
              </button>
              </div>
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
                      outline: "9999px solid rgba(0,0,0,0.48)",
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
        ref={videoCameraRef}
        type="file"
        accept="video/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => addFiles(e.target.files)}
        onClick={(e) => { (e.target as HTMLInputElement).value = ""; }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,video/*"
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
