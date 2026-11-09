"use client";

import { useEffect, useRef, useState } from "react";

// Top strip for the authenticated shell.
//
// Search has a leading "/" prompt character (accent chartreuse -- its second
// of four uses) so the input reads as a command prompt, not a web form.
// ⌘K focuses the input from anywhere.
//
// Health chip shows the last probe's round-trip ms so it reads as live
// instrumentation, not a static "OK" badge. Polls /api/health every 30s.

type State = "unknown" | "healthy" | "degraded";

export function Header() {
  const [state, setState] = useState<State>("unknown");
  const [latency, setLatency] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      const start = performance.now();
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const ms = Math.round(performance.now() - start);
        if (!alive) return;
        if (r.ok) {
          const body = await r.json().catch(() => ({ db: false }));
          setState(body.db ? "healthy" : "degraded");
        } else {
          setState("degraded");
        }
        setLatency(ms);
      } catch {
        if (alive) { setState("degraded"); setLatency(null); }
      }
    };
    probe();
    const id = setInterval(probe, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // ⌘K/Ctrl+K is now owned by the global CommandPalette (mounted in the
  // authenticated shell). The header's input stays as a visual anchor; a
  // focus click or typing into it still works. Removing the local listener
  // means both shortcuts don't fire against the same keypress.

  return (
    <header className="h-14 shrink-0 bg-slab border-b border-line flex items-center gap-4 px-6">
      <div className="flex-1 relative max-w-2xl">
        <div className="h-9 bg-inset border border-line rounded-md flex items-center px-3 gap-2 focus-within:border-accent-dim transition-colors">
          <span className="font-mono text-accent font-semibold">/</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search secrets, paths, principals..."
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-ink-faint"
          />
          <span className="font-mono text-[11px] text-ink-faint border border-line rounded px-1.5 py-0.5">⌘K</span>
        </div>
      </div>
      <HealthChip state={state} latency={latency} />
    </header>
  );
}

function HealthChip({ state, latency }: { state: State; latency: number | null }) {
  const dot =
    state === "healthy"  ? "bg-signal shadow-[0_0_8px_rgba(79,196,140,.7)]" :
    state === "degraded" ? "bg-alert  shadow-[0_0_8px_rgba(232,169,64,.7)]" :
                           "bg-ink-faint";
  const label = state === "healthy" ? "HEALTHY" : state === "degraded" ? "DEGRADED" : "CHECKING";
  return (
    <span className="inline-flex items-center gap-2 px-2.5 py-1.5 bg-raised border border-line rounded-md font-mono text-[11px] text-ink-dim">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span className="text-ink font-medium">{label}</span>
      {latency !== null && <span>&middot; {latency}ms</span>}
    </span>
  );
}
