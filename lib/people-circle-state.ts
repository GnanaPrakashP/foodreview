export type PersonStatus = "mutual" | "one_way" | "sent" | "none";

export type CircleActionResponse = {
  state?: string;
  status?: string;
};

export function addName(prev: ReadonlySet<string>, name: string): Set<string> {
  return new Set([...prev, name]);
}

export function removeName(prev: ReadonlySet<string>, name: string): Set<string> {
  const next = new Set(prev);
  next.delete(name);
  return next;
}

export function personStatusFor(
  name: string,
  state: {
    mutualMembers: ReadonlySet<string>;
    circleMembers: ReadonlySet<string>;
    pendingSent: ReadonlySet<string>;
  }
): PersonStatus {
  if (state.mutualMembers.has(name)) return "mutual";
  if (state.circleMembers.has(name)) return "one_way";
  if (state.pendingSent.has(name)) return "sent";
  return "none";
}

export function personButtonLabel(status: PersonStatus): string {
  if (status === "mutual") return "Mutual Circle";
  if (status === "one_way") return "In Circle";
  if (status === "sent") return "Requested";
  return "Add";
}

export function isAcceptedCircleResponse(data: CircleActionResponse): boolean {
  return data.state === "CIRCLE_MUTUAL" || data.status === "accepted";
}

export function isOneWayCircleResponse(data: CircleActionResponse): boolean {
  return data.state === "CIRCLE_ONE_WAY" || data.status === "one_way";
}
