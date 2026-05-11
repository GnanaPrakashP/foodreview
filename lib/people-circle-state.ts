export type PersonStatus = "one_way" | "sent" | "none";

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
    circleMembers: ReadonlySet<string>;
    pendingSent: ReadonlySet<string>;
  }
): PersonStatus {
  if (state.circleMembers.has(name)) return "one_way";
  if (state.pendingSent.has(name)) return "sent";
  return "none";
}

export function personButtonLabel(status: PersonStatus): string {
  if (status === "one_way") return "In Circle";
  if (status === "sent") return "Requested";
  return "Request";
}

export function isAcceptedCircleResponse(data: CircleActionResponse): boolean {
  return data.state === "CIRCLE_ONE_WAY" || data.status === "accepted" || data.status === "one_way";
}

export function isOneWayCircleResponse(data: CircleActionResponse): boolean {
  return data.state === "CIRCLE_ONE_WAY" || data.status === "one_way";
}
