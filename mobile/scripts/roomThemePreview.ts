/**
 * Renders before/after mockups of the room Table & Chat screens for visual
 * review. AFTER pulls real values from src/theme/tokens.ts; BEFORE hardcodes
 * the previous brown ROOM_COLORS palette. Doodle geometry is the real one.
 *
 * Run: node scripts/roomThemePreview.ts, then screenshot with headless Chrome.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dark as T } from "../src/theme/tokens.ts";
import {
  FOOD_WALLPAPER_LINE_COLOR,
  FOOD_WALLPAPER_OPACITY,
  FOOD_WALLPAPER_TILE_SIZE,
  buildFoodWallpaperPlacements,
  type DoodlePrimitive
} from "../src/components/memories/foodWallpaperPattern.ts";

const tile = FOOD_WALLPAPER_TILE_SIZE;
const placements = buildFoodWallpaperPlacements();

function primSvg(p: DoodlePrimitive): string {
  switch (p.type) {
    case "path":
      return `<path d="${p.d}"/>`;
    case "circle":
      return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}"/>`;
    case "ellipse":
      return `<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}"/>`;
    case "line":
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"/>`;
  }
}
const patternBody = placements
  .map((pl) => `<g opacity="${pl.opacity}" stroke-width="${pl.strokeWidth}" transform="${pl.transform}">${pl.shape.primitives.map(primSvg).join("")}</g>`)
  .join("");

function wallpaper(bg: string, line: string, opacity: number, id: string): string {
  return `<svg class="wp" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tile}">
      <rect width="${tile}" height="${tile}" fill="${bg}"/>
      <g fill="none" opacity="${opacity}" stroke="${line}" stroke-linecap="round" stroke-linejoin="round">${patternBody}</g>
    </pattern></defs>
    <rect width="100%" height="100%" fill="${bg}"/>
    <rect width="100%" height="100%" fill="url(#${id})"/>
  </svg>`;
}

type Theme = {
  key: string;
  bg: string; appBar: string; card: string; raised: string; high: string;
  primary: string; onPrimary: string; onSurface: string; onVariant: string;
  divider: string; outline: string; coolDim: string; coolBorder: string;
  ownBubble: string; ownBubbleBorder: string; otherBubble: string; gold: string; goldDim: string; goldBorder: string;
  modeInactive: string; wpBg: string; wpLine: string; wpOpacity: number; vignette: boolean;
};

const after: Theme = {
  key: "after",
  bg: T.background, appBar: T.surfaceRaised, card: T.surface, raised: T.surfaceRaised, high: T.surfaceHigh,
  primary: T.primary, onPrimary: T.onPrimary, onSurface: T.onSurface, onVariant: T.onSurfaceVariant,
  divider: T.divider, outline: T.outline, coolDim: T.primaryContainer, coolBorder: T.primaryOutline,
  ownBubble: T.sentBubble, ownBubbleBorder: T.sentBubbleOutline, otherBubble: T.receivedBubble, gold: T.gold, goldDim: T.goldContainer, goldBorder: T.goldOutline,
  modeInactive: T.onSurfaceVariant, wpBg: T.wallpaperBackground, wpLine: FOOD_WALLPAPER_LINE_COLOR, wpOpacity: FOOD_WALLPAPER_OPACITY, vignette: true
};

const before: Theme = {
  key: "before",
  bg: "#0E0B08", appBar: "#1A1410", card: "#211C17", raised: "#2B241D", high: "#2B241D",
  primary: "#22C7B8", onPrimary: "#0E0B08", onSurface: "#F5EDD8", onVariant: "#94897C",
  divider: "rgba(245,237,216,0.08)", outline: "rgba(245,237,216,0.14)",
  coolDim: "rgba(34,199,184,0.12)", coolBorder: "rgba(34,199,184,0.30)",
  ownBubble: "#143B36", ownBubbleBorder: "rgba(34,199,184,0.30)", otherBubble: "#211C17", gold: "#E8A830",
  goldDim: "rgba(232,168,48,0.12)", goldBorder: "rgba(232,168,48,0.24)",
  modeInactive: "#A19B94", wpBg: "#0E0B08", wpLine: "#D7CAB9", wpOpacity: 0.2, vignette: false
};

const AVATARS = ["#5CC894", "#8C7CF0", "#E08050", "#D8A848"];

function header(t: Theme, activeTab: string): string {
  const tab = (label: string) =>
    `<div class="tab ${label === activeTab ? "tabActive" : ""}">${label}</div>`;
  return `<div class="header">
    <div class="hTop">
      <div class="hBack">‹</div>
      <div class="hTitle">Friday Night Tacos 🌮</div>
      <div class="hDots">⋯</div>
    </div>
    <div class="hMeta">📍 La Taquería · 6 going</div>
    <div class="avatars">
      ${AVATARS.map((c, i) => `<div class="avatar" style="background:${c};${i ? "margin-left:-8px" : ""}">${"AKMJ"[i]}</div>`).join("")}
      <div class="avatar avatarMore">+2</div>
    </div>
    <div class="tabs">${["Table", "Chat", "Media", "Dishes"].map(tab).join("")}</div>
  </div>`;
}

function tableScreen(t: Theme): string {
  return `<div class="phone" style="background:${t.bg}">
    ${wallpaper(t.wpBg, t.wpLine, t.wpOpacity, "wp-t-" + t.key)}
    ${t.vignette ? '<div class="vignette"></div>' : ""}
    ${header(t, "Table")}
    <div class="tableBody">
      <div class="statRow">
        ${[["6", "Going"], ["12", "Dishes"], ["4.6", "Avg ★"]].map(([v, l]) =>
          `<div class="statCard"><div class="statVal">${v}</div><div class="statLabel">${l}</div></div>`).join("")}
      </div>
      <div class="dishCard">
        <div class="dishIcon" style="background:${AVATARS[2]}">🌮</div>
        <div class="dishText"><div class="dishName">Al Pastor Tacos</div><div class="dishMeta">added by Maya · 8 votes</div></div>
        <div class="ratingPill"><span style="color:${t.gold}">★ 4.8</span></div>
      </div>
      <div class="dishCard">
        <div class="dishIcon" style="background:${AVATARS[1]}">🥑</div>
        <div class="dishText"><div class="dishName">Guacamole &amp; Chips</div><div class="dishMeta">added by Jon · 5 votes</div></div>
        <div class="ratingPill"><span style="color:${t.gold}">★ 4.5</span></div>
      </div>
    </div>
    <div class="fab">+</div>
  </div>`;
}

function chatScreen(t: Theme): string {
  const bubble = (cls: string, html: string) => `<div class="bubble ${cls}">${html}</div>`;
  return `<div class="phone" style="background:${t.bg}">
    ${wallpaper(t.wpBg, t.wpLine, t.wpOpacity, "wp-c-" + t.key)}
    ${t.vignette ? '<div class="vignette"></div>' : ""}
    ${header(t, "Chat")}
    <div class="chatBody">
      <div class="daySep">TODAY</div>
      ${bubble("other", '<div class="bName" style="color:' + AVATARS[1] + '">Jon</div>Who’s in for tacos tonight? <span class="ts">7:02</span>')}
      ${bubble("own", "Count me in! 7pm works 🙌 <span class=\"ts own\">7:03</span>")}
      ${bubble("other", '<div class="bName" style="color:' + AVATARS[0] + '">Maya</div>The al pastor there is unreal <span class="ts">7:05</span>')}
      ${bubble("own", "Booking the table now <span class=\"ts own\">7:06</span>")}
    </div>
    <div class="composer">
      <div class="inputBar"><span class="inputPlaceholder">Message</span></div>
      <div class="sendBtn">➤</div>
    </div>
  </div>`;
}

function css(t: Theme): string {
  return `
  .phone-${t.key} { --bg:${t.bg}; --appBar:${t.appBar}; --card:${t.card}; --raised:${t.raised}; --high:${t.high};
    --primary:${t.primary}; --onPrimary:${t.onPrimary}; --onSurface:${t.onSurface}; --onVariant:${t.onVariant};
    --divider:${t.divider}; --outline:${t.outline}; --coolDim:${t.coolDim}; --coolBorder:${t.coolBorder};
    --ownBubble:${t.ownBubble}; --ownBubbleBorder:${t.ownBubbleBorder}; --otherBubble:${t.otherBubble}; --gold:${t.gold}; --goldDim:${t.goldDim};
    --goldBorder:${t.goldBorder}; --modeInactive:${t.modeInactive}; }`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", sans-serif; }
  body { margin:0; background:#000; display:flex; flex-wrap:wrap; gap:18px; padding:24px; align-items:flex-start; }
  .col { display:flex; flex-direction:column; gap:8px; align-items:center; }
  .colLabel { color:#9aa0a6; font-size:13px; font-weight:700; letter-spacing:.06em; }
  .phone { position:relative; width:390px; height:844px; overflow:hidden; border-radius:30px; outline:1px solid #2a2a2a; }
  .wp { position:absolute; inset:0; width:100%; height:100%; }
  .vignette { position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,.32) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 72%, rgba(0,0,0,.38) 100%); pointer-events:none; }
  /* header / app bar */
  .header { position:relative; z-index:2; background:var(--appBar); padding:14px 16px 12px; border-bottom:1px solid var(--divider); }
  .hTop { display:flex; align-items:center; gap:10px; }
  .hBack, .hDots { color:var(--primary); font-size:26px; line-height:1; width:24px; text-align:center; }
  .hDots { color:var(--onVariant); font-size:22px; }
  .hTitle { flex:1; color:var(--onSurface); font-weight:800; font-size:19px; }
  .hMeta { color:var(--onVariant); font-size:12px; font-weight:600; margin:6px 2px 0; }
  .avatars { display:flex; align-items:center; margin-top:10px; }
  .avatar { width:30px; height:30px; border-radius:50%; border:2px solid var(--appBar); display:flex; align-items:center; justify-content:center; color:#fff; font-size:11px; font-weight:800; }
  .avatarMore { background:var(--raised); color:var(--onVariant); margin-left:-8px; }
  .tabs { display:flex; gap:4px; margin-top:14px; background:var(--card); border-radius:14px; padding:3px; }
  .tab { flex:1; text-align:center; padding:9px 0; border-radius:11px; font-size:11px; font-weight:800; color:var(--modeInactive); }
  .tabActive { background:var(--coolDim); border:1px solid var(--coolBorder); color:var(--onSurface); }
  /* table body */
  .tableBody { position:relative; z-index:1; padding:16px; display:flex; flex-direction:column; gap:12px; }
  .statRow { display:flex; gap:10px; }
  .statCard { flex:1; background:var(--card); border:1px solid var(--divider); border-radius:16px; padding:16px 10px; text-align:center; }
  .statVal { color:var(--onSurface); font-size:22px; font-weight:800; }
  .statLabel { color:var(--onVariant); font-size:11px; font-weight:600; margin-top:3px; }
  .dishCard { display:flex; align-items:center; gap:12px; background:var(--card); border:1px solid var(--divider); border-radius:16px; padding:14px; }
  .dishIcon { width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px; }
  .dishText { flex:1; }
  .dishName { color:var(--onSurface); font-weight:800; font-size:15px; }
  .dishMeta { color:var(--onVariant); font-size:12px; font-weight:600; margin-top:2px; }
  .ratingPill { background:var(--goldDim); border:1px solid var(--goldBorder); border-radius:999px; padding:5px 10px; font-size:12px; font-weight:800; }
  .fab { position:absolute; right:20px; bottom:24px; width:54px; height:54px; border-radius:50%; background:var(--primary); color:var(--onPrimary); display:flex; align-items:center; justify-content:center; font-size:30px; font-weight:400; z-index:3; border:1px solid var(--outline); }
  /* chat body */
  .chatBody { position:relative; z-index:1; padding:14px 14px 0; display:flex; flex-direction:column; gap:8px; height:570px; justify-content:flex-end; }
  .daySep { align-self:center; background:var(--high); color:var(--onVariant); font-size:10px; font-weight:800; letter-spacing:.08em; padding:5px 10px; border-radius:999px; border:1px solid var(--outline); margin-bottom:4px; }
  .bubble { max-width:74%; padding:8px 12px 7px; border-radius:16px; color:var(--onSurface); font-size:14px; line-height:1.35; position:relative; }
  .other { align-self:flex-start; background:var(--otherBubble); border:1px solid var(--divider); border-top-left-radius:7px; }
  .own { align-self:flex-end; background:var(--ownBubble); border:1px solid var(--ownBubbleBorder); border-top-right-radius:7px; }
  .bName { font-size:11px; font-weight:800; margin-bottom:2px; }
  .ts { font-size:10px; color:var(--onVariant); margin-left:6px; }
  .ts.own { color:rgba(255,255,255,.55); }
  .composer { position:relative; z-index:2; display:flex; align-items:center; gap:8px; padding:12px 16px 16px; background:var(--bg); border-top:1px solid var(--divider); }
  .inputBar { flex:1; min-height:42px; display:flex; align-items:center; padding:0 14px; border-radius:16px; background:var(--raised); border:1px solid var(--outline); }
  .inputPlaceholder { color:var(--onVariant); font-size:15px; }
  .sendBtn { width:40px; height:40px; border-radius:50%; background:var(--primary); color:var(--onPrimary); display:flex; align-items:center; justify-content:center; font-size:16px; }
  ${css(before)} ${css(after)}
</style></head><body>
  <div class="col"><div class="colLabel">TABLE · BEFORE</div><div class="phone-before">${tableScreen(before)}</div></div>
  <div class="col"><div class="colLabel">TABLE · AFTER</div><div class="phone-after">${tableScreen(after)}</div></div>
  <div class="col"><div class="colLabel">CHAT · BEFORE</div><div class="phone-before">${chatScreen(before)}</div></div>
  <div class="col"><div class="colLabel">CHAT · AFTER</div><div class="phone-after">${chatScreen(after)}</div></div>
</body></html>`;

function page(title: string, body: string): string {
  const head = html.slice(0, html.indexOf("</style></head><body>") + "</style></head><body>".length);
  return `${head}${body}</body></html>`;
}
const tablePair = `
  <div class="col"><div class="colLabel">TABLE · BEFORE</div><div class="phone-before">${tableScreen(before)}</div></div>
  <div class="col"><div class="colLabel">TABLE · AFTER</div><div class="phone-after">${tableScreen(after)}</div></div>`;
const chatPair = `
  <div class="col"><div class="colLabel">CHAT · BEFORE</div><div class="phone-before">${chatScreen(before)}</div></div>
  <div class="col"><div class="colLabel">CHAT · AFTER</div><div class="phone-after">${chatScreen(after)}</div></div>`;

const dir = import.meta.dirname ?? __dirname;
writeFileSync(join(dir, "room-theme-preview.html"), html);
writeFileSync(join(dir, "room-theme-table.html"), page("table", tablePair));
writeFileSync(join(dir, "room-theme-chat.html"), page("chat", chatPair));
console.log("wrote room-theme-preview.html, room-theme-table.html, room-theme-chat.html");
