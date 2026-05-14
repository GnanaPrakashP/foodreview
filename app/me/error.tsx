"use client";

import RouteError from "@/components/ui/RouteError";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="Profile could not load" reset={reset} />;
}
