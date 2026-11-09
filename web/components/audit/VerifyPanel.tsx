"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChainStrip, type ChainNode } from "@/components/ui/ChainStrip";
import { withCsrf } from "@/lib/csrf-client";

// Wraps <ChainStrip> with a wired Re-verify button that calls
// POST /api/audit/verify. On success we refresh the server page so the
// node list + verdict update from a fresh db read, not a stale snapshot.

export interface VerifyPanelProps {
  initial: {
    nodes: ChainNode[];
    verified: boolean;
    firstFailureSeq: number | null;
    reason?: string;
  };
}

export function VerifyPanel({ initial }: VerifyPanelProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function reverify() {
    setError(null);
    try {
      const res = await fetch("/api/audit/verify", {
        method: "POST",
        headers: withCsrf({ "content-type": "application/json" }),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "verify failed" }));
        setError(body.error ?? `verify failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("network error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ChainStrip
        nodes={initial.nodes}
        verified={initial.verified}
        firstFailureSeq={initial.firstFailureSeq}
        reason={initial.reason}
        onVerify={reverify}
      />
      {error && (
        <div className="rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>
      )}
    </div>
  );
}
