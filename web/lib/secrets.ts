// Service layer for secrets. Every path that touches a secret value goes
// through this file. Routes validate their body, resolve the actor, call
// `can…` helpers, then delegate here — they do not read the DB, do not
// decrypt, and do not write audit events directly.
//
// Invariants this file owns (ARCHITECTURE.md § Layering, SPECS.md § 4):
//
//   1. A secret value never leaves this module in plaintext except through
//      `revealSecret()` and `rotateSecret()`'s return (for CLI flows that
//      need to see what was generated).
//   2. `SecretVersion` is append-only. A write that matches the current
//      version's `valueHash` is a no-op — no row is inserted.
//   3. Every mutation writes an `AccessEvent`. DENIED paths audit too.
//   4. Reveal opportunistically rewraps a version whose `keyId` is not the
//      active KEK, so a key rotation drains the retired key over time.
//   5. Soft delete: `deletedAt` is set; list queries filter it out.

import { Prisma, type Secret, type SecretVersion } from "@prisma/client";
import { db } from "./db";
import {
  canReadValue,
  canWriteValue,
  can,
  type Actor,
  type EnvironmentLike,
} from "./rbac";
import {
  open,
  resolveRootKey,
  rewrapVersion,
  seal,
  generate,
  hashValue,
  type SealedValue,
} from "./crypto";
import { recordEvent } from "./audit";
import {
  evaluatePolicies,
  type Policy,
  type Violation,
} from "./policies";

// --------------------------------------------------------------------------
// Public result shapes
// --------------------------------------------------------------------------

