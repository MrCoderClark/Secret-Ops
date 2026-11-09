// POST /api/auth/logout — clear session + CSRF cookies.
//
// Audits auth.logout only when the caller presented a valid cookie session.
// A machine-token (Bearer) caller gets a 204 with no audit; machine identities
// don't "log out" in the session sense, so a logout call from one is a no-op.

import { type NextRequest, NextResponse } from "next/server";
import { CSRF_COOKIE, SESSION_COOKIE, verifySession } from "@/lib/auth";
import { recordEvent } from "@/lib/audit";
import { contextOf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = cookie ? await verifySession(cookie) : null;

  if (claims) {
    const ctx = contextOf(req);
    await recordEvent({
      organizationId: claims.org,
      actorId: claims.sub,
      actorEmail: claims.email,
      action: "auth.logout",
      resourceType: "session",
      result: "SUCCESS",
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }

  const res = new NextResponse(null, { status: 204 });
  // Expire both cookies on the client. SameSite/secure must match the set,
  // or Chrome refuses to overwrite the sibling cookie.
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, "", { httpOnly: false, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
