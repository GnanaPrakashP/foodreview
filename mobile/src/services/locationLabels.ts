const ADMIN_PARTS = new Set([
  "india",
  "andhra pradesh",
  "delhi",
  "goa",
  "gujarat",
  "haryana",
  "karnataka",
  "kerala",
  "maharashtra",
  "punjab",
  "rajasthan",
  "tamil nadu",
  "telangana",
  "uttar pradesh",
  "west bengal"
]);

const GENERIC_LOCATION_LABELS = new Set([
  "current location",
  "set location"
]);

const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;
const STREET_NUMBER_RE = /^\d+[a-z]?(?:[-/]\d+[a-z]?)*$/i;

function cleanLocationPart(part: string) {
  return part
    .replace(/\b\d{5,6}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function isGenericLocationLabel(value: string | null | undefined) {
  return GENERIC_LOCATION_LABELS.has(normalizedKey(value ?? ""));
}

export function isPlusCodeLocationPart(value: string | null | undefined) {
  return PLUS_CODE_RE.test((value ?? "").trim().replace(/\s+/g, ""));
}

function isStreetNumberLocationPart(value: string | null | undefined) {
  return STREET_NUMBER_RE.test((value ?? "").trim().replace(/\s+/g, ""));
}

export function compactLocationLabel(parts: Array<string | null | undefined>) {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    for (const candidate of (part ?? "").split(",")) {
      const label = cleanLocationPart(candidate);
      if (!label || isGenericLocationLabel(label)) continue;
      if (isPlusCodeLocationPart(label)) continue;
      if (isStreetNumberLocationPart(label)) continue;
      const key = normalizedKey(label);
      if (!key || ADMIN_PARTS.has(key) || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
      if (labels.length >= 2) break;
    }
    if (labels.length >= 2) break;
  }

  if (labels.length === 0) return null;
  return labels.join(", ");
}

export function compactAddressText(value: string | null | undefined) {
  return compactLocationLabel((value ?? "").split(","));
}

// Like compactLocationLabel but keeps the LAST two meaningful parts — the area and
// city sit at the *end* of a full formatted address, so
// "…, Osmania University Rd, Vidya Nagar, Adikmet, Hyderabad" -> "Adikmet, Hyderabad".
export function compactAreaLabel(value: string | null | undefined) {
  const meaningful: string[] = [];
  const seen = new Set<string>();

  for (const candidate of (value ?? "").split(",")) {
    const label = cleanLocationPart(candidate);
    if (!label || isGenericLocationLabel(label)) continue;
    if (isPlusCodeLocationPart(label) || isStreetNumberLocationPart(label)) continue;
    const key = normalizedKey(label);
    if (!key || ADMIN_PARTS.has(key) || seen.has(key)) continue;
    seen.add(key);
    meaningful.push(label);
  }

  if (meaningful.length === 0) return null;
  return meaningful.slice(-2).join(", ");
}