export type ActorContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type SecretSummary = {
  id: string;
  path: string;
  key: string;
  valueType: string;
  description: string | null;
  environmentId: string;
  projectId: string;
  rotationPolicyId: string | null;
  currentVersion: number | null;
  fingerprint: string | null;
  lastWriteAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

export type RevealResult = {
  value: string;
  version: number;
  valueHash: string;
  fingerprint: string;
  keyId: string;
};

export type WriteResult =
  | { ok: true; secret: Secret; version: SecretVersion; created: boolean; unchanged: boolean }
  | { ok: false; code: WriteErrorCode; error: string; violations?: Violation[] };

export type WriteErrorCode =
  | "forbidden"
  | "environment_not_found"
  | "policy_violation"
  | "approval_required";

type ServiceDenial = { ok: false; code: "forbidden"; error: string };
type ServiceNotFound = { ok: false; code: "not_found"; error: string };

export type RevealOutcome = { ok: true; reveal: RevealResult } | ServiceDenial | ServiceNotFound;
export type DeleteOutcome =
  | { ok: true; secret: Secret }
  | ServiceDenial
  | ServiceNotFound;

// --------------------------------------------------------------------------
// listSecrets — metadata only, never plaintext
// --------------------------------------------------------------------------

export type ListSecretsInput = {
  actor: Actor;
  projectId?: string;
  environmentId?: string;
  query?: string;
  limit?: number;
  cursor?: string;
  includeDeleted?: boolean;
};

export async function listSecrets(input: ListSecretsInput): Promise<SecretSummary[]> {
  const { actor } = input;
  if (!can(actor, "secret.read.metadata")) return [];

  const limit = clampLimit(input.limit ?? 100);
  const where: Prisma.SecretWhereInput = {
    ...(input.includeDeleted ? {} : { deletedAt: null }),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    ...orgScope(actor),
    ...(actor.kind === "machine" && actor.environmentIds
      ? { environmentId: { in: actor.environmentIds } }
      : {}),
    ...(input.query
      ? {
          OR: [
            { key: { contains: input.query, mode: "insensitive" } },
            { path: { contains: input.query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const rows = await db.secret.findMany({
    where,
    take: limit,
    ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, fingerprint: true, createdAt: true },
      },
    },
  });

  return rows.map<SecretSummary>((row) => {
    const latest = row.versions[0];
    return {
      id: row.id,
      path: row.path,
      key: row.key,
      valueType: row.valueType,
      description: row.description,
      environmentId: row.environmentId,
      projectId: row.projectId,
      rotationPolicyId: row.rotationPolicyId,
      currentVersion: latest?.version ?? null,
      fingerprint: latest?.fingerprint ?? null,
      lastWriteAt: latest?.createdAt ?? null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  });
}

// --------------------------------------------------------------------------
// putSecret — create-or-append. Idempotent on valueHash.
// --------------------------------------------------------------------------

export type PutSecretInput = {
  actor: Actor;
  environmentId: string;
  path: string;
  key: string;
  value: string;
  valueType?: string;
  description?: string | null;
  rotationPolicyId?: string | null;
  // Policy-context inputs the caller gathered (approval token, MFA state, …).
  // Service layer does not look at headers.
  actorHasApproval?: boolean;
  actorMfaVerified?: boolean;
  createdVia?: "dashboard" | "cli" | "api" | "rotation-worker" | "import";
  context?: ActorContext;
};

export async function putSecret(input: PutSecretInput): Promise<WriteResult> {
  const { actor, environmentId } = input;

  const env = await db.environment.findUnique({
    where: { id: environmentId },
    select: {
      id: true,
      stage: true,
      protected: true,
      projectId: true,
      project: { select: { organizationId: true } },
    },
  });
  if (!env || env.project.organizationId !== actor.organizationId) {
    return { ok: false, code: "environment_not_found", error: "Environment not found." };
  }

  if (!canWriteValue(actor, toEnvLike(env))) {
    await auditDenied(actor, "secret.write", "secret", environmentId, env.id, null, "rbac", input.context);
    return { ok: false, code: "forbidden", error: "You cannot write values in this environment." };
  }

  // Policy gate — evaluate before any encryption so a rejected write never
  // touches the KEK.
  const policies = await loadPolicies(actor.organizationId);
  const violations = evaluatePolicies(policies, {
    path: input.path,
    key: input.key,
    value: input.value,
    environment: toEnvLike(env),
    valueType: input.valueType,
    actorHasApproval: input.actorHasApproval,
    actorMfaVerified: input.actorMfaVerified,
    rotationPolicyId: input.rotationPolicyId ?? null,
  });
  if (violations.some((v) => v.severity === "high" || v.severity === "critical")) {
    await auditDenied(actor, "secret.write", "secret", environmentId, env.id, null, "policy", input.context, {
      violations: violations.map((v) => ({ rule: v.rule, severity: v.severity, message: v.message })),
    });
    return { ok: false, code: "policy_violation", error: policyErrorMessage(violations), violations };
  }

  // Find or create the Secret identity, then append a new version.
  const existing = await db.secret.findUnique({
    where: {
      environmentId_path_key: {
        environmentId,
        path: input.path,
        key: input.key,
      },
    },
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, valueHash: true },
      },
    },
  });

  const { hash } = hashValue(input.value);
  const latest = existing?.versions[0];

  // Idempotency: same value as the current head is a no-op.
  if (existing && latest && latest.valueHash === hash) {
    const currentVersion = await db.secretVersion.findUnique({
      where: { secretId_version: { secretId: existing.id, version: latest.version } },
    });
    if (currentVersion) {
      return { ok: true, secret: existing, version: currentVersion, created: false, unchanged: true };
    }
  }

  const sealed = seal(input.value);
  const actorId = actor.kind === "user" ? actor.id : null;
  const createdVia = input.createdVia ?? (actor.kind === "machine" ? "cli" : "dashboard");

  const result = await db.$transaction(async (tx) => {
    const secret =
      existing ??
      (await tx.secret.create({
        data: {
          projectId: env.projectId,
          environmentId,
          path: input.path,
          key: input.key,
          valueType: input.valueType ?? "string",
          description: input.description ?? null,
          rotationPolicyId: input.rotationPolicyId ?? null,
        },
      }));

    // Apply description / type / rotation changes alongside the new version
    // when the Secret already existed, so the caller sees a consistent row.
    if (existing) {
      const patch: Prisma.SecretUpdateInput = {};
      if (input.description !== undefined) patch.description = input.description;
      if (input.valueType && input.valueType !== existing.valueType) patch.valueType = input.valueType;
      if (input.rotationPolicyId !== undefined) {
        patch.rotationPolicy = input.rotationPolicyId
          ? { connect: { id: input.rotationPolicyId } }
          : { disconnect: true };
      }
      if (Object.keys(patch).length > 0) {
        await tx.secret.update({ where: { id: secret.id }, data: patch });
      }
    }

    const nextVersion = (latest?.version ?? 0) + 1;
    const version = await tx.secretVersion.create({
      data: {
        secretId: secret.id,
        version: nextVersion,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        wrappedDek: sealed.wrappedDek,
        dekIv: sealed.dekIv,
        dekAuthTag: sealed.dekAuthTag,
        keyId: sealed.keyId,
        valueHash: sealed.valueHash,
        fingerprint: sealed.fingerprint,
        createdById: actorId,
        createdVia,
      },
    });
    return { secret, version };
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId,
    actorEmail: actorEmail(actor),
    action: "secret.write",
    resourceType: "secret",
    resourceId: result.secret.id,
    resourceLabel: `${result.secret.path}/${result.secret.key}`,
    environmentId,
    secretId: result.secret.id,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      version: result.version.version,
      fingerprint: result.version.fingerprint,
      keyId: result.version.keyId,
      valueType: result.secret.valueType,
      via: createdVia,
      ...(violations.length > 0 ? { policyAdvisories: violations.map((v) => v.rule) } : {}),
    },
  });

  return {
    ok: true,
    secret: result.secret,
    version: result.version,
    created: !existing,
    unchanged: false,
  };
}

// --------------------------------------------------------------------------
// revealSecret — the only path that returns plaintext.
// --------------------------------------------------------------------------

export type RevealSecretInput = {
  actor: Actor;
  secretId: string;
  version?: number;
  context?: ActorContext;
};

export async function revealSecret(input: RevealSecretInput): Promise<RevealOutcome> {
  const { actor, secretId } = input;

  const secret = await db.secret.findUnique({
    where: { id: secretId },
    include: {
      environment: { select: { id: true, stage: true, protected: true, projectId: true } },
      project: { select: { organizationId: true } },
    },
  });
  if (!secret || secret.deletedAt || secret.project.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "Secret not found." };
  }

  if (!canReadValue(actor, toEnvLike(secret.environment))) {
    await auditDenied(actor, "secret.read", "secret", secret.environmentId, secret.environment.id, secret.id, "rbac", input.context, {
      path: secret.path,
      key: secret.key,
    });
    return { ok: false, code: "forbidden", error: "You cannot reveal values in this environment." };
  }

  const version = input.version
    ? await db.secretVersion.findUnique({
        where: { secretId_version: { secretId, version: input.version } },
      })
    : await db.secretVersion.findFirst({
        where: { secretId },
        orderBy: { version: "desc" },
      });
  if (!version) {
    return { ok: false, code: "not_found", error: "No versions exist for this secret." };
  }

  const kr = resolveRootKey();
  const value = open(sealedFromRow(version), kr);

  // Opportunistic rewrap — if this version is still on a retired KEK, bring
  // it onto the active key. Best-effort: a failure here must not block the
  // reveal itself, which the user is waiting on.
  if (version.keyId !== kr.activeKeyId) {
    try {
      const patch = rewrapVersion(sealedFromRow(version), kr);
      if (patch) {
        await db.secretVersion.update({
          where: { id: version.id },
          data: {
            wrappedDek: patch.wrappedDek,
            dekIv: patch.dekIv,
            dekAuthTag: patch.dekAuthTag,
            keyId: patch.keyId,
          },
        });
      }
    } catch {
      // Swallow — reveal already succeeded. The worker will retry during its
      // rotation sweep. We deliberately do not log the error with the keyId.
    }
  }

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actorEmail(actor),
    action: "secret.read",
    resourceType: "secret",
    resourceId: secret.id,
    resourceLabel: `${secret.path}/${secret.key}`,
    environmentId: secret.environmentId,
    secretId: secret.id,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      version: version.version,
      fingerprint: version.fingerprint,
      keyId: version.keyId,
    },
  });

  return {
    ok: true,
    reveal: {
      value,
      version: version.version,
      valueHash: version.valueHash,
      fingerprint: version.fingerprint,
      keyId: version.keyId,
    },
  };
}

