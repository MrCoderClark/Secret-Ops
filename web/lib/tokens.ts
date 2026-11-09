// Service layer for machine (API) tokens.
//
// A token is a bearer secret. Only its SHA-256 lives in the database — the
// plaintext is returned to the caller ONCE at creation and never recovered.
// Lost tokens are rotated (create new, revoke old), not re-read.
//
// Invariants this module owns:
//
//   1. The plaintext is yielded to `createToken`'s caller exactly once
//      (inside the WriteResult.plaintext field) and never written anywhere
//      — no log, no audit metadata, no response besides the direct return.
//   2. Every create / revoke writes an AccessEvent. Revoke is a soft
//      operation (sets `revokedAt`); historical audit rows still reference
//      the tokenId for traceability.
//   3. Scopes are the schema-documented set. Anything else is refused by
//      the validation layer at the route — this module trusts its input.

import type { ApiToken } from "@prisma/client";
import { db } from "./db";
import { can, type Actor, type MachineScope } from "./rbac";
import { mintMachineToken } from "./auth";
import { recordEvent } from "./audit";

// --------------------------------------------------------------------------
// Public shapes
// --------------------------------------------------------------------------

export type ActorContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type TokenSummary = {
  id: string;
  name: string;
  prefix: string;
  principal: string;
  scopes: MachineScope[];
  environmentIds: string[] | null;
  createdById: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

// --------------------------------------------------------------------------
// listTokens — metadata only. Never returns `tokenHash` or anything derived.
// --------------------------------------------------------------------------

export async function listTokens(input: { actor: Actor }): Promise<TokenSummary[]> {
  const { actor } = input;
  if (!can(actor, "token.manage")) return [];

  const rows = await db.apiToken.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
  });

  return rows.map<TokenSummary>((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    principal: r.principal,
    scopes: coerceScopes(r.scopes),
    environmentIds: coerceEnvIds(r.environmentIds),
    createdById: r.createdById,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
  }));
}

// --------------------------------------------------------------------------
// createToken — mint once, return plaintext in the outcome, store only the
// hash. The route handler MUST surface `plaintext` to the UI in the same
// response and never again.
// --------------------------------------------------------------------------

export type CreateTokenInput = {
  actor: Actor;
  name: string;
  principal: string;
  scopes: MachineScope[];
  environmentIds: string[] | null;
  expiresInDays: number;
  context?: ActorContext;
};

export type CreateTokenOutcome =
  | { ok: true; token: TokenSummary; plaintext: string }
  | { ok: false; code: "forbidden"; error: string };

export async function createToken(input: CreateTokenInput): Promise<CreateTokenOutcome> {
  const { actor } = input;
  if (!can(actor, "token.manage")) {
    return { ok: false, code: "forbidden", error: "You cannot manage API tokens." };
  }

  const minted = mintMachineToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  const row = await db.apiToken.create({
    data: {
      organizationId: actor.organizationId,
      name: input.name,
      tokenHash: minted.hash,
      prefix: minted.prefix,
      principal: input.principal,
      // Prisma Json takes `null` here (nullable column) OR an array; both are
      // valid, so a plain assignment is simpler than the JsonNull sentinel.
      scopes: input.scopes,
      environmentIds: input.environmentIds ?? undefined,
      expiresAt,
      createdById: actor.kind === "user" ? actor.id : null,
    },
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actor.kind === "user" ? actor.email : `machine:${actor.principal}`,
    action: "token.create",
    resourceType: "api_token",
    resourceId: row.id,
    resourceLabel: input.name,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    // DELIBERATE: metadata carries the prefix (safe to show) and the scope
    // list, NOT the plaintext. The plaintext is returned once to the caller
    // and lives nowhere else.
    metadata: {
      principal: input.principal,
      scopes: input.scopes,
      prefix: minted.prefix,
      expiresInDays: input.expiresInDays,
      environmentIds: input.environmentIds,
    },
  });

  return {
    ok: true,
    plaintext: minted.plaintext,
    token: shape(row),
  };
}

// --------------------------------------------------------------------------
// revokeToken — soft revoke (sets revokedAt). Audits token.revoke.
// --------------------------------------------------------------------------

export type RevokeTokenInput = {
  actor: Actor;
  tokenId: string;
  context?: ActorContext;
};

export type RevokeTokenOutcome =
  | { ok: true; token: TokenSummary }
  | { ok: false; code: "forbidden" | "not_found"; error: string };

export async function revokeToken(input: RevokeTokenInput): Promise<RevokeTokenOutcome> {
  const { actor } = input;
  if (!can(actor, "token.manage")) {
    return { ok: false, code: "forbidden", error: "You cannot manage API tokens." };
  }

  const row = await db.apiToken.findUnique({ where: { id: input.tokenId } });
  if (!row || row.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "API token not found." };
  }
  if (row.revokedAt) {
    // Idempotent — repeat revoke is a no-op success so a retry doesn't 404.
    return { ok: true, token: shape(row) };
  }

  const updated = await db.apiToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actor.kind === "user" ? actor.email : `machine:${actor.principal}`,
    action: "token.revoke",
    resourceType: "api_token",
    resourceId: row.id,
    resourceLabel: row.name,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: { prefix: row.prefix, principal: row.principal },
  });

  return { ok: true, token: shape(updated) };
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

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
    if (typeof v === "string" && (ALL_SCOPES as readonly string[]).includes(v)) {
      out.push(v as MachineScope);
    }
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

function shape(r: ApiToken): TokenSummary {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    principal: r.principal,
    scopes: coerceScopes(r.scopes),
    environmentIds: coerceEnvIds(r.environmentIds),
    createdById: r.createdById,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    revokedAt: r.revokedAt,
  };
}
