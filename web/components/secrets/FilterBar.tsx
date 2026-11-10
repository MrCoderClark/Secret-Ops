"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Filter controls for /secrets. Pushes URL query params so the server
// component re-renders. Text query is debounced (300ms) to keep typing
// cheap; select changes are pushed immediately.

export interface FilterBarProps {
  projects: Array<{ id: string; slug: string; name: string }>;
  environments: Array<{ id: string; slug: string; projectSlug: string }>;
}

export function FilterBar({ projects, environments }: FilterBarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  const project = params.get("project") ?? "";
  const env     = params.get("env") ?? "";

  useEffect(() => {
    const id = setTimeout(() => push({ q }), 300);
    return () => clearTimeout(id);
    // `push` reads `params` via closure and gets a fresh reference each
    // render; adding it to deps would retrigger the debounce on every
    // keystroke's re-render, defeating the point. The effect only needs
    // to run when the user's typed text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function push(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k); else next.set(k, v);
    }
    router.push(`/secrets${next.toString() ? "?" + next.toString() : ""}`);
  }

  const envsForProject = project
    ? environments.filter((e) => e.projectSlug === projects.find((p) => p.id === project)?.slug)
    : environments;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="h-9 bg-inset border border-line rounded-md flex items-center px-3 gap-2 focus-within:border-accent-dim transition flex-1 min-w-[240px]">
        <span className="font-mono text-accent font-semibold">/</span>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter by path or key..."
          className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-ink-faint"
        />
      </div>
      <select
        value={project}
        onChange={(e) => push({ project: e.target.value || null, env: null })}
        className="h-9 bg-inset border border-line rounded-md px-2.5 text-[13px] text-ink outline-none focus:border-accent-dim transition"
      >
        <option value="">all projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select
        value={env}
        onChange={(e) => push({ env: e.target.value || null })}
        className="h-9 bg-inset border border-line rounded-md px-2.5 text-[13px] text-ink outline-none focus:border-accent-dim transition"
      >
        <option value="">all environments</option>
        {envsForProject.map((e) => (
          <option key={e.id} value={e.id}>{e.projectSlug} · {e.slug}</option>
        ))}
      </select>
      {(q || project || env) && (
        <button
          onClick={() => { setQ(""); push({ q: null, project: null, env: null }); }}
          className="h-9 px-3 text-xs text-ink-dim hover:text-ink border border-line rounded-md hover:border-line-strong transition"
        >
          clear
        </button>
      )}
    </div>
  );
}
