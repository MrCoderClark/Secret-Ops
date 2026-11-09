// DELETE /api/tokens/:id — soft revoke a machine token.
//
// Idempotent — revoking an already-revoked token returns 204 instead of 404
// so a retry does not look like a failure.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { revokeToken } from "@/lib/tokens";
import { forbidden, noContent, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  try {
    const result = await revokeToken({ actor, tokenId: params.id, context: contextOf(req) });
    if (!result.ok) {
      return result.code === "forbidden" ? forbidden(result.error) : notFound(result.error);
    }
    return noContent();
  } catch {
    return serverError();
  }
}
