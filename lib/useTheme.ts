"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

function applyTheme(mode: ThemeMode) {
  if (mode === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else if (mode === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = localStorage.getItem("fc_theme") as ThemeMode | null;
    if (saved === "light" || saved === "dark") {
      setMode(saved);
      applyTheme(saved);
    } else {
      setMode("system");
      applyTheme("system");
    }
  }, []);

  function setThemeMode(next: ThemeMode) {
    setMode(next);
    if (next === "system") {
      localStorage.removeItem("fc_theme");
    } else {
      localStorage.setItem("fc_theme", next);
    }
    applyTheme(next);
  }

  return { mode, setThemeMode };
}
