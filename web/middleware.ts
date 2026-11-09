// Runs on every request before the route handler. Does two things, no more:
//
//   1. Refuses cross-origin state-changing API requests. If an Origin header
//      is present and does not match Host, respond 403 before the handler
//      runs. This is the CSRF guard SECURITY.md promises — browsers always
//      send Origin on mutations, so a mismatched one is a drive-by attempt.
//      CLI / machine clients do not send Origin, so they pass through and
//      authenticate via the Bearer token at the handler.
//
//   2. Stamps every response with `x-request-id`. The same id is logged by
//      the service layer when it records an audit event, so a support
//      conversation can tie one line in the audit log to one request.
//
// Runs in the Edge runtime. Uses only Web APIs (crypto.randomUUID, URL,
// Headers) so there is no node: import to worry about.

import { NextResponse, type NextRequest } from "next/server";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const REQUEST_ID_HEADER = "x-request-id";

export function middleware(req: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();

  if (isApi(req) && MUTATION_METHODS.has(req.method)) {
    const refusal = crossOriginRefusal(req, requestId);
    if (refusal) return refusal;
  }

  const res = NextResponse.next();
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

function isApi(req: NextRequest): boolean {
  return req.nextUrl.pathname.startsWith("/api/");
}

/**
 * Returns a 403 response when the Origin header is present and does not
 * match Host, or when Origin is present but unparseable. Returns null in
 * every other case so the request passes to the handler.
 *
 * Absent Origin is allowed — CLI tools and server-to-server callers do not
 * send one, and the handler still enforces authentication and RBAC.
 */
function crossOriginRefusal(req: NextRequest, requestId: string): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;

  const host = req.headers.get("host");
  if (!host) {
    return refuse(requestId, "Missing Host header on mutation with an Origin.");
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return refuse(requestId, "Malformed Origin header.");
  }
  if (originHost !== host) {
    return refuse(requestId, `Cross-origin request refused (Origin=${originHost}, Host=${host}).`);
  }
  return null;
}

function refuse(requestId: string, message: string): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: message, code: "cross_origin_refused" }),
    {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        [REQUEST_ID_HEADER]: requestId,
      },
    },
  );
}

// Run on every path except static assets Next.js serves directly. The health
// endpoint is included on purpose — it gets a request-id too, which makes
// probe failures easier to track.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
