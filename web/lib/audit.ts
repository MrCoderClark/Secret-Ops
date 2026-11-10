// Hash-chained audit log — one chain per organization.
//
//   hash = SHA256(prevHash | seq | org | actor | action | resource | result | createdAt)
//
// The first event links to a genesis hash of 64 zeros. Editing, deleting,
// inserting or reordering a row breaks the chain, which `verifyChain` reports
// by sequence number so a tamper is locatable, not merely detectable.
//
// Appends run inside a transaction that reads the tail and writes the next
// link. A unique constraint on (organizationId, seq) rejects a racing writer,
// which retries — so the chain cannot fork under concurrency.

import { createHash } from "node:crypto";
import { Prisma, type AccessEvent } from "@prisma/client";
import { db } from "./db";

export const GENESIS_HASH = "0".repeat(64);

export type EventAction =
  | "auth.login"
  | "auth.failed"
  | "auth.logout"
  | "secret.read"
  | "secret.write"
  | "secret.delete"
  | "secret.rotate"
  | "secret.export"
  | "sync.run"
  | "sync.configure"
  | "request.create"
  | "request.approve"
  | "request.deny"
  | "grant.create"
  | "policy.update"
  | "token.create"
  | "token.revoke"
  | "bundle_key.create"
  | "bundle_key.rotate";

export type EventResult = "SUCCESS" | "DENIED" | "ERROR";

export type RecordEventInput = {
  organizationId: string;
  actorId?: string | null;
  actorEmail: string;
  action: EventAction;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  environmentId?: string | null;
  secretId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  result?: EventResult;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Append one event to the organization's chain. Runs inside a serialisable
 * transaction so the tail read and the new row's write cannot interleave.
 * Retries up to 3× on a unique-constraint collision from a concurrent writer.
 */
export async function recordEvent(input: RecordEventInput): Promise<AccessEvent> {
  const result = input.result ?? "SUCCESS";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const tail = await tx.accessEvent.findFirst({
          where: { organizationId: input.organizationId },
          orderBy: { seq: "desc" },
          select: { hash: true, seq: true },
        });
        const prevHash = tail?.hash ?? GENESIS_HASH;
        const seq = (tail?.seq ?? 0) + 1;
        const createdAt = new Date();

        const hash = linkHash({
          prevHash,
          seq,
          organizationId: input.organizationId,
          actorEmail: input.actorEmail,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          result,
          createdAt,
        });

        return tx.accessEvent.create({
          data: {
            organizationId: input.organizationId,
            actorId: input.actorId ?? null,
            actorEmail: input.actorEmail,
            action: input.action,
            resourceType: input.resourceType,
            resourceId: input.resourceId ?? null,
            resourceLabel: input.resourceLabel ?? null,
            environmentId: input.environmentId ?? null,
            secretId: input.secretId ?? null,
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
            result,
            metadata: input.metadata ?? Prisma.JsonNull,
            prevHash,
            hash,
            seq,
            createdAt,
          },
        });
      });
    } catch (err) {
      lastErr = err;
      if (!isUniqueConstraintViolation(err)) throw err;
      // Another writer won the race for this seq. Retry — the next read picks
      // up the row they just wrote, so our seq moves forward.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("recordEvent: exhausted retries");
}

export type ChainVerification =
  | { ok: true; checked: number }
  | { ok: false; checked: number; firstFailureSeq: number; reason: string };

/** Replay the whole chain and report where (if anywhere) it first breaks. */
export async function verifyChain(organizationId: string): Promise<ChainVerification> {
  const events = await db.accessEvent.findMany({
    where: { organizationId },
    orderBy: { seq: "asc" },
    select: {
      id: true,
      seq: true,
      prevHash: true,
      hash: true,
      organizationId: true,
      actorEmail: true,
      action: true,
      resourceType: true,
      resourceId: true,
      result: true,
      createdAt: true,
    },
  });

  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of events) {
    if (e.seq !== expectedSeq) {
      return { ok: false, checked: expectedSeq - 1, firstFailureSeq: e.seq, reason: "seq-gap" };
    }
    if ((e.prevHash ?? GENESIS_HASH) !== expectedPrev) {
      return { ok: false, checked: expectedSeq - 1, firstFailureSeq: e.seq, reason: "prev-mismatch" };
    }
    const recomputed = linkHash({
      prevHash: expectedPrev,
      seq: e.seq,
      organizationId: e.organizationId,
      actorEmail: e.actorEmail,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      result: e.result,
      createdAt: e.createdAt,
    });
    if (recomputed !== e.hash) {
      return { ok: false, checked: expectedSeq - 1, firstFailureSeq: e.seq, reason: "hash-mismatch" };
    }
    expectedPrev = e.hash;
    expectedSeq += 1;
  }
  return { ok: true, checked: events.length };
}

// --------------------------------------------------------------------------
// English labels for the UI. Add new actions here so events render as
// sentences instead of code strings.
// --------------------------------------------------------------------------

const LABELS: Record<EventAction, string> = {
  "auth.login": "signed in",
  "auth.failed": "failed sign-in",
  "auth.logout": "signed out",
  "secret.read": "read",
  "secret.write": "wrote",
  "secret.delete": "deleted",
  "secret.rotate": "rotated",
  "secret.export": "exported",
  "sync.run": "synced",
  "sync.configure": "configured target",
  "request.create": "raised access request for",
  "request.approve": "approved access request for",
  "request.deny": "denied access request for",
  "grant.create": "granted access to",
  "policy.update": "updated policy",
  "token.create": "created token",
  "token.revoke": "revoked token",
  "bundle_key.create": "bootstrapped bundle signing key",
  "bundle_key.rotate": "rotated bundle signing key",
};

export function actionLabel(action: string): string {
  return LABELS[action as EventAction] ?? action;
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

function linkHash(input: {
  prevHash: string;
  seq: number;
  organizationId: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  createdAt: Date;
}): string {
  // Delimit with a null byte so no field's content can collide with the
  // separator. createdAt uses ISO-8601 with ms precision.
  const parts = [
    input.prevHash,
    String(input.seq),
    input.organizationId,
    input.actorEmail,
    input.action,
    input.resourceType,
    input.resourceId ?? "",
    input.result,
    input.createdAt.toISOString(),
  ];
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

function isUniqueConstraintViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "P2002";
}

// Re-export so callers that only pull `recordEvent` do not also need to
// import the JsonNull sentinel from "@prisma/client".
export const { JsonNull } = Prisma;
