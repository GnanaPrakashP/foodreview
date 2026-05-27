"use client";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  confirmVariant?: "primary" | "danger";
  disabled?: boolean;
};

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText,
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  confirmVariant = "primary",
  disabled = false,
}: ConfirmModalProps) {
  if (!open) return null;

  const confirmBackground = confirmVariant === "danger" ? "#EF4444" : "var(--orange)";
  const confirmFont = confirmVariant === "danger" ? "'DM Sans', sans-serif" : "'DM Sans', sans-serif";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "var(--card)", borderRadius: "20px", padding: "24px", width: "100%", maxWidth: "320px", border: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 800, color: "var(--cream)", marginBottom: "8px" }}>
          {title}
        </h2>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "20px", fontFamily: "'DM Sans', sans-serif" }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={onCancel}
            disabled={disabled}
            style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "12px", color: "var(--cream)", fontSize: "14px", fontWeight: 600, cursor: disabled ? "default" : "pointer", fontFamily: "'DM Sans', sans-serif", opacity: disabled ? 0.6 : 1 }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            style={{ flex: 1, background: confirmBackground, border: "none", borderRadius: "12px", padding: "12px", color: "white", fontSize: "14px", fontWeight: 700, cursor: disabled ? "default" : "pointer", fontFamily: confirmFont, opacity: disabled ? 0.7 : 1 }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
