"use client";

import { useState, useEffect } from "react";

export default function CircleButton({ personName }: { personName: string }) {
  const [inCircle, setInCircle] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const circle: string[] = JSON.parse(localStorage.getItem("fc_circle") ?? "[]");
    setInCircle(circle.includes(personName));
    setMounted(true);
  }, [personName]);

  function toggle() {
    const circle: string[] = JSON.parse(localStorage.getItem("fc_circle") ?? "[]");
    const next = inCircle
      ? circle.filter(n => n !== personName)
      : [...circle, personName];
    localStorage.setItem("fc_circle", JSON.stringify(next));
    setInCircle(!inCircle);
  }

  if (!mounted) return null;

  return (
    <button
      onClick={toggle}
      style={{
        width: "100%",
        background: inCircle ? "rgba(61,214,140,0.1)" : "var(--orange)",
        color: inCircle ? "var(--green)" : "white",
        border: inCircle ? "1px solid rgba(61,214,140,0.3)" : "none",
        borderRadius: "14px",
        padding: "14px",
        fontFamily: "'Syne', sans-serif",
        fontSize: "14px",
        fontWeight: 700,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
      }}
    >
      {inCircle ? "✓ In your circle" : "Add to Circle +"}
    </button>
  );
}
