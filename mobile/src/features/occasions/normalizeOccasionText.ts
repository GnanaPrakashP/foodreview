export function normalizeOccasionText(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleCaseSuggestion(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => (part.length > 0 ? `${part[0].toLocaleUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}
