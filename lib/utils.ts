export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

export function ratingLabel(rating: number): string {
  const labels: Record<number, string> = {
    1: "Terrible",
    2: "Bad",
    3: "Okay",
    4: "Good",
    5: "Amazing",
  };
  return labels[rating] ?? "";
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength).trimEnd() + "…";
}
