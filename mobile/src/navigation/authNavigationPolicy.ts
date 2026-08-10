export type AuthNavigationState =
  | "loading"
  | "signed_out"
  | "onboarding"
  | "signed_in";

export const PUBLIC_ROUTE_NAMES = ["(auth)", "auth/callback"] as const;

export const AUTHENTICATED_ROUTE_NAMES = [
  "(tabs)",
  "dishes/[dish]",
  "memories/[id]",
  "memories/[id]/camera",
  "memories/[id]/dish/[dishId]",
  "memories/[id]/preview",
  "notifications",
  "people/[username]",
  "profile/circle",
  "profile/settings",
  "profile/settings/about",
  "profile/settings/blocked",
  "profile/settings/comments",
  "profile/settings/edit",
  "profile/settings/help",
  "profile/settings/liked",
  "profile/settings/notifications",
  "profile/settings/privacy",
  "profile/settings/saved",
  "profile/settings/security",
  "profile/settings/terms",
  "restaurants/[placeId]",
  "restaurants/by-name/[restaurant]",
  "reviews/[id]",
  "share/camera"
] as const;

export const ONBOARDING_ROUTE_NAME = "onboarding/profile" as const;

export function resolveAuthNavigationState(input: {
  hasCompleteProfile: boolean;
  isAuthenticated: boolean;
  isReady: boolean;
}): AuthNavigationState {
  if (!input.isReady) return "loading";
  if (!input.isAuthenticated) return "signed_out";
  return input.hasCompleteProfile ? "signed_in" : "onboarding";
}

const PROTECTED_PATHS = [
  /^\/$/,
  /^\/(?:explore|hungry|notifications|profile|share)$/,
  /^\/dishes\/[^/]+$/,
  /^\/memories\/[^/]+(?:\/(?:camera|preview|dish\/[^/]+))?$/,
  /^\/people\/[^/]+$/,
  /^\/profile\/(?:circle|settings(?:\/(?:about|blocked|comments|edit|help|liked|notifications|privacy|saved|security|terms))?)$/,
  /^\/restaurants\/[^/]+$/,
  /^\/restaurants\/by-name\/[^/]+$/,
  /^\/reviews\/[^/]+$/,
  /^\/share\/camera$/
] as const;

export function safeProtectedPath(rawPath: string | null | undefined) {
  if (!rawPath) return null;
  const path = `/${rawPath}`.replace(/^\/+/, "/").split(/[?#]/, 1)[0];
  if (path.length > 512 || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (/(?:^|\/)\.\.?($|\/)/.test(path) || /%2f|%5c/i.test(path)) return null;
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decodedPath.includes("\\") || /[\u0000-\u001f\u007f]/.test(decodedPath)) return null;
  if (/(?:^|\/)\.\.?($|\/)/.test(decodedPath)) return null;
  return PROTECTED_PATHS.some((pattern) => pattern.test(path)) ? path : null;
}

export function safeProtectedPathFromLinkParts(input: {
  hostname?: string | null;
  path?: string | null;
  scheme?: string | null;
}, options: { allowExpo?: boolean; customScheme?: string } = {}) {
  const scheme = input.scheme?.toLowerCase() ?? "";
  const hostname = input.hostname ?? "";
  const path = input.path?.replace(/^--\//, "") ?? "";
  if (scheme === (options.customScheme ?? "witoh").toLowerCase()) {
    return safeProtectedPath([hostname, path].filter(Boolean).join("/"));
  }
  if (scheme === "http" || scheme === "https") {
    if (hostname !== "circlebites.in" && hostname !== "www.circlebites.in") return null;
    return safeProtectedPath(path);
  }
  if (scheme === "exp" && options.allowExpo) {
    return safeProtectedPath(path);
  }
  return null;
}
