// GET /api/health — unauthenticated liveness/readiness probe.
//
// Reports whether Postgres is reachable. Returns 200 when green so the Docker
// HEALTHCHECK and the dashboard header pill both agree, and 503 when degraded
// so the load balancer can take this replica out of rotation.

import { db } from "@/lib/db";
import { jsonOk } from "@/lib/responses";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = {
    ok: dbOk,
    db: dbOk,
    time: new Date().toISOString(),
  };
  if (!dbOk) {
    return NextResponse.json({ ...body, error: "Database unreachable." }, { status: 503 });
  }
  return jsonOk(body);
}
