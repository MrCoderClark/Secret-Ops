"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { withCsrf } from "@/lib/csrf-client";

// Approve or deny a pending access request. Approval optionally takes a
// note (visible on the request and in the audit event). PATCH on the
// service layer creates a time-boxed Grant atomically on APPROVE.

export interface DecideDialogProps {
  open: boolean;
  onClose: () => void;
  requestId: string;
  summary: string;        // "dev@acme.test wants READ on payments-api/prod for 60m"
  initialDecision: "APPROVE" | "DENY";
}

export function DecideDialog({ open, onClose, requestId, summary, initialDecision }: DecideDialogProps) {
  const router = useRouter();
  const [decision, setDecision] = useState(initialDecision);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/access/requests/${requestId}`, {
        method: "PATCH",
        headers: withCsrf({ "content-type": "application/json" }),
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "decide failed" }));
        setError(body.error ?? `decide failed (${res.status})`); return;
      }
      onClose();
      router.refresh();
    } catch { setError("network error"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      size="md"
      title={decision === "APPROVE" ? "Approve request" : "Deny request"}
      subtitle={summary}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={decision === "APPROVE" ? "primary" : "danger"}
            onClick={submit}
            disabled={busy}
          >
            {busy ? "Submitting..." : decision === "APPROVE" ? "Approve + grant" : "Deny"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setDecision("APPROVE")}
            className={`px-3 py-2 rounded border font-mono text-[12px] transition ${decision === "APPROVE" ? "border-signal/50 bg-signal/10 text-signal" : "border-line bg-inset text-ink-dim hover:border-line-strong"}`}
          >
            APPROVE
          </button>
          <button
            type="button"
            onClick={() => setDecision("DENY")}
            className={`px-3 py-2 rounded border font-mono text-[12px] transition ${decision === "DENY" ? "border-stop/50 bg-stop/10 text-stop" : "border-line bg-inset text-ink-dim hover:border-line-strong"}`}
          >
            DENY
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="label-eyebrow">Note (optional)</span>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            rows={3} maxLength={2000}
            placeholder={decision === "APPROVE" ? "e.g. close out when done" : "reason for refusal"}
            className="rounded-md bg-inset border border-line px-3 py-2 text-sm text-ink outline-none focus:border-accent-dim transition resize-none font-sans"
          />
        </label>
        {decision === "APPROVE" && (
          <p className="font-mono text-[11px] text-ink-faint">
            Approving materialises a Grant that expires on its own after the request&apos;s durationMinutes.
          </p>
        )}
        {error && <div className="rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>}
      </div>
    </Dialog>
  );
}
