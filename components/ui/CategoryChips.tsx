"use client";

import type { ReactNode } from "react";

export type CategoryChipOption<T extends string = string> = {
  id: T;
  label: string;
};

type CategoryChipsProps<T extends string> = {
  categories: readonly CategoryChipOption<T>[];
  selected: T;
  onChange: (category: T) => void;
  variant: "places" | "dishes";
  renderMedia?: (category: CategoryChipOption<T>, active: boolean) => ReactNode;
};

export default function CategoryChips<T extends string>({
  categories,
  selected,
  onChange,
  variant,
  renderMedia,
}: CategoryChipsProps<T>) {
  const accent = variant === "places" ? "var(--orange)" : "var(--green)";
  const activeText = variant === "places" ? "white" : "var(--on-green)";

  return (
    <div
      aria-label={`${variant} categories`}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "0 16px 14px",
      }}
    >
      {categories.map((category) => {
        const active = category.id === selected;
        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(category.id)}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              minHeight: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: active ? `1px solid ${accent}` : "1px solid var(--border)",
              background: active ? accent : "var(--surface)",
              color: active ? activeText : "var(--cream)",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease",
              transform: active ? "translateY(-1px)" : "translateY(0)",
            }}
          >
            {renderMedia?.(category, active)}
            {category.label}
          </button>
        );
      })}
    </div>
  );
}
