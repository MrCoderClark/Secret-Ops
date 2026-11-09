"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { RevealDialog } from "./RevealDialog";
import { withCsrf } from "@/lib/csrf-client";

export interface RowActionsProps {
  secretId: string;
  label: string;        // "payments-api/prod · stripe/STRIPE_SECRET_KEY"
  canReadValue: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export function RowActions({ secretId, label, canReadValue, canWrite, canDelete }: RowActionsProps) {
  const router = useRouter();
  const [reveal, setReveal] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [del, setDel]       = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRotate() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/secrets/${secretId}/rotate`, {
        method: "POST",
        headers: withCsrf({ "content-type": "application/json" }),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "rotate failed" }));
        setError(body.error ?? `rotate failed (${res.status})`);
        return;
      }
      setRotate(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function doDelete() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/secrets/${secretId}`, {
        method: "DELETE",
        headers: withCsrf({}),
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ error: "delete failed" }));
        setError(body.error ?? `delete failed (${res.status})`);
        return;
      }
      setDel(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canReadValue && (
        <button onClick={() => setReveal(true)} className="text-xs px-2 py-1 rounded text-ink-dim hover:text-accent hover:bg-inset transition" title="reveal">
          reveal
        </button>
      )}
      {canWrite && (
        <button onClick={() => setRotate(true)} className="text-xs px-2 py-1 rounded text-ink-dim hover:text-ink hover:bg-inset transition" title="rotate">
          rotate
        </button>
      )}
      {canDelete && (
        <button onClick={() => setDel(true)} className="text-xs px-2 py-1 rounded text-ink-dim hover:text-stop hover:bg-inset transition" title="delete">
          delete
        </button>
      )}

      <RevealDialog open={reveal} onClose={() => setReveal(false)} secretId={secretId} label={label} />

      <Dialog
        open={rotate}
        onClose={() => !busy && setRotate(false)}
        size="md"
        title="Rotate secret"
        subtitle={label}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRotate(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={doRotate} disabled={busy}>
              {busy ? "Rotating..." : "Rotate now"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-dim">
          Generate a new value using this secret&apos;s rotation policy and append it as the next version. The
          current version stays in history and can still be read by audit tools.
        </p>
        {error && <div className="mt-3 rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>}
      </Dialog>

      <Dialog
        open={del}
        onClose={() => !busy && setDel(false)}
        size="md"
        title="Delete secret"
        subtitle={label}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDel(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={doDelete} disabled={busy}>
              {busy ? "Deleting..." : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-dim">
          Soft-delete this secret. Historical versions survive so audit references still resolve, but new
          reads and syncs will refuse it.
        </p>
        {error && <div className="mt-3 rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>}
      </Dialog>
    </div>
  );
}
