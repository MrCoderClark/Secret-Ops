// prisma/seed.ts — Acme Corporation demo data.
//
// What this gives you after `pnpm db:seed`:
//
//   - One organization, four users with distinct roles, one shared password
//   - Three projects × three environments (dev/staging/prod) = nine envs
//   - ~45 encrypted secrets with realistic names, every one sealed via
//     crypto.seal() so the exact same code path a real write uses
//   - Nine sync targets (one per env) wired into SyncState
//   - Two rotation policies + a row showing one past rotation
//   - One active Policy per rule in the catalogue (six rows)
//   - Three grants (an admin, a developer, and a time-boxed break-glass)
//   - Two AccessRequests — one PENDING for review, one APPROVED (the
//     approval wrote the break-glass grant above)
//   - One API token for CI (plaintext printed once at the end, never stored)
//   - A hash-chained audit log populated through recordEvent() so the chain
//     actually verifies — the audit page has content, and `audit/verify`
//     returns ok on the fresh database
//
// Idempotency: the first thing this script does is look up the Acme org by
// slug. If it exists, we bail with an explicit message rather than trying to
// reconcile — a seed that quietly double-writes is worse than one that
// refuses the second run. Drop the database (or `pnpm prisma migrate reset`)
// to re-seed from a clean slate.

import { Prisma, PrismaClient, type Environment, type Project, type Role, type Secret, type User, SyncTargetKind, SyncStatus } from "@prisma/client";
import { hashPassword, seal } from "@/lib/crypto";
import { mintMachineToken } from "@/lib/auth";
import { recordEvent } from "@/lib/audit";
import { RULE_CATALOGUE, type PolicyRule } from "@/lib/policies";

const db = new PrismaClient();

const DEMO_PASSWORD = "demo-password-change-me";
const ORG_SLUG = "acme";

// --------------------------------------------------------------------------
// Static catalogue — the shape of the demo world lives here rather than in
// the main() body so a reader can scan "what does the seed produce" without
// walking every await.
// --------------------------------------------------------------------------

type SeedUser = { email: string; name: string; role: Role };

const USERS: SeedUser[] = [
  { email: "owner@acme.test",    name: "Robin Sato",    role: "OWNER" },
  { email: "admin@acme.test",    name: "Alex Rivera",   role: "ADMIN" },
  { email: "dev@acme.test",      name: "Priya Shah",    role: "DEVELOPER" },
  { email: "auditor@acme.test",  name: "Morgan Lee",    role: "AUDITOR" },
];

type SeedProject = {
  slug: string;
  name: string;
  description: string;
  sensitivity: "internal" | "pii" | "pci" | "hipaa";
  secrets: SeedSecret[];
  targets: Array<{ envSlug: string; name: string; kind: SyncTargetKind; endpoint: string; pullMode?: boolean }>;
};

type SeedSecret = {
  path: string;
  key: string;
  valueType: "string" | "connection-string" | "json" | "pem" | "token" | "password";
  // The seed uses distinct per-env values so a drift test is meaningful.
  values: { dev: string; staging: string; prod: string };
  rotation?: "quarterly" | "manual-annual";
};

