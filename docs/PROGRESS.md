# SecretOps — Build Progress

Tracks what is built, what is in flight, and what is still ahead. Update as
part of the same change that moves a line — stale progress is worse than none.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-11-10 (phase-8/bundle-signing — M8 lands bundle signing; M7 fully closed before it)

---

## Milestone 0 — Scaffolding

- [x] Design docs (`README`, `ARCHITECTURE`, `SECURITY`, `CLI`, `CONTRIBUTING`)
- [x] `schema.prisma`
- [x] `docker-compose.yml`, `Dockerfile`, `.env.example`
- [x] `package.json` with pinned deps
- [x] `SPECS.md`, `PROGRESS.md`, `CLAUDE.md`
- [x] `next.config.mjs` with security headers + standalone output
- [x] `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`
- [x] `web/app/layout.tsx`, `web/app/globals.css` (Next.js scaffold)
- [x] `web/middleware.ts` (cross-origin guard + `x-request-id`)
- [x] `web/scripts/bootstrap.ts` — prints `SESSION_SECRET` + `SECRETOPS_ROOT_KEYS`
- [x] `web/prisma/schema.prisma` — moved from `docs/` so Prisma finds it

## Milestone 1 — Primitives

- [x] `web/lib/db.ts` — Prisma client singleton
- [x] `web/lib/crypto.ts` — `seal`, `open`, `rewrapVersion`, keyring, hash, generators, password hashing
- [x] `web/lib/auth.ts` — sessions (jose HS256), token mint/verify (SHA-256), CSRF, rate limit
- [x] `web/lib/session.ts` — `resolveActor()` from cookie or bearer
- [x] `web/lib/rbac.ts` — role matrix, `can()`, `canReadValue`, `canWriteValue`
- [x] `web/lib/validation.ts` — every Zod schema the API uses
- [x] `web/lib/audit.ts` — `recordEvent`, `verifyChain`, `actionLabel`
- [x] `web/lib/policies.ts` — `evaluatePolicies()` + rule catalogue

## Milestone 2 — Service layer

- [x] `web/lib/secrets.ts` — `listSecrets`, `putSecret`, `revealSecret`, `rotateSecret`, `deleteSecret`
- [x] `web/lib/sync.ts` — `planSync`, `runSync`, `recordObservedState`, `bundleFor`, `adapterFor` (stubs that decrypt-prove)

## Milestone 3 — Seed

- [x] `web/prisma/seed.ts` — org, users, projects, environments, secrets, targets, policies, rotation policies, access requests, seeded audit events
- [x] `prisma migrate dev --name init` + commit the generated directory
- [x] `prisma db seed` runs clean and prints credentials

## Milestone 4 — API

Health / Auth
- [x] `GET /api/health`
- [x] `POST /api/auth/login` (with rate limit + uniform timing)
- [x] `POST /api/auth/logout`

Secrets
- [x] `GET /api/secrets`
- [x] `POST /api/secrets` (idempotent on `valueHash`)
- [x] `GET /api/secrets/:id` (history)
- [x] `PATCH /api/secrets/:id`
- [x] `DELETE /api/secrets/:id` (soft)
- [x] `POST /api/secrets/:id/reveal` (`no-store`, audited, DENIED logged)
- [x] `POST /api/secrets/:id/rotate`

Sync
- [x] `GET /api/sync` · `POST /api/sync`
- [x] `GET /api/sync/:id/plan`
- [x] `POST /api/sync/:id/run` (`dryRun` honoured)
- [x] `GET /api/sync/:id/bundle` (pull-mode only; `no-store`)

Access
- [x] `GET /api/access/requests`
- [x] `POST /api/access/requests`
- [x] `PATCH /api/access/requests/:id` (approve / deny; grants created with expiry)

Governance
- [x] `GET /api/tokens` · `POST /api/tokens` (returns plaintext once)
- [x] `DELETE /api/tokens/:id`
- [x] `POST /api/audit/verify`
- [x] `GET /api/search?q=`

## Milestone 5 — Dashboard

Shell
- [x] `web/components/shell/Sidebar.tsx`
- [x] `web/components/shell/Header.tsx` (search field + health pill)
- [x] `web/components/shell/CommandPalette.tsx` — global ⌘K, three sections, keyboard nav
- [x] `web/app/(app)/layout.tsx`
- [x] UI primitives: `Button`, `Card`, `Table`, `Badge`, `Input`, `Gauge`, `StatChip`, `ChainStrip`, `Dialog`; native `<select>` used in filters, dedicated `Select` component deferred (no quality loss)

