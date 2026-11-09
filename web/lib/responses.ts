// JSON response helpers used by every route handler.
//
// The error shape is the one SPECS.md § 7 commits to:
//
//   { "error": "human sentence", "code": "optional_machine_code",
//     "fieldErrors": { "field": ["message"] } }
//
// Routes should never assemble these shapes by hand — `jsonOk`, `badRequest`,
// `forbidden`, `notFound`, etc. keep the contract consistent and keep the
// bodies out of the route handlers.

import { NextResponse } from "next/server";

export type ErrorBody = {
  error: string;
  code?: string;
  fieldErrors?: Record<string, string[]>;
};

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(error: string, fieldErrors?: Record<string, string[]>): NextResponse {
  const body: ErrorBody = { error };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) body.fieldErrors = fieldErrors;
  return NextResponse.json(body, { status: 400 });
}

export function unauthorized(error = "Authentication required."): NextResponse {
  return NextResponse.json({ error } satisfies ErrorBody, { status: 401 });
}

export function forbidden(error: string, code?: string): NextResponse {
  const body: ErrorBody = { error };
  if (code) body.code = code;
  return NextResponse.json(body, { status: 403 });
}

export function notFound(error = "Not found."): NextResponse {
  return NextResponse.json({ error } satisfies ErrorBody, { status: 404 });
}

export function conflict(error: string, code?: string): NextResponse {
  const body: ErrorBody = { error };
  if (code) body.code = code;
  return NextResponse.json(body, { status: 409 });
}

export function tooManyRequests(retryAfterSeconds: number, error = "Too many requests."): NextResponse {
  return NextResponse.json({ error } satisfies ErrorBody, {
    status: 429,
    headers: { "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

export function serverError(error = "Internal server error."): NextResponse {
  return NextResponse.json({ error } satisfies ErrorBody, { status: 500 });
}

/**
 * Mark a response as `no-store` end-to-end. Used by /reveal and /bundle so a
 * forward proxy, browser cache or dev-server middleware cannot retain the
 * plaintext in memory. next.config.mjs sets the same header via the headers()
 * block — this is defence-in-depth so a direct handler-authored response is
 * also safe without the config pass.
 */
export function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  return response;
}
