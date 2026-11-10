// GET /api/sync/:id/bundle — pull-mode payload.
//
// Returns a decrypted snapshot of every secret in the target's environment.
// Pull-mode agents on isolated networks fetch this, apply it locally, and
// report back via (future) /observe. Not valid for push-mode targets.
//
// The response body is signed by the organization's active BundleKey. Two
// headers carry the proof:
//
//   X-Signature-Bundle: base64(ed25519(body))
//   X-Signature-Key-Id: <bundle_key.id>
//
// The signature is over the EXACT body bytes transmitted — no JSON
// canonicalization — so an agent in any language verifies by hashing the
// bytes it received. The verification key lives at GET /api/bundle-keys.
//
// Response is always Cache-Control: no-store — middleware, next.config.mjs
// and noStore() here all set it.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { bundleFor } from "@/lib/sync";
import { signBundlePayload } from "@/lib/bundleKeys";
import { conflict, forbidden, noStore, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return noStore(unauthorized());

  try {
    const result = await bundleFor({
      actor,
      syncTargetId: params.id,
      context: contextOf(req),
    });
    if (!result.ok) {
      switch (result.code) {
        case "forbidden":
          return noStore(forbidden(result.error));
        case "not_found":
          return noStore(notFound(result.error));
        case "not_pull_mode":
          return noStore(conflict(result.error, "not_pull_mode"));
      }
    }

    // Serialize the exact bytes we will sign and send. Downstream verifiers
    // hash these bytes without reparsing — the guarantee is byte-for-byte.
    const body = JSON.stringify({
      targetId: result.targetId,
      environmentId: result.environmentId,
      generatedAt: result.generatedAt,
      items: result.items,
    });
    const bodyBytes = Buffer.from(body, "utf8");

    const signed = await signBundlePayload(actor.organizationId, bodyBytes);
    if (!signed.ok) {
      return noStore(
        conflict(
          "No active bundle signing key for this organization. POST /api/bundle-keys to bootstrap one.",
          "no_signing_key",
        ),
      );
    }

    const response = new NextResponse(bodyBytes, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-signature-bundle": signed.signature,
        "x-signature-key-id": signed.keyId,
      },
    });
    return noStore(response);
  } catch {
    return noStore(serverError());
  }
}
