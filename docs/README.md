# SecretOps

A centralized control plane for application secrets. Keeps values in sync across
local development, CI/CD pipelines and production runtimes, with policy
enforcement, just-in-time access and a tamper-evident audit trail behind every
read and write.

---

## What it does

| Capability | How it works |
|---|---|
| **Central storage** | Every value is envelope-encrypted (AES-256-GCM) with a per-version data key before it touches Postgres |
| **Multi-environment sync** | Each project has dev / staging / prod environments; each environment maps to one or more sync targets (local workspace, CI/CD, Kubernetes, Terraform, serverless, VM) |
| **Drift detection** | Each target reports the version and value hash it holds; the control plane compares it to its own and flags the difference |
| **Rotation** | Policies set an interval and a mode — automatic generation or a task for an operator. A worker sweeps on schedule |
| **Governance** | Policy rules evaluated server-side on every write: reject raw provider credentials, force approval on production, cap credential lifetime, forbid wildcards |
| **Just-in-time access** | Users request a scope with a justification, a reviewer approves, and a time-boxed grant is issued that expires on its own |
| **Audit** | Append-only, hash-chained. Each event commits to its predecessor, so altering history is detectable |
| **Machine identities** | Scoped tokens for CI/CD, the CLI and pull-mode agents. Only the SHA-256 is stored |
| **RBAC** | Five roles plus per-environment grants. Protected environments require an explicit grant even to read |

---

## Quick start

```bash
# 1. Install
npm install

# 2. Generate the two secrets this deployment needs
npx tsx scripts/bootstrap.ts

# 3. Configure
cp .env.example .env
#    paste SESSION_SECRET and SECRETOPS_ROOT_KEYS from step 2 into .env

# 4. Start Postgres (or point DATABASE_URL at your own)
docker compose up -d postgres

# 5. Migrate and seed
npx prisma migrate dev
npx prisma db seed

# 6. Run
npm run dev          # dashboard on http://localhost:3000
npm run worker       # rotation + drift sweeps, in a second terminal
```

The seed prints the credentials it created. Sign in with any of them:

| Role | Email | Can |
|---|---|---|
| Owner | `owner@acme.test` | Everything, including org management |
| Admin | `admin@acme.test` | Approve requests, manage policies and tokens |
| Developer | `dev@acme.test` | Read and write non-protected environments, request access to production |
| Auditor | `auditor@acme.test` | Read metadata and the audit log, never values |

Password: `demo-password-change-me`.

---

## Architecture

```
                    ┌───────────────────────────────────────────┐
                    │            Control plane (Next.js)        │
   Browser ────────►│  dashboard pages + REST API route handlers│
                    │  RBAC · policy engine · audit chain       │
                    └───────────────┬───────────────────────────┘
                                    │
                    ┌───────────────▼───────────────────────────┐
                    │              Postgres                     │
                    │  organizations · projects · environments  │
                    │  secrets · secret_versions (ciphertext)   │
                    │  sync_targets · sync_states · grants      │
                    │  access_events (hash-chained)             │
                    └───────────────┬───────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
   ┌────▼─────┐              ┌──────▼──────┐             ┌──────▼──────┐
   │  Worker  │              │  Push mode  │             │  Pull mode  │
   │ rotation │              │  k8s, CI/CD,│             │  agent in a │
   │ drift    │              │  serverless │             │  private net│
   └──────────┘              └─────────────┘             └─────────────┘
```

Details, including the crypto design and the threat model, are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`SECURITY.md`](SECURITY.md).

### Directory map

```
prisma/
  schema.prisma          data model
  seed.ts                demo organization
src/
  app/
    (app)/               authenticated dashboard — overview, secrets, sync,
                         rotation, access, audit, policies, tokens, settings
    api/                 REST route handlers
    login/               sign-in
  components/            shell, command palette, UI primitives
  lib/
    crypto.ts            envelope encryption, password hashing, generators
    secrets.ts           secret service — put, reveal, rotate, policy evaluation
    sync.ts              sync engine, providers, pull bundles
    audit.ts             hash-chained event log
    rbac.ts              roles, capabilities, environment scoping
    auth.ts              sessions, machine tokens, CSRF
    session.ts           actor resolution from cookie or bearer token
    validation.ts        Zod schemas for every write path
  middleware.ts          cross-origin guard, request ids
scripts/
  worker.ts              rotation and drift schedulers
  bootstrap.ts           key generation
```

---

## The dashboard

- **Overview** — secret counts, drift per target, rotation runway, pending approvals, recent activity, project cards
- **Secrets** — filterable table across projects and environments. Values are masked by default; revealing one is a separate, audited request, auto-hidden after 30 seconds. Rotate and delete inline
- **Sync** — every target with coverage, drift counts and last run. Preview the exact diff before applying, dry-run, or sync now
- **Rotation** — what is overdue, what is due soon, what has no policy at all. One-click rotation
- **Access** — the request queue, active grants with expiry, and the member roster
- **Audit log** — filterable event stream with a chain verification panel that replays every hash
- **Policies** — enforced rules and the catalogue of rules you can enable
- **Tokens** — machine identities, their scopes and environment limits, and how to call the API
- **Settings** — organization, session, encryption posture, operational variables

