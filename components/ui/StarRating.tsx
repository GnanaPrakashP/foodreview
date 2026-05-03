"use client";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizes = { sm: "16px", md: "22px", lg: "28px" };

export default function StarRating({
  value,
  onChange,
  readonly = false,
  size = "md",
}: StarRatingProps) {
  return (
    <div style={{ display: "flex", gap: "3px" }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => !readonly && onChange?.(star)}
          style={{
            background: "none",
            border: "none",
            cursor: readonly ? "default" : "pointer",
            padding: "1px",
            fontSize: sizes[size],
            lineHeight: 1,
            opacity: star <= value ? 1 : 0.2,
          }}
          aria-label={`${star} star${star !== 1 ? "s" : ""}`}
        >
          ⭐
        </button>
      ))}
    </div>
  );
}
