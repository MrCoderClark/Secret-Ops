// POST /api/bundle-keys/rotate
//
// Admin+. Soft-revokes the current active bundle key (keeping it queryable
// via GET /api/bundle-keys for a verification grace window) and inserts a
// new active one. Returns the new key's public portion.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { rotateBundleKey } from "@/lib/bundleKeys";
import { forbidden, jsonOk, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  try {
    const result = await rotateBundleKey({ actor, context: contextOf(req) });
    if (!result.ok) return forbidden(result.error);
    return jsonOk({ key: result.key, previousId: result.previousId });
  } catch {
    return serverError();
  }
}
