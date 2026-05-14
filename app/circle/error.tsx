"use client";

import RouteError from "@/components/ui/RouteError";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError title="Circle could not load" reset={reset} />;
}
