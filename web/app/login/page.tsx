"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Sign-in surface. Minimal, graphite, mono-accented -- same visual world as
// the dashboard it unlocks. Posts to /api/auth/login; the server sets the
// session + CSRF cookies and we push to ?next= or /overview.

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
    <div className="min-h-screen bg-slab flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg bg-raised border border-line p-8">
        <div className="flex items-center gap-2.5 mb-8">
          <span className="w-[22px] h-[22px] grid place-items-center bg-accent text-abyss rounded font-mono font-bold text-[13px]">S</span>
          <span className="font-mono font-semibold text-[15px] tracking-tight">SecretOps</span>
        </div>
        <h1 className="font-mono text-xl font-medium mb-1 tracking-tight">Sign in</h1>
        <p className="text-sm text-ink-dim mb-6">Use your work email and password.</p>

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

        <p className="mt-6 text-[11px] text-ink-faint font-mono">
          demo credentials in README. <span className="text-ink-dim">owner@acme.test</span> for full access.
        </p>
      </div>
    </div>
  );
}
