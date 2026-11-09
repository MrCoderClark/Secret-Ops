import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

// /settings -- read-only panel. Shows the operational facts someone on-call
// needs: which org, which KEK, how many historical keys the keyring holds,
// how many events the chain contains, session TTL. Editing org fields is a
// deliberate future feature (SSO wiring etc.).

export default async function SettingsPage() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");
  const orgId = actor.organizationId;

  const [org, memberCount, projectCount, envCount, secretCount, tokenCount, eventCount] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.membership.count({ where: { organizationId: orgId } }),
    db.project.count({ where: { organizationId: orgId, archived: false } }),
    db.environment.count({ where: { project: { organizationId: orgId } } }),
    db.secret.count({ where: { deletedAt: null, project: { organizationId: orgId } } }),
    db.apiToken.count({ where: { organizationId: orgId, revokedAt: null } }),
    db.accessEvent.count({ where: { organizationId: orgId } }),
  ]);

  // Parse SECRETOPS_ROOT_KEYS on the server just to count historical keys
  // without ever exposing the key material. If the env is missing this is a
  // dev environment running the deterministic throwaway key.
  const keyringSize = (process.env.SECRETOPS_ROOT_KEYS ?? "").split(",").filter(Boolean).length || 1;

  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-5">
      <div>
        <h1 className="font-mono text-4xl font-medium tracking-[-0.03em] leading-none">Settings</h1>
        <p className="font-mono text-[13px] text-ink-dim mt-2.5">
          read-only panel · editing org + session + encryption posture lands with the SSO wiring
        </p>
      </div>

      <section className="rounded-lg bg-raised border border-line">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Organization</h2>
        </header>
        <dl className="divide-y divide-line">
          <Row label="Name"      value={org?.name ?? "—"} />
          <Row label="Slug"      value={<span className="font-mono text-[12px]">{org?.slug ?? "—"}</span>} />
          <Row label="Plan"      value={<Badge tone="accent">{org?.plan ?? "—"}</Badge>} />
          <Row label="Members"   value={<span className="font-mono tabular">{memberCount}</span>} />
          <Row label="Projects"  value={<span className="font-mono tabular">{projectCount}</span>} />
          <Row label="Envs"      value={<span className="font-mono tabular">{envCount}</span>} />
          <Row label="Secrets"   value={<span className="font-mono tabular">{secretCount}</span>} />
          <Row label="Live tokens" value={<span className="font-mono tabular">{tokenCount}</span>} />
          <Row label="Audit events" value={<span className="font-mono tabular">{eventCount}</span>} />
          <Row label="Created"   value={<span className="font-mono text-[12px] text-ink-dim">{org?.createdAt.toISOString().slice(0, 10) ?? "—"}</span>} />
        </dl>
      </section>

      <section className="rounded-lg bg-raised border border-line">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Encryption posture</h2>
        </header>
        <dl className="divide-y divide-line">
          <Row label="Active KEK"   value={<span className="font-mono text-signal font-medium">{org?.activeKeyId ?? "—"}</span>} />
          <Row label="Keyring size" value={
            <span className="font-mono tabular text-ink">
              {keyringSize}
              <span className="text-ink-faint ml-2">
                {keyringSize === 1 ? "(single active key)" : "(rotation-ready; historical keys retained)"}
              </span>
            </span>
          } />
          <Row label="DEK scheme"   value={<span className="font-mono text-[12px] text-ink-dim">AES-256-GCM · per-version 32-byte DEK</span>} />
          <Row label="Wrap scheme"  value={<span className="font-mono text-[12px] text-ink-dim">AES-256-GCM · DEK wrapped by KEK</span>} />
          <Row label="Password hash" value={<span className="font-mono text-[12px] text-ink-dim">argon2id · scrypt fallback</span>} />
        </dl>
      </section>

      <section className="rounded-lg bg-raised border border-line">
        <header className="px-5 py-3 border-b border-line">
          <h2 className="font-mono text-[13px] font-medium text-ink">Session</h2>
        </header>
        <dl className="divide-y divide-line">
          <Row label="Signed in as" value={<span className="font-mono text-[12px] text-ink">{actor.email}</span>} />
          <Row label="Role"         value={<Badge tone={actor.role === "OWNER" ? "accent" : "info"}>{actor.role}</Badge>} />
          <Row label="Session TTL"  value={<span className="font-mono text-[12px] text-ink-dim">8 hours · HS256 cookie (sop_session)</span>} />
          <Row label="CSRF"         value={<span className="font-mono text-[12px] text-ink-dim">double-submit cookie (sop_csrf)</span>} />
          <Row label="MFA verified" value={<span className="font-mono text-[12px] text-ink-faint">field present · enforcement deferred</span>} />
        </dl>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-4 px-5 py-2.5">
      <dt className="label-eyebrow self-center">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
