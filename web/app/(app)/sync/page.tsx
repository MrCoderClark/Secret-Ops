import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActor } from "@/lib/session";
import { listSyncTargets, planSync } from "@/lib/sync";
import { Badge } from "@/components/ui/Badge";
import { Gauge } from "@/components/ui/Gauge";
import { RunButtons } from "@/components/sync/RunButtons";

export const dynamic = "force-dynamic";

// /sync -- targets list on the left, selected target's plan diff on the
// right. Clicking a target pushes ?target=<id>; refresh reruns planSync
// so the diff reflects any writes since the last view.

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function SyncPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");

  const selected = typeof searchParams.target === "string" ? searchParams.target : undefined;

  const targets = await listSyncTargets({ actor });
  const target  = selected ? targets.find((t) => t.id === selected) ?? targets[0] : targets[0];
  const plan    = target ? await planSync({ actor, syncTargetId: target.id }) : null;

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Sync</h1>
        <p className="font-mono text-[13px] text-ink-dim mt-2.5">
          <span className="text-ink font-medium">{targets.length}</span> targets ·
          select one to see the plan and run it
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">

        {/* Targets rail */}
        <div className="rounded-lg bg-raised border border-line overflow-hidden">
          <header className="px-5 py-3 border-b border-line">
            <h2 className="font-mono text-[13px] font-medium text-ink">Targets</h2>
          </header>
          <ul>
            {targets.length === 0 ? (
              <li className="px-5 py-8 text-center font-mono text-xs text-ink-faint">no sync targets yet</li>
            ) : targets.map((t) => {
              const active = t.id === target?.id;
              return (
                <li key={t.id} className={`border-b border-line last:border-b-0 ${active ? "bg-accent/[0.05]" : "hover:bg-white/[0.02]"}`}>
                  <Link href={`/sync?target=${t.id}`} className="block px-5 py-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-[3px] h-5 rounded-r-sm ${active ? "bg-accent shadow-accent" : "bg-transparent"}`} />
                      <span className="font-mono font-medium text-ink text-[12.5px] truncate">{t.name}</span>
                      <Badge shape="tag">{t.kind.toLowerCase()}</Badge>
                    </div>
                    <div className="mt-1 ml-2 font-mono text-[11px] text-ink-dim truncate">{t.endpoint}</div>
                    <div className="mt-1 ml-2 flex items-center gap-2 font-mono text-[11px] text-ink-faint">
                      {t.lastStatus === "SYNCED"  && <Badge tone="success" led>synced</Badge>}
                      {t.lastStatus === "DRIFTED" && <Badge tone="danger"  led>drifted</Badge>}
                      {t.lastStatus === "FAILED"  && <Badge tone="danger"  led>failed</Badge>}
                      {t.lastStatus === "PENDING" && <Badge tone="warn"    led>pending</Badge>}
                      {t.lastStatus === "UNKNOWN" && <Badge tone="neutral">unknown</Badge>}
                      <span>{t.lastRunAt ? relativeTime(t.lastRunAt) : "never run"}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Plan panel */}
        {target && plan?.ok ? (
          <div className="rounded-lg bg-raised border border-line min-w-0 flex flex-col">
            <header className="px-5 py-3.5 border-b border-line flex items-start justify-between gap-4">
              <div>
                <h2 className="font-mono text-[13px] font-medium text-ink">{target.name}</h2>
                <p className="font-mono text-[11px] text-ink-faint mt-0.5">plan preview · head vs last observed</p>
              </div>
              <RunButtons targetId={target.id} targetLabel={target.name} pullMode={target.pullMode} />
            </header>

            {/* Diff counts */}
            <div className="grid grid-cols-4 gap-px bg-line border-b border-line">
              <Stat label="added"     n={plan.counts.added}     tone="accent" />
              <Stat label="updated"   n={plan.counts.updated}   tone="warn" />
              <Stat label="unchanged" n={plan.counts.unchanged} tone="ok" />
              <Stat label="missing"   n={plan.counts.missing}   tone="neutral" />
            </div>

            {/* Item list */}
            {plan.items.length === 0 ? (
              <p className="p-10 text-center font-mono text-xs text-ink-faint">no items to compare</p>
            ) : (
              <ul>
                {plan.items.map((item) => (
                  <li key={`${item.secretId}-${item.state}`} className="grid grid-cols-[minmax(0,1fr)_120px_160px] items-center gap-3 px-5 py-2.5 border-b border-line last:border-b-0 hover:bg-white/[0.015]">
                    <div className="min-w-0">
                      <span className="font-mono font-medium text-ink text-[12.5px] truncate block">
                        {item.path}/{item.key}
                      </span>
                      <span className="font-mono text-[11px] text-ink-faint">{item.desiredFingerprint ?? "—"}</span>
                    </div>
                    <StateBadge state={item.state} />
                    <div className="font-mono text-[11px] text-ink-dim text-right">
                      {item.desiredVersion !== null && `v${item.desiredVersion}`}
                      {item.observedVersion !== null && item.observedVersion !== item.desiredVersion && (
                        <span className="text-ink-faint"> ← v{item.observedVersion}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-raised border border-line p-10 text-center font-mono text-xs text-ink-faint">
            {plan && !plan.ok ? plan.error : "pick a target on the left"}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, n, tone }: { label: string; n: number; tone: "accent" | "warn" | "ok" | "neutral" }) {
  const color =
    tone === "accent"  ? "text-accent" :
    tone === "warn"    ? "text-alert" :
    tone === "ok"      ? "text-signal" : "text-ink";
  return (
    <div className="bg-raised px-5 py-3 flex flex-col gap-0.5">
      <span className="label-eyebrow">{label}</span>
      <span className={`font-mono text-xl font-medium tabular ${color}`}>{n}</span>
    </div>
  );
}

function StateBadge({ state }: { state: "added" | "updated" | "unchanged" | "missing" }) {
  const map = {
    added:     { tone: "accent"  as const, label: "added"     },
    updated:   { tone: "warn"    as const, label: "updated"   },
    unchanged: { tone: "success" as const, label: "unchanged" },
    missing:   { tone: "neutral" as const, label: "missing"   },
  };
  const { tone, label } = map[state];
  return <Badge tone={tone} led>{label}</Badge>;
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
