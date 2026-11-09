"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { withCsrf } from "@/lib/csrf-client";

// Buttons for the Sync detail panel: Dry-run (safe, creates a SyncRun row
// with dryRun=true) and Apply. Apply opens a confirm dialog before firing
// because it writes to external runtimes.

export interface RunButtonsProps {
  targetId: string;
  targetLabel: string;
  pullMode: boolean;
}

export function RunButtons({ targetId, targetLabel, pullMode }: RunButtonsProps) {
  const router = useRouter();
  const [confirmApply, setConfirmApply] = useState(false);
  const [busy, setBusy] = useState<"" | "dry" | "apply">("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "apply"); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/sync/${targetId}/run`, {
        method: "POST",
        headers: withCsrf({ "content-type": "application/json" }),
        body: JSON.stringify({ dryRun }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(`${body.status} · pushed ${body.pushed} · skipped ${body.skipped}`);
        router.refresh();
      } else if (res.status === 207) {
        setResult(`partial · ${body.error}`);
        router.refresh();
      } else {
        setError(body.error ?? `run failed (${res.status})`);
      }
    } catch {
      setError("network error");
    } finally {
      setBusy("");
      setConfirmApply(false);
    }
  }

  if (pullMode) {
    return (
      <p className="font-mono text-[11px] text-ink-faint">
        pull-mode target · agent fetches /bundle on its own schedule
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => run(true)} disabled={!!busy}>
        {busy === "dry" ? "Running..." : "Dry run"}
      </Button>
      <Button variant="primary" onClick={() => setConfirmApply(true)} disabled={!!busy}>
        {busy === "apply" ? "Applying..." : "Apply"}
      </Button>
      {result && <span className="font-mono text-[11px] text-signal">{result}</span>}
      {error  && <span className="font-mono text-[11px] text-stop">{error}</span>}

      <Dialog
        open={confirmApply}
        onClose={() => !busy && setConfirmApply(false)}
        size="md"
        title="Apply sync"
        subtitle={targetLabel}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmApply(false)} disabled={!!busy}>Cancel</Button>
            <Button variant="primary" onClick={() => run(false)} disabled={!!busy}>
              {busy === "apply" ? "Applying..." : "Apply now"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-dim">
          Push every head version to this target through its adapter. Current adapters are stubs that
          decrypt-prove and report success; swapping in a real provider SDK is a scoped change later.
        </p>
      </Dialog>
    </div>
  );
}
