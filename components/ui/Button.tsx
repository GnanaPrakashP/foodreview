import { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  fullWidth?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition-opacity disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  primary:   "text-white",
  secondary: "border text-fc-cream",
  ghost:     "text-fc-muted",
  danger:    "text-white bg-red-600 hover:bg-red-700",
};

export default function Button({
  variant = "primary",
  loading = false,
  fullWidth = false,
  children,
  className = "",
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isPrimary = variant === "primary";
  const isSecondary = variant === "secondary";

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      style={{
        background: isPrimary ? "var(--orange)" : isSecondary ? "var(--card)" : undefined,
        borderColor: isSecondary ? "var(--border)" : undefined,
        fontFamily: "'Syne', sans-serif",
        ...style,
      }}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
