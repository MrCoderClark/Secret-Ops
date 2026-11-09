import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyChain, actionLabel } from "@/lib/audit";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Gauge } from "@/components/ui/Gauge";
import { StatChip } from "@/components/ui/StatChip";
import { ChainStrip, type ChainNode } from "@/components/ui/ChainStrip";
import { ContextStrip } from "@/components/shell/ContextStrip";

export const dynamic = "force-dynamic";

// Overview console. Rendered server-side -- every number comes from the
// service layer / Prisma directly, no network hop back to our own API.
//
// Shape (top to bottom): context prompt, headline + CTAs, metric row
// (one hero + three stat chips), two-column ledger (sync posture + rotation
// runway), signature chain strip, activity feed.

export default async function OverviewPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;

  const [
    org,
    projectCount,
    envCount,
    targetCount,
    secretCount,
    driftCount,
    driftWhere,
    byProject,
    overdueCount,
    posture,
    runway,
    recentEvents,
    chain,
  ] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { slug: true, plan: true } }),
    db.project.count({ where: { organizationId: orgId, archived: false } }),
    db.environment.count({ where: { project: { organizationId: orgId } } }),
    db.syncTarget.count({ where: { environment: { project: { organizationId: orgId } } } }),
    db.secret.count({ where: { deletedAt: null, project: { organizationId: orgId } } }),
    db.syncState.count({
      where: { status: "DRIFTED", syncTarget: { environment: { project: { organizationId: orgId } } } },
    }),
    firstDriftEnvironment(orgId),
    secretsPerProject(orgId),
    overdueSecretCount(orgId),
    postureRows(orgId),
    rotationRunway(orgId),
    db.accessEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, actorEmail: true, action: true, resourceLabel: true, result: true, createdAt: true },
    }),
    verifyChain(orgId),
  ]);

  const chainNodes = await chainNodesFor(orgId, 15);

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-6">

      {/* Context */}
      <ContextStrip
        orgSlug={org?.slug ?? "acme"}
        plan={org?.plan ?? "enterprise"}
        signedInAgo="now"
      />

      {/* Headline + actions */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Overview</h1>
          <p className="font-mono text-[13px] text-ink-dim mt-2.5">
            <Num>{projectCount}</Num> projects
            <Sep /> <Num>{envCount}</Num> environments
            <Sep /> <Num>{targetCount}</Num> sync targets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="md">
            <PlayGlyph /> Run sync
          </Button>
          <Button variant="primary" size="md">
            <PlusGlyph /> New secret
          </Button>
        </div>
      </div>

      {/* Metric row -- one hero + three stat chips */}
      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[minmax(260px,1.6fr)_repeat(3,1fr)] sm:grid-cols-2">
        <HeroMetric total={secretCount} byProject={byProject} />
        <StatChip
          label="Drift detected"
          value={String(driftCount)}
          foot={driftCount === 0 ? "all targets in sync" : (driftWhere ?? "action required")}
          tone={driftCount > 0 ? "stop" : "signal"}
        />
        <StatChip
          label="Rotation overdue"
          value={String(overdueCount)}
          foot={overdueCount === 0 ? "nothing past due" : "attention needed"}
          tone={overdueCount > 0 ? "alert" : "neutral"}
        />
        <StatChip
          label="Audit chain"
          value={chain.ok ? "VERIFIED" : `BROKEN @ ${chain.firstFailureSeq}`}
          foot={chain.ok ? `${chain.checked} events · continuous` : chain.reason}
          tone={chain.ok ? "signal" : "stop"}
          valueSize="word"
        />
      </div>

      {/* Two-column ledger */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">

        {/* Sync posture */}
        <section className="rounded-lg bg-raised border border-line min-w-0">
          <header className="flex items-start justify-between px-5 py-3.5 border-b border-line">
            <div>
              <h2 className="font-mono text-[13px] font-medium text-ink">Sync posture</h2>
              <p className="font-mono text-[11px] text-ink-faint mt-0.5">head version compared against last observed at each target</p>
            </div>
            <Link href="/sync" className="text-ink-dim hover:text-accent text-xs transition-colors">manage targets →</Link>
          </header>

          <table className="w-full text-sm">
            <thead>
              <tr>
                <TH>Target</TH>
                <TH>Environment</TH>
                <TH>Status</TH>
                <TH>Coverage</TH>
                <TH className="text-right">Last run</TH>
              </tr>
            </thead>
            <tbody>
              {posture.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-faint font-mono text-sm">no sync targets yet</td></tr>
              ) : posture.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line last:border-b-0 cursor-pointer transition-colors hover:bg-accent/[0.035] [&:hover_td:first-child]:shadow-[inset_3px_0_0_var(--accent)]"
                >
                  <TD>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-medium text-ink truncate">{row.name}</span>
                      <Badge shape="tag">{row.kind.toLowerCase()}</Badge>
                    </div>
                  </TD>
                  <TD className="text-ink-dim">{row.environmentLabel}</TD>
                  <TD>
                    {row.drifted > 0
                      ? <Badge tone="danger" led>{row.drifted} drifted</Badge>
                      : <Badge tone="success" led>in sync</Badge>}
                  </TD>
                  <TD>
                    <Gauge
                      synced={row.synced}
                      drifted={row.drifted}
                      total={row.total}
                      srLabel={`${row.synced} of ${row.total} in sync`}
                    />
                  </TD>
                  <TD className="text-ink-dim font-mono text-xs text-right">{row.lastRunAt ? relativeTime(row.lastRunAt) : "never"}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Rotation runway */}
        <section className="rounded-lg bg-raised border border-line min-w-0">
          <header className="flex items-start justify-between px-5 py-3.5 border-b border-line">
            <div>
              <h2 className="font-mono text-[13px] font-medium text-ink">Rotation runway</h2>
              <p className="font-mono text-[11px] text-ink-faint mt-0.5">next 5 keys due</p>
            </div>
          </header>
          <div className="flex flex-col py-2">
            {runway.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-faint">no rotation policies active</p>
            ) : runway.map((r) => {
              const pct = Math.max(0, Math.min(100, (r.daysLeft / r.intervalDays) * 100));
              const tone = r.daysLeft <= 7 ? "hot" : r.daysLeft <= 14 ? "warn" : "ok";
              return (
                <div key={r.id} className="px-5 py-2.5 flex flex-col gap-1.5 border-t border-line first:border-t-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-ink font-medium truncate">{r.key}</span>
                    <span className={`font-mono text-[11px] ${tone === "hot" ? "text-stop" : tone === "warn" ? "text-alert" : "text-ink-dim"}`}>
                      {r.daysLeft}d left
                    </span>
                  </div>
                  <div className="h-0.5 bg-inset rounded-sm overflow-hidden">
                    <div
                      className={`h-full ${tone === "hot" ? "bg-stop" : tone === "warn" ? "bg-alert" : "bg-signal"}`}
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Signature: audit chain strip */}
      <ChainStrip
        nodes={chainNodes}
        verified={chain.ok}
        firstFailureSeq={chain.ok ? null : chain.firstFailureSeq}
        reason={chain.ok ? undefined : chain.reason}
      />

      {/* Activity feed */}
      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="flex items-start justify-between px-5 py-3.5 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Recent activity</h2>
          <Link href="/audit" className="text-ink-dim hover:text-accent text-xs transition-colors">full log →</Link>
        </header>
        {recentEvents.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-faint text-center font-mono">no activity yet</p>
        ) : (
          <ul className="flex flex-col">
            {recentEvents.map((e) => (
              <li key={e.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 px-5 py-2.5 border-t border-line first:border-t-0 hover:bg-white/[0.015] transition-colors">
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
                <span className="font-mono text-[11px] text-ink-faint shrink-0 text-right min-w-[48px]">{relativeTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------
// Data helpers
// --------------------------------------------------------------------------

async function firstDriftEnvironment(orgId: string): Promise<string | null> {
  const row = await db.syncState.findFirst({
    where: { status: "DRIFTED", syncTarget: { environment: { project: { organizationId: orgId } } } },
    select: { syncTarget: { select: { environment: { select: { slug: true, project: { select: { slug: true } } } } } } },
  });
  if (!row) return null;
  return `${row.syncTarget.environment.project.slug}/${row.syncTarget.environment.slug}`;
}

async function secretsPerProject(orgId: string) {
  const rows = await db.project.findMany({
    where: { organizationId: orgId, archived: false },
    select: { slug: true, _count: { select: { secrets: { where: { deletedAt: null } } } } },
    orderBy: { slug: "asc" },
  });
  return rows.map((p) => ({ slug: p.slug, count: p._count.secrets }));
}

async function overdueSecretCount(orgId: string): Promise<number> {
  const rows = await db.secret.findMany({
    where: { deletedAt: null, rotationPolicyId: { not: null }, project: { organizationId: orgId } },
    select: {
      rotationPolicy: { select: { intervalDays: true, enabled: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const now = Date.now();
  let overdue = 0;
  for (const s of rows) {
    if (!s.rotationPolicy?.enabled) continue;
    const head = s.versions[0];
    if (!head) continue;
    const ageMs = now - head.createdAt.getTime();
    if (ageMs > s.rotationPolicy.intervalDays * 24 * 60 * 60 * 1000) overdue += 1;
  }
  return overdue;
}

async function postureRows(orgId: string) {
  const targets = await db.syncTarget.findMany({
    where: { environment: { project: { organizationId: orgId } } },
    orderBy: [{ environmentId: "asc" }, { name: "asc" }],
    include: {
      environment: { select: { slug: true, project: { select: { slug: true } } } },
      states: { select: { status: true } },
    },
  });
  return targets.map((t) => {
    const total = t.states.length;
    const synced  = t.states.filter((s) => s.status === "SYNCED").length;
    const drifted = t.states.filter((s) => s.status === "DRIFTED").length;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      environmentLabel: `${t.environment.project.slug} · ${t.environment.slug}`,
      total, synced, drifted,
      lastRunAt: t.lastRunAt,
    };
  });
}

async function rotationRunway(orgId: string) {
  const rows = await db.secret.findMany({
    where: { deletedAt: null, rotationPolicyId: { not: null }, project: { organizationId: orgId } },
    select: {
      id: true,
      key: true,
      rotationPolicy: { select: { intervalDays: true, enabled: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const now = Date.now();
  return rows
    .filter((s) => s.rotationPolicy?.enabled && s.versions[0])
    .map((s) => {
      const head = s.versions[0]!;
      const policy = s.rotationPolicy!;
      const ageMs = now - head.createdAt.getTime();
      const totalMs = policy.intervalDays * 24 * 60 * 60 * 1000;
      const remainingMs = totalMs - ageMs;
      return {
        id: s.id,
        key: s.key,
        intervalDays: policy.intervalDays,
        daysLeft: Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000))),
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);
}

async function chainNodesFor(orgId: string, limit: number): Promise<ChainNode[]> {
  const rows = await db.accessEvent.findMany({
    where: { organizationId: orgId },
    orderBy: { seq: "desc" },
    take: limit,
    select: { seq: true, hash: true, result: true },
  });
  // Reverse so the strip reads left-to-right as oldest -> newest.
  return rows.reverse().map((r) => ({
    seq: r.seq,
    hash: r.hash,
    status: r.result as "SUCCESS" | "DENIED" | "ERROR",
  }));
}

// --------------------------------------------------------------------------
// Presentational sub-bits
// --------------------------------------------------------------------------

function HeroMetric({ total, byProject }: { total: number; byProject: Array<{ slug: string; count: number }> }) {
  // Four colours for breakdown dots. If a demo grows past four projects,
  // the fifth loops back to trace (no project should have an invisible dot).
  const PALETTE = ["bg-trace", "bg-signal", "bg-alert", "bg-accent"];
  return (
    <div className="rounded-lg bg-raised border border-line p-5 flex flex-col gap-1.5">
      <span className="label-eyebrow">Secrets under management</span>
      <span className="font-mono text-5xl font-medium leading-none tracking-[-0.03em] tabular">{total}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 font-mono text-[11px] text-ink-dim">
        {byProject.map((p, i) => (
          <span key={p.slug} className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${PALETTE[i % PALETTE.length]}`} />
            <span className="text-ink font-medium tabular">{p.count}</span> {p.slug}
          </span>
        ))}
      </div>
    </div>
  );
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

function TH({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <th className={`px-5 py-2 text-left text-[10.5px] font-semibold tracking-wider uppercase text-ink-faint border-b border-line ${className}`}>
      {children}
    </th>
  );
}
function TD({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <td className={`px-5 py-2.5 text-ink align-middle ${className}`}>{children}</td>;
}

function Num({ children }: { children: React.ReactNode }) { return <span className="text-ink font-medium tabular">{children}</span>; }
function Sep() { return <span className="text-line-strong"> &middot; </span>; }

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function PlayGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5" />
    </svg>
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