Pages
- [x] `web/app/login/page.tsx`
- [x] `/overview` — mirrors the mock (metrics, sync posture, runway, recent activity)
- [x] `/secrets` — filterable table, reveal (30s auto-close), rotate, delete
- [x] `/sync` — targets rail, plan diff, dry-run / apply
- [x] `/rotation` — overdue / due soon / no policy
- [x] `/access` — queue, active grants, members, recent decisions, approve/deny with note
- [x] `/audit` — event stream + chain verifier panel
- [x] `/policies` — enabled rules + catalogue
- [x] `/tokens` — mint-once dialog, scope checkboxes, revoke with confirm
- [x] `/settings` — org info, encryption posture (KEK + keyring size), session info

## Milestone 6 — Worker

- [x] `web/scripts/worker.ts` — rotation sweep (6h default)
- [x] `web/scripts/worker.ts` — drift sweep (30m default)
- [x] Shared JSON-per-line logging, honours `ROTATION_SWEEP_MS` / `DRIFT_SWEEP_MS`

## Milestone 8 — Bundle signing

Ed25519 signatures on `GET /api/sync/:id/bundle` so pull-mode agents can
detect tampering in transit or at rest. One active signing key per org;
soft-revoke on rotation keeps cached signatures verifiable for a grace
window.

Schema
- [x] `BundleKey` model — Ed25519 keypair per org, private key envelope-
      sealed with the same `seal()`/`open()` the rest of the crypto layer
      uses. Migration `*_bundle_signing`.

Service + crypto
- [x] `generateBundleKey`, `signBundle`, `verifyBundle` in `web/lib/crypto.ts`
- [x] `web/lib/bundleKeys.ts` — bootstrap / rotate / list / signBundlePayload
- [x] RBAC capability `bundle_key.manage` (OWNER, ADMIN) — mirrored in
      `SECURITY.md` capability table.
- [x] Audit actions `bundle_key.create`, `bundle_key.rotate` in
      `actionLabel()` so they render in English on the audit page.

API
- [x] `GET  /api/bundle-keys`           — list for the actor's org
- [x] `POST /api/bundle-keys`           — bootstrap (admin+, 409 if active exists)
- [x] `POST /api/bundle-keys/rotate`    — soft-revoke old, insert new active
- [x] `GET  /api/sync/:id/bundle`       — body signed, headers `x-signature-bundle`
      + `x-signature-key-id`; 409 `no_signing_key` if the org has not bootstrapped

Docs
- [x] `CLI.md` — pull-mode verify recipe in Node (≤30 lines, stdlib only)
- [x] `SECURITY.md` — capability row added, "Not mitigated" bullet removed,
      new mitigated-threat row for tampered bundles
- [x] `ARCHITECTURE.md` — bundle-signing section in the Sync chapter +
      limitations updated

Seed
- [x] Fresh seeds generate an initial `BundleKey` for Acme so the bundle
      route works out of the box. Existing databases need a one-time
      `POST /api/bundle-keys` (admin+); the smoke script does it.

Verification
- [x] `scripts/smoke-bundle-signing.ps1` — bootstrap (idempotent on 409) →
      fetch bundle → verify signature → tamper body → verify fails →
      rotate → old + new keys both listed → fetch uses new key.

## Milestone 7 — Release

All verifications are automated through `scripts/smoke-release.ps1`. The
default sweep (typecheck + worker + dashboard + 5b + 5c + chain-tamper +
roles) ran green on 2026-11-10 against a freshly regenerated Prisma
client; PR #18 landed on main as `f9e8033`. `next build` is intentionally
NOT in the default sweep because it writes to `.next` while `pnpm dev`
also owns it, so running them concurrently fails both. Build is a
separate manual check — stop the dev server, delete `.next`, then
`pnpm build` from `web/`.

- [x] `pnpm typecheck` clean (sweep 2026-11-10)
- [x] `pnpm build` clean — ran standalone from `web/` with the dev
      server stopped (2026-11-10). Fixes that got it there:
      `app/page.tsx` marked `force-dynamic` so `cookies()`/`headers()`
      stop throwing during prerender, and `app/login/page.tsx` split
      into a server shell + `LoginForm.tsx` client under a Suspense
      boundary so `useSearchParams` does not bail the whole prerender.
      Build stays out of the default `smoke-release.ps1` sweep because
      `next build` and `pnpm dev` both own `.next` and cannot coexist.
- [x] `docker compose --profile full up -d` builds and comes up healthy
      — now covered by the dedicated `scripts/smoke-docker-rehearsal.ps1`,
      which chains build + up + health probe + migration-drift check +
      in-container `prisma migrate deploy` (and an optional `-RunSeed`
      / `-Down`). Green on 2026-11-10. The dev-shaped
      `smoke-release.ps1 -IncludeDocker` is NOT the right gate here —
      see the 2026-11-10 decisions-log entry below.