// --------------------------------------------------------------------------
// rotateSecret — write a new version from a generator spec, or an explicit
// plaintext when the caller already has the new value (manual rotation).
// --------------------------------------------------------------------------

export type RotateSecretInput = {
  actor: Actor;
  secretId: string;
  generator?: string; // overrides the attached RotationPolicy.generator
  value?: string;     // bypass generation entirely (manual rotation)
  reason?: string;
  context?: ActorContext;
};

export type RotateOutcome =
  | { ok: true; secret: Secret; version: SecretVersion; generator: string | null }
  | ServiceDenial
  | ServiceNotFound
  | { ok: false; code: "policy_violation"; error: string; violations: Violation[] };

export async function rotateSecret(input: RotateSecretInput): Promise<RotateOutcome> {
  const { actor, secretId } = input;

  if (!can(actor, "secret.rotate")) {
    await auditDenied(actor, "secret.rotate", "secret", null, null, secretId, "rbac", input.context);
    return { ok: false, code: "forbidden", error: "You cannot rotate secrets." };
  }

  const secret = await db.secret.findUnique({
    where: { id: secretId },
    include: {
      environment: { select: { id: true, stage: true, protected: true, projectId: true } },
      project: { select: { organizationId: true } },
      rotationPolicy: { select: { generator: true, mode: true } },
    },
  });
  if (!secret || secret.deletedAt || secret.project.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "Secret not found." };
  }

  // A rotation is also a write — scope it through the same env gate.
  if (!canWriteValue(actor, toEnvLike(secret.environment))) {
    await auditDenied(actor, "secret.rotate", "secret", secret.environmentId, secret.environment.id, secret.id, "rbac", input.context);
    return { ok: false, code: "forbidden", error: "You cannot write values in this environment." };
  }

  const generator = input.value ? null : (input.generator ?? secret.rotationPolicy?.generator ?? "base64:32");
  const value = input.value ?? generate(generator!);

  const put = await putSecret({
    actor,
    environmentId: secret.environmentId,
    path: secret.path,
    key: secret.key,
    value,
    valueType: secret.valueType,
    rotationPolicyId: secret.rotationPolicyId ?? null,
    createdVia: actor.kind === "machine" ? "cli" : "rotation-worker",
    context: input.context,
    // Policies don't block a rotation on these axes — approval and MFA gate
    // the originating human-initiated write, not the follow-on rotation.
    actorHasApproval: true,
    actorMfaVerified: true,
  });
  if (!put.ok) {
    if (put.code === "forbidden") return { ok: false, code: "forbidden", error: put.error };
    if (put.code === "policy_violation") {
      return { ok: false, code: "policy_violation", error: put.error, violations: put.violations ?? [] };
    }
    // environment_not_found is unreachable: we just loaded the env.
    return { ok: false, code: "not_found", error: put.error };
  }

  if (secret.rotationPolicyId) {
    await db.rotationEvent.create({
      data: {
        policyId: secret.rotationPolicyId,
        secretId: secret.id,
        status: "SUCCEEDED",
        reason: input.reason ?? null,
        fromVersion: put.version.version - 1 >= 1 ? put.version.version - 1 : null,
        toVersion: put.version.version,
      },
    });
  }

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actorEmail(actor),
    action: "secret.rotate",
    resourceType: "secret",
    resourceId: secret.id,
    resourceLabel: `${secret.path}/${secret.key}`,
    environmentId: secret.environmentId,
    secretId: secret.id,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      version: put.version.version,
      fingerprint: put.version.fingerprint,
      generator,
      reason: input.reason ?? null,
    },
  });

  return { ok: true, secret: put.secret, version: put.version, generator };
}

