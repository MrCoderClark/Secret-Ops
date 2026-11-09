// /api/sync
//
//   GET  — list sync targets (query ?env=<id> narrows to one environment).
//   POST — register a new target. Requires sync.configure capability.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { createSyncTarget, listSyncTargets } from "@/lib/sync";
import { createSyncTargetSchema, parse } from "@/lib/validation";
import { badRequest, created, forbidden, jsonOk, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const url = new URL(req.url);
  const env = url.searchParams.get("env") ?? undefined;
  const targets = await listSyncTargets({ actor, environmentId: env });
  return jsonOk({ targets });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const body = await readJson(req);
  const parsed = parse(createSyncTargetSchema, body);
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  try {
    const result = await createSyncTarget({
      actor,
      environmentId: parsed.data.environmentId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      endpoint: parsed.data.endpoint,
      pullMode: parsed.data.pullMode,
      context: contextOf(req),
    });
    if (!result.ok) {
      return result.code === "forbidden" ? forbidden(result.error) : notFound(result.error);
    }
    return created({ target: result.target });
  } catch {
    return serverError();
  }
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
