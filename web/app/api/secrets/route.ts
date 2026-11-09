// /api/secrets
//
//   GET  — list metadata (never values). Query: env, project, q, limit, cursor.
//   POST — create or append a version. Idempotent on valueHash.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { listSecrets, putSecret } from "@/lib/secrets";
import { createSecretSchema, listSecretsSchema, parse } from "@/lib/validation";
import { badRequest, conflict, created, forbidden, jsonOk, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();

  const url = new URL(req.url);
  const parsed = parse(listSecretsSchema, {
    env: url.searchParams.get("env") ?? undefined,
    project: url.searchParams.get("project") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  const rows = await listSecrets({
    actor,
    environmentId: parsed.data.env,
    projectId: parsed.data.project,
    query: parsed.data.q,
    limit: parsed.data.limit,
    cursor: parsed.data.cursor,
  });
  return jsonOk({ secrets: rows });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const body = await readJson(req);
  const parsed = parse(createSecretSchema, body);
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  try {
    const result = await putSecret({
      actor,
      environmentId: parsed.data.environmentId,
      path: parsed.data.path,
      key: parsed.data.key,
      value: parsed.data.value,
      valueType: parsed.data.valueType,
      description: parsed.data.description ?? null,
      rotationPolicyId: parsed.data.rotationPolicyId ?? null,
      context: contextOf(req),
    });
    if (!result.ok) {
      switch (result.code) {
        case "forbidden":
          return forbidden(result.error);
        case "environment_not_found":
          return notFound(result.error);
        case "policy_violation":
          return conflict(result.error, "policy_violation");
        case "approval_required":
          return forbidden(result.error, "approval_required");
      }
    }
    return created({
      secret: shapeSecret(result.secret, result.version.version, result.version.fingerprint),
      version: {
        version: result.version.version,
        fingerprint: result.version.fingerprint,
        valueHash: result.version.valueHash,
        createdAt: result.version.createdAt,
      },
      created: result.created,
      unchanged: result.unchanged,
    });
  } catch {
    return serverError();
  }
}

function shapeSecret(
  s: { id: string; path: string; key: string; valueType: string; description: string | null; environmentId: string; projectId: string; rotationPolicyId: string | null; createdAt: Date; updatedAt: Date },
  version: number,
  fingerprint: string,
) {
  return {
    id: s.id,
    path: s.path,
    key: s.key,
    valueType: s.valueType,
    description: s.description,
    environmentId: s.environmentId,
    projectId: s.projectId,
    rotationPolicyId: s.rotationPolicyId,
    currentVersion: version,
    fingerprint,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
