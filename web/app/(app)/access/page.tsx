import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { listAccessRequests } from "@/lib/access";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { Badge } from "@/components/ui/Badge";
import { DecideButton } from "@/components/access/DecideButton";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;
  const isReviewer = can(actor, "request.review");

  const [pending, decided, grants, members] = await Promise.all([
    listAccessRequests({ actor, status: "PENDING", limit: 50 }),
    listAccessRequests({ actor, limit: 20 }).then((all) => all.filter((r) => r.status !== "PENDING").slice(0, 20)),
    db.grant.findMany({
      where: { organizationId: orgId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: "desc" },
      include: {
        environment: { select: { slug: true, project: { select: { slug: true } } } },
        secret: { select: { path: true, key: true } },
      },
    }),
    db.membership.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { name: true, email: true, status: true, lastLoginAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Access</h1>
        <p className="font-mono text-[13px] text-ink-dim mt-2.5">
          <span className="text-ink font-medium">{pending.length}</span> pending ·
          <span className="text-ink-faint"> {grants.length}</span> active grants ·
          <span className="text-ink-faint"> {members.length}</span> members
        </p>
      </div>

      {/* Pending queue */}
      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="px-5 py-3 border-b border-line flex items-center justify-between">
          <h2 className="font-mono text-[13px] font-medium text-ink">Pending requests</h2>
          <span className="font-mono text-[11px] text-ink-faint">
            {isReviewer ? "reviewers see every request in the org" : "shows only your own"}
          </span>
        </header>
        {pending.length === 0 ? (
          <p className="px-5 py-10 text-center font-mono text-xs text-ink-faint">no requests waiting</p>
        ) : (
          <ul>
            {pending.map((r) => {
              const scope = r.environmentLabel ?? r.secretLabel ?? "(unspecified)";
              const summary = `${r.requesterEmail} wants ${r.permission} on ${scope} for ${r.durationMinutes}m`;
              return (
                <li key={r.id} className="border-b border-line last:border-b-0 px-5 py-3 flex items-start gap-4 hover:bg-white/[0.015] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2 min-w-0">
                      <span className="font-mono text-[12px] text-ink">{r.requesterEmail}</span>
                      <span className="text-ink-dim text-xs">wants</span>
                      <Badge tone="info">{r.permission}</Badge>
                      <span className="text-ink-dim text-xs">on</span>
                      <span className="font-mono text-[12px] text-ink bg-inset border border-line px-1.5 py-[1px] rounded">{scope}</span>
                      <span className="font-mono text-[11px] text-ink-faint">for {r.durationMinutes}m</span>
                    </div>
                    <p className="text-sm text-ink mt-2 italic">&ldquo;{r.justification}&rdquo;</p>
                    <p className="font-mono text-[11px] text-ink-faint mt-1.5">raised {relativeTime(r.createdAt)}</p>
                  </div>
                  {isReviewer && r.requesterId !== actor.id && (
                    <DecideButton requestId={r.id} summary={summary} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Active grants */}
      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Active grants</h2>
        </header>
        {grants.length === 0 ? (
          <p className="px-5 py-10 text-center font-mono text-xs text-ink-faint">no live grants</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <TH>Principal</TH>
                <TH>Permission</TH>
                <TH>Scope</TH>
                <TH>Expires</TH>
                <TH>Created</TH>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => {
                const scope = g.secret
                  ? `${g.secret.path}/${g.secret.key}`
                  : g.environment
                    ? `${g.environment.project.slug} · ${g.environment.slug}`
                    : "org-wide";
                return (
                  <tr key={g.id} className="border-b border-line last:border-b-0 hover:bg-white/[0.015] transition-colors">
                    <TD>
                      <span className="font-mono text-[12px] text-ink">
                        {g.principal ?? `user:${g.userId?.slice(-6) ?? "?"}`}
                      </span>
                    </TD>
                    <TD><Badge tone="info">{g.permission}</Badge></TD>
                    <TD className="font-mono text-[12px] text-ink-dim">{scope}</TD>
                    <TD className="font-mono text-[11px] text-ink-dim">{g.expiresAt ? friendly(g.expiresAt) : "never"}</TD>
                    <TD className="font-mono text-[11px] text-ink-faint">{relativeTime(g.createdAt)}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Members */}
      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Members</h2>
        </header>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Last login</TH>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-b-0 hover:bg-white/[0.015] transition-colors">
                <TD><span className="text-ink text-[13px]">{m.user.name}</span></TD>
                <TD className="font-mono text-[12px] text-ink-dim">{m.user.email}</TD>
                <TD><Badge tone={m.role === "OWNER" || m.role === "ADMIN" ? "accent" : "neutral"}>{m.role}</Badge></TD>
                <TD>
                  {m.user.status === "ACTIVE" ? (
                    <Badge tone="success" led>active</Badge>
                  ) : (
                    <Badge tone="warn">{m.user.status.toLowerCase()}</Badge>
                  )}
                </TD>
                <TD className="font-mono text-[11px] text-ink-faint">{m.user.lastLoginAt ? relativeTime(m.user.lastLoginAt) : "never"}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Recent decisions */}
      {decided.length > 0 && (
        <section className="rounded-lg bg-raised border border-line min-w-0">
          <header className="px-5 py-3 border-b border-line">
            <h2 className="font-mono text-[13px] font-medium text-ink">Recent decisions</h2>
          </header>
          <ul>
            {decided.map((r) => (
              <li key={r.id} className="border-b border-line last:border-b-0 px-5 py-2.5 flex items-center gap-3">
                <span className="font-mono text-[12px] text-ink min-w-0 truncate">{r.requesterEmail}</span>
                <span className="text-ink-dim text-xs">· {r.permission} on</span>
                <span className="font-mono text-[12px] text-ink">{r.environmentLabel ?? r.secretLabel}</span>
                <span className="flex-1" />
                {r.status === "APPROVED" && <Badge tone="success" led>approved</Badge>}
                {r.status === "DENIED"   && <Badge tone="danger" led>denied</Badge>}
                {r.status === "EXPIRED"  && <Badge tone="neutral">expired</Badge>}
                <span className="font-mono text-[11px] text-ink-faint">{r.decidedAt ? relativeTime(r.decidedAt) : "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
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

function friendly(when: Date): string {
  const ms = when.getTime() - Date.now();
  const abs = Math.abs(ms);
  const future = ms > 0;
  const d = Math.round(abs / (24 * 60 * 60 * 1000));
  if (d >= 1) return future ? `in ${d}d` : `${d}d ago`;
  const h = Math.round(abs / (60 * 60 * 1000));
  if (h >= 1) return future ? `in ${h}h` : `${h}h ago`;
  const m = Math.round(abs / (60 * 1000));
  return future ? `in ${m}m` : `${m}m ago`;
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
