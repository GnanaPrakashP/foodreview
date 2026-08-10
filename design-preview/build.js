/* Witoh — design-review mockups generator.
 * Reads nothing at runtime; encodes the RN screens as static HTML phone frames.
 * Output: witoh-screens.html  (then rendered to PDF by headless Chrome). */
const fs = require("fs");
const path = require("path");

/* ---- design tokens (from mobile/src/theme) ---- */
const C = {
  bg: "#0E0B08", surface: "#1A1410", card: "#211C17", border: "#2E2720",
  orange: "#F06030", orangeDim: "rgba(240,96,48,0.12)", orangeBorder: "rgba(240,96,48,0.30)",
  gold: "#E8A830", cream: "#F5EDD8", muted: "#7A6E65",
  green: "#3DD68C", greenDim: "rgba(61,214,140,0.10)", greenBorder: "rgba(61,214,140,0.28)",
  danger: "#E84040", dangerSoft: "#F87171", dangerDim: "rgba(232,64,64,0.10)",
  white: "#FFFFFF"
};
/* Telegram-blue chat theme */
const T = {
  bg: "#111B25", surface: "#141D27", header: "#162332", high: "#1A2A3A", dim: "#0F1821",
  primary: "#3390EC", sent: "#625AD6", received: "#1F2123",
  onSurface: "rgba(255,255,255,0.87)", muted: "rgba(255,255,255,0.60)", faint: "rgba(255,255,255,0.38)",
  divider: "rgba(255,255,255,0.08)", outline: "rgba(255,255,255,0.16)", gold: "#E8A830"
};
const AVATARS = ["#C04020", "#4F46E5", "#22C55E", "#D4821A", "#BE185D", "#0F766E"];

