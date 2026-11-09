// Service layer for just-in-time access requests.
//
// A request is a signed intent: "User X asks for permission Y on Z for N
// minutes." Anyone can raise one. Only reviewers (OWNER | ADMIN) can approve
// or deny. Approving materialises a time-boxed Grant whose expiry mirrors
// the request's — the grant falls off on its own, no janitor sweep needed.
//
// Invariants this module owns:
//
//   1. Every create / approve / deny writes an AccessEvent through
//      recordEvent so the chain stays valid.
//   2. A reviewer is always a different user than the requester
//      (self-approval is refused with a forbidden outcome).
//   3. A decision is final — re-deciding a non-PENDING request is refused.
//      Expiry of the resulting Grant is NOT recomputed; a fresh request is
//      the right path.
//   4. Permission strings are the schema-documented set: READ | WRITE |
//      ADMIN. Anything else is coerced to READ (defence-in-depth against a
//      hand-crafted body that slipped the Zod gate elsewhere).

import type { AccessRequest, Grant } from "@prisma/client";
import { db } from "./db";
import { can, type Actor } from "./rbac";
import { recordEvent } from "./audit";

// --------------------------------------------------------------------------
// Public shapes
// --------------------------------------------------------------------------

export type ActorContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type Permission = "READ" | "WRITE" | "ADMIN";

