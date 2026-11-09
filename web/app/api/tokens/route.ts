// /api/tokens
//
//   GET  — list token metadata for the org (never the hash).
//   POST — mint a new token. Response includes the plaintext ONCE; the UI
//          surfaces a "copy and store this now" dialog. The database holds
//          only its SHA-256.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { createToken, listTokens } from "@/lib/tokens";
import { createTokenSchema, parse } from "@/lib/validation";
import { badRequest, created, forbidden, jsonOk, noStore, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const tokens = await listTokens({ actor });
  return jsonOk({ tokens });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return noStore(unauthorized());
  const csrf = enforceCsrf(req, actor);
  if (csrf) return noStore(csrf);

  const parsed = parse(createTokenSchema, await readJson(req));
  if (!parsed.ok) return noStore(badRequest(parsed.error, parsed.fieldErrors));

  try {
    const result = await createToken({
      actor,
      name: parsed.data.name,
      principal: parsed.data.principal,
      scopes: parsed.data.scopes,
      environmentIds: parsed.data.environmentIds ?? null,
      expiresInDays: parsed.data.expiresInDays,
      context: contextOf(req),
    });
    if (!result.ok) return noStore(forbidden(result.error));

    // The plaintext is in the body on purpose and ONLY here. The response is
    // no-store so a proxy or CDN cannot retain it.
    return noStore(
      created({
        token: result.token,
        plaintext: result.plaintext,
        warning: "Save this token now. The control plane stores only its hash and cannot show it again.",
      }),
    );
  } catch {
    return noStore(serverError());
  }
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
