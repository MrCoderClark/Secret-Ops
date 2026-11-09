// Small request-side helpers shared by every route handler.
//
// Nothing policy-ish lives here — CSRF is enforced, the client IP is
// extracted, and that's it. Capability checks and policy evaluation belong
// in the service layer.

import type { NextRequest, NextResponse } from "next/server";
import { CSRF_COOKIE, CSRF_HEADER, csrfOk } from "./auth";
import type { Actor } from "./rbac";
import { forbidden } from "./responses";

export type ActorContext = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * Best-effort client IP. Reads the first entry of `x-forwarded-for` if the
 * app is behind a trusted proxy, then `x-real-ip`. Returns null when none
 * is set (e.g. direct curl from the host). Routes pass the result to the
 * service layer for audit; it is never used for authorization.
 */
export function getClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? null;
}

export function contextOf(req: NextRequest): ActorContext {
  return {
    ip: getClientIp(req),
    userAgent: req.headers.get("user-agent"),
  };
}

/**
 * CSRF guard for state-changing requests. Bearer-authed callers bypass this
 * (they do not send cookies, and the Authorization header is itself proof
 * of intent). Cookie-authed requests must echo the sop_csrf cookie in the
 * `x-sop-csrf` header. Returns a 403 response on failure, null on pass.
 *
 * middleware.ts already rejects mismatched Origin/Host; this adds the
 * second half of the double-submit pattern so a same-origin XSS that
 * reads the cookie still cannot forge a header.
 */
export function enforceCsrf(req: NextRequest, actor: Actor): NextResponse | null {
  if (actor.kind !== "user") return null;
  const cookie = req.cookies.get(CSRF_COOKIE)?.value;
  const header = req.headers.get(CSRF_HEADER);
  if (!csrfOk(cookie, header)) {
    return forbidden("CSRF token missing or mismatched.", "csrf_failed");
  }
  return null;
}
