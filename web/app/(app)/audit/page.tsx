import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyChain, actionLabel } from "@/lib/audit";
import { VerifyPanel } from "@/components/audit/VerifyPanel";
import type { ChainNode } from "@/components/ui/ChainStrip";

export const dynamic = "force-dynamic";

// /audit -- the two things an auditor opens the page to see:
//   1. Does the chain still verify? (top panel with a live Re-verify button)
//   2. What actually happened recently? (filterable event stream below)
//
// Filters are via URL query params (?action=secret.read&result=DENIED) so
// deep links work and copy-paste of a scoped view travels.

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;

  const action = typeof searchParams.action === "string" ? searchParams.action : undefined;
  const result = typeof searchParams.result === "string" ? searchParams.result : undefined;
  const actor_ = typeof searchParams.actor  === "string" ? searchParams.actor  : undefined;

  const [chain, chainNodes, events] = await Promise.all([
    verifyChain(orgId),
    chainNodesFor(orgId, 20),
    db.accessEvent.findMany({
      where: {
        organizationId: orgId,
        ...(action ? { action } : {}),
        ...(result ? { result } : {}),
        ...(actor_ ? { actorEmail: { contains: actor_, mode: "insensitive" } } : {}),
      },
      orderBy: { seq: "desc" },
      take: 100,
      select: { id: true, seq: true, actorEmail: true, action: true, resourceLabel: true, environmentId: true, result: true, createdAt: true, hash: true, prevHash: true },
    }),
  ]);

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Audit log</h1>
        <p className="font-mono text-[13px] text-ink-dim mt-2.5">
          <span className="text-ink font-medium">{chain.checked}</span> total events ·
          SHA-256 linked, replayable from genesis
        </p>
      </div>

      <VerifyPanel
        initial={{
          nodes: chainNodes,
          verified: chain.ok,
          firstFailureSeq: chain.ok ? null : chain.firstFailureSeq,
          reason: chain.ok ? undefined : chain.reason,
        }}
      />

      <form action="/audit" method="get" className="flex flex-wrap items-center gap-2">
        <input
          type="text" name="actor" defaultValue={actor_ ?? ""}
          placeholder="filter by actor email..."
          className="h-9 flex-1 min-w-[200px] bg-inset border border-line rounded-md px-3 text-[13px] text-ink outline-none focus:border-accent-dim transition placeholder:text-ink-faint"
        />
        <select
          name="action" defaultValue={action ?? ""}
          className="h-9 bg-inset border border-line rounded-md px-2.5 text-[13px] text-ink outline-none focus:border-accent-dim"
        >
          <option value="">all actions</option>
          <option value="auth.login">auth.login</option>
          <option value="auth.failed">auth.failed</option>
          <option value="auth.logout">auth.logout</option>
          <option value="secret.read">secret.read</option>
          <option value="secret.write">secret.write</option>
          <option value="secret.rotate">secret.rotate</option>
          <option value="secret.delete">secret.delete</option>
          <option value="sync.run">sync.run</option>
          <option value="request.create">request.create</option>
          <option value="request.approve">request.approve</option>
          <option value="token.create">token.create</option>
        </select>
        <select
          name="result" defaultValue={result ?? ""}
          className="h-9 bg-inset border border-line rounded-md px-2.5 text-[13px] text-ink outline-none focus:border-accent-dim"
        >
          <option value="">any result</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="DENIED">DENIED</option>
          <option value="ERROR">ERROR</option>
        </select>
        <button type="submit" className="h-9 px-3 bg-inset border border-line rounded-md text-[13px] text-ink hover:border-line-strong transition">
          filter
        </button>
      </form>

      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="px-5 py-3 border-b border-line flex items-center justify-between">
          <h2 className="font-mono text-[13px] font-medium text-ink">Events</h2>
          <span className="font-mono text-[11px] text-ink-faint">{events.length} shown · most recent first</span>
        </header>
        {events.length === 0 ? (
          <p className="px-5 py-12 text-center font-mono text-xs text-ink-faint">no events match</p>
        ) : (
          <ul className="flex flex-col">
            {events.map((e) => (
              <li key={e.id} className="grid grid-cols-[48px_28px_minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-2.5 border-b border-line last:border-b-0 hover:bg-white/[0.015]">
                <span className="font-mono text-[11px] text-ink-faint tabular">#{e.seq}</span>
                <div className="w-6 h-6 rounded-full bg-inset border border-line-strong grid place-items-center text-[9.5px] font-semibold text-ink shrink-0">
                  {initialsFromEmail(e.actorEmail)}
                </div>
                <div className="flex flex-wrap items-baseline gap-1.5 min-w-0 text-[13px]">
                  <span className="font-mono text-ink text-[12px]">{e.actorEmail}</span>
                  <span className="text-ink-dim">{actionLabel(e.action)}</span>
                  {e.resourceLabel && (
                    <span className="font-mono text-[12px] text-ink bg-inset border border-line px-1.5 py-[1px] rounded">
                      {e.resourceLabel}
                    </span>
                  )}
                </div>
                <ResultBadge result={e.result} />
                <span className="font-mono text-[11px] text-ink-faint shrink-0 text-right min-w-[52px]">{relativeTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function chainNodesFor(orgId: string, limit: number): Promise<ChainNode[]> {
  const rows = await db.accessEvent.findMany({
    where: { organizationId: orgId },
    orderBy: { seq: "desc" },
    take: limit,
    select: { seq: true, hash: true, result: true },
  });
  return rows.reverse().map((r) => ({
    seq: r.seq,
    hash: r.hash,
    status: r.result as "SUCCESS" | "DENIED" | "ERROR",
  }));
}

function ResultBadge({ result }: { result: string }) {
  if (result === "DENIED") return (
    <span className="font-mono text-[10px] px-1.5 py-[1px] rounded border border-alert/30 text-alert tracking-wider">DENIED</span>
  );
  if (result === "ERROR") return (
    <span className="font-mono text-[10px] px-1.5 py-[1px] rounded border border-stop/30 text-stop tracking-wider">ERROR</span>
  );
  return (
    <span className="font-mono text-[10px] px-1.5 py-[1px] rounded border border-signal/30 text-signal tracking-wider">OK</span>
  );
}

function initialsFromEmail(email: string): string {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[._-]/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[parts.length - 1]?.[0] ?? "";
  return (a + b).toUpperCase().slice(0, 2);
}

function relativeTime(when: Date): string {
  const ms = Date.now() - when.getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
