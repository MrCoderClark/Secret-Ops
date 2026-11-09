import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { verifyChain, actionLabel } from "@/lib/audit";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CoverageBar } from "@/components/ui/CoverageBar";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/Table";

// /overview — mirrors the mock. Server component: every query goes direct
// to the service layer / Prisma, no network hop back to our own API.
//
// Numbers surface:
//   - project / env / target counts in the subtitle
//   - four metric cards (secrets under management, drift detected, rotation
//     overdue, audit chain verifier)
//
// Three content panels:
//   - Sync posture: one row per target, in-sync/drifted badge + coverage bar
//   - Rotation runway: top 5 secrets closest to being overdue
//   - Recent activity: last ten AccessEvents, with an English action label

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;

  const [projects, environments, targets, secretCount, driftCount, overdueSecrets, posture, runway, events, chain] = await Promise.all([
    db.project.count({ where: { organizationId: orgId, archived: false } }),
    db.environment.count({ where: { project: { organizationId: orgId } } }),
    db.syncTarget.count({ where: { environment: { project: { organizationId: orgId } } } }),
    db.secret.count({ where: { deletedAt: null, project: { organizationId: orgId } } }),
    db.syncState.count({
      where: { status: "DRIFTED", syncTarget: { environment: { project: { organizationId: orgId } } } },
    }),
    overdueSecretCount(orgId),
    postureRows(orgId),
    rotationRunway(orgId),
    recentActivity(orgId),
    verifyChain(orgId),
  ]);

  return (
    <div className="p-8 space-y-6 max-w-[1400px]">
      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-fg-muted mt-1">
            {projects} projects · {environments} environments · {targets} sync targets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary"><PlusGlyph /> New secret</Button>
          <Button variant="secondary">Run sync</Button>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Secrets under management" value={String(secretCount)} note="Active keys" />
        <MetricCard label="Drift detected" value={String(driftCount)} note="Action required" tone={driftCount > 0 ? "warn" : "neutral"} />
        <MetricCard label="Rotation overdue" value={String(overdueSecrets)} note="Attention needed" tone={overdueSecrets > 0 ? "warn" : "neutral"} />
        <MetricCard
          label="Audit chain"
          value={chain.ok ? "Verified" : `Broken @ ${chain.firstFailureSeq}`}
          note={chain.ok ? "Continuous check" : chain.reason}
          tone={chain.ok ? "success" : "danger"}
        />
      </div>

      {/* Sync posture + runway */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card
            title="Sync posture"
            subtitle="Control-plane version compared against what each runtime reports"
            action={<Link href="/sync" className="text-xs text-accent hover:underline">Manage targets →</Link>}
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Target</TH>
                  <TH>Environment</TH>
                  <TH>Status</TH>
                  <TH>Coverage</TH>
                  <TH>Last run</TH>
                </TR>
              </THead>
              <TBody>
                {posture.length === 0 ? (
                  <TR><TD colSpan={5} className="text-fg-muted text-center">No sync targets yet.</TD></TR>
                ) : posture.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <span className="font-medium">{row.name}</span>
                      <Badge className="ml-2">{row.kind}</Badge>
                    </TD>
                    <TD className="text-fg-secondary">{row.environmentName}</TD>
                    <TD>
                      {row.drifted > 0
                        ? <Badge tone="danger">{row.drifted} drifted</Badge>
                        : <Badge tone="success">In sync</Badge>}
                    </TD>
                    <TD><CoverageBar ratio={row.coverage} srLabel={`${row.synced} of ${row.total} in sync`} /></TD>
                    <TD className="text-fg-secondary">{row.lastRunAt ? relativeTime(row.lastRunAt) : "never"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>

        <Card title="Rotation runway">
          {runway.length === 0 ? (
            <p className="text-sm text-fg-muted">No rotation policies active.</p>
          ) : (
            <ul className="space-y-3">
              {runway.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span className="mono text-sm truncate">{r.key}</span>
                  <Badge tone={r.daysLeft <= 7 ? "warn" : "neutral"}>{r.daysLeft}d left</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Recent activity */}
      <Card title="Recent activity" flush>
        {events.length === 0 ? (
          <p className="p-5 text-sm text-fg-muted">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-7 h-7 rounded-full bg-surface-hover flex items-center justify-center text-[10px] font-semibold text-fg-primary shrink-0">
                  {initials(e.actorEmail)}
                </div>
                <div className="flex-1 min-w-0 text-sm">
                  <span className="text-fg-primary">{e.actorEmail}</span>
                  <span className="text-fg-muted"> {actionLabel(e.action)} </span>
                  {e.resourceLabel && <span className="mono text-fg-primary">{e.resourceLabel}</span>}
                </div>
                <span className="text-xs text-fg-muted shrink-0">{relativeTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------
// Data helpers — keep them server-side, close to the component that renders.
// --------------------------------------------------------------------------

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
      environment: { select: { name: true } },
      states: { select: { status: true } },
    },
  });
  return targets.map((t) => {
    const total = t.states.length;
    const synced = t.states.filter((s) => s.status === "SYNCED").length;
    const drifted = t.states.filter((s) => s.status === "DRIFTED").length;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      environmentName: t.environment.name,
      total,
      synced,
      drifted,
      coverage: total === 0 ? 0 : synced / total,
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
  const ranked = rows
    .filter((s) => s.rotationPolicy?.enabled && s.versions[0])
    .map((s) => {
      const head = s.versions[0]!;
      const ageMs = now - head.createdAt.getTime();
      const totalMs = s.rotationPolicy!.intervalDays * 24 * 60 * 60 * 1000;
      const remainingMs = totalMs - ageMs;
      return { id: s.id, key: s.key, daysLeft: Math.floor(remainingMs / (24 * 60 * 60 * 1000)) };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);
  return ranked;
}

async function recentActivity(orgId: string) {
  return db.accessEvent.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      actorEmail: true,
      action: true,
      resourceLabel: true,
      createdAt: true,
    },
  });
}

// --------------------------------------------------------------------------
// Presentational bits local to this page.
// --------------------------------------------------------------------------

function MetricCard({ label, value, note, tone = "neutral" }: {
  label: string;
  value: string;
  note: string;
  tone?: "neutral" | "success" | "warn" | "danger";
}) {
  const valueTone =
    tone === "success" ? "text-success" :
    tone === "warn"    ? "text-warn" :
    tone === "danger"  ? "text-danger" : "text-fg-primary";
  const noteTone =
    tone === "success" ? "text-success" :
    tone === "warn"    ? "text-warn" :
    tone === "danger"  ? "text-danger" : "text-fg-muted";
  return (
    <div className="rounded-xl bg-surface-raised border border-border-subtle p-5 shadow-card">
      <div className="label-eyebrow">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${valueTone}`}>{value}</div>
      <div className={`mt-1 text-xs ${noteTone}`}>{note}</div>
    </div>
  );
}

function PlusGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function initials(email: string): string {
  const name = email.split("@")[0] ?? email;
  const parts = name.split(/[._-]/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[parts.length - 1]?.[0] ?? "";
  return (a + b).toUpperCase().slice(0, 2);
}

function relativeTime(when: Date): string {
  const ms = Date.now() - when.getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
