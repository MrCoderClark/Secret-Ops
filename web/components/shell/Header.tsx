"use client";

import { useEffect, useState } from "react";

// Top bar for the authenticated shell. Two live pieces:
//
//   - Search input (⌘K hint on the right) — command-palette hook lands in
//     phase-5b; this cut just captures the text and the keyboard shortcut
//     so the layout is stable.
//   - Health pill — polls /api/health every 30s. "Healthy" in green when
//     ok=true, "Degraded" in amber on non-200 or db=false.

type Health = "unknown" | "healthy" | "degraded";

export function Header() {
  const [health, setHealth] = useState<Health>("unknown");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!alive) return;
        if (r.ok) {
          const body = await r.json().catch(() => ({ db: false }));
          setHealth(body.db ? "healthy" : "degraded");
        } else {
          setHealth("degraded");
        }
      } catch {
        if (alive) setHealth("degraded");
      }
    };
    probe();
    const id = setInterval(probe, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (document.querySelector<HTMLInputElement>("input[data-shell-search]"))?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="h-16 shrink-0 border-b border-border-subtle bg-surface-raised flex items-center gap-4 px-6">
      <div className="flex-1 relative">
        <span className="absolute inset-y-0 left-3 flex items-center text-fg-muted">
          <SearchGlyph />
        </span>
        <input
          data-shell-search
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search secrets, paths, actors..."
          className="w-full rounded-md bg-surface-sunken border border-border-subtle pl-10 pr-14 py-2 text-sm outline-none focus:border-accent placeholder:text-fg-muted"
        />
        <span className="absolute inset-y-0 right-3 flex items-center text-fg-muted text-[11px] font-medium mono">⌘K</span>
      </div>
      <HealthPill state={health} />
    </header>
  );
}

function HealthPill({ state }: { state: Health }) {
  const label = state === "healthy" ? "Healthy" : state === "degraded" ? "Degraded" : "Checking...";
  const dot =
    state === "healthy"  ? "bg-success" :
    state === "degraded" ? "bg-warn"    : "bg-fg-muted";
  const chip =
    state === "healthy"  ? "bg-success-soft text-success border-success/30" :
    state === "degraded" ? "bg-warn-soft text-warn border-warn/30" :
                           "bg-surface-hover text-fg-secondary border-border-subtle";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${chip}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