- [x] CLI / HTTP happy paths succeed against a running instance
      (`smoke-dashboard` + `smoke-pages-5b` + `smoke-pages-5c` all PASS
      in the sweep 2026-11-10)
- [x] Manual test plan from `CONTRIBUTING.md` passes — RBAC matrix
      covered by `smoke-roles.ps1` which signs in as the four seeded
      users and asserts SECURITY.md's capability table holds (PASS
      2026-11-10)
- [x] Chain verifier catches a tamper on an edited row
      (`smoke-chain-tamper.ps1` — PASS 2026-11-10)

---

## Decisions log

Append-only. One line each, dated.

- **2026-11-06** — Build is a greenfield implementation of the already-written
  design docs; schema is frozen, docs are frozen, everything else is open.
- **2026-11-06** — Known gaps from `README.md` are explicitly accepted for v1
  and do not block the Milestone 7 sign-off.
- **2026-11-06** — Next.js scaffold lives at `web/` (not `src/` at repo root).
  All service-layer paths in SPECS/CLAUDE/PROGRESS now say `web/lib/*`; TS
  path alias `@/*` → `web/*` means imports are `@/lib/...`.
- **2026-11-06** — Schema moved from `docs/schema.prisma` to
  `web/prisma/schema.prisma` so `npx prisma generate` from the `web/` package
  root finds it with no extra config.
