"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Sign-in form. Minimal, graphite, mono-accented -- same visual world as
// the dashboard it unlocks. Posts to /api/auth/login; the server sets the
// session + CSRF cookies and we push to ?next= or /overview.
//
// Lives inside a Suspense boundary in page.tsx because useSearchParams
// forces client-side rendering in Next 14; without the boundary, `next
// build` fails to prerender the shell around this component.

export function LoginForm() {
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
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <label className="flex flex-col gap-1">
        <span className="label-eyebrow">Email</span>
        <input
          type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="rounded-md bg-inset border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim transition"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label-eyebrow">Password</span>
        <input
          type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="rounded-md bg-inset border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim transition"
        />
      </label>

      {error && (
        <div className="rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !email || !password}
        className="w-full rounded-md bg-accent text-abyss font-medium text-sm py-2.5 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-accent"
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
