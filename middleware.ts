import { NextRequest, NextResponse } from "next/server";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;

export function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  const supplied = req.headers.get("x-request-id")?.trim() ?? "";
  const requestId = REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-foodreview-request-start-ms", String(Date.now()));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("X-Request-Id", requestId);
  response.headers.set("X-Correlation-Id", requestId);
  return response;
}

export const config = {
  matcher: "/api/:path*"
};
