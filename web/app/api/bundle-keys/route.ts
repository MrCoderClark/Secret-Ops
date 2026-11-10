// /api/bundle-keys
//
//   GET  — list the organization's bundle signing keys (active + soft-revoked).
//          Any authenticated actor can read; verification is not privileged.
//   POST — bootstrap: create the first active bundle key for this org.
//          Admin+ only. 409 if one already exists (use /rotate instead).

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { bootstrapBundleKey, listBundleKeys } from "@/lib/bundleKeys";
import { conflict, created, forbidden, jsonOk, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const keys = await listBundleKeys({ actor });
  return jsonOk({ keys });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  try {
    const result = await bootstrapBundleKey({ actor, context: contextOf(req) });
    if (!result.ok) {
      if (result.code === "forbidden") return forbidden(result.error);
      return conflict(result.error, "already_exists");
    }
    return created({ key: result.key });
  } catch {
    return serverError();
  }
}
