// Resolve an Actor from either a session cookie (dashboard) or a bearer token
// (CLI / CI / agent). Routes call this at the top of every handler, pass the
// result to `can()` / `canReadValue()` / `canWriteValue()`, and never read
// headers or cookies on their own.

import { db } from "./db";
import {
  SESSION_COOKIE,
  TOKEN_PREFIX,
  looksLikeToken,
  verifySession,
} from "./auth";
import { hashToken } from "./crypto";
import type { Actor, MachineActor, UserActor, MachineScope, ActorGrant } from "./rbac";

type Headerish = {
  get(name: string): string | null;
};

type Cookieish = {
  get(name: string): { value: string } | undefined;
};

export type ResolveInput = {
  headers: Headerish;
  cookies: Cookieish;
};

/**
 * Returns the Actor for this request, or null if none could be resolved.
 * A null result is never a server error — the route decides whether to
 * return 401 (write path) or fall through to a public response (health).
 */
export async function resolveActor(req: ResolveInput): Promise<Actor | null> {
  const bearer = extractBearer(req.headers);
  if (bearer) {
    return resolveMachineActor(bearer);
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  const claims = await verifySession(cookie);
  if (!claims) return null;

  return resolveUserActor(claims.sub, claims.org);
}

// --------------------------------------------------------------------------
// User actor — loads the membership for the claimed org and attaches the
// user's unexpired grants. Returns null if the user is suspended, their
// membership is gone, or their role has been revoked for this org.
// --------------------------------------------------------------------------

async function resolveUserActor(userId: string, organizationId: string): Promise<UserActor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return null;

  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });
  if (!membership) return null;

  const now = new Date();
  const grants = await db.grant.findMany({
    where: {
      organizationId,
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { permission: true, environmentId: true, secretId: true, expiresAt: true },
  });

  return {
    kind: "user",
    id: user.id,
    email: user.email,
    role: membership.role,
    organizationId,
    grants: grants.map<ActorGrant>((g) => ({
      // Prisma's String default lets callers set anything; the schema's
      // documented options are READ | WRITE | ADMIN. Anything else is coerced
      // to READ so an unexpected row does not elevate.
      permission: isGrantPermission(g.permission) ? g.permission : "READ",
      environmentId: g.environmentId,
      secretId: g.secretId,
      expiresAt: g.expiresAt,
    })),
  };
}

function isGrantPermission(s: string): s is ActorGrant["permission"] {
  return s === "READ" || s === "WRITE" || s === "ADMIN";
}

// --------------------------------------------------------------------------
// Machine actor — looks the token up by its SHA-256 (constant-time index).
// Rejects revoked, expired or shape-mismatched tokens. Updates lastUsedAt
// as a side effect so the Tokens page can show activity.
// --------------------------------------------------------------------------

async function resolveMachineActor(bearer: string): Promise<MachineActor | null> {
  if (!looksLikeToken(bearer)) return null;
  const tokenHash = hashToken(bearer);
  const row = await db.apiToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      principal: true,
      scopes: true,
      environmentIds: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  const scopes = coerceScopes(row.scopes);
  if (scopes.length === 0) return null;

  // Fire-and-forget — don't block the request on bookkeeping.
  void db.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    kind: "machine",
    tokenId: row.id,
    principal: row.principal,
    organizationId: row.organizationId,
    scopes,
    environmentIds: coerceEnvIds(row.environmentIds),
  };
}

const ALL_SCOPES: readonly MachineScope[] = [
  "secrets:read",
  "secrets:write",
  "sync:run",
  "sync:configure",
  "audit:read",
];

function coerceScopes(json: unknown): MachineScope[] {
  if (!Array.isArray(json)) return [];
  const out: MachineScope[] = [];
  for (const v of json) {
    if (typeof v !== "string") continue;
    if ((ALL_SCOPES as readonly string[]).includes(v)) out.push(v as MachineScope);
  }
  return out;
}

function coerceEnvIds(json: unknown): string[] | null {
  if (json === null || json === undefined) return null;
  if (!Array.isArray(json)) return null;
  const out: string[] = [];
  for (const v of json) if (typeof v === "string" && v.length > 0) out.push(v);
  return out;
}

// --------------------------------------------------------------------------
// Header plumbing
// --------------------------------------------------------------------------

function extractBearer(headers: Headerish): string | null {
  const raw = headers.get("authorization") ?? headers.get("Authorization");
  if (!raw) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  if (!match) return null;
  const token = match[1]!;
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  return token;
}
