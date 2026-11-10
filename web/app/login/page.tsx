import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

// Server shell for /login. The actual form is a client component (it owns
// state + fetch + useSearchParams), wrapped in Suspense so `next build`
// can prerender this chrome around a loading placeholder. Without the
// boundary, useSearchParams at build-time bails the whole prerender,
// which then cascades into the misleading "Html should not be imported"
// error on the auto-generated /404 and /500 pages.

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slab flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg bg-raised border border-line p-8">
        <div className="flex items-center gap-2.5 mb-8">
          <span className="w-[22px] h-[22px] grid place-items-center bg-accent text-abyss rounded font-mono font-bold text-[13px]">S</span>
          <span className="font-mono font-semibold text-[15px] tracking-tight">SecretOps</span>
        </div>
        <h1 className="font-mono text-xl font-medium mb-1 tracking-tight">Sign in</h1>
        <p className="text-sm text-ink-dim mb-6">Use your work email and password.</p>

        <Suspense fallback={<div className="h-48 flex items-center justify-center font-mono text-xs text-ink-faint">loading form…</div>}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-[11px] text-ink-faint font-mono">
          demo credentials in README. <span className="text-ink-dim">owner@acme.test</span> for full access.
        </p>
      </div>
    </div>
  );
}