// --------------------------------------------------------------------------
// deleteSecret — soft delete only. Historical versions remain so audit
// references and rollback both still work.
// --------------------------------------------------------------------------

export type DeleteSecretInput = {
  actor: Actor;
  secretId: string;
  context?: ActorContext;
};

export async function deleteSecret(input: DeleteSecretInput): Promise<DeleteOutcome> {
  const { actor, secretId } = input;

  if (!can(actor, "secret.delete")) {
    await auditDenied(actor, "secret.delete", "secret", null, null, secretId, "rbac", input.context);
    return { ok: false, code: "forbidden", error: "You cannot delete secrets." };
  }

  const secret = await db.secret.findUnique({
    where: { id: secretId },
    include: {
      project: { select: { organizationId: true } },
    },
  });
  if (!secret || secret.project.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "Secret not found." };
  }
  if (secret.deletedAt) {
    // Already deleted — idempotent success so a retry does not 404.
    return { ok: true, secret };
  }

  const updated = await db.secret.update({
    where: { id: secret.id },
    data: { deletedAt: new Date() },
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actorEmail(actor),
    action: "secret.delete",
    resourceType: "secret",
    resourceId: secret.id,
    resourceLabel: `${secret.path}/${secret.key}`,
    environmentId: secret.environmentId,
    secretId: secret.id,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: { path: secret.path, key: secret.key },
  });

  return { ok: true, secret: updated };
}

