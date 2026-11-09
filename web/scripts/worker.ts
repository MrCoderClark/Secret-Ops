#!/usr/bin/env tsx
// SecretOps background worker.
//
// Two independent loops, each on its own schedule:
//
//   - rotation sweep (ROTATION_SWEEP_MS, default 6h)
//       For every org, find secrets whose attached RotationPolicy is overdue
//       (now - head.createdAt > policy.intervalDays). Auto-mode policies call
//       rotateSecret() with the policy's generator. Manual-mode policies
//       write a RotationEvent{status:"SCHEDULED"} + audit so the dashboard
//       surfaces a task for an operator.
//
//   - drift sweep (DRIFT_SWEEP_MS, default 30m)
//       For every enabled SyncTarget, compare the control plane's head
//       version to what SyncState last recorded. Divergence → DRIFTED;
//       unseen secrets → PENDING. We do not probe the target itself; a real
//       integration would push observations via recordObservedState().
//
// Runs as a synthetic MachineActor per-organization with the superset of
// scopes the service layer needs. The actor never hits the database as a
// real ApiToken row — it exists only in memory for the duration of a sweep.
//
// Structured logging: one JSON object per line on stdout, so an operator
// can `pnpm worker | jq` to triage. SIGTERM/SIGINT drain the in-flight
// sweep cleanly before disconnecting Prisma.

import { PrismaClient, SyncStatus } from "@prisma/client";
import { rotateSecret } from "@/lib/secrets";
import { planSync } from "@/lib/sync";
import { recordEvent } from "@/lib/audit";
import type { MachineActor, MachineScope } from "@/lib/rbac";

const db = new PrismaClient();

const ROTATION_SWEEP_MS = parseInterval(process.env.ROTATION_SWEEP_MS, 6 * 60 * 60 * 1000);
const DRIFT_SWEEP_MS = parseInterval(process.env.DRIFT_SWEEP_MS, 30 * 60 * 1000);

// Short initial delay staggers the two loops so a full database query does
// not fire on both at second zero when the worker boots.
const ROTATION_INITIAL_DELAY_MS = 5_000;
const DRIFT_INITIAL_DELAY_MS = 10_000;

const WORKER_SCOPES: MachineScope[] = [
  "secrets:read",
  "secrets:write",
  "sync:run",
  "sync:configure",
  "audit:read",
];

function actorFor(organizationId: string, principal: string): MachineActor {
  return {
    kind: "machine",
    tokenId: `worker:${principal}`,
    principal,
    organizationId,
    scopes: WORKER_SCOPES,
    environmentIds: null,
  };
}

// --------------------------------------------------------------------------
// Structured logging — one JSON line per event. `level` is info|warn|error.
// --------------------------------------------------------------------------

