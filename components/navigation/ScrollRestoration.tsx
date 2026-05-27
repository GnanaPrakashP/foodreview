"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const STORAGE_PREFIX = "fc_scroll:";
const MAX_SCROLL_AGE_MS = 30 * 60 * 1000;

type ScrollEntry = {
  y: number;
  savedAt: number;
};

function scrollKey() {
  return `${window.location.pathname}${window.location.search}`;
}

function readScroll(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<ScrollEntry>;
    if (
      typeof entry.y !== "number" ||
      typeof entry.savedAt !== "number" ||
      Date.now() - entry.savedAt > MAX_SCROLL_AGE_MS
    ) {
      return null;
    }
    return Math.max(0, entry.y);
  } catch {
    return null;
  }
}

function writeScroll(key: string) {
  try {
    sessionStorage.setItem(
      `${STORAGE_PREFIX}${key}`,
      JSON.stringify({ y: window.scrollY, savedAt: Date.now() } satisfies ScrollEntry)
    );
  } catch {
    // sessionStorage can be unavailable in private browsing.
  }
}

export default function ScrollRestoration() {
  const pathname = usePathname();
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.history.scrollRestoration = "manual";
    } catch {
      // Older browsers may not expose scrollRestoration.
    }
  }, []);

  useEffect(() => {
    const previousKey = keyRef.current;
    if (previousKey) writeScroll(previousKey);

    const nextKey = scrollKey();
    keyRef.current = nextKey;
    const savedY = readScroll(nextKey);
    if (savedY !== null) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo(0, savedY));
      });
    }

    return () => {
      writeScroll(nextKey);
    };
  }, [pathname]);

  useEffect(() => {
    const saveCurrent = () => {
      const key = keyRef.current;
      if (key) writeScroll(key);
    };
    window.addEventListener("pagehide", saveCurrent);
    document.addEventListener("visibilitychange", saveCurrent);
    return () => {
      window.removeEventListener("pagehide", saveCurrent);
      document.removeEventListener("visibilitychange", saveCurrent);
    };
  }, []);

  return null;
}