// --------------------------------------------------------------------------
// getSecretHistory — version metadata (fingerprint/version/createdAt), never
// plaintext. Powers the Secrets detail page and the CLI `history` subcommand.
// --------------------------------------------------------------------------

export type SecretHistoryEntry = {
  version: number;
  fingerprint: string;
  valueHash: string;
  keyId: string;
  createdAt: Date;
  createdVia: string;
  createdById: string | null;
};

export type HistoryOutcome =
  | { ok: true; secret: SecretSummary; versions: SecretHistoryEntry[] }
  | ServiceDenial
  | ServiceNotFound;

export async function getSecretHistory(input: {
  actor: Actor;
  secretId: string;
}): Promise<HistoryOutcome> {
  const { actor, secretId } = input;
  if (!can(actor, "secret.read.metadata")) {
    return { ok: false, code: "forbidden", error: "You cannot read secret metadata." };
  }
  const secret = await db.secret.findUnique({
    where: { id: secretId },
    include: {
      project: { select: { organizationId: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          version: true,
          fingerprint: true,
          valueHash: true,
          keyId: true,
          createdAt: true,
          createdVia: true,
          createdById: true,
        },
      },
    },
  });
  if (!secret || secret.project.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "Secret not found." };
  }
  const head = secret.versions[0];
  const summary: SecretSummary = {
    id: secret.id,
    path: secret.path,
    key: secret.key,
    valueType: secret.valueType,
    description: secret.description,
    environmentId: secret.environmentId,
    projectId: secret.projectId,
    rotationPolicyId: secret.rotationPolicyId,
    currentVersion: head?.version ?? null,
    fingerprint: head?.fingerprint ?? null,
    lastWriteAt: head?.createdAt ?? null,
    updatedAt: secret.updatedAt,
    createdAt: secret.createdAt,
  };
  return { ok: true, secret: summary, versions: secret.versions };
}

// --------------------------------------------------------------------------
// updateSecret — metadata-only patch (description, valueType, rotationPolicy).
// Changing the value is a separate operation (putSecret) with a new version.
// --------------------------------------------------------------------------

// Note: validation.ts exports a Zod-inferred `UpdateSecretInput` that is the
// request body shape. This is the service-layer input, which bundles the
// actor and secretId — rename to `UpdateSecretParams` to avoid a clash in
// files that import both.
export type UpdateSecretParams = {
  actor: Actor;
  secretId: string;
  description?: string | null;
  valueType?: string;
  rotationPolicyId?: string | null;
  context?: ActorContext;
};

export type UpdateOutcome =
  | { ok: true; secret: Secret }
  | ServiceDenial
  | ServiceNotFound;