Press <kbd>⌘K</kbd> anywhere for the command palette.

---

## API

Human sessions use the `sop_session` cookie. Machines use a bearer token.

```bash
# List secret metadata (never values)
curl -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/secrets?env=<environment-id>"

# Create or append a version
curl -X POST "$APP_URL/api/secrets" \
  -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"projectId":"…","environmentId":"…","path":"db","key":"DATABASE_URL","value":"postgres://…"}'

# Reveal (audited)
curl -X POST "$APP_URL/api/secrets/<id>/reveal" \
  -H "Authorization: Bearer $SECRETOPS_TOKEN"

# Preview a sync plan, then run it
curl -H "Authorization: Bearer $SECRETOPS_TOKEN" "$APP_URL/api/sync/<target-id>/plan"
curl -X POST "$APP_URL/api/sync/<target-id>/run" \
  -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  -H "content-type: application/json" -d '{"dryRun":false}'

# Pull-mode agents fetch a bundle
curl -H "Authorization: Bearer $SECRETOPS_TOKEN" "$APP_URL/api/sync/<target-id>/bundle"
```

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness and readiness, unauthenticated |
| `POST` | `/api/auth/login` · `/api/auth/logout` | Session lifecycle |
| `GET` `POST` | `/api/secrets` | List metadata · create or append |
| `GET` `PATCH` `DELETE` | `/api/secrets/:id` | History · update · soft delete |
| `POST` | `/api/secrets/:id/reveal` | Return the value (writes an audit event) |
| `POST` | `/api/secrets/:id/rotate` | Generate a new value |
| `GET` `POST` | `/api/sync` | List targets · register one |
| `GET` | `/api/sync/:id/plan` | Diff without touching the target |
| `POST` | `/api/sync/:id/run` | Apply (`dryRun` supported) |
| `GET` | `/api/sync/:id/bundle` | Pull-mode payload |
| `GET` `POST` `PATCH` | `/api/access/requests` | Queue · raise · decide |
| `PATCH` | `/api/access/requests/:id` | Approve or deny |
| `GET` `POST` `DELETE` | `/api/tokens` | List · mint · revoke |
| `POST` | `/api/audit/verify` | Replay the hash chain |
| `GET` | `/api/search?q=` | Command palette backing |

---

## Deployment

The included `Dockerfile` produces a standalone Next.js server running as a
non-root user, with a health check wired to `/api/health`.

```bash
docker compose up -d
docker compose exec app pnpm prisma migrate deploy
docker compose exec app pnpm db:seed              # optional demo data
```

`docker-compose.yml` starts three services: Postgres, the app, and the worker.
`SESSION_SECRET` and `SECRETOPS_ROOT_KEYS` are required — the app refuses to
start without them in production, and the stack will not come up if they are
unset.

### Environment

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes in prod | Signs dashboard sessions, 32+ characters |
| `SECRETOPS_ROOT_KEYS` | yes in prod | `keyId:base64` list, comma-separated. First entry is active |
| `APP_URL` | no | Origin used in generated snippets |
| `ROTATION_SWEEP_MS` | no | Rotation sweep interval, default 6h |
| `DRIFT_SWEEP_MS` | no | Drift sweep interval, default 30m |

In development, a deterministic throwaway root key is derived so the app boots
without configuration. That path is refused outright when
`NODE_ENV=production`.

### Rotating the root key

Generate a new key, prepend it, keep the old one:

```bash
SECRETOPS_ROOT_KEYS="kek-v2:<new>,kek-v1:<old>"
```

New writes use `kek-v2`. Existing versions record the key that wrapped them and
keep decrypting. `rewrapVersion()` in `src/lib/crypto.ts` re-wraps them in place
as they are read — no downtime and no bulk re-encryption pass.

---

## Verification

```bash
npm run typecheck     # tsc --noEmit
npm run build         # prisma generate && next build
```

---

## Known gaps

Stated plainly, because a control plane that overstates itself is worse than one
that does not.

- **Sync provider adapters are reference implementations.** `adapterFor()` in
  `src/lib/sync.ts` decrypts each version to prove it is retrievable and reports
  success. Wiring it to a real Kubernetes, GitHub, Terraform or serverless API is
  a matter of replacing that one function body — the plan / apply / observe
  contract around it is complete.
- **Rate limiting is in-process.** Fine for a single instance; put it in Redis
  before running more than one behind a load balancer.
- **No SCIM or OIDC.** Users are created by the seed or directly in the
  database. An enterprise rollout wants SSO wired into `/api/auth/login`.
- **The pull bundle is returned as JSON.** A production agent would additionally
  verify a signature over the payload so a compromised control plane cannot
  silently alter values in flight.
- **Soft delete only.** There is no purge route; retention and crypto-shredding
  would be a deliberate, admin-only addition.
- **No migration directory yet.** Run `npx prisma migrate dev --name init` to
  generate the first one.

---

## Licence

Provided as-is for evaluation.