export type AccessRequestSummary = {
  id: string;
  requesterId: string;
  requesterEmail: string;
  requesterName: string;
  reviewerId: string | null;
  reviewerEmail: string | null;
  permission: Permission;
  justification: string;
  durationMinutes: number;
  environmentId: string | null;
  environmentLabel: string | null;
  secretId: string | null;
  secretLabel: string | null;
  status: AccessRequest["status"];
  decisionNote: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

// --------------------------------------------------------------------------
// listAccessRequests — reviewers see all, requesters see their own.
// --------------------------------------------------------------------------

export type ListAccessRequestsInput = {
  actor: Actor;
  status?: AccessRequest["status"];
  limit?: number;
};

export async function listAccessRequests(input: ListAccessRequestsInput): Promise<AccessRequestSummary[]> {
  const { actor } = input;
  // READONLY/AUDITOR can read metadata but aren't on the review list — show
  // them their own requests only. Machines don't raise requests.
  if (actor.kind === "machine") return [];

  const isReviewer = can(actor, "request.review");
  const limit = clampLimit(input.limit ?? 100);

  const rows = await db.accessRequest.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(isReviewer ? {} : { requesterId: actor.id }),
      ...(input.status ? { status: input.status } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      requester: { select: { id: true, email: true, name: true } },
      reviewer: { select: { id: true, email: true } },
      environment: { select: { name: true, slug: true, project: { select: { slug: true } } } },
      secret: { select: { path: true, key: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    requesterId: row.requester.id,
    requesterEmail: row.requester.email,
    requesterName: row.requester.name,
    reviewerId: row.reviewer?.id ?? null,
    reviewerEmail: row.reviewer?.email ?? null,
    permission: coercePermission(row.permission),
    justification: row.justification,
    durationMinutes: row.durationMinutes,
    environmentId: row.environmentId,
    environmentLabel: row.environment ? `${row.environment.project.slug}/${row.environment.slug}` : null,
    secretId: row.secretId,
    secretLabel: row.secret ? `${row.secret.path}/${row.secret.key}` : null,
    status: row.status,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}

// --------------------------------------------------------------------------
// createAccessRequest — raise a new request, audit request.create.
// --------------------------------------------------------------------------

export type CreateAccessRequestInput = {
  actor: Actor;
  environmentId?: string;
  secretId?: string;
  permission: Permission;
  justification: string;
  durationMinutes: number;
  context?: ActorContext;
};

export type CreateAccessRequestOutcome =
  | { ok: true; request: AccessRequest }
  | { ok: false; code: "forbidden" | "not_found" | "invalid"; error: string };

export async function createAccessRequest(input: CreateAccessRequestInput): Promise<CreateAccessRequestOutcome> {
  const { actor } = input;
  if (actor.kind !== "user") {
    return { ok: false, code: "forbidden", error: "Only users may raise access requests." };
  }
  if (!input.environmentId && !input.secretId) {
    return { ok: false, code: "invalid", error: "environmentId or secretId is required." };
  }

  // Scope-check whatever the caller named — we don't want cross-org requests
  // to be filed against someone else's env.
  if (input.environmentId) {
    const env = await db.environment.findUnique({
      where: { id: input.environmentId },
      select: { project: { select: { organizationId: true } } },
    });
    if (!env || env.project.organizationId !== actor.organizationId) {
      return { ok: false, code: "not_found", error: "Environment not found." };
    }
  }
  if (input.secretId) {
    const secret = await db.secret.findUnique({
      where: { id: input.secretId },
      select: { project: { select: { organizationId: true } } },
    });
    if (!secret || secret.project.organizationId !== actor.organizationId) {
      return { ok: false, code: "not_found", error: "Secret not found." };
    }
  }

  const request = await db.accessRequest.create({
    data: {
      organizationId: actor.organizationId,
      requesterId: actor.id,
      environmentId: input.environmentId ?? null,
      secretId: input.secretId ?? null,
      permission: input.permission,
      justification: input.justification,
      durationMinutes: input.durationMinutes,
      status: "PENDING",
    },
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "request.create",
    resourceType: "access_request",
    resourceId: request.id,
    environmentId: input.environmentId ?? null,
    secretId: input.secretId ?? null,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      permission: input.permission,
      durationMinutes: input.durationMinutes,
    },
  });

  return { ok: true, request };
}

// --------------------------------------------------------------------------
// decideAccessRequest — approve or deny. Approve materialises a Grant
// whose expiry mirrors durationMinutes.
// --------------------------------------------------------------------------

export type DecideAccessRequestInput = {
  actor: Actor;
  requestId: string;
  decision: "APPROVE" | "DENY";
  note?: string;
  context?: ActorContext;
};

export type DecideAccessRequestOutcome =
  | { ok: true; request: AccessRequest; grant: Grant | null }
  | { ok: false; code: "forbidden" | "not_found" | "already_decided" | "self_review"; error: string };

export async function decideAccessRequest(input: DecideAccessRequestInput): Promise<DecideAccessRequestOutcome> {
  const { actor } = input;
  if (!can(actor, "request.review")) {
    return { ok: false, code: "forbidden", error: "You cannot review access requests." };
  }
  if (actor.kind !== "user") {
    return { ok: false, code: "forbidden", error: "Only user actors can review requests." };
  }

  const request = await db.accessRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      organizationId: true,
      requesterId: true,
      permission: true,
      durationMinutes: true,
      environmentId: true,
      secretId: true,
      status: true,
    },
  });
  if (!request || request.organizationId !== actor.organizationId) {
    return { ok: false, code: "not_found", error: "Access request not found." };
  }
  if (request.status !== "PENDING") {
    return { ok: false, code: "already_decided", error: "This request has already been decided." };
  }
  if (request.requesterId === actor.id) {
    return { ok: false, code: "self_review", error: "You cannot review your own request." };
  }

  const decidedAt = new Date();

  if (input.decision === "DENY") {
    const updated = await db.accessRequest.update({
      where: { id: request.id },
      data: {
        status: "DENIED",
        reviewerId: actor.id,
        decisionNote: input.note ?? null,
        decidedAt,
      },
    });
    await recordEvent({
      organizationId: actor.organizationId,
      actorId: actor.id,
      actorEmail: actor.email,
      action: "request.deny",
      resourceType: "access_request",
      resourceId: request.id,
      environmentId: request.environmentId,
      secretId: request.secretId,
      ip: input.context?.ip ?? null,
      userAgent: input.context?.userAgent ?? null,
      result: "SUCCESS",
      metadata: { reviewer: actor.email, note: input.note ?? null },
    });
    return { ok: true, request: updated, grant: null };
  }

  // Approve: set status + create a time-boxed grant atomically.
  const expiresAt = new Date(decidedAt.getTime() + request.durationMinutes * 60 * 1000);
  const { updated, grant } = await db.$transaction(async (tx) => {
    const updated = await tx.accessRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewerId: actor.id,
        decisionNote: input.note ?? null,
        decidedAt,
        expiresAt,
      },
    });
    const grant = await tx.grant.create({
      data: {
        organizationId: actor.organizationId,
        userId: request.requesterId,
        environmentId: request.environmentId ?? null,
        secretId: request.secretId ?? null,
        permission: coercePermission(request.permission),
        expiresAt,
        createdById: actor.id,
      },
    });
    return { updated, grant };
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "request.approve",
    resourceType: "access_request",
    resourceId: request.id,
    environmentId: request.environmentId,
    secretId: request.secretId,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      reviewer: actor.email,
      grantId: grant.id,
      expiresAt: expiresAt.toISOString(),
      note: input.note ?? null,
    },
  });
  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: "grant.create",
    resourceType: "grant",
    resourceId: grant.id,
    environmentId: request.environmentId,
    secretId: request.secretId,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      source: "access_request",
      requestId: request.id,
      permission: coercePermission(request.permission),
      ttlMinutes: request.durationMinutes,
    },
  });

  return { ok: true, request: updated, grant };
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

function coercePermission(s: string): Permission {
  return s === "WRITE" || s === "ADMIN" ? s : "READ";
}
