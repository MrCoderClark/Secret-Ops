"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { withCsrf } from "@/lib/csrf-client";

// Mint-once flow. Opens a dialog; on success the server returns plaintext
// in the response body (no-store header) exactly once. We render it with
// a persistent modal so a stray backdrop click does not drop the only
// time the operator will ever see it.

type Scope = "secrets:read" | "secrets:write" | "sync:run" | "sync:configure" | "audit:read";
const ALL_SCOPES: Scope[] = ["secrets:read", "secrets:write", "sync:run", "sync:configure", "audit:read"];

export interface MintDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MintDialog({ open, onClose }: MintDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [principal, setPrincipal] = useState("");
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({
    "secrets:read": true, "secrets:write": false, "sync:run": false, "sync:configure": false, "audit:read": false,
  });
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName(""); setPrincipal(""); setDays(90); setPlaintext(null);
    setError(null); setCopied(false); setBusy(false);
    setScopes({ "secrets:read": true, "secrets:write": false, "sync:run": false, "sync:configure": false, "audit:read": false });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const selected = ALL_SCOPES.filter((s) => scopes[s]);
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: withCsrf({ "content-type": "application/json" }),
        body: JSON.stringify({
          name, principal,
          scopes: selected,
          environmentIds: null,
          expiresInDays: days,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `mint failed (${res.status})`); return; }
      setPlaintext(body.plaintext);
      router.refresh();
    } catch { setError("network error"); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* fall through to select-all */ }
  }

  function closeAndReset() {
    reset();
    onClose();
  }

  if (plaintext) {
    return (
      <Dialog
        open={open}
        onClose={closeAndReset}
        size="md"
        persistent
        title="Token minted"
        subtitle="Save this now — it will not be shown again"
        footer={
          <>
            <Button variant="ghost" onClick={closeAndReset}>Close</Button>
            <Button variant="primary" onClick={copy}>{copied ? "Copied" : "Copy token"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <pre
            className="bg-abyss border border-line rounded-md p-3 font-mono text-[12px] text-ink overflow-x-auto select-all break-all whitespace-pre-wrap"
            tabIndex={0}
          >
            {plaintext}
          </pre>
          <p className="font-mono text-[11px] text-ink-faint">
            The control plane stored only the SHA-256 hash. Paste this token into your CI secrets or agent
            configuration now; there is no recovery route if it is lost.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && closeAndReset()}
      size="md"
      title="Mint API token"
      subtitle="Machine identity for CI, CLI, or pull-mode agents"
      footer={
        <>
          <Button variant="ghost" onClick={closeAndReset} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={(e) => submit(e as unknown as FormEvent)}
            disabled={busy || !name || !principal || !Object.values(scopes).some(Boolean)}
          >
            {busy ? "Minting..." : "Mint token"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">Name</span>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. github-actions"
            className="rounded-md bg-inset border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim transition"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">Principal</span>
          <input
            value={principal} onChange={(e) => setPrincipal(e.target.value)}
            placeholder="e.g. ci/github/acme"
            className="rounded-md bg-inset border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim transition font-mono"
          />
        </label>
        <div>
          <span className="label-eyebrow">Scopes</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {ALL_SCOPES.map((s) => (
              <label key={s} className={`flex items-center gap-2 px-2.5 py-1.5 rounded border cursor-pointer transition ${scopes[s] ? "border-accent-dim bg-accent/[0.05]" : "border-line bg-inset hover:border-line-strong"}`}>
                <input
                  type="checkbox"
                  checked={scopes[s]}
                  onChange={(e) => setScopes({ ...scopes, [s]: e.target.checked })}
                  className="accent-accent"
                />
                <span className="font-mono text-[12px] text-ink">{s}</span>
              </label>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">Expires in (days)</span>
          <input
            type="number" min={1} max={730}
            value={days} onChange={(e) => setDays(Number(e.target.value) || 90)}
            className="rounded-md bg-inset border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim transition font-mono w-32"
          />
        </label>
        {error && <div className="rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>}
      </form>
    </Dialog>
  );
}
