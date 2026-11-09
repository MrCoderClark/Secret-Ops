"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Global command palette. ⌘K / Ctrl+K from anywhere opens it; typing
// queries /api/search debounced; results are three sections (secrets,
// paths, actors). Arrow keys navigate a flat ordered list under the hood,
// Enter jumps, Escape closes.
//
// Mounted once inside the authenticated shell so the overlay reaches
// every page without each page having to render it.

type Hit = {
  kind: "secret" | "path" | "actor";
  id: string;
  label: string;        // primary text
  meta?: string;        // secondary
  href: string;         // where Enter navigates
};

type SearchResponse = {
  secrets: Array<{ id: string; path: string; key: string; environmentId: string; fingerprint: string | null }>;
  paths:   Array<{ path: string; count: number }>;
  actors:  Array<{ id: string; name: string; email: string }>;
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K opens the palette. Also Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (!q.trim()) { setHits([]); return; }
    let alive = true;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`);
        if (!alive) return;
        if (!res.ok) { setHits([]); return; }
        const data = await res.json() as SearchResponse;
        const flat: Hit[] = [
          ...data.secrets.map((s) => ({
            kind: "secret" as const,
            id: `secret-${s.id}`,
            label: `${s.path}/${s.key}`,
            meta: s.fingerprint ?? "",
            href: `/secrets?env=${s.environmentId}`,
          })),
          ...data.paths.map((p) => ({
            kind: "path" as const,
            id: `path-${p.path}`,
            label: p.path,
            meta: `${p.count} match${p.count === 1 ? "" : "es"}`,
            href: `/secrets?q=${encodeURIComponent(p.path)}`,
          })),
          ...data.actors.map((a) => ({
            kind: "actor" as const,
            id: `actor-${a.id}`,
            label: a.name,
            meta: a.email,
            href: `/audit?actor=${encodeURIComponent(a.email)}`,
          })),
        ];
        setHits(flat);
        setCursor(0);
      } finally { if (alive) setLoading(false); }
    }, 180);
    return () => { alive = false; clearTimeout(id); };
  }, [q, open]);

  const jump = useCallback((hit: Hit) => {
    setOpen(false);
    setQ("");
    router.push(hit.href);
  }, [router]);

  const onKeyInside = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hits[cursor]) jump(hits[cursor]); }
  }, [hits, cursor, jump]);

  const grouped = useMemo(() => ({
    secret: hits.filter((h) => h.kind === "secret"),
    path:   hits.filter((h) => h.kind === "path"),
    actor:  hits.filter((h) => h.kind === "actor"),
  }), [hits]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="absolute inset-0 bg-abyss/80 backdrop-blur-sm" aria-hidden="true" />
      <div className="relative w-full max-w-xl rounded-lg bg-raised border border-line shadow-card overflow-hidden flex flex-col max-h-[65vh]">
        <div className="h-11 bg-inset border-b border-line flex items-center px-3 gap-2">
          <span className="font-mono text-accent font-semibold">/</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyInside}
            placeholder="search secrets, paths, people..."
            className="flex-1 bg-transparent outline-none text-[13px] text-ink placeholder:text-ink-faint"
          />
          <span className="font-mono text-[11px] text-ink-faint border border-line rounded px-1.5 py-0.5">esc</span>
        </div>

        <div className="overflow-y-auto">
          {q.trim() === "" ? (
            <EmptyState />
          ) : hits.length === 0 ? (
            <p className="px-5 py-8 text-center font-mono text-xs text-ink-faint">
              {loading ? "searching..." : "no matches"}
            </p>
          ) : (
            <>
              {grouped.secret.length > 0 && <Section label="Secrets" items={grouped.secret} hits={hits} cursor={cursor} setCursor={setCursor} onJump={jump} />}
              {grouped.path.length   > 0 && <Section label="Paths"   items={grouped.path}   hits={hits} cursor={cursor} setCursor={setCursor} onJump={jump} />}
              {grouped.actor.length  > 0 && <Section label="People"  items={grouped.actor}  hits={hits} cursor={cursor} setCursor={setCursor} onJump={jump} />}
            </>
          )}
        </div>

        <div className="h-8 border-t border-line flex items-center justify-between px-4 font-mono text-[10px] text-ink-faint shrink-0">
          <span>↑↓ navigate · ↵ open · esc close</span>
          {loading && <span>searching...</span>}
        </div>
      </div>
    </div>
  );
}

function Section({ label, items, hits, cursor, setCursor, onJump }: {
  label: string;
  items: Hit[];
  hits: Hit[];
  cursor: number;
  setCursor: (n: number) => void;
  onJump: (hit: Hit) => void;
}) {
  return (
    <div>
      <div className="px-4 pt-3 pb-1 label-eyebrow">{label}</div>
      <ul>
        {items.map((h) => {
          const idx = hits.indexOf(h);
          const active = cursor === idx;
          return (
            <li
              key={h.id}
              onMouseEnter={() => setCursor(idx)}
              onMouseDown={(e) => { e.preventDefault(); onJump(h); }}
              className={`px-4 py-2 flex items-center gap-3 cursor-pointer transition ${active ? "bg-accent/[0.08] shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-white/[0.02]"}`}
            >
              <span className="font-mono text-[13px] text-ink truncate">{h.label}</span>
              {h.meta && <span className="font-mono text-[11px] text-ink-faint ml-auto shrink-0">{h.meta}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-5 py-8 flex flex-col gap-2">
      <p className="font-mono text-[11px] text-ink-faint">try:</p>
      <ul className="font-mono text-[12px] text-ink-dim space-y-1">
        <li>&middot; a key name like <span className="text-ink">DATABASE_URL</span></li>
        <li>&middot; a path like <span className="text-ink">stripe</span></li>
        <li>&middot; a person like <span className="text-ink">owner</span></li>
      </ul>
    </div>
  );
}
