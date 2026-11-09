// POST /api/sync/:id/run — apply the plan through the adapter.
//
// Body: { dryRun?: boolean }. Default false. Dry-run still creates a
// SyncRun row (with secretsPushed=0) so the Runs list shows the attempt.
// Pull-mode targets refuse this endpoint — their agents fetch /bundle
// on a schedule instead.

import { type NextRequest, NextResponse } from "next/server";
import { resolveActor } from "@/lib/session";
import { runSync } from "@/lib/sync";
import { parse, runSyncSchema } from "@/lib/validation";
import { badRequest, conflict, forbidden, jsonOk, notFound, serverError, unauthorized } from "@/lib/responses";
import { contextOf, enforceCsrf } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const actor = await resolveActor({ headers: req.headers, cookies: req.cookies });
  if (!actor) return unauthorized();
  const csrf = enforceCsrf(req, actor);
  if (csrf) return csrf;

  const parsed = parse(runSyncSchema, (await readJson(req)) ?? {});
  if (!parsed.ok) return badRequest(parsed.error, parsed.fieldErrors);

  try {
    const result = await runSync({
      actor,
      syncTargetId: params.id,
      dryRun: parsed.data.dryRun,
      context: contextOf(req),
    });
    if (!result.ok) {
      switch (result.code) {
        case "forbidden":
          return forbidden(result.error);
        case "not_found":
          return notFound(result.error);
        case "pull_mode":
          return conflict(result.error, "pull_mode");
        case "adapter_error":
          return jsonOk(
            {
              status: "FAILED",
              error: result.error,
              run: result.run
                ? {
                    id: result.run.id,
                    status: result.run.status,
                    secretsPushed: result.run.secretsPushed,
                    secretsSkipped: result.run.secretsSkipped,
                    error: result.run.error,
                  }
                : null,
            },
            { status: 207 }, // multi-status: some items succeeded, some did not
          );
      }
    }
    return jsonOk({
      status: result.dryRun ? "DRY_RUN" : "SYNCED",
      pushed: result.pushed,
      skipped: result.skipped,
      run: {
        id: result.run.id,
        status: result.run.status,
        startedAt: result.run.startedAt,
        finishedAt: result.run.finishedAt,
      },
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
