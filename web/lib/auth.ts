// Auth primitives:
//   - Dashboard sessions: HS256 JWT in the `sop_session` cookie.
//   - Machine identities: scoped bearer tokens, SHA-256 of the plaintext stored.
//   - CSRF: double-submit cookie, mutations echo it in a header.
//   - Login rate limit: per-(email, IP), 15-minute sliding window, in-process.
//
// The rate limit is in-process on purpose — put it in Redis before running
// more than one app instance behind a load balancer. Documented in README.md
// as a known gap.

import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { hashToken, safeEqual } from "./crypto";

// --------------------------------------------------------------------------
// Session JWT
// --------------------------------------------------------------------------

export const SESSION_COOKIE = "sop_session";
export const CSRF_COOKIE = "sop_csrf";
export const CSRF_HEADER = "x-sop-csrf";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const TOKEN_PREFIX = "sop_live_";

export type SessionClaims = {
  sub: string;           // userId
  email: string;
  org: string;           // organizationId
  // mfaVerified: true once the user has completed a WebAuthn/TOTP step in
  // this session. The matrix field exists today; enforcement is pending —
  // see SECURITY.md § Not mitigated.
  mfa: boolean;
  iat: number;
  exp: number;
};

function sessionSecretKey(): Uint8Array {
  const raw = process.env.SESSION_SECRET?.trim();
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be at least 32 characters in production.");
    }
    // Deterministic dev-only fallback. Not derived from the KEK on purpose —
    // sessions and secret material should not share a root of trust.
    return new TextEncoder().encode("secretops-dev-only-session-secret-change-me");
  }
  return new TextEncoder().encode(raw);
}

export async function mintSession(claims: Omit<SessionClaims, "iat" | "exp">): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: claims.email, org: claims.org, mfa: claims.mfa })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(sessionSecretKey());
}

export async function verifySession(jwt: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(jwt, sessionSecretKey(), { algorithms: ["HS256"] });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.org !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email,
      org: payload.org,
      mfa: payload.mfa === true,
      iat: Number(payload.iat),
      exp: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

// --------------------------------------------------------------------------
// Machine tokens — plaintext shown once, SHA-256 stored.
//
// Layout:  <prefix><4-char hint>_<32-char body>
// The hint (first 4 chars of the body) is safe to show in the UI so an
// operator can recognise which token is which without revealing it.
// --------------------------------------------------------------------------

const TOKEN_BODY_BYTES = 24; // 24 bytes -> 32 base64url chars

export type MintedToken = {
  plaintext: string;
  hash: string;
  prefix: string; // the safe-to-show display prefix including the hint
};

export function mintMachineToken(): MintedToken {
  const body = randomBytes(TOKEN_BODY_BYTES).toString("base64url");
  const hint = body.slice(0, 4);
  const plaintext = `${TOKEN_PREFIX}${hint}_${body.slice(4)}`;
  return {
    plaintext,
    hash: hashToken(plaintext),
    prefix: `${TOKEN_PREFIX}${hint}`,
  };
}

/** True when the string is shaped like a machine token. Cheap pre-check. */
export function looksLikeToken(candidate: string): boolean {
  if (!candidate.startsWith(TOKEN_PREFIX)) return false;
  const body = candidate.slice(TOKEN_PREFIX.length);
  return /^[A-Za-z0-9_-]{4}_[A-Za-z0-9_-]{28,}$/.test(body);
}

// --------------------------------------------------------------------------
// CSRF — double-submit cookie. The cookie is set at login and rotated on
// every mutation that returns 2xx. The header value and cookie value must
// match for state-changing requests.
// --------------------------------------------------------------------------

export function mintCsrfToken(): string {
  return randomBytes(24).toString("base64url");
}

export function csrfOk(cookieValue: string | undefined, headerValue: string | null | undefined): boolean {
  if (!cookieValue || !headerValue) return false;
  return safeEqual(cookieValue, headerValue);
}

// --------------------------------------------------------------------------
// Rate limit — per (email, IP) over a 15-minute sliding window. In-process;
// swap for a Redis implementation before running more than one instance.
// --------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export function recordLoginAttempt(email: string, ip: string, now: number = Date.now()): RateLimitResult {
  const k = `${email.toLowerCase()}|${ip}`;
  const bucket = buckets.get(k) ?? { timestamps: [] };
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = bucket.timestamps[0]!;
    const retryAfter = Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000);
    buckets.set(k, bucket);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }
  bucket.timestamps.push(now);
  buckets.set(k, bucket);
  return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS - bucket.timestamps.length };
}

/** Test seam — clear the rate-limit state between tests. */
export function __clearRateLimitForTests(): void {
  buckets.clear();
}
