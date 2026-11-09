// POST /api/secrets/:id/reveal
//
// The ONLY route that returns a secret's plaintext. Writes a secret.read
// AccessEvent in all branches (success AND denial). Response is always
// Cache-Control: no-store — middleware, next.config.mjs and noStore() here
// all set it (defence in depth).
//
// Body is optional: `{ version?: number }` to pull a specific historical
// version. Omitted → head.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { revealSecret } from "@/lib/secrets";
import { forbidden, jsonOk, noStore, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return noStore(unauthorized());
  const csrf = enforceCsrf(req, actor);
  if (csrf) return noStore(csrf);

  const body = await readJson(req);
  const version = typeof (body as { version?: unknown })?.version === "number"
    ? ((body as { version: number }).version)
    : undefined;

  try {
    const result = await revealSecret({
      actor,
      secretId: params.id,
      version,
      context: contextOf(req),
    });
    if (!result.ok) {
      return noStore(result.code === "forbidden" ? forbidden(result.error) : notFound(result.error));
    }
    return noStore(
      jsonOk({
        value: result.reveal.value,
        version: result.reveal.version,
        valueHash: result.reveal.valueHash,
        fingerprint: result.reveal.fingerprint,
        keyId: result.reveal.keyId,
      }),
    );
  } catch {
    return noStore(serverError());
  }
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
