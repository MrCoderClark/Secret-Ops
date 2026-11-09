// Service layer for sync — plan, run, observe and pull-mode bundle.
//
// The adapters in this file are deliberately stubs. The contract is complete
// (plan / apply / observe, every method decrypts to prove the control plane
// can still open its own values), and real cloud SDKs are explicitly out of
// scope for v1 per SPECS.md § 1 and README's "Known gaps". Swapping a stub
// for a real integration is a scoped future change — the service layer and
// routes do not need to change for it.
//
// Invariants this module owns:
//
//   1. A sync run that cannot decrypt a value fails loudly rather than
//      pushing an empty string. A stub adapter whose `apply` returns `ok` is
//      proof that the control plane is still able to open the value.
//   2. SyncState is upserted on `(syncTargetId, secretId)` after every
//      observe pass; no duplicate rows ever.
//   3. Every `runSync` writes a SyncRun row and a `sync.run` audit event
//      whether it succeeds, fails or is a dry-run.
//   4. Pull-mode targets never receive an `apply` — the agent fetches a
//      bundle and applies it on its end.

import { Prisma, SyncStatus, SyncTargetKind, type SyncRun, type SyncTarget } from "@prisma/client";
import { db } from "./db";
import { can, type Actor } from "./rbac";
import { open, resolveRootKey, hashValue, type Keyring, type SealedValue } from "./crypto";
import { recordEvent } from "./audit";
import type { SecretVersion } from "@prisma/client";

// --------------------------------------------------------------------------
// Public shapes
// --------------------------------------------------------------------------

export type ActorContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type PlanItemState = "added" | "updated" | "unchanged" | "missing";

export type PlanItem = {
  secretId: string;
  path: string;
  key: string;
  state: PlanItemState;
  // The desired version — what the control plane has at head. Null when the
  // secret is gone (state === "missing").
  desiredVersion: number | null;
  desiredFingerprint: string | null;
  // What the target had on its last observed check. Null for never-observed.
  observedVersion: number | null;
  observedHash: string | null;
};

export type PlanResult =
  | {
      ok: true;
      target: { id: string; name: string; kind: SyncTargetKind; pullMode: boolean };
      environmentId: string;
      items: PlanItem[];
      counts: Record<PlanItemState, number>;
    }
  | { ok: false; code: "forbidden" | "not_found"; error: string };

export type RunResult =
  | { ok: true; run: SyncRun; pushed: number; skipped: number; dryRun: boolean }
  | { ok: false; code: "forbidden" | "not_found" | "pull_mode" | "adapter_error"; error: string; run?: SyncRun };

export type BundleItem = {
  secretId: string;
  path: string;
  key: string;
  version: number;
  valueHash: string;
  fingerprint: string;
  value: string;
};

export type BundleResult =
  | { ok: true; targetId: string; environmentId: string; generatedAt: Date; items: BundleItem[] }
  | { ok: false; code: "forbidden" | "not_found" | "not_pull_mode"; error: string };

// --------------------------------------------------------------------------
// Adapter contract
// --------------------------------------------------------------------------

export type AdapterApplyInput = {
  target: SyncTarget;
  path: string;
  key: string;
  value: string;
  version: number;
};

export type AdapterApplyOutcome = {
  ok: boolean;
  // The hash the target now holds. Equal to the control-plane's hash on
  // success — the drift detector compares against this.
  observedHash: string;
  note?: string;
  error?: string;
};

export type Adapter = {
  kind: SyncTargetKind;
  apply(input: AdapterApplyInput): Promise<AdapterApplyOutcome>;
};

// Stub registry — one entry per enum variant. Each one decrypts (really, the
// caller already decrypted and passed the value; the stub hashes it again to
// prove equality end-to-end) and returns a success outcome.
const ADAPTERS: Record<SyncTargetKind, Adapter> = {
  LOCAL: makeStubAdapter("LOCAL", "wrote to local .env preview"),
  CICD: makeStubAdapter("CICD", "pushed to CI/CD provider (stub)"),
  KUBERNETES: makeStubAdapter("KUBERNETES", "upserted Kubernetes Secret (stub)"),
  TERRAFORM: makeStubAdapter("TERRAFORM", "updated Terraform variable (stub)"),
  SERVERLESS: makeStubAdapter("SERVERLESS", "updated serverless env (stub)"),
  VM: makeStubAdapter("VM", "wrote to VM via agent channel (stub)"),
};

export function adapterFor(kind: SyncTargetKind): Adapter {
  return ADAPTERS[kind];
}

