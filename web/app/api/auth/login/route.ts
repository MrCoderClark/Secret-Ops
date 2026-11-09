// POST /api/auth/login
//
// Body: { email, password } — see validation.ts.
// On success: sets sop_session (HS256 JWT, 8h) and sop_csrf cookies, writes
// an auth.login AccessEvent, returns { user: { id, email, name, role,
// organizationId } }.
// On failure: writes an auth.failed AccessEvent WHEN the email matched a
// user, 401 either way, uniform timing so the response doesn't leak whether
// the email was registered.
//
// Rate limit: per-(email, IP), 10/15m. Returns 429 with Retry-After when hot.

import { type NextRequest, NextResponse } from "next/server";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  mintCsrfToken,
  mintSession,
  recordLoginAttempt,
  sessionCookieOptions,
} from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/audit";
import { loginSchema, parse } from "@/lib/validation";
import { badRequest, tooManyRequests, unauthorized } from "@/lib/responses";
import { contextOf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lazy dummy hash used for timing-uniform rejection when the email does not
// resolve to a user. Hashed once per process; verifyPassword against it burns
// the same CPU as a real check.
let dummyHashCached: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashCached) {
    dummyHashCached = hashPassword("unused-placeholder-for-uniform-timing");
  }
  return dummyHashCached;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJson(req);
  const parsed = parse(loginSchema, body);
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  const { email, password } = parsed.data;
  const ctx = contextOf(req);
  const limit = recordLoginAttempt(email, ctx.ip ?? "unknown");
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterSeconds, "Too many login attempts, try again later.");
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      passwordHash: true,
      memberships: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { role: true, organizationId: true },
      },
    },
  });

  // Time the verify in both branches. When the email doesn't resolve we
  // verify against a precomputed dummy so the response latency doesn't tell
  // an attacker which emails are registered.
  const stored = user?.passwordHash ?? (await dummyHash());
  const match = await verifyPassword(stored, password);

  if (!user || !match || user.status !== "ACTIVE" || user.memberships.length === 0) {
    // Audit only when the email resolved to a user — we need an org to
    // append to the chain. "User not found" is enforced solely by the rate
    // limit, which is the documented behaviour.
    if (user && user.memberships[0]) {
      await recordEvent({
        organizationId: user.memberships[0].organizationId,
        actorId: user.id,
        actorEmail: user.email,
        action: "auth.failed",
        resourceType: "session",
        result: "DENIED",
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        metadata: { reason: !match ? "bad_password" : user.status !== "ACTIVE" ? "suspended" : "no_membership" },
      });
    }
    return unauthorized("Invalid email or password.");
  }

  const membership = user.memberships[0]!;
  const token = await mintSession({
    sub: user.id,
    email: user.email,
    org: membership.organizationId,
    mfa: false,
  });
  const csrf = mintCsrfToken();

  await recordEvent({
    organizationId: membership.organizationId,
    actorId: user.id,
    actorEmail: user.email,
    action: "auth.login",
    resourceType: "session",
    result: "SUCCESS",
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent ?? null,
    metadata: { role: membership.role },
  });

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const res = NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: membership.role,
        organizationId: membership.organizationId,
      },
      csrfToken: csrf,
    },
    { status: 200 },
  );
  const sessionOpts = sessionCookieOptions();
  res.cookies.set(SESSION_COOKIE, token, sessionOpts);
  // CSRF cookie is readable by JS (double-submit requires the client to echo
  // it in a header) — the httpOnly session cookie is the auth secret.
  res.cookies.set(CSRF_COOKIE, csrf, {
    httpOnly: false,
    sameSite: "lax",
    secure: sessionOpts.secure,
    path: "/",
    maxAge: sessionOpts.maxAge,
  });
  return res;
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