const PROJECTS: SeedProject[] = [
  {
    slug: "payments-api",
    name: "Payments API",
    description: "Transaction processing and billing integrations.",
    sensitivity: "pci",
    secrets: [
      { path: "db",      key: "DATABASE_URL",        valueType: "connection-string",
        values: {
          dev:     "postgres://payments:dev@db-dev.svc:5432/payments",
          staging: "postgres://payments:stg@db-staging.svc:5432/payments",
          prod:    "postgres://payments:prod@db-prod.svc:5432/payments",
        },
        rotation: "quarterly" },
      { path: "stripe",  key: "STRIPE_SECRET_KEY",   valueType: "token",
        // Deliberately not real Stripe prefixes (sk_test_, sk_live_). GitHub
        // secret scanning blocks a push that contains them, and our own
        // deny_plaintext_in_cicd policy rejects a WRITE that matches them.
        values: {
          dev:     "demo-stripe-dev-" + "a".repeat(32),
          staging: "demo-stripe-staging-" + "b".repeat(32),
          prod:    "demo-stripe-prod-" + "c".repeat(32),
        },
        rotation: "quarterly" },
      { path: "session", key: "SESSION_SECRET",      valueType: "password",
        values: {
          dev:     "dev-sess-" + "a".repeat(44),
          staging: "stg-sess-" + "b".repeat(44),
          prod:    "prod-sess-" + "c".repeat(44),
        },
        rotation: "quarterly" },
      { path: "cache",   key: "REDIS_URL",           valueType: "connection-string",
        values: {
          dev:     "redis://redis-dev:6379/0",
          staging: "redis://redis-staging:6379/0",
          prod:    "rediss://redis-prod:6379/0",
        } },
      { path: "ops",     key: "PAGERDUTY_TOKEN",     valueType: "token",
        values: {
          dev:     "pd-dev-abc123",
          staging: "pd-stg-def456",
          prod:    "pd-prod-ghi789",
        },
        rotation: "manual-annual" },
    ],
    targets: [
      { envSlug: "dev",     name: "developer-laptops", kind: SyncTargetKind.LOCAL,      endpoint: "local://workspace", pullMode: true },
      { envSlug: "staging", name: "k8s-staging",       kind: SyncTargetKind.KUBERNETES, endpoint: "k8s://staging-us-east/api/payments" },
      { envSlug: "prod",    name: "k8s-prod",          kind: SyncTargetKind.KUBERNETES, endpoint: "k8s://prod-us-east/api/payments" },
    ],
  },
  {
    slug: "customer-portal",
    name: "Customer Portal",
    description: "Customer-facing account self-service dashboard.",
    sensitivity: "pii",
    secrets: [
      { path: "db",      key: "DATABASE_URL",            valueType: "connection-string",
        values: {
          dev:     "postgres://portal:dev@db-dev.svc:5432/portal",
          staging: "postgres://portal:stg@db-staging.svc:5432/portal",
          prod:    "postgres://portal:prod@db-prod.svc:5432/portal",
        },
        rotation: "quarterly" },
      { path: "auth",    key: "OIDC_CLIENT_SECRET",      valueType: "token",
        values: {
          dev:     "oidc-dev-" + "x".repeat(40),
          staging: "oidc-stg-" + "y".repeat(40),
          prod:    "oidc-prod-" + "z".repeat(40),
        },
        rotation: "quarterly" },
      { path: "session", key: "SESSION_SECRET",          valueType: "password",
        values: {
          dev:     "portal-dev-" + "a".repeat(44),
          staging: "portal-stg-" + "b".repeat(44),
          prod:    "portal-prod-" + "c".repeat(44),
        },
        rotation: "quarterly" },
      { path: "email",   key: "SMTP_PASSWORD",           valueType: "password",
        values: {
          dev:     "smtp-dev-password",
          staging: "smtp-stg-password",
          prod:    "smtp-prod-strong-password",
        } },
      { path: "analytics", key: "SEGMENT_WRITE_KEY",      valueType: "token",
        values: {
          dev:     "seg-dev-writekey",
          staging: "seg-stg-writekey",
          prod:    "seg-prod-writekey",
        } },
    ],
    targets: [
      { envSlug: "dev",     name: "developer-laptops",    kind: SyncTargetKind.LOCAL,      endpoint: "local://workspace", pullMode: true },
      { envSlug: "staging", name: "github-actions-staging", kind: SyncTargetKind.CICD,     endpoint: "github://acme/customer-portal/actions" },
      { envSlug: "prod",    name: "k8s-prod",             kind: SyncTargetKind.KUBERNETES, endpoint: "k8s://prod-us-east/portal" },
    ],
  },
  {
    slug: "data-platform",
    name: "Data Platform",
    description: "Pipelines, warehouse and lakehouse integrations.",
    sensitivity: "internal",
    secrets: [
      { path: "db",       key: "DATABASE_URL",          valueType: "connection-string",
        values: {
          dev:     "postgres://data:dev@db-dev.svc:5432/data",
          staging: "postgres://data:stg@db-staging.svc:5432/data",
          prod:    "postgres://data:prod@db-prod.svc:5432/data",
        },
        rotation: "quarterly" },
      { path: "kafka",    key: "KAFKA_SASL_PASSWORD",   valueType: "password",
        values: {
          dev:     "kafka-dev-password",
          staging: "kafka-stg-password",
          prod:    "kafka-prod-strong-password",
        },
        rotation: "quarterly" },
      { path: "s3",       key: "S3_SECRET_KEY",         valueType: "token",
        values: {
          dev:     "s3-dev-" + "a".repeat(32),
          staging: "s3-stg-" + "b".repeat(32),
          prod:    "s3-prod-" + "c".repeat(32),
        },
        rotation: "quarterly" },
      { path: "airflow",  key: "AIRFLOW_FERNET_KEY",    valueType: "token",
        values: {
          dev:     "fernet-dev-" + "f".repeat(32),
          staging: "fernet-stg-" + "f".repeat(32),
          prod:    "fernet-prod-" + "f".repeat(32),
        } },
      { path: "dbt",      key: "DBT_CLOUD_TOKEN",       valueType: "token",
        values: {
          dev:     "dbt-dev-token",
          staging: "dbt-stg-token",
          prod:    "dbt-prod-token",
        },
        rotation: "manual-annual" },
    ],
    targets: [
      { envSlug: "dev",     name: "developer-laptops", kind: SyncTargetKind.LOCAL,      endpoint: "local://workspace", pullMode: true },
      { envSlug: "staging", name: "lambda-staging",    kind: SyncTargetKind.SERVERLESS, endpoint: "lambda://us-east-1/data-pipeline-staging" },
      { envSlug: "prod",    name: "terraform-prod",    kind: SyncTargetKind.TERRAFORM,  endpoint: "tf://acme-data-prod/variables" },
    ],
  },
];