function makeStubAdapter(kind: SyncTargetKind, note: string): Adapter {
  return {
    kind,
    async apply(input) {
      // Prove the value is really the plaintext by re-hashing. A real adapter
      // would hand the value to the provider SDK here; the stub reports the
      // hash the control plane expects the target to carry.
      if (typeof input.value !== "string" || input.value.length === 0) {
        return { ok: false, observedHash: "", error: "adapter received empty value" };
      }
      const { hash } = hashValue(input.value);
      return { ok: true, observedHash: hash, note };
    },
  };
}

// --------------------------------------------------------------------------
// planSync — compare desired (head versions) to observed (SyncState)
// --------------------------------------------------------------------------

export type PlanSyncInput = {
  actor: Actor;
  syncTargetId: string;
};

export async function planSync(input: PlanSyncInput): Promise<PlanResult> {
  const { actor, syncTargetId } = input;

  if (!can(actor, "secret.read.metadata")) {
    return { ok: false, code: "forbidden", error: "You cannot read secret metadata." };
  }

  const target = await loadTarget(syncTargetId, actor);
  if (!target) return { ok: false, code: "not_found", error: "Sync target not found." };

  const [secrets, states] = await Promise.all([
    db.secret.findMany({
      where: { environmentId: target.environmentId, deletedAt: null },
      select: {
        id: true,
        path: true,
        key: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, valueHash: true, fingerprint: true },
        },
      },
      orderBy: [{ path: "asc" }, { key: "asc" }],
    }),
    db.syncState.findMany({
      where: { syncTargetId },
      select: { secretId: true, observedVersion: true, observedHash: true },
    }),
  ]);

  const stateBySecret = new Map(states.map((s) => [s.secretId, s] as const));
  const items: PlanItem[] = [];

  for (const secret of secrets) {
    const head = secret.versions[0];
    const state = stateBySecret.get(secret.id);
    const desiredHash = head?.valueHash ?? null;
    const observedHash = state?.observedHash ?? null;

    let kind: PlanItemState;
    if (!state) kind = "added";
    else if (desiredHash && observedHash === desiredHash) kind = "unchanged";
    else kind = "updated";

    items.push({
      secretId: secret.id,
      path: secret.path,
      key: secret.key,
      state: kind,
      desiredVersion: head?.version ?? null,
      desiredFingerprint: head?.fingerprint ?? null,
      observedVersion: state?.observedVersion ?? null,
      observedHash: state?.observedHash ?? null,
    });
  }

  // Anything in SyncState that no longer resolves to a non-deleted secret is
  // "missing" — the target still carries a value the control plane has
  // dropped. Surfacing this lets an operator reconcile without hunting rows.
  const secretIds = new Set(secrets.map((s) => s.id));
  for (const state of states) {
    if (secretIds.has(state.secretId)) continue;
    items.push({
      secretId: state.secretId,
      path: "(deleted)",
      key: "(deleted)",
      state: "missing",
      desiredVersion: null,
      desiredFingerprint: null,
      observedVersion: state.observedVersion,
      observedHash: state.observedHash,
    });
  }

  const counts: Record<PlanItemState, number> = { added: 0, updated: 0, unchanged: 0, missing: 0 };
  for (const item of items) counts[item.state] += 1;

  return {
    ok: true,
    target: {
      id: target.id,
      name: target.name,
      kind: target.kind,
      pullMode: target.pullMode,
    },
    environmentId: target.environmentId,
    items,
    counts,
  };
}

// --------------------------------------------------------------------------
// runSync — apply the plan through the adapter, upsert SyncState
// --------------------------------------------------------------------------

export type RunSyncInput = {
  actor: Actor;
  syncTargetId: string;
  dryRun?: boolean;
  context?: ActorContext;
};

