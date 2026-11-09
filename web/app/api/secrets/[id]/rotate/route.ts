// POST /api/secrets/:id/rotate
//
// Body (all optional):
//   { generator?: "base64:32" | "hex:32" | "alnum:64" | "uuid",
//     value?: string,       // manual rotation — bypass generation
//     reason?: string }
//
// Service layer uses the attached RotationPolicy.generator when neither is
// supplied. Writes a RotationEvent + secret.rotate audit.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { rotateSecret } from "@/lib/secrets";
import { conflict, forbidden, jsonOk, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const body = (await readJson(req)) as { generator?: unknown; value?: unknown; reason?: unknown } | null;
  const generator = typeof body?.generator === "string" ? body.generator : undefined;
  const value = typeof body?.value === "string" ? body.value : undefined;
  const reason = typeof body?.reason === "string" ? body.reason : undefined;

  try {
    const result = await rotateSecret({
      actor,
      secretId: params.id,
      generator,
      value,
      reason,
      context: contextOf(req),
    });
    if (!result.ok) {
      switch (result.code) {
        case "forbidden":
          return forbidden(result.error);
        case "not_found":
          return notFound(result.error);
        case "policy_violation":
          return conflict(result.error, "policy_violation");
      }
    }
    return jsonOk({
      secret: { id: result.secret.id, path: result.secret.path, key: result.secret.key },
      version: {
        version: result.version.version,
        fingerprint: result.version.fingerprint,
        valueHash: result.version.valueHash,
        createdAt: result.version.createdAt,
      },
      generator: result.generator,
    });
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
