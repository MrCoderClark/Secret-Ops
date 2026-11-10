// Service layer for BundleKey — the Ed25519 signing keys that protect
// pull-mode sync bundles. One active key per organization; rotation produces
// a new active row and soft-revokes the previous one (revokedAt set) so
// cached agents can still verify signatures they already received.
//
// Invariants this module owns:
//
//   1. The private key material never leaves this module unsealed. `seal()`
//      wraps it on the way in; `signBundlePayload` opens it, signs, and
//      releases the buffer immediately.
//   2. At most one `active: true` row per organization at a time. Rotation
//      flips the old one to `active: false, revokedAt: now()` in the same
//      transaction that inserts the new active row.
//   3. Every bootstrap and rotation writes an AccessEvent through
//      recordEvent() — the chain is the product.

import { db } from "./db";
import { can, type Actor } from "./rbac";
import {
  generateBundleKey,
  signBundle,
  type SealedValue,
} from "./crypto";
import { recordEvent } from "./audit";

// --------------------------------------------------------------------------
// Public shapes
// --------------------------------------------------------------------------

export type BundleKeyPublic = {
  id: string;
  publicKey: string;
  active: boolean;
  revokedAt: Date | null;
  createdAt: Date;
};

export type BootstrapResult =
  | { ok: true; key: BundleKeyPublic }
  | { ok: false; code: "forbidden" | "already_exists"; error: string };

export type RotateResult =
  | { ok: true; key: BundleKeyPublic; previousId: string | null }
  | { ok: false; code: "forbidden"; error: string };

export type SignResult =
  | { ok: true; signature: string; keyId: string }
  | { ok: false; code: "no_active_key" };

export type Context = { ip?: string | null; userAgent?: string | null };

// --------------------------------------------------------------------------
// bootstrapBundleKey — admin+. Creates the first active key for the actor's
// org. Bails if one already exists (use rotate instead).
// --------------------------------------------------------------------------

export async function bootstrapBundleKey(input: {
  actor: Actor;
  context?: Context;
}): Promise<BootstrapResult> {
  const { actor } = input;
  if (!can(actor, "bundle_key.manage")) {
    return { ok: false, code: "forbidden", error: "You cannot manage bundle signing keys." };
  }

  const existing = await db.bundleKey.findFirst({
    where: { organizationId: actor.organizationId, active: true },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      code: "already_exists",
      error: "An active bundle key already exists; call rotate to replace it.",
    };
  }

  const generated = generateBundleKey();
  const row = await db.bundleKey.create({
    data: {
      organizationId: actor.organizationId,
      publicKey: generated.publicKeyB64,
      ciphertext: generated.sealedPrivate.ciphertext,
      iv: generated.sealedPrivate.iv,
      authTag: generated.sealedPrivate.authTag,
      wrappedDek: generated.sealedPrivate.wrappedDek,
      dekIv: generated.sealedPrivate.dekIv,
      dekAuthTag: generated.sealedPrivate.dekAuthTag,
      keyId: generated.sealedPrivate.keyId,
      active: true,
      createdById: actor.kind === "user" ? actor.id : null,
    },
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actor.kind === "user" ? actor.email : `machine:${actor.principal}`,
    action: "bundle_key.create",
    resourceType: "bundle_key",
    resourceId: row.id,
    resourceLabel: `bundle-key ${row.id.slice(0, 8)}`,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: { publicKey: row.publicKey, reason: "bootstrap" },
  });

  return { ok: true, key: toPublic(row) };
}

// --------------------------------------------------------------------------
// rotateBundleKey — admin+. Soft-revokes the current active key (if any),
// inserts a new active key, writes one bundle_key.rotate audit event. The
// old key stays visible in listBundleKeys() so cached agents can still
// verify signatures they already received.
// --------------------------------------------------------------------------

