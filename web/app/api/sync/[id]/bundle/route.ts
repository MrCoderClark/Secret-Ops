// GET /api/sync/:id/bundle — pull-mode payload.
//
// Returns a decrypted snapshot of every secret in the target's environment.
// Pull-mode agents on isolated networks fetch this, apply it locally, and
// report back via (future) /observe. Not valid for push-mode targets.
//
// Response is always Cache-Control: no-store — middleware, next.config.mjs
// and noStore() here all set it.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { bundleFor } from "@/lib/sync";
import { conflict, forbidden, jsonOk, noStore, notFound, serverError, unauthorized } from "@/lib/responses";
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
    return noStore(
      jsonOk({
        targetId: result.targetId,
        environmentId: result.environmentId,
        generatedAt: result.generatedAt,
        items: result.items,
      }),
    );
  } catch {
    return noStore(serverError());
  }
}
