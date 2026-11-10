// RBAC — single source of truth for "may this actor do this?".
//
// Two axes, both enforced server-side:
//   1. Role — the ceiling, assigned per membership (OWNER | ADMIN | DEVELOPER
//      | AUDITOR | READONLY).
//   2. Environment scope — a protected environment (stage ≥ 2 or
//      `protected: true`) requires an Admin+ role OR an unexpired grant.
//
// Hiding a button in the UI is not enforcement. Every capability check must
// also run at the API boundary. Both call `can(actor, capability)` so the two
// cannot disagree.

import type { Role } from "@prisma/client";

export type Capability =
  | "secret.read.metadata"
  | "secret.read.value"
  | "secret.write"
  | "secret.rotate"
  | "secret.delete"
  | "sync.run"
  | "sync.configure"
  | "request.review"
  | "policy.manage"
  | "token.manage"
  | "bundle_key.manage"
  | "audit.read"
  | "audit.verify"
  | "org.manage";

// Capability matrix — mirrors the table in SECURITY.md. Keep them in sync in
// the same commit; the UI and the API both read from here, so a drift here is
// a defect in both places at once.
const MATRIX: Record<Capability, Role[]> = {
  "secret.read.metadata": ["OWNER", "ADMIN", "DEVELOPER", "AUDITOR", "READONLY"],
  "secret.read.value": ["OWNER", "ADMIN", "DEVELOPER"],
  "secret.write": ["OWNER", "ADMIN", "DEVELOPER"],
  "secret.rotate": ["OWNER", "ADMIN", "DEVELOPER"],
  "secret.delete": ["OWNER", "ADMIN"],
  "sync.run": ["OWNER", "ADMIN", "DEVELOPER"],
  "sync.configure": ["OWNER", "ADMIN"],
  "request.review": ["OWNER", "ADMIN"],
  "policy.manage": ["OWNER", "ADMIN"],
  "token.manage": ["OWNER", "ADMIN"],
  "bundle_key.manage": ["OWNER", "ADMIN"],
  "audit.read": ["OWNER", "ADMIN", "DEVELOPER", "AUDITOR", "READONLY"],
  "audit.verify": ["OWNER", "ADMIN", "AUDITOR"],
  "org.manage": ["OWNER"],
};

// Machine tokens carry scopes (not roles). Each scope maps to a set of
// capabilities. A token can never exceed the scopes it holds.
export type MachineScope =
  | "secrets:read"
  | "secrets:write"
  | "sync:run"
  | "sync:configure"
  | "audit:read";

const SCOPE_CAPS: Record<MachineScope, Capability[]> = {
  "secrets:read": ["secret.read.metadata", "secret.read.value"],
  "secrets:write": ["secret.read.metadata", "secret.read.value", "secret.write", "secret.rotate"],
  "sync:run": ["sync.run", "secret.read.metadata"],
  "sync:configure": ["sync.run", "sync.configure", "secret.read.metadata"],
  "audit:read": ["audit.read"],
};

// --------------------------------------------------------------------------
// Actor — shape flows from `resolveActor()` in session.ts.
// --------------------------------------------------------------------------

export type UserActor = {
  kind: "user";
  id: string;
  email: string;
  role: Role;
  organizationId: string;
  // Grants loaded with the actor. Only unexpired ones should be passed in;
  // session.ts filters expiresAt ≤ now before constructing the actor.
  grants: ActorGrant[];
};

export type MachineActor = {
  kind: "machine";
  tokenId: string;
  principal: string;
  organizationId: string;
  scopes: MachineScope[];
  environmentIds: string[] | null; // null = any env within the org
};

export type Actor = UserActor | MachineActor;

export type ActorGrant = {
  permission: "READ" | "WRITE" | "ADMIN";
  environmentId: string | null;
  secretId: string | null;
  expiresAt: Date | null;
};

export type EnvironmentLike = {
  id: string;
  stage: number;
  protected: boolean;
};

// --------------------------------------------------------------------------
// Capability checks
// --------------------------------------------------------------------------

export function can(actor: Actor, capability: Capability): boolean {
  if (actor.kind === "user") {
    const roles = MATRIX[capability];
    return roles?.includes(actor.role) ?? false;
  }
  for (const scope of actor.scopes) {
    if (SCOPE_CAPS[scope]?.includes(capability)) return true;
  }
  return false;
}

export function isProtected(env: EnvironmentLike): boolean {
  return env.stage >= 2 || env.protected;
}

/** Can this actor read a decrypted value in this environment? */
export function canReadValue(actor: Actor, env: EnvironmentLike): boolean {
  if (!can(actor, "secret.read.value")) return false;
  if (!isProtected(env)) return hasEnvReach(actor, env.id);
  if (actor.kind === "user") {
    if (actor.role === "OWNER" || actor.role === "ADMIN") return true;
    return holdsGrant(actor, env.id, ["READ", "WRITE", "ADMIN"]);
  }
  // A machine token with a scope that includes secret.read.value already
  // passed the capability check; the env-reach check completes the pair.
  return hasEnvReach(actor, env.id);
}

/** Can this actor write a new version in this environment? */
export function canWriteValue(actor: Actor, env: EnvironmentLike): boolean {
  if (!can(actor, "secret.write")) return false;
  if (!isProtected(env)) return hasEnvReach(actor, env.id);
  if (actor.kind === "user") {
    if (actor.role === "OWNER" || actor.role === "ADMIN") return true;
    return holdsGrant(actor, env.id, ["WRITE", "ADMIN"]);
  }
  return hasEnvReach(actor, env.id);
}

function hasEnvReach(actor: Actor, envId: string): boolean {
  if (actor.kind === "user") return true; // user reach is org-wide; the grant check handles protected
  if (actor.environmentIds === null) return true;
  return actor.environmentIds.includes(envId);
}

function holdsGrant(
  actor: UserActor,
  envId: string,
  acceptable: ActorGrant["permission"][],
): boolean {
  const now = Date.now();
  for (const g of actor.grants) {
    if (g.expiresAt && g.expiresAt.getTime() <= now) continue;
    if (g.environmentId && g.environmentId !== envId) continue;
    if (!acceptable.includes(g.permission)) continue;
    return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// Convenience — surface the full capability set for the UI (hide what the
// actor cannot do). Enforcement still happens at the API boundary.
// --------------------------------------------------------------------------

export function capabilitiesOf(actor: Actor): Capability[] {
  return (Object.keys(MATRIX) as Capability[]).filter((c) => can(actor, c));
}
