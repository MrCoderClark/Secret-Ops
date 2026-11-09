"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Sign-in surface. Posts email+password to /api/auth/login; on success the
// server sets sop_session + sop_csrf cookies and we push the user to the
// `next` query param (or /overview by default). The password field never
// hits state after submit and the form never persists input across reloads.

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/overview";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Sign in failed." }));
        setError(body.error ?? "Sign in failed.");
        setPassword("");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-base px-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-raised border border-border-subtle shadow-card p-8">
        <div className="flex items-center gap-2 mb-6">
          <LockGlyph />
          <span className="text-lg font-semibold tracking-tight">SecretOps</span>
        </div>
        <h1 className="text-xl font-semibold mb-1">Sign in</h1>
        <p className="text-sm text-fg-muted mb-6">Use your work email and password.</p>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <label className="block">
            <span className="text-xs font-medium text-fg-secondary">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md bg-surface-sunken border border-border-subtle px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg-secondary">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md bg-surface-sunken border border-border-subtle px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          {error && (
            <div className="rounded-md bg-danger-soft border border-danger/40 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full rounded-md bg-accent text-fg-on-accent font-medium py-2 text-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-xs text-fg-muted">
          Seeded demo credentials are in the README. Sign in as{" "}
          <span className="mono">owner@acme.test</span> for full access.
        </p>
      </div>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