/* ---- icons (Lucide-style, 24x24 stroke) ---- */
const PATHS = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.9z"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 18l-6.2 3.3L7 14.4 2 9.5l6.9-1z"/>',
  mapPin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  store: '<path d="M2 7l2-4h16l2 4"/><path d="M4 7v13h16V7"/><path d="M2 7h20"/><path d="M9 20v-6h6v6"/>',
  utensils: '<path d="M3 2v7a2 2 0 0 0 2 2 2 2 0 0 0 2-2V2"/><path d="M5 11v11"/><path d="M21 15V2a5 5 0 0 0-5 5v6h5zm0 0v7"/>',
  userPlus: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M19 8v6M22 11h-6"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7.6-7.6V3h7l10.6 10.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  imagePlus: '<path d="M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/><path d="M19 16v6M16 19h6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  lifeBuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M14.9 9.1l4.2-4.2M9.1 14.9l-4.2 4.2"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trendingUp: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  circleUser: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M6.2 18.8a6 6 0 0 1 11.6 0"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  paperclip: '<path d="M21.4 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49"/>',
  check: '<path d="M20 6L9 17l-5-5"/>'
};
function ic(name, o = {}) {
  const size = o.size || 18, color = o.color || "currentColor",
    fill = o.fill || "none", sw = o.sw == null ? 2 : o.sw;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${PATHS[name] || ""}</svg>`;
}

/* ---- small helpers ---- */
function avColor(name) { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0xffff; return AVATARS[h % AVATARS.length]; }
function statusBar(dark) {
  const col = dark || C.cream;
  return `<div class="sbar" style="color:${col}">
    <span class="sb-time">9:41</span>
    <span class="sb-right">
      <span class="sb-dots"><i></i><i></i><i></i><i style="opacity:.4"></i></span>
      <svg width="17" height="11" viewBox="0 0 17 11" fill="${col}"><path d="M1 4h2v6H1zM5 2.5h2V10H5zM9 1h2v9H9zM13 0h2v10h-2z" opacity="1"/></svg>
      <svg width="22" height="11" viewBox="0 0 24 12" fill="none" stroke="${col}" stroke-width="1"><rect x="1" y="1.5" width="19" height="9" rx="2.5"/><rect x="2.5" y="3" width="14" height="6" rx="1" fill="${col}"/><rect x="21" y="4" width="2" height="4" rx="1" fill="${col}"/></svg>
    </span>
  </div>`;
}
function foodPhoto(h, label, hue) {
  const grads = {
    warm: "linear-gradient(135deg,#3a2418,#7a3a1f 45%,#caa14a)",
    green: "linear-gradient(135deg,#1c2b1f,#2f5a37 50%,#7fae5a)",
    cool: "linear-gradient(135deg,#1c2230,#3a3550 55%,#7a6fb0)",
    plate: "linear-gradient(135deg,#2a1c14,#5a3a28 40%,#b07a4a 80%,#e0b070)"
  };
  return `<div class="photo" style="height:${h}px;background:${grads[hue] || grads.warm}">
    <div class="photo-glow"></div>${label ? `<span class="photo-badge">${label}</span>` : ""}</div>`;
}
function tabBar(active) {
  const items = [["index", "Circle", "users"], ["explore", "Explore", "search"], ["share", "Create", "plus"], ["profile", "Profile", "circleUser"]];
  return `<div class="tabbar">${items.map(([id, label, icon]) => {
    const on = id === active, col = on ? C.orange : C.muted;
    return `<div class="tab"><span style="color:${col}">${ic(icon, { color: col, sw: on ? 2.4 : 1.8, size: 21 })}</span><span class="tab-lbl" style="color:${col};font-weight:${on ? 800 : 700}">${label}</span></div>`;
  }).join("")}</div>`;
}
function chip(text, kind) {
  const styles = {
    orange: `background:${C.orangeDim};border:1px solid rgba(240,96,48,0.20);color:${C.orange};font-weight:800`,
    plain: `background:${C.surface};border:1px solid ${C.border};color:${C.cream}`,
    green: `background:${C.greenDim};border:1px solid rgba(61,214,140,0.22);color:${C.green};font-weight:800`
  };
  return `<span class="chip" style="${styles[kind] || styles.plain}">${text}</span>`;
}
function ratingPill(v) {
  return `<span class="rpill">${ic("star", { size: 8, color: C.gold, fill: C.gold, sw: 0 })}<b>${v}</b></span>`;
}
function dishPill(name, rating) {
  return `<span class="dish">${name}${rating ? ratingPill(rating) : ""}</span>`;
}

/* ---- reusable: feed post card (warm) ---- */
function postCard(p) {
  const av = avColor(p.author);
  return `<div class="pcard">
    <div class="pc-head">
      <div class="av" style="background:${av}">${p.initials}</div>
      <div class="pc-meta">
        <div class="pc-row"><b class="pc-author">${p.author}</b><span class="pc-dot">•</span><span class="pc-time">${p.time}</span></div>
        <div class="pc-sub">shared a spot</div>
      </div>
      ${p.request ? `<span class="req-btn">Request</span>` : ""}
      <span class="more">${ic("more", { size: 18, color: C.cream })}</span>
    </div>
    <div class="pc-body">
      <div class="pc-rest">${p.restaurant}</div>
      ${p.area ? `<div class="pc-loc">${ic("mapPin", { size: 12, color: C.muted })}<span>${p.area}</span></div>` : ""}
      ${p.caption ? `<div class="pc-cap">${p.caption}</div>` : ""}
      ${p.tags ? `<div class="row-wrap" style="margin-top:10px">${p.tags.map(t => chip(t, "orange")).join("")}</div>` : ""}
      ${p.dishes ? `<div class="row-wrap" style="margin-top:10px">${p.dishes.map(d => dishPill(d[0], d[1])).join("")}</div>` : ""}
    </div>
    ${foodPhoto(p.photoH || 230, p.media ? `1/${p.media}` : "", p.hue || "plate")}
    <div class="pc-actions">
      <div class="pc-acluster">
        <span class="pc-act ${p.liked ? "liked" : ""}">${ic("heart", { size: 19, color: p.liked ? C.danger : C.muted, fill: p.liked ? C.danger : "none" })}<i>${p.likes}</i></span>
        <span class="pc-act">${ic("message", { size: 18, color: C.muted })}<i>${p.comments}</i></span>
        <span class="pc-act">${ic("utensils", { size: 17, color: C.muted })}<i>${p.dishes ? p.dishes.length : 0}</i></span>
      </div>
      <span class="pc-icon">${ic("bookmark", { size: 19, color: p.saved ? C.orange : C.muted, fill: p.saved ? C.orange : "none" })}</span>
      <span class="pc-icon">${ic("share", { size: 18, color: C.muted })}</span>
    </div>
  </div>`;
}

/* ====================================================================== */
/* SCREENS                                                                 */
/* ====================================================================== */
const SAMPLE = {
  author: "Aarav Mehta", initials: "AM", time: "2h ago", restaurant: "Bombay Brasserie",
  area: "Indiranagar, Bengaluru", caption: "The butter chicken here is unreal — easily the best in the area.",
  tags: ["Must try", "Worth the hype"], dishes: [["Butter Chicken", 5], ["Garlic Naan", 4]],
  likes: 24, comments: 6, media: 3, liked: true, saved: false, hue: "plate"
};

const screens = [];
const S = (title, caption, theme, body, opts = {}) => screens.push({ title, caption, theme, body, ...opts });

/* 1. Login — entry */
S("Sign in — entry", "First launch. Google one-tap, or continue with email. Full-bleed food hero with gradient fade.", "warm",
  `<div class="screen-pad" style="padding:0;justify-content:flex-end">
    <div class="login-hero">${foodPhoto(560, "", "warm")}<div class="login-fade"></div></div>
    <div class="login-content">
      <div class="brand-wm">Circle<span style="color:${C.orange}">Bites</span></div>
      <div class="brand-tag">Food picks from people you trust</div>
      <div style="height:34px"></div>
      <div class="method primary">${ic("circleUser", { size: 0 })}<span class="gmark"></span>Continue with Google</div>
      <div class="auth-div"><i></i><span>OR</span><i></i></div>
      <div class="method">${ic("mail", { size: 20, color: C.orange })}Continue with Email</div>
      <div class="terms">By continuing, you agree to our<br><b>Terms of Service</b> and <b>Privacy Policy</b>.</div>
    </div>
  </div>`, { noTab: true, dark: C.white });

/* 2. Login — sign in */
S("Sign in — password", "After entering a known email. Email + password with show/hide and forgot-password.", "warm",
  `<div class="screen-pad">
    <div class="back-link"><span style="display:inline-flex;transform:scaleX(-1)">${ic("chevronRight", { size: 16, color: C.orange })}</span><b>Back</b></div>
    <div class="auth-h"><div class="auth-title">Welcome back</div><div class="auth-text">Enter your password to sign in.</div></div>
    <div class="field"><span>${ic("mail", { size: 16, color: C.muted })}</span><input value="aarav@email.com"></div>
    <div class="field"><span>${ic("lock", { size: 16, color: C.muted })}</span><input value="••••••••" style="letter-spacing:2px"><b class="show">Show</b></div>
    <div style="text-align:right;margin:-2px 0 14px"><b style="color:${C.orange};font-size:12px">Forgot password?</b></div>
    <div class="btn-orange">Sign In</div>
  </div>`, { noTab: true });

/* 3. Sign up — create account */
S("Create account", "New email path. Name, email, password + confirm. Validates 8-char minimum and match.", "warm",
  `<div class="screen-pad">
    <div class="back-link"><span style="transform:scaleX(-1)">${ic("chevronRight", { size: 16, color: C.orange })}</span><b>Back</b></div>
    <div class="auth-h"><div class="auth-title">Create your account</div><div class="auth-text">Set your name and password. You'll choose a username next.</div></div>
    <div style="display:flex;gap:8px">
      <div class="field" style="flex:1">${ic("user", { size: 16, color: C.muted })}<input placeholder="First name" value="Aarav"></div>
      <div class="field" style="flex:1">${ic("user", { size: 16, color: C.muted })}<input placeholder="Last name" value="Mehta"></div>
    </div>
    <div class="field">${ic("mail", { size: 16, color: C.muted })}<input value="aarav@email.com"></div>
    <div class="field">${ic("lock", { size: 16, color: C.muted })}<input placeholder="Password (min. 8 chars)" value="••••••••" style="letter-spacing:2px"><b class="show">Show</b></div>
    <div class="field">${ic("lock", { size: 16, color: C.muted })}<input placeholder="Confirm password" value="••••••••" style="letter-spacing:2px"></div>
    <div class="btn-orange">Create Account</div>
    <div class="terms" style="font-size:12px;margin-top:6px">By creating an account, you agree to our <b>Terms</b> and <b>Privacy Policy</b>.</div>
  </div>`, { noTab: true });

/* 4. Onboarding — username */
S("Onboarding — username", "Post-signup. Confirms name and picks the @handle friends use to find your reviews.", "warm",
  `<div class="screen-pad" style="justify-content:center">
    <div class="auth-card">
      <div class="auth-title" style="text-align:left;font-size:20px">Choose your username</div>
      <div class="auth-text" style="text-align:left;margin-bottom:18px">This is how friends find your food reviews on Witoh.</div>
      <div style="display:flex;gap:8px">
        <div class="field" style="flex:1">${ic("user", { size: 16, color: C.muted })}<input value="Aarav"></div>
        <div class="field" style="flex:1">${ic("user", { size: 16, color: C.muted })}<input value="Mehta"></div>
      </div>
      <div class="field"><b style="color:${C.muted}">@</b><input placeholder="username" value="aaraveats"></div>
      <div class="btn-orange">Finish Setup →</div>
    </div>
  </div>`, { noTab: true });

/* 5. Circle feed */
S("Circle — home feed", "The landing tab. Trusted food posts from people in your circle. Bell opens notifications.", "warm",
  `<div class="hdr">
    <div class="hdr-title" style="font-weight:400">What they're <span style="font-style:italic;color:${C.orange}">eating</span></div>
    <span>${ic("bell", { size: 20, color: C.cream })}</span>
  </div>
  <div class="feed">${postCard(SAMPLE)}${postCard({ author: "Sara Khan", initials: "SK", time: "5h ago", restaurant: "Truffles", area: "Koramangala", tags: ["Big portions"], dishes: [["Mexican Burger", 5]], likes: 41, comments: 12, media: 0, liked: false, saved: true, hue: "warm", photoH: 150 })}</div>`,
  { active: "index" });

/* 6. Explore — Places */
S("Explore — Places", "Discovery tab. Search + category grid; ranked places aggregated from public posts with social proof.", "warm",
  `<div class="hdr"><div class="hdr-title" style="font-weight:400;font-size:24px">Explore</div>
    <span class="loc-btn">🧭 <b>Nearby</b> ${ic("chevronDown", { size: 14, color: C.muted })}</span></div>
  <div class="srch"><div class="srch-box">${ic("search", { size: 17, color: C.muted })}<span class="ph">Search people, dishes or places...</span></div></div>
  <div class="ex-tabs"><span class="ex-tab on">Places</span><span class="ex-tab">Dishes</span><span class="ex-tab">People</span></div>
  <div class="cat-grid">${["Veg", "Biryani", "Cafe", "Bakery"].map((l, i) => `<div class="cat"><div class="cat-img" style="background:${["#2f5a37", "#7a3a1f", "#3a3550", "#caa14a"][i]}"></div><span>${l}</span></div>`).join("")}</div>
  <div class="disc-h">${ic("store", { size: 17, color: C.orange })}<b>Top places near you</b></div>
  ${[["Bombay Brasserie", "Indiranagar", "4.6", "5 visits", ["Butter Chicken", "Naan"], "Aarav + 4 others have been here", "plate"],
    ["Truffles", "Koramangala", "4.4", "8 visits", ["Mexican Burger"], "Sara + 7 others have been here", "warm"]]
    .map(([n, a, r, v, d, proof, hue]) => `<div class="spot">
      <div class="spot-media">${foodPhoto(152, "", hue)}</div>
      <div class="spot-body"><div class="spot-top"><div><div class="spot-name">${n}</div><div class="spot-meta">${ic("mapPin", { size: 12, color: "rgba(255,255,255,0.7)" })}<span>${a}</span></div></div>${ratingScore(r)}</div>
        <div class="spot-visit">${v}</div><div class="row-wrap">${d.map(x => chip(x, "plain")).join("")}</div>
        <div class="spot-proof">${proof}</div></div></div>`).join("")}`,
  { active: "explore" });

/* 7. Explore — People */
S("Explore — People", "People-discovery tab. Reviewers ranked by places shared, with a one-tap circle Request.", "warm",
  `<div class="hdr"><div class="hdr-title" style="font-weight:400;font-size:24px">Explore</div>
    <span class="loc-btn">🧭 <b>Nearby</b> ${ic("chevronDown", { size: 14, color: C.muted })}</span></div>
  <div class="srch"><div class="srch-box">${ic("search", { size: 17, color: C.muted })}<span class="ph">Search people, dishes or places...</span></div></div>
  <div class="ex-tabs"><span class="ex-tab">Places</span><span class="ex-tab">Dishes</span><span class="ex-tab on">People</span></div>
  <div class="disc-h" style="padding-left:16px">${ic("users", { size: 17, color: C.orange })}<b>People to discover</b></div>
  ${[["Aarav Mehta", "aaraveats", "AM", 12], ["Sara Khan", "sarak", "SK", 9], ["Diego Lopez", "diegol", "DL", 7], ["Mei Lin", "meilin", "ML", 5]]
    .map(([n, u, ini, pl]) => `<div class="person">
      <div class="av lg" style="background:${avColor(n)}">${ini}</div>
      <div class="person-txt"><div class="person-name">${n}</div><div class="person-meta">@${u} · ${pl} places</div></div>
      <span class="req-btn">Request</span></div>`).join("")}`,
  { active: "explore" });

/* 8. Create — choice */
S("Create — choose mode", "The + tab. Two paths: a public/circle Bite post, or a private Table Memory with friends.", "warm",
  `<div class="hdr-col"><div class="hdr-title" style="font-weight:400;font-size:24px">Create</div>
    <div class="hdr-sub">Choose how you want to capture this meal.</div></div>
  <div class="screen-pad" style="padding-top:8px;gap:18px">
    ${actionCard("orange", "Post a Bite", "Share the dish worth talking about.", ["Photo", "Rating"], "Capture Dish", "pencil")}
    ${actionCard("green", "Table Memory", "Remember the places you visit with friends.", ["Private", "With friends", "Photos + dishes"], "Create memory", "users")}
  </div>`,
  { active: "share" });

/* 9. Create — solo details */
S("Post a Bite — details", "Step 1 of 3. Place autocomplete, free-text note, rated dishes, and up to five tags.", "warm",
  `<div class="hdr"><span class="hdr-x">${ic("x", { size: 20, color: C.cream })}</span><div style="flex:1"></div><span class="hdr-next">Next</span></div>
  <div class="screen-pad" style="gap:14px;padding-top:6px">
    <div class="attach">${ic("store", { size: 20, color: C.green })}<span class="aval">Bombay Brasserie</span></div>
    <div class="attach loc">${ic("mapPin", { size: 15, color: C.muted })}<span class="ph">Indiranagar, Bengaluru</span></div>
    <div class="cap-box"><span class="ph">Write something about the restaurant?</span></div>
    <div class="dishrow"><div class="dish-in">${ic("utensils", { size: 20, color: C.green })}<span class="aval">Butter Chicken</span></div>
      <div class="dish-rate"><span class="rate-lbl">5/5</span><span class="stars">${[1, 1, 1, 1, 1].map(f => ic("star", { size: 18, color: C.gold, fill: C.gold, sw: 0 })).join("")}</span></div></div>
    <div class="add-dish">${ic("plus", { size: 14, color: C.green })}<b>Add another dish</b></div>
    <div class="tag-in">${ic("tag", { size: 20, color: C.orange })}<span class="ph">Add your own tag</span></div>
    <div class="row-wrap">${["Hidden gem", "Worth the hype", "Must try", "Budget friendly", "Spicy"].map(t => `<span class="tagpill">${ic("tag", { size: 10, color: C.muted })}${t}</span>`).join("")}</div>
  </div>`,
  { active: "share" });

/* 10. Create — solo media */
S("Post a Bite — photo", "Step 2 of 3. A photo is required; a recent-photos sheet and camera tile sit above the fold.", "warm",
  `<div class="hdr"><span class="hdr-x">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div style="flex:1"></div><span class="hdr-next">Next</span></div>
  <div class="screen-pad" style="padding-top:6px">
    <div class="photo-req">
      <div class="req-ico">${ic("imagePlus", { size: 28, color: C.orange })}</div>
      <div class="req-title">Add food photo <span class="req-pill">Required</span></div>
      <div class="req-text">Add a photo, then tap Next to preview your post.</div>
    </div>
  </div>
  <div class="gallery">
    <div class="g-handle"></div>
    <div class="g-head"><b>Recent photos</b><b style="color:${C.orange};font-size:12px">Open library</b></div>
    <div class="g-strip"><div class="g-cam">${ic("camera", { size: 24, color: C.cream })}<span>Camera</span></div>
      ${["plate", "warm", "green", "cool"].map(h => `<div class="g-tile">${foodPhoto(72, "", h)}</div>`).join("")}</div>
  </div>`,
  { active: "share" });

/* 11. Create — solo preview */
S("Post a Bite — preview", "Step 3 of 3. Exact feed-card preview, then choose visibility: Public, Circle, or Just me.", "warm",
  `<div class="hdr"><span class="hdr-x">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div style="flex:1"></div><span class="hdr-post">Post</span></div>
  <div style="padding:0 4px">
    ${postCard({ author: "You", initials: "Y", time: "just now", restaurant: "Bombay Brasserie", caption: "The butter chicken here is unreal.", tags: ["Must try"], dishes: [["Butter Chicken", 5]], likes: 0, comments: 0, media: 0, hue: "plate", photoH: 200 })}
  </div>
  <div class="vis-grid">
    <div class="vis on">${ic("globe", { size: 14, color: C.orange })}<b style="color:${C.orange}">Public</b></div>
    <div class="vis">${ic("users", { size: 14, color: C.muted })}<b>Circle</b></div>
    <div class="vis">${ic("lock", { size: 14, color: C.muted })}<b>Just me</b></div>
  </div>`,
  { active: "share" });

/* 12. Create — Table Memory setup */
S("Table Memory — setup", "The friends path. Pick the place and invite friends by @username; private to the table.", "warm",
  `<div class="hdr"><span class="hdr-x">${ic("x", { size: 20, color: C.cream })}</span>
    <div class="hdr-col" style="flex:1"><div class="hdr-title" style="font-size:22px">Table Memory</div><div class="hdr-sub">Save the place you visited with friends.</div></div>
    <span class="hdr-next">Create</span></div>
  <div class="screen-pad" style="gap:14px;padding-top:10px">
    <div class="attach">${ic("store", { size: 20, color: C.orange })}<span class="aval">Bombay Brasserie</span></div>
    <div class="attach">${ic("userPlus", { size: 20, color: C.orange })}<span class="ph">Who is at the table?</span></div>
    <div class="row-wrap">${["@sarak", "@diegol", "@meilin"].map(f => `<span class="fchip">${f} ${ic("x", { size: 12, color: C.muted })}</span>`).join("")}</div>
    <div class="priv-note">${ic("lock", { size: 13, color: C.green })}<span>Private to invited friends.</span></div>
  </div>`,
  { active: "share" });

/* 13. Profile — Posts */
S("Profile — posts", "Your profile. Avatar, stats (Trust / Places / Dishes / Circle), and your post grid.", "warm",
  `<div class="screen-pad" style="padding-top:16px;gap:12px">
    <div class="prof-hero">
      <span class="prof-settings">${ic("settings", { size: 21, color: C.cream })}</span>
      <div class="prof-id"><div class="av xl" style="background:${C.orange}">AM</div>
        <div><div class="prof-name">Aarav Mehta</div><div class="prof-handle">@aaraveats · 23 visits</div>
          <div class="prof-joined">${ic("calendar", { size: 13, color: C.muted })}<span>Joined Jan 2026</span></div></div></div>
      <div class="prof-bio">Always chasing the best biryani in town. 🍛</div>
    </div>
    <div class="stats">${[["28.4", "Trust"], ["19", "Places"], ["34", "Dishes"], ["12", "Circle"]].map(([v, l], i) => `<div class="stat${i ? " div" : ""}"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`).join("")}</div>
    <div class="prof-tabs"><div class="ptab on">Posts<i></i></div><div class="ptab">Memories<i></i></div></div>
  </div>
  ${postCard({ author: "Aarav Mehta", initials: "AM", time: "2h ago", restaurant: "Bombay Brasserie", area: "Indiranagar", tags: ["Must try"], dishes: [["Butter Chicken", 5]], likes: 24, comments: 6, media: 0, hue: "plate", photoH: 150 })}`,
  { active: "profile" });

/* 14. Profile — Memories tab */
S("Profile — memories", "The Memories tab: a timeline of private rooms with date, place, and unread / participant counts.", "warm",
  `<div class="screen-pad" style="padding-top:16px;gap:12px">
    <div class="prof-hero">
      <span class="prof-settings">${ic("settings", { size: 21, color: C.cream })}</span>
      <div class="prof-id"><div class="av xl" style="background:${C.orange}">AM</div>
        <div><div class="prof-name">Aarav Mehta</div><div class="prof-handle">@aaraveats · 23 visits</div></div></div>
    </div>
    <div class="stats">${[["28.4", "Trust"], ["19", "Places"], ["34", "Dishes"], ["12", "Circle"]].map(([v, l], i) => `<div class="stat${i ? " div" : ""}"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`).join("")}</div>
    <div class="prof-tabs"><div class="ptab">Posts<i></i></div><div class="ptab on">Memories<i></i></div></div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
      ${[["14", "JUN", "Bombay Brasserie", "Indiranagar, Bengaluru", 3, 24, 2], ["02", "JUN", "Truffles Night", "Koramangala", 4, 51, 0], ["28", "MAY", "Sunday Brunch Club", "MG Road", 5, 12, 0]]
      .map(([d, m, t, loc, ppl, msg, unread]) => `<div class="mem-row${unread ? " unread" : ""}">
        <div class="mem-date"><div class="mem-day">${d}</div><div class="mem-mon">${m}</div></div><div class="mem-divider"></div>
        <div class="mem-copy"><div class="mem-title">${t}</div><div class="mem-meta">${loc}</div></div>
        <div class="mem-counts">${unread ? `<span class="mem-unread">${unread}</span>` : ""}<span class="mem-c">${ic("users", { size: 12, color: C.muted })}${ppl}</span><span class="mem-c">${ic("message", { size: 12, color: C.muted })}${msg}</span></div></div>`).join("")}
    </div>
  </div>`,
  { active: "profile" });

/* 15. Trust score sheet */
S("Trust score sheet", "Bottom sheet from the profile stat. Score /100, level, post/confirm/match metrics, how it grows.", "warm",
  `<div class="sheet-scrim"></div>
  <div class="sheet">
    <div class="sheet-head"><b>Trust Score</b><span class="sheet-x">${ic("x", { size: 16, color: C.muted })}</span></div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:14px">
        <div class="trust-score"><div class="ts-val">28.4</div><div class="ts-max">/100</div></div>
        <div class="trust-lvl"><div class="tl-row"><span class="tl-ico">${ic("user", { size: 15, color: C.orange })}</span><b>Trusted Reviewer</b></div><div class="tl-desc">Earn trust when others try and confirm your posts.</div></div>
      </div>
      <div style="display:flex;gap:8px">${[["fileText", "12", "Posts"], ["shieldCheck", "9", "Confirmed"], ["users", "82%", "Match"]].map(([i, v, l]) => `<div class="tmetric"><div class="tm-top">${ic(i, { size: 15, color: C.orange })}<b>${v}</b></div><div class="tm-lbl">${l}</div></div>`).join("")}</div>
      <div class="trust-unlock">${ic("shieldCheck", { size: 13, color: C.orange })}<span>Level unlocked at 5 confirmations</span></div>
      <div class="trust-grow"><div class="tg-eyebrow">HOW IT GROWS</div>
        <div class="tg-steps">${["pencil:Post", "shield:Confirm", "trendingUp:Grow"].map((s, i) => { const [ico, lbl] = s.split(":"); return `<div class="tg-step"><div class="tg-ico">${ic(ico, { size: 16, color: C.orange })}</div><span>${lbl}</span></div>${i < 2 ? ic("chevronRight", { size: 15, color: C.muted }) : ""}`; }).join("")}</div>
        <div class="tg-note">Confirmations strengthen trust.</div></div>
    </div>
  </div>`,
  { active: "profile", noTab: true });

/* 16. Settings */
S("Settings", "From the profile gear. Grouped rows: profile, activity, preferences (account type), support & account.", "warm",
  `<div class="route-hdr"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div class="rh-title">Settings</div></div>
  <div class="screen-pad" style="gap:14px;padding-top:6px">
    ${setSection("PROFILE", [["settings", "Edit Profile"]])}
    ${setSection("ACTIVITY", [["heart", "Liked Posts"], ["bookmark", "Saved Posts"], ["message", "My Comments"]])}
    ${setSection("PREFERENCES", null, `<div class="set-row"><span class="set-ico">${ic("shield", { size: 16, color: C.muted })}</span><span class="set-lbl">Account Type</span><span class="segmented"><b class="seg">Private</b><b class="seg on">Public</b></span></div>`)}
    ${setSection("SUPPORT & ACCOUNT", [["lifeBuoy", "Help & Contact"], ["logOut", "Log out", 1], ["shield", "Privacy Policy"], ["fileText", "Terms of Service"], ["trash", "Delete account", 1]])}
  </div>`,
  { active: "profile", noTab: true });

/* 17. Edit profile */
S("Edit profile", "Editable name, @username (validated 3–20 chars), and a 160-char bio with live counter.", "warm",
  `<div class="route-hdr"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div class="rh-title">Edit Profile</div></div>
  <div class="screen-pad" style="gap:16px;padding-top:8px">
    <div class="efield"><label>NAME</label><div class="einput">Aarav Mehta</div></div>
    <div class="efield"><label>USERNAME</label><div class="einput">aaraveats</div><span class="ehint">3-20 characters, lowercase letters, numbers, or underscore.</span></div>
    <div class="efield"><label>BIO</label><div class="einput tall">Always chasing the best biryani in town. 🍛</div><span class="ecount">38/160</span></div>
    <div class="btn-orange">Save</div>
  </div>`,
  { active: "profile", noTab: true });

/* 18. My Circle */
S("My Circle", "Your trusted circle: avatars, handles, places shared, and a Remove control per member.", "warm",
  `<div class="route-hdr"><div><div class="rh-kicker">PROFILE</div><div class="rh-title">My Circle</div><div class="rh-sub">Public account · 4 people</div></div></div>
  <div class="screen-pad" style="padding-top:8px">
    <div class="member-list">${[["Sara Khan", "sarak", "SK", 8], ["Diego Lopez", "diegol", "DL", 5], ["Mei Lin", "meilin", "ML", 11], ["Tom Reed", "tomr", "TR", 3]]
    .map(([n, u, ini, pl]) => `<div class="member">
      <div class="av" style="background:${avColor(n)}">${ini}</div>
      <div class="member-copy"><div class="member-name">${n}</div><div class="member-handle">@${u}</div></div>
      <span class="member-places">${ic("users", { size: 13, color: C.orange })}<b>${pl} places</b></span>
      <span class="remove-btn">Remove</span></div>`).join("")}</div>
  </div>`,
  { active: "profile", noTab: true });

/* 19. Person profile */
S("Person profile", "Another reviewer, opened from Explore or a post. Same stats layout with their public posts.", "warm",
  `<div class="screen-pad" style="padding-top:8px;gap:16px">
    <div class="route-hdr" style="padding:0"><span class="rh-back">${ic("arrowLeft", { size: 21, color: C.cream })}</span><div class="rh-title" style="font-size:16px">Profile</div><div style="width:28px"></div></div>
    <div class="pp-hero"><div class="av" style="width:74px;height:74px;border-radius:999px;font-size:22px;background:${avColor("Sara Khan")}">SK</div>
      <div><div class="prof-name">Sara Khan</div><div class="pp-handle">@sarak</div><div class="prof-bio" style="margin-top:8px">Dessert first, always.</div></div></div>
    <div class="stats" style="border-top:1px solid rgba(245,237,216,0.08);border-bottom:1px solid rgba(245,237,216,0.08)">${[["24.1", "Trust"], ["15", "Places"], ["28", "Dishes"], ["9", "Circle"]].map(([v, l]) => `<div class="stat"><div class="stat-v" style="font-size:22px">${v}</div><div class="stat-l">${l}</div></div>`).join("")}</div>
  </div>
  ${postCard({ author: "Sara Khan", initials: "SK", time: "1d ago", restaurant: "Truffles", area: "Koramangala", dishes: [["Mexican Burger", 5]], likes: 41, comments: 12, media: 0, hue: "warm", photoH: 150 })}`,
  { active: "explore", noTab: true });

/* 20. Review detail + comments */
S("Post detail + comments", "A post opened full-screen with its comment thread and an inline composer.", "warm",
  `<div class="route-hdr" style="padding:12px 20px 0"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div><div class="rh-kicker">CIRCLE</div><div class="rh-title">Post</div></div></div>
  ${postCard({ author: "Aarav Mehta", initials: "AM", time: "2h ago", restaurant: "Bombay Brasserie", dishes: [["Butter Chicken", 5]], likes: 24, comments: 2, media: 0, hue: "plate", photoH: 120 })}
  <div style="padding:14px 20px 0"><b style="color:${C.cream};font-size:16px">Comments</b>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
      ${[["Sara Khan", "SK", "Adding this to my list!", "1h ago"], ["Diego Lopez", "DL", "Their naan is unreal too 🔥", "45m ago"]]
      .map(([n, ini, txt, t]) => `<div class="cmt"><div class="av sm" style="background:${avColor(n)}">${ini}</div><div class="cmt-body"><div class="cmt-text"><b>${n}</b> ${txt}</div><div class="cmt-time">${t}</div></div></div>`).join("")}
    </div>
    <div class="composer"><div class="av sm" style="background:${avColor("me")}">A</div><span class="ph" style="flex:1">Add a comment...</span><span class="send-sm">${ic("send", { size: 16, color: C.white })}</span></div>
  </div>`,
  { active: "index", noTab: true });

/* 21. Notifications (empty) */
S("Notifications", "Reached from the bell. Empty state today — likes, comments, and circle activity will land here.", "warm",
  `<div class="route-hdr"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div><div class="rh-kicker">CIRCLE</div><div class="rh-title">Notifications</div></div></div>
  <div class="empty"><div class="empty-ico">${ic("bell", { size: 30, color: C.muted })}</div><div class="empty-title">No notifications yet</div><div class="empty-text">Likes, comments, and circle activity will appear here.</div></div>`,
  { active: "index", noTab: true });

/* 22. Help & Contact */
S("Help & Contact", "Support entry from settings. A contact card that opens email, plus the support address.", "warm",
  `<div class="route-hdr"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div class="rh-title">Help & Contact</div></div>
  <div class="screen-pad" style="gap:12px;padding-top:6px">
    <div class="help-card"><div class="req-ico" style="width:58px;height:58px">${ic("help", { size: 24, color: C.orange })}</div>
      <div class="help-title">Need help?</div>
      <div class="help-body">Tell us what went wrong or what you need help with. Include your username if the issue is account-specific.</div>
      <div class="btn-orange" style="min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px">${ic("mail", { size: 16, color: C.white })}Contact support</div></div>
    <div class="info-card"><div class="info-t">SUPPORT EMAIL</div><div class="info-v">hello@foodcircle.app</div></div>
  </div>`,
  { active: "profile", noTab: true });

/* 23. Privacy policy */
S("Privacy Policy", "Static legal page from settings, broken into short sections (collect / use / delete / contact).", "warm",
  `<div class="route-hdr"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div><div class="rh-title">Privacy Policy</div><div class="rh-sub">Last updated: May 2025</div></div></div>
  <div class="screen-pad" style="gap:18px;padding-top:6px">
    ${[["What we collect", "We collect your name, email address, and the food reviews you post. Photos you upload are stored securely. We do not sell your data to any third party."],
    ["How we use it", "Your data is used solely to power the Witoh experience, showing your reviews to your circle and letting you discover what friends are eating."],
    ["Deleting your data", "You can delete your account at any time from settings. This permanently removes your profile and all your reviews from our systems."],
    ["Contact", "Questions? Email us at privacy@foodcircle.app"]].map(([h, b]) => `<div><div class="legal-h">${h}</div><div class="legal-b">${b}</div></div>`).join("")}
  </div>`,
  { active: "profile", noTab: true });

/* 24. Create Memory (form) */
S("Create Memory — form", "Direct memory builder (also reachable from a post's share). Manual or from-post, with details.", "warm",
  `<div class="route-hdr"><span class="rh-back">${ic("arrowLeft", { size: 20, color: C.cream })}</span><div><div class="rh-kicker">CREATE</div><div class="rh-title">Table Memory</div></div></div>
  <div class="screen-pad" style="gap:12px;padding-top:6px">
    <div style="display:flex;gap:8px"><b class="seg-lg on">Manual</b><b class="seg-lg">From post</b></div>
    <div class="minput">Bombay Brasserie</div>
    <div class="minput ph">Area or location</div>
    <div class="minput ph">Visit date, e.g. 2026-06-03</div>
    <div class="minput ph tall">Friends by username, comma separated</div>
    <div class="btn-orange" style="min-height:52px;display:flex;align-items:center;justify-content:center">Create table memory</div>
  </div>`,
  { active: "share", noTab: true });

/* 25. Chat room — Telegram-style */
S("Table Memory — chat room", "The memory room: Telegram-style chat over a food wallpaper. Sent (indigo) vs received bubbles, media, dishes/people panels, blue composer.", "chat",
  `<div class="troom-hdr">
    <span>${ic("arrowLeft", { size: 22, color: T.onSurface })}</span>
    <div class="tr-av" style="background:${C.orange}">BB</div>
    <div class="tr-id"><div class="tr-name">Bombay Brasserie</div><div class="tr-sub">3 members · Indiranagar</div></div>
    <span>${ic("more", { size: 20, color: T.onSurface })}</span>
  </div>
  <div class="troom-body">
    <div class="t-date">JUNE 14</div>
    ${tmsg("Sara Khan", "#5CA8E0", "This place was incredible 😍", "7:02 PM", false)}
    ${tmedia("plate", "Sara Khan", "#5CA8E0", "7:03 PM")}
    ${tmsg("You", "", "Best butter chicken I've had all year", "7:05 PM", true)}
    ${tmsg("Diego Lopez", "#E08050", "Adding the naan to the dishes list", "7:08 PM", false)}
    ${tdish("Butter Chicken", 5, "Diego Lopez", "#E08050", "7:09 PM")}
    ${tmsg("You", "", "Same time next week?", "7:11 PM", true)}
  </div>
  <div class="troom-input"><span>${ic("paperclip", { size: 22, color: T.muted })}</span><span class="ti-ph">Message this memory...</span><span class="ti-send">${ic("send", { size: 18, color: T.primary })}</span></div>`,
  { noTab: true, dark: T.onSurface });

/* ---- screen sub-helpers used above ---- */
function ratingScore(r) { return `<span class="rscore">${ic("star", { size: 10, color: C.gold, fill: C.gold, sw: 0 })}<b>${r}</b></span>`; }
function actionCard(accent, title, desc, tags, cta, icon) {
  const isG = accent === "green", col = isG ? C.green : C.orange;
  const bg = isG ? "linear-gradient(135deg,rgba(61,214,140,0.18),rgba(20,184,166,0.06),rgba(33,28,23,0.98))" : "linear-gradient(135deg,rgba(240,96,48,0.22),rgba(232,168,48,0.06),rgba(33,28,23,0.98))";
  return `<div class="action-card" style="border-color:${isG ? "rgba(61,214,140,0.34)" : "rgba(240,96,48,0.42)"};background:${bg}">
    <div class="ac-ico" style="background:${isG ? "rgba(61,214,140,0.14)" : "rgba(240,96,48,0.16)"};border-color:${col}">${ic(icon, { size: 22, color: col })}</div>
    <div class="ac-title">${title}</div><div class="ac-desc">${desc}</div>
    <div class="row-wrap" style="margin:6px 0 12px">${tags.map(t => `<span class="ac-chip" style="color:${col};border-color:${isG ? "rgba(61,214,140,0.22)" : "rgba(240,96,48,0.24)"};background:${isG ? "rgba(61,214,140,0.10)" : "rgba(240,96,48,0.10)"}">${t}</span>`).join("")}</div>
    <div class="ac-cta" style="color:${col}">${ic(icon === "pencil" ? "camera" : "userPlus", { size: 14, color: col })}<b>${cta}</b></div>
  </div>`;
}
function setSection(title, rows, custom) {
  const body = custom || rows.map(([icon, label, danger], i) => `<div class="set-row${i ? " sep" : ""}"><span class="set-ico${danger ? " danger" : ""}">${ic(icon, { size: 16, color: danger ? C.dangerSoft : C.muted })}</span><span class="set-lbl${danger ? " danger" : ""}">${label}</span>${ic("chevronRight", { size: 16, color: danger ? C.dangerSoft : C.muted })}</div>`).join("");
  return `<div class="set-section"><div class="set-title">${title}</div><div class="set-divider"></div>${body}</div>`;
}
function tmsg(name, color, text, time, sent) {
  if (sent) return `<div class="t-rowR"><div class="bub sent">${text}<span class="t-time">${time} ✓✓</span></div></div>`;
  return `<div class="t-rowL"><div class="t-sav" style="background:${color}">${name.split(" ").map(w => w[0]).join("")}</div><div class="bub recv"><div class="bub-name" style="color:${color}">${name}</div>${text}<span class="t-time">${time}</span></div></div>`;
}
function tmedia(hue, name, color, time) {
  return `<div class="t-rowL"><div class="t-sav" style="background:${color}">${name.split(" ").map(w => w[0]).join("")}</div><div class="bub recv media">${foodPhoto(150, "", hue)}<span class="t-time over">${time}</span></div></div>`;
}
function tdish(name, rating, who, color, time) {
  return `<div class="t-rowL"><div class="t-sav" style="background:${color}">${who.split(" ").map(w => w[0]).join("")}</div><div class="bub recv dish-bub"><div class="bub-name" style="color:${color}">${who}</div><div class="dish-card">${ic("utensils", { size: 16, color: T.gold })}<b>${name}</b><span class="rscore" style="margin-left:auto">${ic("star", { size: 10, color: T.gold, fill: T.gold, sw: 0 })}<b>${rating}</b></span></div><span class="t-time">${time}</span></div></div>`;
}

/* ====================================================================== */
/* RENDER                                                                  */
/* ====================================================================== */
function phone(s) {
  const themeBg = s.theme === "chat" ? T.bg : C.bg;
  const cls = s.theme === "chat" ? "chat-theme" : "warm-theme";
  return `<div class="phone-wrap">
    <div class="phone ${cls}" style="background:${themeBg}">
      ${statusBar(s.dark)}
      <div class="phone-body">${s.body}</div>
      ${s.noTab ? "" : tabBar(s.active)}
    </div>
    <div class="caption"><div class="cap-title">${s.title}</div><div class="cap-text">${s.caption}</div></div>
  </div>`;
}

const cover = `<section class="page cover">
  <div class="cover-brand">Circle<span style="color:${C.orange}">Bites</span></div>
  <div class="cover-sub">Mobile App — Design Review</div>
  <div class="cover-line"></div>
  <div class="cover-meta">
    <div><b>${screens.length}</b> screens</div>
    <div><b>2</b> design systems</div>
    <div>Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
  </div>
  <div class="cover-note">Static HTML mockups recreated from the React Native (Expo) source — colours, type (DM Sans), spacing and copy mirror the live screens. For review only; not interactive.</div>
  <div class="cover-legend">
    <div class="leg"><span class="sw" style="background:${C.orange}"></span> Warm “food” theme — feed, explore, create, profile</div>
    <div class="leg"><span class="sw" style="background:${T.primary}"></span> Telegram-blue theme — Table Memory chat room</div>
  </div>
</section>`;

let pages = cover;
for (let i = 0; i < screens.length; i += 2) {
  const pair = screens.slice(i, i + 2);
  pages += `<section class="page board">
    <div class="board-head"><span class="board-num">${String(i / 2 + 1).padStart(2, "0")}</span><span class="board-brand">Witoh · Design Review</span></div>
    <div class="board-grid">${pair.map(phone).join("")}</div>
  </section>`;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Witoh — Screens</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400;1,9..40,600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'DM Sans',system-ui,sans-serif;background:#0a0a0a;color:#fff}
@page{size:Letter portrait;margin:0}
.page{width:8.5in;height:11in;padding:0.42in;background:#fbf9f4;position:relative;page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
/* cover */
.cover{background:#0E0B08;color:${C.cream};display:flex;flex-direction:column;justify-content:center;padding:0.9in}
.cover-brand{font-size:62px;font-weight:800;letter-spacing:-1px}
.cover-sub{font-size:20px;color:${C.muted};font-weight:600;margin-top:6px}
.cover-line{height:3px;width:80px;background:${C.orange};margin:26px 0;border-radius:2px}
.cover-meta{display:flex;gap:26px;font-size:14px;color:${C.cream};opacity:.8}
.cover-meta b{color:${C.orange};font-size:18px}
.cover-note{margin-top:22px;max-width:5.2in;font-size:13.5px;line-height:1.7;color:${C.muted}}
.cover-legend{margin-top:40px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:${C.cream}}
.leg{display:flex;align-items:center;gap:10px}.sw{width:14px;height:14px;border-radius:4px;display:inline-block}
/* board */
.board{background:#fbf9f4;color:#1a1a1a}
.board-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1.5px solid #e6e0d4;padding-bottom:10px;margin-bottom:18px}
.board-num{font-size:22px;font-weight:800;color:${C.orange}}
.board-brand{font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#9a9388}
.board-grid{display:flex;gap:0.42in;justify-content:center;align-items:flex-start}
.phone-wrap{width:300px;display:flex;flex-direction:column;align-items:center}
.phone{width:300px;height:600px;border-radius:34px;border:7px solid #15110d;overflow:hidden;position:relative;box-shadow:0 12px 30px rgba(0,0,0,0.28);display:flex;flex-direction:column}
.phone-body{flex:1;overflow:hidden;position:relative;display:flex;flex-direction:column}
.caption{margin-top:14px;text-align:center;width:300px}
.cap-title{font-size:13.5px;font-weight:800;color:#1a1a1a}
.cap-text{font-size:11px;line-height:1.5;color:#6b655c;margin-top:3px}

/* status bar */
.sbar{height:30px;display:flex;align-items:center;justify-content:space-between;padding:0 18px 0 22px;font-size:13px;font-weight:700;flex-shrink:0}
.sb-right{display:flex;align-items:center;gap:5px}
.sb-dots{display:flex;gap:2px;align-items:flex-end}
.sb-dots i{width:3px;height:3px;border-radius:50%;background:currentColor;display:block}

/* tab bar */
.tabbar{height:54px;display:flex;border-top:1px solid ${C.border};background:${C.surface};flex-shrink:0}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px}
.tab-lbl{font-size:9px;letter-spacing:.2px}

/* generic warm-theme */
.warm-theme{color:${C.cream}}
.screen-pad{display:flex;flex-direction:column;padding:16px 20px;flex:1;overflow:hidden}
.hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 10px}
.hdr-col{padding:18px 20px 6px}
.hdr-title{font-size:26px;color:${C.cream};line-height:1.15}
.hdr-sub{font-size:14px;color:rgba(245,237,216,0.62);font-weight:600;margin-top:5px}
.hdr-x{width:34px;height:34px;border-radius:999px;display:flex;align-items:center;justify-content:center;margin-left:-6px}
.hdr-next,.hdr-post{background:${C.orange};color:#fff;font-weight:700;font-size:14px;padding:9px 18px;border-radius:999px}
.feed{flex:1;overflow:hidden}
.row-wrap{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:10px;border-radius:999px;padding:3px 8px;font-weight:600;white-space:nowrap}
.rpill{display:inline-flex;align-items:center;gap:2px;background:rgba(232,168,48,0.15);border:1px solid rgba(232,168,48,0.25);border-radius:5px;padding:1px 5px;color:${C.gold};font-size:10px;font-weight:700}
.dish{display:inline-flex;align-items:center;gap:5px;background:rgba(245,237,216,0.055);border:1px solid rgba(245,237,216,0.10);border-radius:8px;padding:4px 7px;color:${C.cream};font-size:11px}

/* avatars */
.av{width:38px;height:38px;border-radius:19px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:13px;flex-shrink:0;border:1px solid rgba(245,237,216,0.14)}
.av.lg{width:48px;height:48px;border-radius:24px;font-size:15px}
.av.xl{width:72px;height:72px;border-radius:22px;font-size:22px}
.av.sm{width:30px;height:30px;border-radius:10px;font-size:10px}

/* post card */
.pcard{border-bottom:1px solid rgba(46,39,32,0.78);background:${C.bg}}
.pc-head{display:flex;align-items:center;gap:10px;padding:14px 8px 12px 20px}
.pc-meta{flex:1;min-width:0}
.pc-row{display:flex;align-items:center;gap:7px}
.pc-author{font-size:13px;font-weight:600;color:${C.cream}}
.pc-dot{color:${C.muted};font-weight:700}
.pc-time{font-size:13px;color:${C.muted}}
.pc-sub{font-size:12px;color:${C.muted}}
.req-btn{background:${C.orangeDim};border:1px solid rgba(240,96,48,0.35);color:${C.orange};font-weight:800;font-size:11px;padding:6px 11px;border-radius:999px;white-space:nowrap}
.more{width:34px;height:34px;display:flex;align-items:center;justify-content:center}
.pc-body{padding:0 20px 12px}
.pc-rest{font-size:18px;font-weight:800;color:${C.cream};margin-bottom:5px}
.pc-loc{display:flex;align-items:center;gap:4px;color:${C.muted};font-size:11px}
.pc-cap{font-size:13px;line-height:1.55;color:rgba(245,237,216,0.9);margin-top:10px}
.photo{position:relative;width:100%;overflow:hidden}
.photo-glow{position:absolute;inset:0;background:radial-gradient(120% 80% at 70% 20%,rgba(255,255,255,0.18),transparent 60%)}
.photo-badge{position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.5);color:#fff;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px}
.pc-actions{display:flex;align-items:center;gap:8px;padding:10px 20px 8px}
.pc-acluster{flex:1;display:flex;align-items:center;gap:16px}
.pc-act{display:flex;align-items:center;gap:5px;color:${C.muted};font-size:13px;font-weight:600}
.pc-act i{font-style:normal}
.pc-act.liked{color:${C.danger}}
.pc-icon{width:32px;height:32px;display:flex;align-items:center;justify-content:center}

/* login */
.login-hero{position:absolute;inset:0;z-index:0}
.login-fade{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(14,11,8,0.08) 0%,rgba(14,11,8,0.48) 28%,rgba(14,11,8,0.86) 58%,${C.bg} 86%)}
.login-content{position:relative;z-index:1;margin-top:auto;padding:0 22px 24px;text-align:center}
.brand-wm{font-size:36px;font-weight:800;color:#fff}
.brand-tag{font-size:14px;color:rgba(255,255,255,0.68);font-weight:600;margin-top:8px}
.method{display:flex;align-items:center;justify-content:center;gap:14px;min-height:54px;border-radius:16px;border:1.5px solid rgba(245,237,216,0.18);background:rgba(245,237,216,0.06);color:#fff;font-weight:700;font-size:16px;margin-bottom:10px}
.method.primary{background:#fff;color:#1F2933;border-color:#fff}
.gmark{width:18px;height:18px;border-radius:50%;background:conic-gradient(#EA4335 0 25%,#FBBC05 0 50%,#34A853 0 75%,#4285F4 0 100%);display:inline-block}
.auth-div{display:flex;align-items:center;gap:12px;margin:14px 0}
.auth-div i{flex:1;height:1px;background:rgba(245,237,216,0.16)}
.auth-div span{font-size:12px;color:rgba(245,237,216,0.55);font-weight:600}
.terms{font-size:13px;line-height:1.6;color:rgba(255,255,255,0.56);font-weight:500;margin-top:24px}
.terms b{color:${C.orange}}
.back-link{display:flex;align-items:center;gap:4px;color:${C.orange};font-size:13px;font-weight:700;margin-bottom:12px}
.auth-h{text-align:center;margin:10px 0 18px}
.auth-title{font-size:18px;font-weight:800;color:${C.cream}}
.auth-text{font-size:13px;color:${C.muted};font-weight:600;line-height:1.5;margin-top:8px}
.field{display:flex;align-items:center;gap:10px;background:rgba(14,11,8,0.55);border:1px solid rgba(46,39,32,0.9);border-radius:14px;padding:13px 14px;margin-bottom:10px}
.field input{background:none;border:none;outline:none;color:${C.cream};font-size:15px;font-family:inherit;flex:1;font-weight:500}
.field input::placeholder{color:${C.muted}}
.field .show{color:${C.muted};font-size:12px;font-weight:600}
.btn-orange{background:${C.orange};color:#fff;font-weight:700;font-size:15px;text-align:center;padding:14px;border-radius:14px;margin-top:4px}
.auth-card{background:rgba(33,28,23,0.92);border:1px solid rgba(46,39,32,0.9);border-radius:20px;padding:22px}

/* explore */
.loc-btn{display:flex;align-items:center;gap:6px;color:${C.cream};font-size:13px;font-weight:800}
.srch{padding:4px 16px 8px}
.srch-box{display:flex;align-items:center;gap:8px;background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:10px 16px}
.ph{color:${C.muted};font-size:14px}
.ex-tabs{display:flex;padding:0 16px 10px}
.ex-tab{flex:1;text-align:center;padding:10px 0 9px;font-size:12px;font-weight:600;color:${C.muted};border-bottom:2px solid ${C.border}}
.ex-tab.on{color:${C.orange};border-bottom-color:${C.orange}}
.cat-grid{display:flex;gap:6px;padding:0 16px 12px}
.cat{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px}
.cat-img{width:62px;height:62px;border-radius:14px}
.cat span{font-size:11px;font-weight:800;color:rgba(255,255,255,0.72)}
.disc-h{display:flex;align-items:center;gap:8px;padding:8px 16px}
.disc-h b{font-size:14px;font-weight:800;color:${C.cream}}
.spot{display:flex;background:${C.card};border:1px solid ${C.border};border-radius:14px;overflow:hidden;height:152px;margin:0 16px 10px}
.spot-media{width:122px;flex-shrink:0}
.spot-body{flex:1;padding:14px;min-width:0}
.spot-top{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}
.spot-name{font-size:17px;font-weight:700;color:${C.cream}}
.spot-meta{display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.72);font-size:11px;margin-top:2px}
.rscore{display:inline-flex;align-items:center;gap:3px;background:rgba(232,168,48,0.14);border:1px solid rgba(232,168,48,0.24);border-radius:999px;padding:4px 7px;color:${C.gold};font-size:11px;font-weight:800;height:fit-content}
.spot-visit{font-size:11px;color:rgba(255,255,255,0.72);margin-bottom:8px}
.spot-proof{font-size:11px;color:rgba(255,255,255,0.74);border-top:1px solid rgba(255,255,255,0.16);padding-top:9px;margin-top:9px}
.person{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid ${C.border}}
.person-txt{flex:1;min-width:0}
.person-name{font-size:16px;font-weight:700;color:${C.cream}}
.person-meta{font-size:11px;color:rgba(255,255,255,0.72);margin-top:2px}

/* create */
.action-card{border:1px solid;border-radius:24px;padding:18px;position:relative;overflow:hidden;min-height:180px}
.ac-ico{width:48px;height:48px;border-radius:999px;border:1px solid;display:flex;align-items:center;justify-content:center;margin-bottom:13px}
.ac-title{font-size:24px;font-weight:800;color:${C.cream};margin-bottom:8px}
.ac-desc{font-size:13px;font-weight:600;color:rgba(245,237,216,0.7);margin-bottom:12px;max-width:62%}
.ac-chip{font-size:10px;font-weight:800;border:1px solid;border-radius:999px;padding:5px 9px}
.ac-cta{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:800}
.attach{display:flex;align-items:center;gap:12px;background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px}
.attach.loc{padding:10px 14px;background:transparent;border:none}
.aval{color:${C.cream};font-size:15px;font-weight:500}
.cap-box{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;min-height:64px}
.dishrow{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.dish-in{display:flex;align-items:center;gap:12px}
.dish-rate{display:flex;align-items:center;justify-content:space-between}
.rate-lbl{font-size:12px;color:${C.gold};font-weight:700}
.stars{display:flex;gap:4px}
.add-dish{display:flex;align-items:center;gap:6px;color:${C.green};font-size:13px;font-weight:700}
.tag-in{display:flex;align-items:center;gap:12px;background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px}
.tagpill{display:inline-flex;align-items:center;gap:5px;background:${C.card};border:1px solid ${C.border};border-radius:999px;padding:6px 10px;color:${C.muted};font-size:11px;font-weight:600}
.photo-req{border:1px dashed ${C.orangeBorder};border-radius:12px;min-height:176px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:20px;background:rgba(14,11,8,0.4)}
.req-ico{width:58px;height:58px;border-radius:999px;background:${C.orangeDim};border:1px solid ${C.orangeBorder};display:flex;align-items:center;justify-content:center}
.req-title{font-size:16px;font-weight:800;color:${C.cream};display:flex;align-items:center;gap:7px}
.req-pill{font-size:10px;font-weight:800;background:${C.orangeDim};border:1px solid ${C.orangeBorder};color:${C.orange};padding:4px 8px;border-radius:999px}
.req-text{font-size:12px;color:${C.muted};font-weight:500;max-width:230px}
.gallery{background:${C.surface};border-top:1px solid ${C.border};border-radius:18px 18px 0 0;padding:8px 20px 12px;margin-top:auto}
.g-handle{width:36px;height:4px;border-radius:999px;background:${C.border};margin:0 auto 10px}
.g-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.g-head b{color:${C.cream};font-size:14px}
.g-strip{display:flex;gap:8px;overflow:hidden}
.g-cam{width:72px;height:72px;border-radius:10px;background:${C.card};border:1px solid ${C.border};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:${C.cream};font-size:11px;font-weight:600;flex-shrink:0}
.g-tile{width:72px;height:72px;border-radius:10px;overflow:hidden;flex-shrink:0}
.g-tile .photo{height:72px;border-radius:10px}
.vis-grid{display:flex;gap:8px;padding:14px 20px}
.vis{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid ${C.border};border-radius:12px;padding:10px;color:${C.muted};font-size:12px}
.vis.on{border-color:${C.orange};background:${C.orangeDim}}
.fchip{display:inline-flex;align-items:center;gap:6px;background:${C.card};border:1px solid ${C.border};border-radius:999px;padding:6px 11px;color:${C.cream};font-size:12px;font-weight:600}
.priv-note{display:flex;align-items:center;gap:6px;color:${C.green};font-size:12px;font-weight:600}

/* profile */
.prof-hero{position:relative}
.prof-settings{position:absolute;right:0;top:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center}
.prof-id{display:flex;align-items:center;gap:12px;padding-right:52px}
.prof-name{font-size:23px;font-weight:700;color:${C.cream}}
.prof-handle{font-size:13px;font-weight:600;color:${C.cream};opacity:.62;margin-top:2px}
.prof-joined{display:flex;align-items:center;gap:5px;color:${C.muted};font-size:12px;font-weight:600;margin-top:5px}
.prof-bio{font-size:14px;color:${C.cream};opacity:.82;margin-top:12px;font-weight:500}
.stats{display:flex;padding:8px 0}
.stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0}
.stat.div{border-left:1px solid rgba(245,237,216,0.08)}
.stat-v{font-size:24px;font-weight:800;color:${C.cream}}
.stat-l{font-size:11px;font-weight:700;color:${C.muted}}
.prof-tabs{display:flex;padding-top:4px}
.ptab{flex:1;text-align:center;font-size:12px;font-weight:700;color:${C.muted};display:flex;flex-direction:column;gap:10px}
.ptab i{height:2px;background:${C.border};display:block}
.ptab.on{color:${C.orange}}
.ptab.on i{background:${C.orange}}
.mem-row{display:flex;align-items:center;gap:12px;background:${C.card};border:1px solid ${C.border};border-radius:12px;padding:12px;min-height:80px}
.mem-row.unread{border-color:rgba(240,96,48,0.45)}
.mem-date{width:38px;text-align:center}
.mem-day{font-size:14px;font-weight:800;color:${C.orange}}
.mem-mon{font-size:10px;font-weight:700;color:${C.muted};margin-top:2px}
.mem-divider{width:1px;align-self:stretch;background:${C.border}}
.mem-copy{flex:1;min-width:0}
.mem-title{font-size:15px;font-weight:800;color:${C.cream}}
.mem-meta{font-size:12px;font-weight:600;color:${C.muted};margin-top:3px}
.mem-counts{display:flex;flex-direction:column;align-items:flex-end;gap:7px}
.mem-unread{background:${C.orange};color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:3px 7px}
.mem-c{display:flex;align-items:center;gap:4px;color:${C.muted};font-size:11px;font-weight:800}

/* trust sheet */
.sheet-scrim{position:absolute;inset:0;background:rgba(0,0,0,0.6)}
.sheet{position:absolute;left:0;right:0;bottom:0;background:${C.card};border:1px solid rgba(245,237,216,0.09);border-radius:20px 20px 0 0;max-height:88%}
.sheet-head{display:flex;justify-content:space-between;align-items:center;padding:18px;border-bottom:1px solid rgba(245,237,216,0.06)}
.sheet-head b{font-size:16px;font-weight:800;color:${C.cream}}
.sheet-x{width:30px;height:30px;border-radius:999px;background:rgba(245,237,216,0.07);display:flex;align-items:center;justify-content:center}
.trust-score{width:112px;background:${C.orangeDim};border:1.5px solid rgba(240,96,48,0.3);border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;min-height:118px}
.ts-val{font-size:40px;font-weight:800;color:${C.cream};line-height:1}
.ts-max{font-size:11px;font-weight:800;color:${C.orange};margin-top:3px}
.trust-lvl{flex:1;background:rgba(245,237,216,0.03);border:1px solid rgba(245,237,216,0.07);border-radius:18px;padding:14px;display:flex;flex-direction:column;justify-content:center}
.tl-row{display:flex;align-items:center;gap:8px}
.tl-row b{color:${C.cream};font-size:14px;font-weight:800}
.tl-ico{width:28px;height:28px;border-radius:999px;background:rgba(245,237,216,0.06);display:flex;align-items:center;justify-content:center}
.tl-desc{font-size:12px;color:${C.muted};font-weight:700;margin-top:12px;line-height:1.4}
.tmetric{flex:1;background:rgba(245,237,216,0.035);border:1px solid rgba(245,237,216,0.08);border-radius:14px;padding:11px 10px}
.tm-top{display:flex;align-items:center;justify-content:space-between}
.tm-top b{font-size:17px;font-weight:800;color:${C.cream}}
.tm-lbl{font-size:10px;font-weight:800;color:${C.muted};margin-top:9px}
.trust-unlock{display:flex;align-items:center;gap:7px;color:${C.muted};font-size:11px;font-weight:800}
.trust-grow{background:rgba(245,237,216,0.035);border:1px solid rgba(245,237,216,0.08);border-radius:16px;padding:14px}
.tg-eyebrow{font-size:10px;font-weight:800;letter-spacing:.8px;color:${C.muted}}
.tg-steps{display:flex;align-items:center;gap:4px;margin-top:13px}
.tg-step{flex:1;display:flex;flex-direction:column;align-items:center;gap:7px}
.tg-step span{font-size:11px;font-weight:800;color:${C.cream}}
.tg-ico{width:38px;height:38px;border-radius:12px;background:${C.orangeDim};border:1px solid ${C.orangeBorder};display:flex;align-items:center;justify-content:center}
.tg-note{font-size:12px;font-weight:800;color:${C.muted};text-align:center;margin-top:13px}

/* route header / settings / forms */
.route-hdr{display:flex;align-items:center;gap:12px;padding:18px 20px 6px}
.rh-back{width:34px;height:34px;display:flex;align-items:center;justify-content:center;margin-left:-6px}
.rh-kicker{font-size:11px;font-weight:800;letter-spacing:1px;color:${C.orange};text-transform:uppercase}
.rh-title{font-size:20px;font-weight:800;color:${C.cream}}
.rh-sub{font-size:12px;color:${C.muted};font-weight:600;margin-top:2px}
.set-section{display:flex;flex-direction:column}
.set-title{font-size:11px;font-weight:800;letter-spacing:.9px;color:${C.muted};text-transform:uppercase;margin-bottom:6px}
.set-divider{height:1px;background:rgba(245,237,216,0.1);margin-bottom:2px}
.set-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:12px 0}
.set-row.sep{border-top:1px solid rgba(245,237,216,0.08)}
.set-ico{width:34px;height:34px;border-radius:12px;background:rgba(245,237,216,0.055);display:flex;align-items:center;justify-content:center}
.set-ico.danger{background:${C.dangerDim}}
.set-lbl{flex:1;font-size:14px;color:${C.cream};font-weight:500}
.set-lbl.danger,.danger{color:${C.dangerSoft}}
.segmented{display:flex;gap:2px;background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:3px}
.seg{font-size:11px;font-weight:800;color:${C.muted};padding:6px 9px;border-radius:9px}
.seg.on{background:${C.orange};color:#fff}
.efield{display:flex;flex-direction:column;gap:8px}
.efield label{font-size:10px;font-weight:800;letter-spacing:1px;color:${C.muted}}
.einput{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;font-size:14px;color:${C.cream};font-weight:500}
.einput.tall{min-height:90px}
.ehint{font-size:11px;color:${C.muted};font-weight:600}
.ecount{font-size:11px;color:${C.muted};font-weight:600;text-align:right}
.member-list{background:${C.card};border:1px solid ${C.border};border-radius:16px;overflow:hidden}
.member{display:flex;align-items:center;gap:12px;padding:12px;border-bottom:1px solid ${C.border}}
.member-copy{flex:1;min-width:0}
.member-name{font-size:15px;font-weight:700;color:${C.cream}}
.member-handle{font-size:12px;font-weight:600;color:${C.muted};margin-top:3px}
.member-places{display:flex;align-items:center;gap:5px;background:${C.orangeDim};border:1px solid ${C.orangeBorder};border-radius:999px;padding:6px 9px;color:${C.orange};font-size:11px;font-weight:800}
.remove-btn{background:${C.dangerDim};border:1px solid rgba(232,64,64,0.25);color:${C.dangerSoft};font-size:11px;font-weight:800;padding:7px 10px;border-radius:12px}
.pp-hero{display:flex;align-items:center;gap:12px}
.pp-handle{font-size:13px;font-weight:600;color:${C.muted};margin-top:2px}
.cmt{display:flex;gap:9px}
.cmt-body{flex:1}
.cmt-text{font-size:13px;color:${C.cream};line-height:1.5}
.cmt-text b{font-weight:800}
.cmt-time{font-size:11px;color:${C.muted};margin-top:3px}
.composer{display:flex;align-items:center;gap:10px;border:1px solid ${C.border};border-radius:12px;padding:10px;margin-top:16px}
.send-sm{width:38px;height:38px;border-radius:12px;background:${C.orange};display:flex;align-items:center;justify-content:center}
.empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 36px;gap:12px}
.empty-ico{width:64px;height:64px;border-radius:999px;background:${C.card};border:1px solid ${C.border};display:flex;align-items:center;justify-content:center}
.empty-title{font-size:17px;font-weight:800;color:${C.cream}}
.empty-text{font-size:13px;color:${C.muted};line-height:1.5}
.help-card{background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.help-title{font-size:18px;font-weight:800;color:${C.cream}}
.help-body{font-size:14px;color:${C.muted};line-height:1.5}
.info-card{background:${C.card};border:1px solid ${C.border};border-radius:16px;padding:12px}
.info-t{font-size:11px;font-weight:800;letter-spacing:.8px;color:${C.muted}}
.info-v{font-size:14px;font-weight:600;color:${C.cream};margin-top:4px}
.legal-h{font-size:15px;font-weight:800;color:${C.cream};margin-bottom:8px}
.legal-b{font-size:14px;color:${C.muted};line-height:1.6}
.seg-lg{flex:1;text-align:center;background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:13px;font-size:14px;font-weight:800;color:${C.muted}}
.seg-lg.on{background:${C.orangeDim};border-color:${C.orange};color:${C.orange}}
.minput{background:${C.card};border:1px solid ${C.border};border-radius:14px;padding:14px;font-size:14px;color:${C.cream};font-weight:500}
.minput.ph{color:${C.muted}}
.minput.tall{min-height:80px}

/* chat room */
.chat-theme{color:${T.onSurface}}
.troom-hdr{display:flex;align-items:center;gap:10px;padding:10px 14px;background:${T.header};border-bottom:1px solid ${T.divider}}
.tr-av{width:38px;height:38px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:#fff}
.tr-id{flex:1}
.tr-name{font-size:15px;font-weight:700;color:${T.onSurface}}
.tr-sub{font-size:12px;color:${T.muted};margin-top:1px}
.troom-body{flex:1;overflow:hidden;background:${T.bg};background-image:radial-gradient(circle at 20% 30%,rgba(51,144,236,0.05),transparent 25%),radial-gradient(circle at 80% 70%,rgba(98,90,214,0.05),transparent 25%);padding:12px 12px 4px;display:flex;flex-direction:column;gap:8px}
.t-date{align-self:center;background:rgba(0,0,0,0.4);color:${T.muted};font-size:11px;font-weight:700;padding:4px 12px;border-radius:999px;letter-spacing:.5px}
.t-rowL{display:flex;gap:8px;align-items:flex-end;max-width:82%}
.t-rowR{display:flex;justify-content:flex-end}
.t-sav{width:28px;height:28px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;flex-shrink:0}
.bub{border-radius:14px;padding:8px 11px;font-size:13.5px;line-height:1.4;position:relative;max-width:100%}
.bub.recv{background:${T.received};color:${T.onSurface};border-bottom-left-radius:5px}
.bub.sent{background:${T.sent};color:#fff;max-width:82%;border-bottom-right-radius:5px}
.bub.media{padding:4px}.bub.media .photo{border-radius:11px;width:180px}
.bub-name{font-size:12px;font-weight:800;margin-bottom:2px}
.t-time{display:block;font-size:10px;color:${T.faint};text-align:right;margin-top:3px}
.bub.sent .t-time{color:rgba(255,255,255,0.7)}
.t-time.over{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,0.45);color:#fff;padding:1px 6px;border-radius:8px;margin:0}
.dish-card{display:flex;align-items:center;gap:8px;background:rgba(232,168,48,0.1);border:1px solid rgba(232,168,48,0.24);border-radius:10px;padding:8px 10px;margin-top:2px;min-width:170px}
.dish-card b{font-size:13px;color:${T.onSurface}}
.troom-input{display:flex;align-items:center;gap:10px;padding:10px 14px;background:${T.header};border-top:1px solid ${T.divider}}
.ti-ph{flex:1;color:${T.muted};font-size:14px}
.ti-send{width:38px;height:38px;border-radius:999px;background:rgba(51,144,236,0.16);display:flex;align-items:center;justify-content:center}
</style></head><body>${pages}</body></html>`;

fs.writeFileSync(path.join(__dirname, "witoh-screens.html"), html);
console.log("Wrote witoh-screens.html with", screens.length, "screens,", Math.ceil(screens.length / 2) + 1, "pages");
