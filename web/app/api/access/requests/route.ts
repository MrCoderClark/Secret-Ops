// /api/access/requests
//
//   GET  — reviewers see all requests for their org; everyone else sees
//          their own. Query ?status=PENDING|APPROVED|DENIED|EXPIRED|CANCELLED
//          to filter.
//   POST — raise a new request. Zod schema requires environmentId OR secretId.

import { type NextRequest, NextResponse } from "next/server";
import type { AccessRequest } from "@prisma/client";
import { resolveActor } from "@/lib/session";
import { createAccessRequest, listAccessRequests } from "@/lib/access";
import { createRequestSchema, parse } from "@/lib/validation";
import { badRequest, created, forbidden, jsonOk, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_STATUSES = new Set<AccessRequest["status"]>(["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && VALID_STATUSES.has(statusParam as AccessRequest["status"])
    ? (statusParam as AccessRequest["status"])
    : undefined;

  const requests = await listAccessRequests({ actor, status });
  return jsonOk({ requests });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const body = await readJson(req);
  const parsed = parse(createRequestSchema, body);
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  try {
    const result = await createAccessRequest({
      actor,
      environmentId: parsed.data.environmentId,
      secretId: parsed.data.secretId,
      permission: parsed.data.permission,
      justification: parsed.data.justification,
      durationMinutes: parsed.data.durationMinutes,
      context: contextOf(req),
    });
    if (!result.ok) {
      switch (result.code) {
        case "forbidden":
          return forbidden(result.error);
        case "not_found":
          return notFound(result.error);
        case "invalid":
          return badRequest(result.error);
      }
    }
    return created({ request: result.request });
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