// --------------------------------------------------------------------------
// main()
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  const existing = await db.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (existing) {
    console.log(`→ Organization "${ORG_SLUG}" already exists (id ${existing.id}). Nothing to do.`);
    console.log(`  Run "pnpm prisma migrate reset" if you want a fresh seed.`);
    return;
  }

  console.log("→ Hashing passwords…");
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  console.log("→ Creating organization + users…");
  const org = await db.organization.create({
    data: { name: "Acme Corporation", slug: ORG_SLUG, plan: "enterprise", activeKeyId: "kek-v1" },
  });

  const users: Record<string, User> = {};
  for (const u of USERS) {
    const user = await db.user.create({
      data: {
        email: u.email,
        name: u.name,
        passwordHash,
        status: "ACTIVE",
      },
    });
    await db.membership.create({
      data: { userId: user.id, organizationId: org.id, role: u.role },
    });
    users[u.email] = user;
  }
  const owner = users["owner@acme.test"]!;
  const admin = users["admin@acme.test"]!;
  const developer = users["dev@acme.test"]!;

  console.log("→ Rotation policies…");
  const quarterly = await db.rotationPolicy.create({
    data: {
      name: "Quarterly rotation",
      intervalDays: 90,
      notifyBeforeDays: 14,
      mode: "auto",
      generator: "base64:48",
      enabled: true,
    },
  });
  const manualAnnual = await db.rotationPolicy.create({
    data: {
      name: "Annual manual review",
      intervalDays: 365,
      notifyBeforeDays: 30,
      mode: "manual",
      generator: "base64:32",
      enabled: true,
    },
  });
  const rotationIds: Record<"quarterly" | "manual-annual", string> = {
    quarterly: quarterly.id,
    "manual-annual": manualAnnual.id,
  };

  console.log("→ Policies (one per rule in the catalogue)…");
  for (const [rule, meta] of Object.entries(RULE_CATALOGUE) as [PolicyRule, typeof RULE_CATALOGUE[PolicyRule]][]) {
    await db.policy.create({
      data: {
        organizationId: org.id,
        name: meta.title,
        description: meta.description,
        rule,
        severity: meta.defaultSeverity,
        enabled: true,
        config: rule === "max_ttl_days" ? { days: 90 } : Prisma.JsonNull,
      },
    });
  }

  console.log("→ Projects + environments…");
  const projectsByslug: Record<string, Project> = {};
  const envByProjectAndSlug: Record<string, Environment> = {};
  for (const p of PROJECTS) {
    const project = await db.project.create({
      data: {
        organizationId: org.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        sensitivity: p.sensitivity,
      },
    });
    projectsByslug[p.slug] = project;
    for (const [slug, stage, proto] of [
      ["dev", 0, false] as const,
      ["staging", 1, false] as const,
      ["prod", 2, true] as const,
    ]) {
      const env = await db.environment.create({
        data: {
          projectId: project.id,
          name: slug === "dev" ? "Development" : slug === "staging" ? "Staging" : "Production",
          slug,
          stage,
          protected: proto,
          requiresApproval: proto,
        },
      });
      envByProjectAndSlug[`${p.slug}/${slug}`] = env;
    }
  }

  console.log("→ Secrets + sealed versions…");
  const createdSecrets: Array<{ secret: Secret; env: Environment; project: Project }> = [];
  for (const p of PROJECTS) {
    const project = projectsByslug[p.slug]!;
    for (const envSlug of ["dev", "staging", "prod"] as const) {
      const env = envByProjectAndSlug[`${p.slug}/${envSlug}`]!;
      for (const s of p.secrets) {
        const secret = await db.secret.create({
          data: {
            projectId: project.id,
            environmentId: env.id,
            path: s.path,
            key: s.key,
            valueType: s.valueType,
            rotationPolicyId: s.rotation ? rotationIds[s.rotation] : null,
          },
        });
        const sealed = seal(s.values[envSlug]);
        await db.secretVersion.create({
          data: {
            secretId: secret.id,
            version: 1,
            ciphertext: sealed.ciphertext,
            iv: sealed.iv,
            authTag: sealed.authTag,
            wrappedDek: sealed.wrappedDek,
            dekIv: sealed.dekIv,
            dekAuthTag: sealed.dekAuthTag,
            keyId: sealed.keyId,
            valueHash: sealed.valueHash,
            fingerprint: sealed.fingerprint,
            createdById: owner.id,
            createdVia: "import",
          },
        });
        createdSecrets.push({ secret, env, project });
      }
    }
  }

  console.log("→ Sync targets + initial SyncState rows…");
  const targetsByName: Record<string, { id: string; environmentId: string; kind: SyncTargetKind }> = {};
  for (const p of PROJECTS) {
    for (const t of p.targets) {
      const env = envByProjectAndSlug[`${p.slug}/${t.envSlug}`]!;
      const target = await db.syncTarget.create({
        data: {
          environmentId: env.id,
          name: t.name,
          kind: t.kind,
          endpoint: t.endpoint,
          pullMode: t.pullMode ?? false,
          enabled: true,
          lastStatus: SyncStatus.SYNCED,
          lastRunAt: new Date(Date.now() - 1000 * 60 * 60 * 4),
        },
      });
      targetsByName[`${p.slug}/${t.envSlug}`] = { id: target.id, environmentId: env.id, kind: t.kind };
      const envSecrets = createdSecrets.filter((cs) => cs.env.id === env.id);
      for (const cs of envSecrets) {
        const head = await db.secretVersion.findFirst({
          where: { secretId: cs.secret.id },
          orderBy: { version: "desc" },
          select: { version: true, valueHash: true },
        });
        if (!head) continue;
        // Make one target in production drift, to exercise the UI.
        const drift =
          t.envSlug === "prod" && p.slug === "customer-portal" && cs.secret.key === "SMTP_PASSWORD";
        await db.syncState.create({
          data: {
            syncTargetId: target.id,
            secretId: cs.secret.id,
            status: drift ? SyncStatus.DRIFTED : SyncStatus.SYNCED,
            observedVersion: head.version,
            observedHash: drift ? "drifted".padEnd(64, "0") : head.valueHash,
          },
        });
      }
    }
  }

  console.log("→ Access requests + grants…");
  // One request already approved → produced a time-boxed grant above
  // (chronologically — we create them in order so the audit chain is clean).
  const paymentsProd = envByProjectAndSlug["payments-api/prod"]!;
  const approvedRequest = await db.accessRequest.create({
    data: {
      organizationId: org.id,
      environmentId: paymentsProd.id,
      requesterId: developer.id,
      reviewerId: admin.id,
      permission: "READ",
      justification: "Incident #1247 — need to confirm Stripe webhook secret for a customer refund investigation.",
      durationMinutes: 60,
      status: "APPROVED",
      decisionNote: "Approved for 1 hour, Priya please close out when done.",
      decidedAt: new Date(Date.now() - 1000 * 60 * 25),
      expiresAt: new Date(Date.now() + 1000 * 60 * 35),
    },
  });
  await db.grant.create({
    data: {
      organizationId: org.id,
      userId: developer.id,
      environmentId: paymentsProd.id,
      permission: "READ",
      expiresAt: new Date(Date.now() + 1000 * 60 * 35),
      createdById: admin.id,
    },
  });

  const pendingRequest = await db.accessRequest.create({
    data: {
      organizationId: org.id,
      environmentId: envByProjectAndSlug["data-platform/prod"]!.id,
      requesterId: developer.id,
      permission: "WRITE",
      justification: "Rotation of Kafka SASL password to resolve an expired credential blocking tonight's batch run.",
      durationMinutes: 120,
      status: "PENDING",
    },
  });

  // Durable (non-time-boxed) grant: admin gets WRITE on payments-api/staging.
  await db.grant.create({
    data: {
      organizationId: org.id,
      userId: admin.id,
      environmentId: envByProjectAndSlug["payments-api/staging"]!.id,
      permission: "WRITE",
      createdById: owner.id,
    },
  });

  console.log("→ A rotation event (so Rotation page has history)…");
  const stripeProd = createdSecrets.find(
    (cs) => cs.project.slug === "payments-api" && cs.env.slug === "prod" && cs.secret.key === "STRIPE_SECRET_KEY",
  );
  if (stripeProd) {
    await db.rotationEvent.create({
      data: {
        policyId: quarterly.id,
        secretId: stripeProd.secret.id,
        status: "SUCCEEDED",
        reason: "Scheduled 90-day rotation",
        fromVersion: null,
        toVersion: 1,
        runAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
      },
    });
  }

  console.log("→ Machine token for CI (plaintext printed once at the end)…");
  const minted = mintMachineToken();
  await db.apiToken.create({
    data: {
      organizationId: org.id,
      name: "github-actions",
      tokenHash: minted.hash,
      prefix: minted.prefix,
      principal: "ci/github/acme",
      scopes: ["secrets:read", "sync:run"] as Prisma.InputJsonValue,
      environmentIds: Prisma.JsonNull,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
      createdById: owner.id,
    },
  });

  console.log("→ Audit chain (recordEvent so hashes verify)…");
  await seedAuditEvents({
    orgId: org.id,
    ownerId: owner.id,
    ownerEmail: owner.email,
    adminId: admin.id,
    adminEmail: admin.email,
    developerId: developer.id,
    developerEmail: developer.email,
    firstPaymentsStripeId: stripeProd?.secret.id ?? null,
    paymentsProdEnvId: paymentsProd.id,
    approvedRequestId: approvedRequest.id,
    pendingRequestId: pendingRequest.id,
    firstTargetId: targetsByName["payments-api/staging"]?.id ?? null,
  });

  // --------------------------------------------------------------------------
  // Credential readout — the operator pastes these into the UI / env.
  // --------------------------------------------------------------------------
  const line = "─".repeat(72);
  console.log("\n" + line);
  console.log("Seed complete. Sign in at http://localhost:3000/login with:");
  console.log(line);
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(10)}  ${u.email.padEnd(22)}  password: ${DEMO_PASSWORD}`);
  }
  console.log(line);
  console.log(`Machine token (CI) — PRINTED ONCE, cannot be recovered:`);
  console.log(`  ${minted.plaintext}`);
  console.log(line + "\n");
}

// --------------------------------------------------------------------------
// seedAuditEvents — writes a short chronological run of events. Uses
// recordEvent so (organizationId, seq) and the SHA-256 chain are both
// produced by the same code the runtime writes, which means verifyChain()
// on the fresh seed returns ok with no special-cased replay.
// --------------------------------------------------------------------------

async function seedAuditEvents(args: {
  orgId: string;
  ownerId: string;
  ownerEmail: string;
  adminId: string;
  adminEmail: string;
  developerId: string;
  developerEmail: string;
  firstPaymentsStripeId: string | null;
  paymentsProdEnvId: string;
  approvedRequestId: string;
  pendingRequestId: string;
  firstTargetId: string | null;
}): Promise<void> {
  const common = { organizationId: args.orgId };
  const o = { actorId: args.ownerId, actorEmail: args.ownerEmail };
  const a = { actorId: args.adminId, actorEmail: args.adminEmail };
  const d = { actorId: args.developerId, actorEmail: args.developerEmail };

  await recordEvent({ ...common, ...o, action: "auth.login", resourceType: "session", result: "SUCCESS" });
  await recordEvent({ ...common, ...a, action: "auth.login", resourceType: "session", result: "SUCCESS" });
  await recordEvent({ ...common, ...d, action: "auth.login", resourceType: "session", result: "SUCCESS" });

  await recordEvent({
    ...common, ...o,
    action: "policy.update",
    resourceType: "policy",
    result: "SUCCESS",
    metadata: { rule: "require_mfa_for_prod", change: "enabled" },
  });

  await recordEvent({
    ...common, ...a,
    action: "token.create",
    resourceType: "api_token",
    resourceLabel: "github-actions",
    result: "SUCCESS",
    metadata: { principal: "ci/github/acme", scopes: ["secrets:read", "sync:run"] },
  });

  if (args.firstPaymentsStripeId) {
    await recordEvent({
      ...common, ...o,
      action: "secret.write",
      resourceType: "secret",
      resourceId: args.firstPaymentsStripeId,
      resourceLabel: "stripe/STRIPE_SECRET_KEY",
      environmentId: args.paymentsProdEnvId,
      secretId: args.firstPaymentsStripeId,
      result: "SUCCESS",
      metadata: { version: 1, via: "import" },
    });
    await recordEvent({
      ...common, ...o,
      action: "secret.rotate",
      resourceType: "secret",
      resourceId: args.firstPaymentsStripeId,
      resourceLabel: "stripe/STRIPE_SECRET_KEY",
      environmentId: args.paymentsProdEnvId,
      secretId: args.firstPaymentsStripeId,
      result: "SUCCESS",
      metadata: { reason: "Scheduled 90-day rotation" },
    });
    await recordEvent({
      ...common, ...d,
      action: "secret.read",
      resourceType: "secret",
      resourceId: args.firstPaymentsStripeId,
      resourceLabel: "stripe/STRIPE_SECRET_KEY",
      environmentId: args.paymentsProdEnvId,
      secretId: args.firstPaymentsStripeId,
      result: "DENIED",
      metadata: { reason: "rbac", note: "attempted before break-glass was approved" },
    });
  }

  await recordEvent({
    ...common, ...d,
    action: "request.create",
    resourceType: "access_request",
    resourceId: args.approvedRequestId,
    environmentId: args.paymentsProdEnvId,
    result: "SUCCESS",
    metadata: { permission: "READ", durationMinutes: 60 },
  });
  await recordEvent({
    ...common, ...a,
    action: "request.approve",
    resourceType: "access_request",
    resourceId: args.approvedRequestId,
    environmentId: args.paymentsProdEnvId,
    result: "SUCCESS",
    metadata: { decidedBy: args.adminEmail },
  });
  await recordEvent({
    ...common, ...a,
    action: "grant.create",
    resourceType: "grant",
    environmentId: args.paymentsProdEnvId,
    result: "SUCCESS",
    metadata: { permission: "READ", ttlMinutes: 60, reason: "incident-1247" },
  });

  if (args.firstPaymentsStripeId) {
    await recordEvent({
      ...common, ...d,
      action: "secret.read",
      resourceType: "secret",
      resourceId: args.firstPaymentsStripeId,
      resourceLabel: "stripe/STRIPE_SECRET_KEY",
      environmentId: args.paymentsProdEnvId,
      secretId: args.firstPaymentsStripeId,
      result: "SUCCESS",
      metadata: { version: 1, via: "break-glass" },
    });
  }

  await recordEvent({
    ...common, ...d,
    action: "request.create",
    resourceType: "access_request",
    resourceId: args.pendingRequestId,
    result: "SUCCESS",
    metadata: { permission: "WRITE", durationMinutes: 120 },
  });

  if (args.firstTargetId) {
    await recordEvent({
      ...common, ...a,
      action: "sync.run",
      resourceType: "sync_target",
      resourceId: args.firstTargetId,
      result: "SUCCESS",
      metadata: { pushed: 5, skipped: 0, dryRun: false },
    });
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await db.$disconnect();
    process.exitCode = 1;
  });