export async function rotateBundleKey(input: {
  actor: Actor;
  context?: Context;
}): Promise<RotateResult> {
  const { actor } = input;
  if (!can(actor, "bundle_key.manage")) {
    return { ok: false, code: "forbidden", error: "You cannot manage bundle signing keys." };
  }

  const generated = generateBundleKey();
  const now = new Date();

  // Transaction so a reader never sees two active keys for the same org.
  const { row, previousId } = await db.$transaction(async (tx) => {
    const current = await tx.bundleKey.findFirst({
      where: { organizationId: actor.organizationId, active: true },
      select: { id: true },
    });
    if (current) {
      await tx.bundleKey.update({
        where: { id: current.id },
        data: { active: false, revokedAt: now },
      });
    }
    const inserted = await tx.bundleKey.create({
      data: {
        organizationId: actor.organizationId,
        publicKey: generated.publicKeyB64,
        ciphertext: generated.sealedPrivate.ciphertext,
        iv: generated.sealedPrivate.iv,
        authTag: generated.sealedPrivate.authTag,
        wrappedDek: generated.sealedPrivate.wrappedDek,
        dekIv: generated.sealedPrivate.dekIv,
        dekAuthTag: generated.sealedPrivate.dekAuthTag,
        keyId: generated.sealedPrivate.keyId,
        active: true,
        createdById: actor.kind === "user" ? actor.id : null,
      },
    });
    return { row: inserted, previousId: current?.id ?? null };
  });

  await recordEvent({
    organizationId: actor.organizationId,
    actorId: actor.kind === "user" ? actor.id : null,
    actorEmail: actor.kind === "user" ? actor.email : `machine:${actor.principal}`,
    action: "bundle_key.rotate",
    resourceType: "bundle_key",
    resourceId: row.id,
    resourceLabel: `bundle-key ${row.id.slice(0, 8)}`,
    ip: input.context?.ip ?? null,
    userAgent: input.context?.userAgent ?? null,
    result: "SUCCESS",
    metadata: {
      publicKey: row.publicKey,
      previousKeyId: previousId,
      graceWindow: previousId ? "previous key still listed for verification" : null,
    },
  });

  return { ok: true, key: toPublic(row), previousId };
}

// --------------------------------------------------------------------------
// listBundleKeys — public portions of every key the org still has (active +
// soft-revoked but not hard-deleted). Any authenticated actor in the org can
// read; verification is not privileged.
// --------------------------------------------------------------------------

export async function listBundleKeys(input: { actor: Actor }): Promise<BundleKeyPublic[]> {
  const rows = await db.bundleKey.findMany({
    where: { organizationId: input.actor.organizationId },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toPublic);
}

// --------------------------------------------------------------------------
// signBundlePayload — internal. The bundle route calls this with the exact
// JSON bytes it will send on the wire, and sets X-Signature-Bundle +
// X-Signature-Key-Id on the response.
// --------------------------------------------------------------------------

export async function signBundlePayload(
  organizationId: string,
  bodyBytes: Buffer,
): Promise<SignResult> {
  const key = await db.bundleKey.findFirst({
    where: { organizationId, active: true },
    select: {
      id: true,
      publicKey: true,
      ciphertext: true,
      iv: true,
      authTag: true,
      wrappedDek: true,
      dekIv: true,
      dekAuthTag: true,
      keyId: true,
    },
  });
  if (!key) return { ok: false, code: "no_active_key" };

  const sealed: SealedValue = {
    ciphertext: key.ciphertext,
    iv: key.iv,
    authTag: key.authTag,
    wrappedDek: key.wrappedDek,
    dekIv: key.dekIv,
    dekAuthTag: key.dekAuthTag,
    keyId: key.keyId,
    // valueHash and fingerprint are unused in the open() path but the type
    // requires them; the signing private key has no plaintext fingerprint
    // worth exposing, so stub them with empty strings.
    valueHash: "",
    fingerprint: "",
  };
  const signature = signBundle(bodyBytes, sealed);
  return { ok: true, signature, keyId: key.id };
}

// --------------------------------------------------------------------------
// Internals
// --------------------------------------------------------------------------

function toPublic(row: {
  id: string;
  publicKey: string;
  active: boolean;
  revokedAt: Date | null;
  createdAt: Date;
}): BundleKeyPublic {
  return {
    id: row.id,
    publicKey: row.publicKey,
    active: row.active,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
