import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { RULE_CATALOGUE, type PolicyRule } from "@/lib/policies";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");

  const enabled = await db.policy.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ enabled: "desc" }, { severity: "desc" }, { createdAt: "asc" }],
  });

  const enabledByRule = new Map(enabled.map((p) => [p.rule, p]));

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Policies</h1>
        <p className="font-mono text-[13px] text-ink-dim mt-2.5">
          <span className="text-ink font-medium">{enabled.filter((p) => p.enabled).length}</span> active ·
          <span className="text-ink-faint"> {Object.keys(RULE_CATALOGUE).length}</span> available ·
          evaluated server-side on every write
        </p>
      </div>

      {/* Enabled */}
      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Configured for this org</h2>
        </header>
        {enabled.length === 0 ? (
          <p className="px-5 py-10 text-center font-mono text-xs text-ink-faint">no policies configured</p>
        ) : (
          <ul>
            {enabled.map((p) => {
              const catalogue = RULE_CATALOGUE[p.rule as PolicyRule];
              return (
                <li key={p.id} className="border-b border-line last:border-b-0 px-5 py-3 flex items-start gap-4">
                  <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${p.enabled ? "bg-signal shadow-[0_0_6px_rgba(79,196,140,.5)]" : "bg-ink-faint"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[13px] font-medium text-ink">{p.name}</span>
                      <Badge shape="tag">{p.rule}</Badge>
                      <SeverityBadge sev={p.severity} />
                      {!p.enabled && <Badge tone="neutral">disabled</Badge>}
                    </div>
                    <p className="text-sm text-ink-dim mt-1">{catalogue?.description ?? p.description ?? ""}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Catalogue */}
      <section className="rounded-lg bg-raised border border-line min-w-0">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Catalogue</h2>
        </header>
        <ul>
          {(Object.keys(RULE_CATALOGUE) as PolicyRule[]).map((rule) => {
            const meta = RULE_CATALOGUE[rule];
            const configured = enabledByRule.get(rule);
            return (
              <li key={rule} className="border-b border-line last:border-b-0 px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-medium text-ink">{meta.title}</span>
                  <Badge shape="tag">{rule}</Badge>
                  <SeverityBadge sev={meta.defaultSeverity} />
                  {configured
                    ? <Badge tone={configured.enabled ? "success" : "neutral"} led={configured.enabled}>{configured.enabled ? "active" : "disabled"}</Badge>
                    : <Badge tone="neutral">not configured</Badge>}
                </div>
                <p className="text-sm text-ink-dim mt-1">{meta.description}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function SeverityBadge({ sev }: { sev: string }) {
  const tone =
    sev === "critical" ? "danger"  as const :
    sev === "high"     ? "warn"    as const :
    sev === "medium"   ? "info"    as const : "neutral" as const;
  return <Badge tone={tone}>{sev}</Badge>;
}