export async function runSync(input: RunSyncInput): Promise<RunResult> {
  const { actor, syncTargetId } = input;

  if (!can(actor, "sync.run")) {
    return { ok: false, code: "forbidden", error: "You cannot run syncs." };
  }

  const target = await loadTarget(syncTargetId, actor);
  if (!target) return { ok: false, code: "not_found", error: "Sync target not found." };
  if (target.pullMode) {
    return {
      ok: false,
      code: "pull_mode",
      error: "This target pulls on a schedule — use /api/sync/:id/bundle from the agent.",
    };
  }

  const plan = await planSync({ actor, syncTargetId });
  if (!plan.ok) {
    return { ok: false, code: plan.code, error: plan.error };
  }

  const actionable = plan.items.filter((i) => i.state === "added" || i.state === "updated");
  const dryRun = Boolean(input.dryRun);

  // Open one run row up front so a failure part-way still leaves a record in
  // the Runs list. We flip status + finishedAt on completion.
  const run = await db.syncRun.create({
    data: {
      syncTargetId,
      status: SyncStatus.PENDING,
      startedAt: new Date(),
      log: Prisma.JsonNull,
    },
  });

  if (dryRun) {
    const finished = await db.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.SYNCED,
        finishedAt: new Date(),
        secretsPushed: 0,
        secretsSkipped: actionable.length,
        log: {
          dryRun: true,
          wouldPush: actionable.map((i) => ({ secretId: i.secretId, path: i.path, key: i.key, state: i.state })),
        },
      },
    });
    await auditSyncRun(actor, target, finished, { dryRun, pushed: 0, skipped: actionable.length }, input.context);
    return { ok: true, run: finished, pushed: 0, skipped: actionable.length, dryRun: true };
  }

  const adapter = adapterFor(target.kind);
  const kr = resolveRootKey();
  const log: Array<Record<string, unknown>> = [];
  let pushed = 0;
  let skipped = 0;
  let firstError: string | null = null;

  for (const item of actionable) {
    const result = await applyOne(adapter, kr, target, item, log);
    if (result.pushed) pushed += 1;
    else skipped += 1;
    if (result.error && !firstError) firstError = result.error;
  }

  const finalStatus = firstError ? SyncStatus.FAILED : SyncStatus.SYNCED;
  const finished = await db.syncRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus,
      finishedAt: new Date(),
      secretsPushed: pushed,
      secretsSkipped: skipped,
      error: firstError,
      log: log as Prisma.InputJsonValue,
    },
  });
  await db.syncTarget.update({
    where: { id: target.id },
    data: { lastRunAt: finished.finishedAt, lastStatus: finalStatus, lastError: firstError },
  });

  await auditSyncRun(actor, target, finished, { dryRun: false, pushed, skipped, error: firstError }, input.context);

  if (firstError) {
    return { ok: false, code: "adapter_error", error: firstError, run: finished };
  }
  return { ok: true, run: finished, pushed, skipped, dryRun: false };
}

async function applyOne(
  adapter: Adapter,
  kr: Keyring,
  target: SyncTarget,
  item: PlanItem,
  log: Array<Record<string, unknown>>,
): Promise<{ pushed: boolean; error: string | null }> {
  if (item.desiredVersion === null) {
    log.push({ secretId: item.secretId, path: item.path, key: item.key, status: "SKIPPED", reason: "no versions" });
    return { pushed: false, error: null };
  }
  const version = await db.secretVersion.findUnique({
    where: { secretId_version: { secretId: item.secretId, version: item.desiredVersion } },
  });
  if (!version) {
    log.push({ secretId: item.secretId, path: item.path, key: item.key, status: "SKIPPED", reason: "version missing" });
    return { pushed: false, error: null };
  }

  let plaintext: string;
  try {
    plaintext = open(sealedFromRow(version), kr);
  } catch (err) {
    const message = err instanceof Error ? err.message : "decrypt failed";
    log.push({ secretId: item.secretId, path: item.path, key: item.key, status: "FAILED", reason: message });
    return { pushed: false, error: `decrypt failed for ${item.path}/${item.key}` };
  }

  const outcome = await adapter.apply({
    target,
    path: item.path,
    key: item.key,
    value: plaintext,
    version: version.version,
  });

  // Scrub the plaintext from our frame — the adapter has either accepted or
  // rejected it by now and must not retain a reference.
  plaintext = "";

  if (!outcome.ok) {
    log.push({
      secretId: item.secretId,
      path: item.path,
      key: item.key,
      status: "FAILED",
      reason: outcome.error ?? "adapter refused",
    });
    return { pushed: false, error: outcome.error ?? `adapter refused ${item.path}/${item.key}` };
  }

  await db.syncState.upsert({
    where: { syncTargetId_secretId: { syncTargetId: target.id, secretId: item.secretId } },
    create: {
      syncTargetId: target.id,
      secretId: item.secretId,
      status: SyncStatus.SYNCED,
      observedVersion: version.version,
      observedHash: outcome.observedHash,
    },
    update: {
      status: SyncStatus.SYNCED,
      observedVersion: version.version,
      observedHash: outcome.observedHash,
      checkedAt: new Date(),
    },
  });
  await db.secret.update({ where: { id: item.secretId }, data: { lastSyncedAt: new Date() } });

  log.push({
    secretId: item.secretId,
    path: item.path,
    key: item.key,
    status: "SYNCED",
    version: version.version,
    note: outcome.note ?? null,
  });
  return { pushed: true, error: null };
}

// --------------------------------------------------------------------------
// recordObservedState — the pull-mode agent reports back here after it has
// applied a bundle; the drift sweep uses the same path with status DRIFTED
// when the observed hash does not match head.
// --------------------------------------------------------------------------

export type ObservedItem = {
  secretId: string;
  status: SyncStatus;
  observedVersion?: number | null;
  observedHash?: string | null;
};

