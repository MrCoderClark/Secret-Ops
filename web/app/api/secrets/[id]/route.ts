// /api/secrets/:id
//
//   GET    — version history (no plaintext).
//   PATCH  — metadata-only update (description, valueType, rotationPolicyId).
//   DELETE — soft delete (sets deletedAt; versions survive).

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { deleteSecret, getSecretHistory, updateSecret } from "@/lib/secrets";
import { parse, updateSecretSchema } from "@/lib/validation";
import { badRequest, forbidden, jsonOk, noContent, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const result = await getSecretHistory({ actor, secretId: params.id });
  if (!result.ok) {
    return result.code === "forbidden" ? forbidden(result.error) : notFound(result.error);
  }
  return jsonOk({ secret: result.secret, versions: result.versions });
}

export async function PATCH(req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const body = await readJson(req);
  const parsed = parse(updateSecretSchema, body);
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  try {
    const result = await updateSecret({
      actor,
      secretId: params.id,
      description: parsed.data.description,
      valueType: parsed.data.valueType,
      rotationPolicyId: parsed.data.rotationPolicyId ?? undefined,
      context: contextOf(req),
    });
    if (!result.ok) {
      return result.code === "forbidden" ? forbidden(result.error) : notFound(result.error);
    }
    return jsonOk({ secret: result.secret });
  } catch {
    return serverError();
  }
}

export async function DELETE(req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  try {
    const result = await deleteSecret({ actor, secretId: params.id, context: contextOf(req) });
    if (!result.ok) {
      return result.code === "forbidden" ? forbidden(result.error) : notFound(result.error);
    }
    return noContent();
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
