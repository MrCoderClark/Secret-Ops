"use client";

import { useState } from "react";

// The signature element of the dashboard.
//
// Each AccessEvent in the chain is a node: a dot linked to the next by a
// hairline. On a clean chain every dot is phosphor green. A DENIED event
// renders amber (still part of the chain -- an expected outcome). A
// chain break renders red at the break and greys out every node after it
// -- the forensic signal verifyChain() produces, rendered as UI so an
// operator sees where tampering starts at a glance.
//
// Hovering a node reveals its hash prefix. Clicking the Re-verify button
// pulses the whole strip in sequence; the actual re-run is the caller's
// `onVerify` handler (hits /api/audit/verify).

export type ChainNode = {
  seq: number;
  hash: string;
  status: "SUCCESS" | "DENIED" | "ERROR";
};

export interface ChainStripProps {
  nodes: ChainNode[];
  verified: boolean;
  firstFailureSeq?: number | null;
  reason?: string;
  onVerify?: () => void | Promise<void>;
}

export function ChainStrip({ nodes, verified, firstFailureSeq = null, reason, onVerify }: ChainStripProps) {
  const [pulsing, setPulsing] = useState(false);

  async function handleVerify() {
    if (pulsing) return;
    setPulsing(true);
    try {
      await onVerify?.();
    } finally {
      // Stagger window: nodes.length * 60ms + a little slack so the visual
      // settles even if the request returned instantly.
      setTimeout(() => setPulsing(false), nodes.length * 60 + 300);
    }
  }

  const verdictColor = verified ? "text-signal" : "text-stop";
  const verdictLed   = verified
    ? "bg-signal shadow-[0_0_10px_rgba(79,196,140,.8)]"
    : "bg-stop shadow-[0_0_10px_rgba(229,83,83,.8)]";
  const verdictText = verified
    ? `chain intact through seq ${nodes.length > 0 ? nodes[nodes.length - 1]!.seq : 0}`
    : `broken at seq ${firstFailureSeq ?? "?"}${reason ? ` -- ${reason}` : ""}`;

  return (
    <section className="rounded-lg bg-raised border border-line px-5 pt-4 pb-5" aria-label="Audit chain">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-mono text-[13px] font-medium text-ink">Audit chain</h2>
          <span className="font-mono text-[11px] text-ink-faint">
            {nodes.length} events · SHA-256 linked
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-flex items-center gap-2 font-mono text-xs ${verdictColor}`}>
            <span className={`w-[7px] h-[7px] rounded-full ${verdictLed}`} />
            {verdictText}
          </span>
          <button
            type="button"
            onClick={handleVerify}
            disabled={pulsing}
            className="font-sans text-xs px-2.5 py-1 rounded border border-line-strong text-ink hover:border-accent-dim hover:text-accent transition disabled:opacity-60"
          >
            {pulsing ? "Verifying..." : "Re-verify"}
          </button>
        </div>
      </div>

      <div className="relative flex items-center overflow-x-auto py-4">
        {nodes.length === 0 ? (
          <p className="text-ink-faint text-xs font-mono">No audit events yet.</p>
        ) : (
          nodes.map((n, i) => {
            const brokenHere = !verified && firstFailureSeq !== null && n.seq === firstFailureSeq;
            const faded     = !verified && firstFailureSeq !== null && n.seq >  firstFailureSeq;
            const dotTone =
              brokenHere          ? "bg-stop shadow-[0_0_8px_rgba(229,83,83,.6)]" :
              faded               ? "bg-ink-faint" :
              n.status === "DENIED" ? "bg-alert shadow-[0_0_8px_rgba(232,169,64,.6)]" :
                                       "bg-signal shadow-[0_0_8px_rgba(79,196,140,.6)]";
            const connectorTone = faded ? "bg-line-strong" : "bg-signal-dim";
            return (
              <div key={n.seq} className="relative flex-none flex flex-col items-center min-w-[54px] group">
                {i > 0 && (
                  <span className={`absolute left-[-50%] top-[11px] w-full h-px ${connectorTone}`} />
                )}
                <span
                  className={`w-3.5 h-3.5 rounded-full relative z-10 transition-transform ${dotTone} ${pulsing ? "animate-pulse" : "group-hover:scale-125"}`}
                  style={pulsing ? { animationDelay: `${i * 60}ms`, animationDuration: "400ms", animationIterationCount: 1 } : undefined}
                  title={`seq ${n.seq} · ${n.status}`}
                />
                <span className="mt-2.5 font-mono text-[10px] text-ink-faint">
                  {String(n.seq).padStart(2, "0")}
                </span>
                <span className="mt-0.5 font-mono text-[9.5px] text-ink-dim opacity-0 group-hover:opacity-100 transition-opacity">
                  {n.hash.slice(0, 4)}...
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-4 mt-1 font-mono text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-signal shadow-[0_0_6px_rgba(79,196,140,.5)]" /> success
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-alert" /> denied (normal)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-stop" /> chain break
        </span>
        <span className="ml-auto">hover a node for its hash prefix</span>
      </div>
    </section>
  );
}