type LogFields = Record<string, unknown>;
function log(level: "info" | "warn" | "error", msg: string, fields: LogFields = {}): void {
  const line = { ts: new Date().toISOString(), level, worker: "secretops", msg, ...fields };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

// --------------------------------------------------------------------------
// Rotation sweep
// --------------------------------------------------------------------------

type RotationCounts = { auto: number; scheduled: number; failed: number; skipped: number };

async function rotationSweep(): Promise<void> {
  const started = Date.now();
  log("info", "rotation sweep: start");

  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  let totals: RotationCounts = { auto: 0, scheduled: 0, failed: 0, skipped: 0 };

  for (const org of orgs) {
    const counts = await rotationSweepForOrg(org.id, org.slug);
    totals = {
      auto: totals.auto + counts.auto,
      scheduled: totals.scheduled + counts.scheduled,
      failed: totals.failed + counts.failed,
      skipped: totals.skipped + counts.skipped,
    };
  }

  log("info", "rotation sweep: done", {
    durationMs: Date.now() - started,
    orgs: orgs.length,
    ...totals,
  });
}

async function rotationSweepForOrg(organizationId: string, orgSlug: string): Promise<RotationCounts> {
  const actor = actorFor(organizationId, "worker/rotation");
  const counts: RotationCounts = { auto: 0, scheduled: 0, failed: 0, skipped: 0 };

  const now = Date.now();
  // Load candidate secrets with their head version createdAt and policy.
  const secrets = await db.secret.findMany({
    where: {
      deletedAt: null,
      rotationPolicyId: { not: null },
      rotationPolicy: { enabled: true },
      project: { organizationId },
    },
    include: {
      rotationPolicy: { select: { id: true, intervalDays: true, mode: true, generator: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true, version: true } },
    },
  });

  for (const secret of secrets) {
    const head = secret.versions[0];
    const policy = secret.rotationPolicy;
    if (!head || !policy) {
      counts.skipped += 1;
      continue;
    }
    const ageMs = now - head.createdAt.getTime();
    const dueAfterMs = policy.intervalDays * 24 * 60 * 60 * 1000;
    if (ageMs < dueAfterMs) continue;

    if (policy.mode === "auto") {
      const result = await rotateSecret({
        actor,
        secretId: secret.id,
        generator: policy.generator,
        reason: `auto-rotation after ${policy.intervalDays} days`,
      });
      if (result.ok) {
        counts.auto += 1;
        log("info", "rotation: auto", {
          org: orgSlug,
          secret: `${secret.path}/${secret.key}`,
          fromVersion: head.version,
          toVersion: result.version.version,
        });
      } else {
        counts.failed += 1;
        log("error", "rotation: auto failed", {
          org: orgSlug,
          secret: `${secret.path}/${secret.key}`,
          code: result.code,
          error: result.error,
        });
      }
    } else {
      // Manual mode: no new version here; file a task for an operator.
      await db.rotationEvent.create({
        data: {
          policyId: policy.id,
          secretId: secret.id,
          status: "SCHEDULED",
          reason: "manual rotation due",
          fromVersion: head.version,
          toVersion: null,
        },
      });
      await recordEvent({
        organizationId,
        actorId: null,
        actorEmail: "machine:worker/rotation",
        action: "secret.rotate",
        resourceType: "secret",
        resourceId: secret.id,
        resourceLabel: `${secret.path}/${secret.key}`,
        environmentId: secret.environmentId,
        secretId: secret.id,
        result: "SUCCESS",
        metadata: { mode: "manual", status: "SCHEDULED", intervalDays: policy.intervalDays },
      });
      counts.scheduled += 1;
      log("info", "rotation: scheduled (manual)", {
        org: orgSlug,
        secret: `${secret.path}/${secret.key}`,
        fromVersion: head.version,
      });
    }
  }

  return counts;
}

// --------------------------------------------------------------------------
// Drift sweep
// --------------------------------------------------------------------------

type DriftCounts = { drifted: number; pending: number; synced: number; targets: number };

async function driftSweep(): Promise<void> {
  const started = Date.now();
  log("info", "drift sweep: start");

  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  const totals: DriftCounts = { drifted: 0, pending: 0, synced: 0, targets: 0 };

  for (const org of orgs) {
    const counts = await driftSweepForOrg(org.id, org.slug);
    totals.drifted += counts.drifted;
    totals.pending += counts.pending;
    totals.synced += counts.synced;
    totals.targets += counts.targets;
  }

  log("info", "drift sweep: done", { durationMs: Date.now() - started, orgs: orgs.length, ...totals });
}

async function driftSweepForOrg(organizationId: string, orgSlug: string): Promise<DriftCounts> {
  const actor = actorFor(organizationId, "worker/drift");
  const counts: DriftCounts = { drifted: 0, pending: 0, synced: 0, targets: 0 };

  const targets = await db.syncTarget.findMany({
    where: { enabled: true, environment: { project: { organizationId } } },
    select: { id: true, name: true },
  });

  for (const target of targets) {
    counts.targets += 1;
    const plan = await planSync({ actor, syncTargetId: target.id });
    if (!plan.ok) {
      log("warn", "drift: plan failed", { org: orgSlug, target: target.name, code: plan.code, error: plan.error });
      continue;
    }

    const checkedAt = new Date();
    for (const item of plan.items) {
      switch (item.state) {
        case "updated":
          await db.syncState.update({
            where: { syncTargetId_secretId: { syncTargetId: target.id, secretId: item.secretId } },
            data: { status: SyncStatus.DRIFTED, checkedAt },
          });
          counts.drifted += 1;
          break;
        case "added":
          await db.syncState.upsert({
            where: { syncTargetId_secretId: { syncTargetId: target.id, secretId: item.secretId } },
            create: {
              syncTargetId: target.id,
              secretId: item.secretId,
              status: SyncStatus.PENDING,
              observedVersion: null,
              observedHash: null,
              checkedAt,
            },
            update: { status: SyncStatus.PENDING, checkedAt },
          });
          counts.pending += 1;
          break;
        case "unchanged":
          counts.synced += 1;
          // No write — the row is already SYNCED and nothing moved.
          break;
        case "missing":
          // The SyncState points at a deleted secret; leave the row to the
          // operator. Marking it MISSING would require a new enum value.
          break;
      }
    }
  }

  return counts;
}

// --------------------------------------------------------------------------
// Scheduler + graceful shutdown
// --------------------------------------------------------------------------

type SweepSlot = { name: string; fn: () => Promise<void>; intervalMs: number; initialDelayMs: number };

const SLOTS: SweepSlot[] = [
  { name: "rotation", fn: rotationSweep, intervalMs: ROTATION_SWEEP_MS, initialDelayMs: ROTATION_INITIAL_DELAY_MS },
  { name: "drift", fn: driftSweep, intervalMs: DRIFT_SWEEP_MS, initialDelayMs: DRIFT_INITIAL_DELAY_MS },
];

const timers: NodeJS.Timeout[] = [];
let shuttingDown = false;
const inFlight = new Set<Promise<void>>();

function schedule(slot: SweepSlot): void {
  const run = async (): Promise<void> => {
    if (shuttingDown) return;
    const p = (async () => {
      try {
        await slot.fn();
      } catch (err) {
        log("error", `${slot.name}: unhandled`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    inFlight.add(p);
    try {
      await p;
    } finally {
      inFlight.delete(p);
    }
  };

  // Fire once after the initial delay, then on the interval.
  const first = setTimeout(() => {
    void run();
    const t = setInterval(() => void run(), slot.intervalMs);
    timers.push(t);
  }, slot.initialDelayMs);
  timers.push(first);
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown: received signal", { signal });

  for (const t of timers) clearTimeout(t);
  if (inFlight.size > 0) {
    log("info", "shutdown: draining in-flight sweeps", { inFlight: inFlight.size });
    await Promise.allSettled(inFlight);
  }

  await db.$disconnect();
  log("info", "shutdown: done");
  process.exit(0);
}

function parseInterval(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1_000) return fallback;
  return n;
}

function main(): void {
  log("info", "worker: starting", {
    rotationSweepMs: ROTATION_SWEEP_MS,
    driftSweepMs: DRIFT_SWEEP_MS,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
  for (const slot of SLOTS) schedule(slot);
  process.on("SIGTERM", (s) => void shutdown(s));
  process.on("SIGINT", (s) => void shutdown(s));
}

main();
