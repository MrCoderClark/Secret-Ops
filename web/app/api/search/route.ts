// GET /api/search?q=
//
// Backing endpoint for the ⌘K command palette and the dashboard header
// search. Returns three slices — secrets (metadata), paths (distinct), and
// actors (org roster). RBAC-filtered: a caller without secret.read.metadata
// sees an empty secrets slice; machine tokens never see actors.
//
// Response contains no secret values, no hashes, and no tokens. Safe to
// stream through the standard browser cache; no-store would be overkill.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { search } from "@/lib/search";
import { badRequest, jsonOk, unauthorized } from "@/lib/responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) return jsonOk({ secrets: [], paths: [], actors: [] });
  if (q.length > 200) return badRequest("q too long (max 200 characters).");

  const limitRaw = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 25;

  const hit = await search({ actor, q, limit });
  return jsonOk(hit);
}