export async function updateSecret(input: UpdateSecretParams): Promise<UpdateOutcome> {
  const { actor, secretId } = input;
  const secret = await db.secret.findUnique({
    where: { id: secretId },
    include: {
      environment: { select: { id: true, stage: true, protected: true } },
      project: { select: { organizationId: true } },
    },
  });
  if (!secret || secret.deletedAt || secret.project.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "Secret not found." };
  }
  if (!canWriteValue(actor, toEnvLike(secret.environment))) {
    await auditDenied(actor, "secret.write", "secret", secret.environmentId, secret.environment.id, secret.id, "rbac", input.context, { kind: "metadata" });
    return { ok: false, code: "forbidden", error: "You cannot update secrets in this environment." };
  }

  const patch: Prisma.SecretUpdateInput = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.valueType !== undefined) patch.valueType = input.valueType;
  if (input.rotationPolicyId !== undefined) {
    patch.rotationPolicy = input.rotationPolicyId
      ? { connect: { id: input.rotationPolicyId } }
      : { disconnect: true };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, secret };
  }

  const updated = await db.secret.update({ where: { id: secret.id }, data: patch });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actor.kind === "user" ? actor.email : `machine:${actor.principal}`,
    action: "secret.write",
    resourceType: "secret",
    resourceId: secret.id,
    resourceLabel: `${secret.path}/${secret.key}`,
    environmentId: secret.environmentId,
    secretId: secret.id,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: { kind: "metadata", fields: Object.keys(patch) },
  });

  return { ok: true, secret: updated };
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 100;
  if (n < 1) return 1;
  if (n > 500) return 500;
  return Math.floor(n);
}

function orgScope(actor: Actor): Prisma.SecretWhereInput {
  // All secrets reach through project → organization. The scoping is written
  // via the relation rather than denormalised, so a membership change does
  // not need a backfill to take effect.
  return { project: { organizationId: actor.organizationId } };
}

function toEnvLike(env: { id: string; stage: number; protected: boolean }): EnvironmentLike {
  return { id: env.id, stage: env.stage, protected: env.protected };
}

function sealedFromRow(v: SecretVersion): SealedValue {
  return {
    ciphertext: v.ciphertext,
    iv: v.iv,
    authTag: v.authTag,
    wrappedDek: v.wrappedDek,
    dekIv: v.dekIv,
    dekAuthTag: v.dekAuthTag,
    keyId: v.keyId,
    valueHash: v.valueHash,
    fingerprint: v.fingerprint,
  };
}

function actorEmail(actor: Actor): string {
  return actor.kind === "user" ? actor.email : `machine:${actor.principal}`;
}

function policyErrorMessage(violations: Violation[]): string {
  const blocking = violations.filter((v) => v.severity === "high" || v.severity === "critical");
  if (blocking.length === 1) return blocking[0]!.message;
  return `Refused by ${blocking.length} org policies.`;
}

async function loadPolicies(organizationId: string): Promise<Policy[]> {
  const rows = await db.policy.findMany({
    where: { organizationId, enabled: true },
    select: { id: true, name: true, rule: true, severity: true, enabled: true, config: true },
  });
  return rows.map<Policy>((r) => ({
    id: r.id,
    name: r.name,
    rule: r.rule as Policy["rule"],
    severity: r.severity as Policy["severity"],
    enabled: r.enabled,
    config: (r.config as Record<string, unknown> | null) ?? null,
  }));
}

async function auditDenied(
  actor: Actor,
  action: Parameters<typeof recordEvent>[0]["action"],
  resourceType: string,
  environmentId: string | null,
  resolvedEnvId: string | null,
  resourceId: string | null,
  reason: "rbac" | "policy" | "approval" | "mfa",
  context: ActorContext | undefined,
  extra?: Record<string, unknown>,
): Promise<void> {
  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actorEmail(actor),
    action,
    resourceType,
    resourceId,
    environmentId: resolvedEnvId ?? environmentId,
    secretId: resourceType === "secret" ? resourceId : null,
    ip: context?.ip ?? null,
    userAgent: context?.userAgent ?? null,
    result: "DENIED",
    metadata: { reason, ...(extra ?? {}) },
  });
}
