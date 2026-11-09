// POST /api/audit/verify
//
// Replays the organization's hash-chained audit log from genesis and reports
// where (if anywhere) it first breaks. Works on the actor's organization —
// no cross-org leak surface.
//
// Powers the "Verify chain" button on the Audit page and the CLI
// `secretops audit verify` subcommand. Expensive on large chains, so this
// is POST, not GET (operators invoke it deliberately).

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { verifyChain } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { forbidden, jsonOk, serverError, unauthorized } from "@/lib/responses";
import { enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  if (!can(actor, "audit.verify")) {
    return forbidden("You cannot verify the audit chain.");
  }

  try {
    const result = await verifyChain(actor.organizationId);
    return jsonOk(result);
  } catch {
    return serverError();
  }
}
