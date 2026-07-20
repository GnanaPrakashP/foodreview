import type { QueryClient } from "@tanstack/react-query";

const revisionsByClient = new WeakMap<QueryClient, number>();

export function readHomeStructuralRevision(queryClient: QueryClient) {
  return revisionsByClient.get(queryClient) ?? 0;
}

export function recordHomeStructuralMutation(queryClient: QueryClient) {
  const revision = readHomeStructuralRevision(queryClient) + 1;
  revisionsByClient.set(queryClient, revision);
  return revision;
}
