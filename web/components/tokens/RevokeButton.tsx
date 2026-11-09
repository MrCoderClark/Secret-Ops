"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { withCsrf } from "@/lib/csrf-client";

export interface RevokeButtonProps {
  tokenId: string;
  tokenName: string;
  prefix: string;
}

export function RevokeButton({ tokenId, tokenName, prefix }: RevokeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/tokens/${tokenId}`, {
        method: "DELETE",
        headers: withCsrf({}),
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ error: "revoke failed" }));
        setError(body.error ?? `revoke failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs px-2 py-1 rounded text-ink-dim hover:text-stop hover:bg-inset transition">
        revoke
      </button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        size="md"
        title="Revoke token"
        subtitle={`${tokenName} · ${prefix}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={revoke} disabled={busy}>
              {busy ? "Revoking..." : "Revoke"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-dim">
          Immediately refuse new authentications with this token. In-flight requests already past
          auth are not interrupted; the next call fails 401. The hash stays in the database for audit
          traceability and is never re-issuable.
        </p>
        {error && <div className="mt-3 rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>}
      </Dialog>
    </>
  );
}
