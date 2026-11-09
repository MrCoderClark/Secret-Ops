import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { listTokens, type TokenSummary } from "@/lib/tokens";
import { Badge } from "@/components/ui/Badge";
import { MintButton } from "@/components/tokens/MintButton";
import { RevokeButton } from "@/components/tokens/RevokeButton";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");

  const tokens = await listTokens({ actor });
  const active  = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) =>  t.revokedAt);

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Tokens</h1>
          <p className="font-mono text-[13px] text-ink-dim mt-2.5">
            <span className="text-ink font-medium">{active.length}</span> active ·
            <span className="text-ink-faint"> {revoked.length}</span> revoked ·
            plaintext shown exactly once at mint
          </p>
        </div>
        <MintButton />
      </div>

      <TokenTable title="Active" rows={active} />
      {revoked.length > 0 && <TokenTable title="Revoked" rows={revoked} dim />}
    </div>
  );
}

function TokenTable({ title, rows, dim = false }: { title: string; rows: TokenSummary[]; dim?: boolean }) {
  return (
    <section className="rounded-lg bg-raised border border-line min-w-0 overflow-x-auto">
      <header className="px-5 py-3 border-b border-line flex items-center justify-between">
        <h2 className="font-mono text-[13px] font-medium text-ink">{title}</h2>
        <span className="font-mono text-[11px] text-ink-faint">{rows.length} token{rows.length === 1 ? "" : "s"}</span>
      </header>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center font-mono text-xs text-ink-faint">no {title.toLowerCase()} tokens</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <TH>Name</TH>
              <TH>Principal</TH>
              <TH>Scopes</TH>
              <TH>Prefix</TH>
              <TH>Expires</TH>
              <TH>Last used</TH>
              <TH className="text-right">{dim ? "Revoked" : "Actions"}</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={`border-b border-line last:border-b-0 ${dim ? "opacity-60" : "hover:bg-accent/[0.035] [&:hover_td:first-child]:shadow-[inset_3px_0_0_var(--accent)]"} transition-colors`}>
                <TD><span className="font-mono text-[12.5px] font-medium text-ink">{t.name}</span></TD>
                <TD className="font-mono text-[12px] text-ink-dim">{t.principal}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {t.scopes.map((s) => <Badge key={s} shape="tag">{s}</Badge>)}
                  </div>
                </TD>
                <TD className="font-mono text-[11px] text-ink-dim">{t.prefix}&hellip;</TD>
                <TD className="font-mono text-[11px] text-ink-dim">{t.expiresAt ? friendly(t.expiresAt) : "never"}</TD>
                <TD className="font-mono text-[11px] text-ink-dim">{t.lastUsedAt ? friendly(t.lastUsedAt) : "never"}</TD>
                <TD className="text-right">
                  {dim ? (
                    <span className="font-mono text-[11px] text-ink-faint">{t.revokedAt ? friendly(t.revokedAt) : ""}</span>
                  ) : (
                    <RevokeButton tokenId={t.id} tokenName={t.name} prefix={t.prefix} />
                  )}
                </TD>
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

function friendly(when: Date | null): string {
  if (!when) return "—";
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
