"use client";

// Tiny client helper: pull the sop_csrf cookie value and return it. The
// cookie is set non-HttpOnly by the login route specifically so the client
// can echo it in the x-sop-csrf header on every mutation (double-submit
// CSRF). Server-side enforcement lives in web/lib/http.ts::enforceCsrf.

export const CSRF_HEADER = "x-sop-csrf";

export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sop_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : "";
}

export function withCsrf(headers: HeadersInit = {}): HeadersInit {
  const t = csrfToken();
  return t ? { ...headers, [CSRF_HEADER]: t } : headers;
}