export type RecordObservedInput = {
  actor: Actor;
  syncTargetId: string;
  items: ObservedItem[];
};

export async function recordObservedState(
  input: RecordObservedInput,
): Promise<{ ok: true; updated: number } | { ok: false; code: "forbidden" | "not_found"; error: string }> {
  const { actor, syncTargetId, items } = input;

  if (!can(actor, "sync.run")) {
    return { ok: false, code: "forbidden", error: "You cannot report observed state." };
  }
  const target = await loadTarget(syncTargetId, actor);
  if (!target) return { ok: false, code: "not_found", error: "Sync target not found." };

  let updated = 0;
  const checkedAt = new Date();
  for (const item of items) {
    await db.syncState.upsert({
      where: { syncTargetId_secretId: { syncTargetId, secretId: item.secretId } },
      create: {
        syncTargetId,
        secretId: item.secretId,
        status: item.status,
        observedVersion: item.observedVersion ?? null,
        observedHash: item.observedHash ?? null,
        checkedAt,
      },
      update: {
        status: item.status,
        observedVersion: item.observedVersion ?? null,
        observedHash: item.observedHash ?? null,
        checkedAt,
      },
    });
    updated += 1;
  }
  return { ok: true, updated };
}

// --------------------------------------------------------------------------
// bundleFor — pull-mode: the agent asks for a decrypted snapshot of its
// environment, applies it on the far side, then reports back through
// recordObservedState. Responses MUST be served with Cache-Control: no-store
// (the route sets it; next.config.mjs sets it too, defence-in-depth).
// --------------------------------------------------------------------------

export type BundleForInput = {
  actor: Actor;
  syncTargetId: string;
  context?: ActorContext;
};

export async function bundleFor(input: BundleForInput): Promise<BundleResult> {
  const { actor, syncTargetId } = input;

  if (!can(actor, "secret.read.value")) {
    return { ok: false, code: "forbidden", error: "You cannot read secret values." };
  }
  const target = await loadTarget(syncTargetId, actor);
  if (!target) return { ok: false, code: "not_found", error: "Sync target not found." };
  if (!target.pullMode) {
    return {
      ok: false,
      code: "not_pull_mode",
      error: "This target is push-mode; use /api/sync/:id/run instead.",
    };
  }

  const kr = resolveRootKey();
  const secrets = await db.secret.findMany({
    where: { environmentId: target.environmentId, deletedAt: null },
    orderBy: [{ path: "asc" }, { key: "asc" }],
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
      },
    },
  });

  const items: BundleItem[] = [];
  for (const secret of secrets) {
    const head = secret.versions[0];
    if (!head) continue;
    const value = open(sealedFromRow(head), kr);
    items.push({
      secretId: secret.id,
      path: secret.path,
      key: secret.key,
      version: head.version,
      valueHash: head.valueHash,
      fingerprint: head.fingerprint,
      value,
    });
  }

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actorEmail(actor),
    action: "secret.export",
    resourceType: "sync_target",
    resourceId: target.id,
    resourceLabel: target.name,
    environmentId: target.environmentId,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: { kind: target.kind, items: items.length, pullMode: true },
  });

  return {
    ok: true,
    targetId: target.id,
    environmentId: target.environmentId,
    generatedAt: new Date(),
    items,
  };
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

async function loadTarget(syncTargetId: string, actor: Actor): Promise<SyncTarget | null> {
  const target = await db.syncTarget.findUnique({
    where: { id: syncTargetId },
    include: { environment: { select: { project: { select: { organizationId: true } } } } },
  });
  if (!target) return null;
  if (target.environment.project.organizationId !== actor.organizationId) return null;
  if (actor.kind === "machine" && actor.environmentIds && !actor.environmentIds.includes(target.environmentId)) {
    return null;
  }
  // Strip the joined fields before returning so callers see a plain SyncTarget.
  const { environment: _env, ...rest } = target;
  return rest as SyncTarget;
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

async function auditSyncRun(
  actor: Actor,
  target: SyncTarget,
  run: SyncRun,
  summary: { dryRun: boolean; pushed: number; skipped: number; error?: string | null },
  context: ActorContext | undefined,
): Promise<void> {
  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actorEmail(actor),
    action: "sync.run",
    resourceType: "sync_target",
    resourceId: target.id,
    resourceLabel: target.name,
    environmentId: target.environmentId,
    ip: context?.ip ?? null,
    userAgent: context?.userAgent ?? null,
    result: summary.error ? "ERROR" : "SUCCESS",
    metadata: {
      runId: run.id,
      status: run.status,
      pushed: summary.pushed,
      skipped: summary.skipped,
      dryRun: summary.dryRun,
      ...(summary.error ? { error: summary.error } : {}),
    },
  });
}
