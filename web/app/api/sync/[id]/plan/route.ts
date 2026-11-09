// GET /api/sync/:id/plan — the diff between desired (control plane) and
// observed (target). No side effects: reading the plan does not touch the
// target or write a run row. Use /run with { dryRun: true } to produce a
// SyncRun record without pushing.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { planSync } from "@/lib/sync";
import { forbidden, jsonOk, notFound, unauthorized } from "@/lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();

  const result = await planSync({ actor, syncTargetId: params.id });
  if (!result.ok) {
    return result.code === "forbidden" ? forbidden(result.error) : notFound(result.error);
  }
  return jsonOk({
    target: result.target,
    environmentId: result.environmentId,
    counts: result.counts,
    items: result.items,
  });
}
