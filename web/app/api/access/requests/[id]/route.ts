// PATCH /api/access/requests/:id — approve or deny a pending request.
//
// Body: { decision: "APPROVE" | "DENY", note?: string }
// APPROVE materialises a Grant whose expiresAt mirrors durationMinutes;
// DENY leaves no residue beyond the request row + audit event.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { decideAccessRequest } from "@/lib/access";
import { decideRequestSchema, parse } from "@/lib/validation";
import { badRequest, conflict, forbidden, jsonOk, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const parsed = parse(decideRequestSchema, await readJson(req));
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  try {
    const result = await decideAccessRequest({
      actor,
      requestId: params.id,
      decision: parsed.data.decision,
      note: parsed.data.note,
      context: contextOf(req),
    });
    if (!result.ok) {
      switch (result.code) {
        case "forbidden":
          return forbidden(result.error);
        case "not_found":
          return notFound(result.error);
        case "self_review":
          return forbidden(result.error, "self_review");
        case "already_decided":
          return conflict(result.error, "already_decided");
      }
    }
    return jsonOk({ request: result.request, grant: result.grant });
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
