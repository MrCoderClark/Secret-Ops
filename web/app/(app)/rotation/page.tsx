import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

// /rotation -- three sections the worker's rotation sweep informs:
//   overdue (worker will auto-rotate or file a task next sweep)
//   due soon (within intervalDays/8, so < ~2 weeks at a 90-day policy)
//   no policy (secrets whose intervalDays is effectively infinite)

type Row = {
  id: string;
  key: string;
  path: string;
  environmentLabel: string;
  policyName: string | null;
  policyMode: string | null;
  intervalDays: number | null;
  daysLeft: number | null;         // negative when overdue
  lastWriteAt: Date | null;
};

export default async function RotationPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;

  const secrets = await db.secret.findMany({
    where: { deletedAt: null, project: { organizationId: orgId } },
    include: {
      environment: { select: { slug: true, project: { select: { slug: true } } } },
      rotationPolicy: { select: { name: true, intervalDays: true, mode: true, enabled: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  const now = Date.now();
  const rows: Row[] = secrets.map((s) => {
    const head = s.versions[0];
    if (!s.rotationPolicy || !s.rotationPolicy.enabled) {
      return {
        id: s.id, key: s.key, path: s.path,
        environmentLabel: `${s.environment.project.slug} · ${s.environment.slug}`,
        policyName: null, policyMode: null, intervalDays: null,
        daysLeft: null,
        lastWriteAt: head?.createdAt ?? null,
      };
    }
    const policy = s.rotationPolicy;
    const ageMs = head ? now - head.createdAt.getTime() : 0;
    const totalMs = policy.intervalDays * 24 * 60 * 60 * 1000;
    const remainingMs = totalMs - ageMs;
    return {
      id: s.id, key: s.key, path: s.path,
      environmentLabel: `${s.environment.project.slug} · ${s.environment.slug}`,
      policyName: policy.name, policyMode: policy.mode, intervalDays: policy.intervalDays,
      daysLeft: Math.floor(remainingMs / (24 * 60 * 60 * 1000)),
      lastWriteAt: head?.createdAt ?? null,
    };
  });

  const overdue  = rows.filter((r) => r.daysLeft !== null && r.daysLeft < 0).sort((a, b) => (a.daysLeft! - b.daysLeft!));
  const dueSoon  = rows.filter((r) => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= 14).sort((a, b) => (a.daysLeft! - b.daysLeft!));
  const noPolicy = rows.filter((r) => r.daysLeft === null);

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Rotation</h1>
        <p className="font-mono text-[13px] text-ink-dim mt-2.5">
          <span className="text-stop font-medium">{overdue.length}</span> overdue ·
          <span className="text-alert"> {dueSoon.length}</span> due within 14d ·
          <span className="text-ink-faint"> {noPolicy.length}</span> without a policy
        </p>
      </div>

      <Section title="Overdue" subtitle="worker auto-rotates (auto mode) or files a task (manual) on next sweep" rows={overdue} empty="nothing is overdue" tone="hot" />
      <Section title="Due soon" subtitle="within the next 14 days" rows={dueSoon} empty="no rotations due within 14 days" tone="warn" />
      <Section title="No rotation policy" subtitle="attach a policy if lifetime matters for this key" rows={noPolicy} empty="every secret has a policy" tone="neutral" />
    </div>
  );
}

function Section({ title, subtitle, rows, empty, tone }: { title: string; subtitle: string; rows: Row[]; empty: string; tone: "hot" | "warn" | "neutral" }) {
  const dotColor =
    tone === "hot"  ? "bg-stop shadow-[0_0_6px_rgba(229,83,83,.5)]" :
    tone === "warn" ? "bg-alert shadow-[0_0_6px_rgba(232,169,64,.5)]" : "bg-ink-faint";
  return (
    <section className="rounded-lg bg-raised border border-line min-w-0">
      <header className="px-5 py-3 border-b border-line flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <h2 className="font-mono text-[13px] font-medium text-ink">{title}</h2>
        <span className="font-mono text-[11px] text-ink-faint">{subtitle}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-dim">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center font-mono text-xs text-ink-faint">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <TH>Key</TH>
              <TH>Environment</TH>
              <TH>Policy</TH>
              <TH>Days left</TH>
              <TH>Last write</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-white/[0.015] transition-colors">
                <TD>
                  <span className="font-mono text-[12.5px] text-ink">{r.path}/{r.key}</span>
                </TD>
                <TD className="font-mono text-[12px] text-ink-dim">{r.environmentLabel}</TD>
                <TD>
                  {r.policyName ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-ink">{r.policyName}</span>
                      <Badge shape="tag">{r.policyMode}</Badge>
                    </div>
                  ) : <span className="font-mono text-[11px] text-ink-faint">—</span>}
                </TD>
                <TD>
                  {r.daysLeft === null ? (
                    <span className="font-mono text-[11px] text-ink-faint">—</span>
                  ) : r.daysLeft < 0 ? (
                    <span className="font-mono text-[12px] text-stop">{Math.abs(r.daysLeft)}d overdue</span>
                  ) : r.daysLeft <= 7 ? (
                    <span className="font-mono text-[12px] text-stop">{r.daysLeft}d</span>
                  ) : r.daysLeft <= 14 ? (
                    <span className="font-mono text-[12px] text-alert">{r.daysLeft}d</span>
                  ) : (
                    <span className="font-mono text-[12px] text-ink-dim">{r.daysLeft}d</span>
                  )}
                </TD>
                <TD className="font-mono text-[11px] text-ink-dim">{r.lastWriteAt ? relativeTime(r.lastWriteAt) : "—"}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
