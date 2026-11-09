import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { listSecrets } from "@/lib/secrets";
import { can, canReadValue, canWriteValue } from "@/lib/rbac";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FilterBar } from "@/components/secrets/FilterBar";
import { RowActions } from "@/components/secrets/RowActions";

export const dynamic = "force-dynamic";

// /secrets -- the table people spend most of their time in. Columns:
//   path/key · env · type · fingerprint · version · last write · actions
//
// Filters: project / env / text query (debounced), driven by URL params so
// the server component always owns the truth and deep links work.

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function SecretsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;

  const q       = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const project = typeof searchParams.project === "string" ? searchParams.project : undefined;
  const env     = typeof searchParams.env === "string" ? searchParams.env : undefined;

  const [rows, projects, environments] = await Promise.all([
    listSecrets({ actor, environmentId: env, projectId: project, query: q, limit: 200 }),
    db.project.findMany({
      where: { organizationId: orgId, archived: false },
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.environment.findMany({
      where: { project: { organizationId: orgId } },
      select: { id: true, slug: true, project: { select: { slug: true } } },
      orderBy: [{ project: { slug: "asc" } }, { stage: "asc" }],
    }),
  ]);

  // RBAC check runs once per env to avoid N loops in the row; we build a
  // map the row renderer indexes into.
  const envRows = await db.environment.findMany({
    where: { project: { organizationId: orgId } },
    select: { id: true, stage: true, protected: true, slug: true, project: { select: { slug: true } } },
  });
  const perEnv = new Map(
    envRows.map((e) => [e.id, {
      label: `${e.project.slug} · ${e.slug}`,
      canRead:   canReadValue(actor, { id: e.id, stage: e.stage, protected: e.protected }),
      canWrite:  canWriteValue(actor, { id: e.id, stage: e.stage, protected: e.protected }),
      canDelete: can(actor, "secret.delete"),
    }]),
  );

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Secrets</h1>
          <p className="font-mono text-[13px] text-ink-dim mt-2.5">
            <span className="text-ink font-medium">{rows.length}</span> entries
            {(q || project || env) && <span className="text-ink-faint"> &middot; filtered</span>}
          </p>
        </div>
        <Button variant="primary">+ New secret</Button>
      </div>

      <FilterBar
        projects={projects}
        environments={environments.map((e) => ({ id: e.id, slug: e.slug, projectSlug: e.project.slug }))}
      />

      <div className="rounded-lg bg-raised border border-line min-w-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <TH>Key</TH>
              <TH>Environment</TH>
              <TH>Type</TH>
              <TH>Fingerprint</TH>
              <TH>Version</TH>
              <TH>Last write</TH>
              <TH className="text-right">Actions</TH>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center">
                <p className="font-mono text-ink-faint text-sm">no secrets match</p>
                <p className="font-mono text-ink-faint text-[11px] mt-1">
                  {q || project || env ? "try clearing the filter" : "create one above"}
                </p>
              </td></tr>
            ) : rows.map((r) => {
              const meta = perEnv.get(r.environmentId);
              return (
                <tr
                  key={r.id}
                  className="border-b border-line last:border-b-0 transition-colors hover:bg-accent/[0.035] [&:hover_td:first-child]:shadow-[inset_3px_0_0_var(--accent)]"
                >
                  <TD>
                    <div className="flex flex-col min-w-0">
                      <span className="font-mono font-medium text-ink text-[12.5px] truncate">{r.path}/{r.key}</span>
                      {r.description && <span className="text-[11px] text-ink-faint truncate">{r.description}</span>}
                    </div>
                  </TD>
                  <TD className="text-ink-dim text-[12px]">{meta?.label ?? r.environmentId}</TD>
                  <TD><Badge shape="tag">{r.valueType}</Badge></TD>
                  <TD className="font-mono text-[11px] text-ink-dim">{r.fingerprint ?? "—"}</TD>
                  <TD className="font-mono text-[11px] text-ink-dim">
                    {r.currentVersion !== null ? `v${r.currentVersion}` : "—"}
                  </TD>
                  <TD className="font-mono text-[11px] text-ink-dim">{r.lastWriteAt ? relativeTime(r.lastWriteAt) : "—"}</TD>
                  <TD className="text-right">
                    <RowActions
                      secretId={r.id}
                      label={`${meta?.label ?? r.environmentId} · ${r.path}/${r.key}`}
                      canReadValue={!!meta?.canRead}
                      canWrite={!!meta?.canWrite}
                      canDelete={!!meta?.canDelete}
                    />
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
