"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cachedJson, invalidateCachedJson, readCachedJson, refreshCachedJson } from "@/lib/browser-api-cache";
import type { Story } from "@/lib/types";
import type { StoriesPage, StoryGroup } from "@/lib/stories";

const API_URL = "/api/stories";
const STORIES_TTL_MS = 60 * 1000;
const STORY_ITEM_WIDTH = 68;
const STORY_AVATAR_SIZE = 62;
const STORY_LABEL_HEIGHT = 14;
const STORY_ITEM_GAP = 7;
const STORY_TRAY_HEIGHT = 2 + STORY_AVATAR_SIZE + STORY_ITEM_GAP + STORY_LABEL_HEIGHT;

function timeLeftLabel(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const hours = Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
  return `${hours}h`;
}

function avatarInitial(label: string) {
  return label.trim().charAt(0).toUpperCase() || "?";
}

function currentStory(groups: StoryGroup[], groupIndex: number, storyIndex: number): Story | null {
  return groups[groupIndex]?.stories[storyIndex] ?? null;
}

export default function StoriesTray() {
  const [data, setData] = useState<StoriesPage | null>(() => readCachedJson<StoriesPage>(API_URL, { allowStale: true }));
  const [error, setError] = useState(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState<number | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);

  useEffect(() => {
    const cached = readCachedJson<StoriesPage>(API_URL, { allowStale: true });
    if (cached) setData(cached);

    const load = cached
      ? refreshCachedJson<StoriesPage>(API_URL, STORIES_TTL_MS)
      : cachedJson<StoriesPage>(API_URL, STORIES_TTL_MS, { bypassOnReload: true });

    load
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const open = activeGroupIndex !== null;
  const story = open ? currentStory(groups, activeGroupIndex, activeStoryIndex) : null;
  const group = open ? groups[activeGroupIndex] : null;

  function openGroup(index: number) {
    setActiveGroupIndex(index);
    setActiveStoryIndex(0);
  }

  function closeViewer() {
    setActiveGroupIndex(null);
    setActiveStoryIndex(0);
  }

  function goNext() {
    if (activeGroupIndex === null) return;
    const activeGroup = groups[activeGroupIndex];
    if (activeStoryIndex < activeGroup.stories.length - 1) {
      setActiveStoryIndex((index) => index + 1);
      return;
    }
    if (activeGroupIndex < groups.length - 1) {
      setActiveGroupIndex((index) => (index === null ? null : index + 1));
      setActiveStoryIndex(0);
      return;
    }
    closeViewer();
  }

  function goPrevious() {
    if (activeGroupIndex === null) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex((index) => index - 1);
      return;
    }
    if (activeGroupIndex > 0) {
      const previousGroup = groups[activeGroupIndex - 1];
      setActiveGroupIndex((index) => (index === null ? null : index - 1));
      setActiveStoryIndex(previousGroup.stories.length - 1);
    }
  }

  if (error) return null;

  return (
    <>
      <div style={{ minHeight: STORY_TRAY_HEIGHT }}>
        <div
          style={{
            display: "flex",
            gap: "12px",
            overflowX: "auto",
            padding: "2px 12px 0",
            scrollbarWidth: "none",
            minHeight: STORY_TRAY_HEIGHT,
          }}
        >
          <Link
            href="/stories/new"
            onClick={() => invalidateCachedJson(API_URL)}
            aria-label="Add story"
            style={{
              flex: "0 0 auto",
              width: STORY_ITEM_WIDTH,
              textDecoration: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: STORY_ITEM_GAP,
            }}
          >
            <span
              style={{
                width: STORY_AVATAR_SIZE,
                height: STORY_AVATAR_SIZE,
                borderRadius: "50%",
                border: "1.5px dashed var(--border)",
                background: "var(--card)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--orange)",
              }}
            >
              <Plus size={22} strokeWidth={2.2} />
            </span>
            <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", lineHeight: `${STORY_LABEL_HEIGHT}px`, height: STORY_LABEL_HEIGHT, color: "var(--muted)", maxWidth: STORY_ITEM_WIDTH, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Your story
            </span>
          </Link>

          {groups.map((storyGroup, index) => {
            const latest = storyGroup.stories[storyGroup.stories.length - 1];
            return (
              <button
                key={storyGroup.authorName}
                type="button"
                onClick={() => openGroup(index)}
                style={{
                  flex: "0 0 auto",
                  width: STORY_ITEM_WIDTH,
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: STORY_ITEM_GAP,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: STORY_AVATAR_SIZE,
                    height: STORY_AVATAR_SIZE,
                    borderRadius: "50%",
                    padding: "2px",
                    background: "linear-gradient(135deg, var(--orange), var(--gold))",
                    display: "flex",
                  }}
                >
                  <span
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      border: "2px solid var(--bg)",
                      overflow: "hidden",
                      background: "var(--surface)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--cream)",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: "20px",
                      fontWeight: 800,
                    }}
                  >
                    {latest?.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={latest.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      avatarInitial(storyGroup.displayName)
                    )}
                  </span>
                </span>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "11px", lineHeight: `${STORY_LABEL_HEIGHT}px`, height: STORY_LABEL_HEIGHT, color: "var(--muted)", maxWidth: STORY_ITEM_WIDTH, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {storyGroup.authorName === data?.myName ? "You" : storyGroup.displayName}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {open && story && group && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${group.displayName}'s story`}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "18px",
          }}
        >
          <div style={{ position: "relative", width: "100%", maxWidth: "430px", height: "min(780px, calc(100vh - 36px))", borderRadius: "18px", overflow: "hidden", background: "#050505" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={story.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />

            <div style={{ position: "absolute", inset: "0 0 auto", padding: "14px", background: "linear-gradient(180deg, rgba(0,0,0,0.62), rgba(0,0,0,0))" }}>
              <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
                {group.stories.map((item, index) => (
                  <span
                    key={item.id}
                    style={{
                      height: "2px",
                      flex: 1,
                      borderRadius: "999px",
                      background: index <= activeStoryIndex ? "white" : "rgba(255,255,255,0.35)",
                    }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                  <span style={{ width: "34px", height: "34px", borderRadius: "50%", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "'DM Sans', sans-serif", fontWeight: 800, flexShrink: 0 }}>
                    {avatarInitial(group.displayName)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 800, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {group.authorName === data?.myName ? "You" : group.displayName}
                    </p>
                    <p style={{ margin: 0, fontFamily: "'DM Sans', sans-serif", fontSize: "11px", color: "rgba(255,255,255,0.72)" }}>
                      {timeLeftLabel(story.expires_at)} left
                    </p>
                  </div>
                </div>
                <button type="button" aria-label="Close story" onClick={closeViewer} style={{ width: "34px", height: "34px", borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.36)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                  <X size={18} strokeWidth={2.4} />
                </button>
              </div>
            </div>

            {story.caption && (
              <div style={{ position: "absolute", left: "14px", right: "14px", bottom: "18px", borderRadius: "14px", background: "rgba(0,0,0,0.52)", padding: "12px 14px" }}>
                <p style={{ margin: 0, color: "white", fontFamily: "'DM Sans', sans-serif", fontSize: "14px", lineHeight: 1.45 }}>
                  {story.caption}
                </p>
              </div>
            )}

            <button type="button" aria-label="Previous story" onClick={goPrevious} style={{ position: "absolute", left: 0, top: "22%", bottom: "22%", width: "28%", border: "none", background: "transparent", color: "white", cursor: "pointer" }}>
              <ChevronLeft size={24} strokeWidth={2} style={{ opacity: activeGroupIndex === 0 && activeStoryIndex === 0 ? 0 : 0.82 }} />
            </button>
            <button type="button" aria-label="Next story" onClick={goNext} style={{ position: "absolute", right: 0, top: "22%", bottom: "22%", width: "28%", border: "none", background: "transparent", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "8px" }}>
              <ChevronRight size={24} strokeWidth={2} style={{ opacity: 0.82 }} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