- **2026-11-06** — Docker is not required for everything: the primary dev
  flow stays "postgres in Docker, `pnpm dev` on the host". `docker compose
  up -d` is the single-host production-style path. The compose stack now
  builds from `./web` with the Dockerfile at `web/Dockerfile`, pnpm 10 via
  corepack, Next.js standalone output, and argon2 copied into the runtime
  image explicitly (it's `serverComponentsExternalPackages` in
  `next.config.mjs` so Next doesn't try to bundle the native binding).
- **2026-11-06** — Worker service dropped from `docker-compose.yml` until
  Milestone 6 lands `web/scripts/worker.ts`. Rationale: a service that
  always crash-loops is worse than one that isn't defined. Lands back when
  the code exists and the image copies `tsx` into runtime.
- **2026-11-09** — `.env` lives at the repo root but Prisma (invoked from
  `web/`) only looks at `web/.env` and `web/prisma/.env`. Running a prisma
  command therefore needs `DATABASE_URL` preloaded into the shell from
  `..\\.env`, or a wrapper that does it. Not fixed yet because adding
  `dotenv-cli` breaks the "no new deps without a reason" rule — revisit if
  the paper cut recurs.
- **2026-11-09** — Compose's `app` service is now opt-in via the `full` /
  `prod` profile. Default `docker compose up -d` brings up only `postgres`
  so there is never a `:3000` fight with `pnpm dev`. Full-stack rehearsal
  is `docker compose --profile full up -d`. CLAUDE.md § Commands → "Two
  paths, never both at once" documents the split.
- **2026-11-09** — Worker returns to `docker-compose.yml` now that
  `web/scripts/worker.ts` exists. Dockerfile's runner stage carries
  `scripts/`, `lib/`, `tsconfig.json` and installs `tsx@4.19.2` globally so
  `tsx scripts/worker.ts` resolves `@/lib/*` and the Prisma client at boot.
  Worker is also gated behind the `full` / `prod` profile — in hybrid-dev
  you run `pnpm worker` on the host in a second terminal.
- **2026-11-09** — Milestone 7 verification is automated as a chained
  PowerShell sweep (`scripts/smoke-release.ps1`) rather than a manual
  checklist in a doc. Each individual smoke stays runnable on its own.
  Chain-tamper detection has a dedicated destructive script that writes
  directly into `access_events` via `docker exec … psql`, calls the
  verifier, then restores the row inside a `finally` so a mid-script
  failure still leaves the chain intact. RBAC conformance against
  `SECURITY.md` is covered by `smoke-roles.ps1` which signs in as each
  seeded user and checks representative capabilities.
- **2026-11-10** — M7 sweep went green (PR #18 → `f9e8033` on main) after
  a long detour chasing a typecheck cascade: every error was a missing
  Prisma type (`AccessRequest`, `Grant`, `Role`, `Secret`, `ApiToken`,
  `SyncStatus`, plus built-ins `Prisma.JsonNull` and `Prisma.InputJsonValue`
  that every generated client ships with). Root cause was a corrupt
  `web/node_modules/.prisma/client` left behind by an earlier
  `pnpm build` that hit EPERM because `pnpm dev` was holding the query-
  engine DLL open on Windows. Fix is to stop the dev server, delete
  `web/node_modules/.prisma` and `web/node_modules/@prisma/client`,
  `pnpm install`, `pnpm prisma generate`. Future-us: if a Prisma-heavy
  typecheck explodes with "no exported member" on everything at once,
  suspect the generated client, not the source files.
- **2026-11-10** — `next build` is deliberately NOT in the default M7
  sweep. The sweep wants `pnpm dev` running so the HTTP smokes have a
  server to talk to, and `next build` writes to the same `.next` dir
  `pnpm dev` owns — they cannot coexist. Build is opt-in via
  `-IncludeBuild` and documented as a separate manual check.
- **2026-11-10** — Docker full-profile rehearsal is its own script
  (`scripts/smoke-docker-rehearsal.ps1`), NOT
  `smoke-release.ps1 -IncludeDocker`. Reason: the HTTP smokes in the
  release sweep were written for `pnpm dev` (NODE_ENV=development, plain
  HTTP, non-Secure cookies). The Docker `app` container runs
  NODE_ENV=production, which flips the session cookie's `secure` flag on
  (`web/lib/auth.ts:93`). `Invoke-WebRequest` will not keep a `Secure`
  cookie received over plain HTTP, so every auth-gated smoke fails at
  login even when `POST /api/auth/login` returns 200. The rehearsal
  script covers only what the production shape can actually prove over
  HTTP (health) plus in-container verifications via `docker exec`
  (migration drift, `prisma migrate deploy`, optional seed). The
  dev-shape sweep stays the gate for `pnpm dev` work.
- **2026-11-10** — M8 bundle signing chose Ed25519 over RSA for the detached
  signatures: 32-byte public key is compact enough to print in UI chips,
  stdlib-only verify in Node / Python / Go / Rust, and no parameter zoo.
  Signature is over the **exact JSON bytes** we write to the response — no
  canonicalization — matching GitHub's webhook convention. Private key
  storage reuses `seal()/open()` so there is one envelope pattern to audit,
  not two. Rotation is **soft**: `POST /api/bundle-keys/rotate` flips old
  active key to `active: false, revokedAt: now()` but keeps it listed on
  `GET /api/bundle-keys` so cached signatures still verify; a hard DELETE
  endpoint will come later when an operator needs to actually burn a key.
  A separate `BundleKey` table (not a field on Organization) because
  rotation needs multiple rows per org during the grace window, and the
  audit footprint wants its own `resource_type: "bundle_key"`.
- **2026-11-10** — Dockerfile defect uncovered and fixed during the
  rehearsal: the comment at `web/Dockerfile:54-56` advertised that
  `prisma migrate deploy` could be run via `docker compose exec`, but
  only `@prisma/client` and `.prisma` (the engine) were copied into the
  runtime image — the `prisma` CLI package was not. Invoking
  `pnpm prisma migrate deploy` from inside the container triggered
  pnpm 10's `verifyDepsBeforeRun`, which fetched 390 packages at
  runtime; corepack simultaneously auto-upgraded pnpm 10 → 12.18.0
  (no `packageManager` field pinning it); pnpm 12 then died trying to
  symlink into `/app/node_modules/.pnpm/*` with
  `ERR_PNPM_PACKAGE_MANAGER_SYMLINK_FAILED` (overlayfs EXDEV, "Cross-
  device link"). Fix: copy `/app/node_modules/prisma` from the builder
  stage and create a `.bin/prisma` shim pointing at
  `prisma/build/index.js`. Invocation becomes
  `docker compose exec app node_modules/.bin/prisma migrate deploy` —
  no pnpm, no corepack, no install at runtime. Seed uses the already-
  globally-installed `tsx` the same way.
- **2026-11-09** — Dashboard shipped in phase-5a read as a bland generic
  B2B template (shouldn't have called SPECS § 8's ASCII bar "v1 acceptable"
  and shipped it unchallenged). Reworked around a specific thesis — the
  product is a **forensic tool**, not growth-SaaS — with new tokens
  (graphite + phosphor + a single chartreuse used in four places only),
  mono as the display face, and an audit **chain strip** as the signature
  element. SPECS's permission to ship an ASCII coverage bar is now
  expressly superseded by the segmented `<Gauge>` primitive.

## Risks / open questions

- The seed must produce an audit chain that verifies. If `recordEvent()` is
  unavailable at seed time, the seed has to use the same hashing helper rather
  than writing rows directly.
- Argon2 native binding fails on some Alpine builds. The crypto layer must
  fall back to `scrypt` as `SECURITY.md` promises.
- ~~The mock's coverage bars are ASCII (`====|-----`). Keep it ASCII in the UI
  for now — a real bar component can replace it later without an API change.~~
  Superseded 2026-11-09: replaced with the segmented `<Gauge>` primitive as
  part of the phase-5a-redesign console pass.
