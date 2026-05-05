import { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

const inputBase: React.CSSProperties = {
  width: "100%",
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "14px",
  padding: "14px",
  color: "var(--cream)",
  fontSize: "14px",
  outline: "none",
};

const errorBorder: React.CSSProperties = { borderColor: "#EF4444" };

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  error?: string;
}

function FieldLabel({ children }: { children: ReactNode }) {
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
    </label>
  );
}

export function Input({ label, error, style, ...props }: InputProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input
        {...props}
        style={{ ...inputBase, ...(error ? errorBorder : {}), ...style }}
      />
      {error && <p style={{ fontSize: "11px", color: "#EF4444" }}>{error}</p>}
    </div>
  );
}

export function Textarea({ label, error, style, ...props }: TextareaProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <textarea
        {...props}
        style={{
          ...inputBase,
          resize: "none",
          fontFamily: "'Syne', sans-serif",
          fontStyle: "italic",
          fontSize: "16px",
          lineHeight: "1.4",
          ...(error ? errorBorder : {}),
          ...style,
        }}
      />
      {error && <p style={{ fontSize: "11px", color: "#EF4444" }}>{error}</p>}
    </div>
  );
}
