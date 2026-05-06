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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("fc_theme") as ThemeMode | null;
    const resolved = saved === "light" || saved === "dark" ? saved : "system";
    setMode(resolved);
    applyTheme(resolved);
    setMounted(true);
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

  return { mode, setThemeMode, mounted };
}
