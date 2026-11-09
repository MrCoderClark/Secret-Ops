# SecretOps — Build Progress

Tracks what is built, what is in flight, and what is still ahead. Update as
part of the same change that moves a line — stale progress is worse than none.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-11-09 (phase-5a-redesign/console branch — shell + Overview redesigned to "graphite + phosphor + chartreuse" direction)

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
- [ ] `web/components/shell/CommandPalette.tsx` (phase-5b)
- [x] `web/app/(app)/layout.tsx`
- [~] UI primitives: `Button`, `Card`, `Table`, `Badge`, `Input`, `CoverageBar` done; `Dialog`, `Select` in phase-5b

Pages
- [x] `web/app/login/page.tsx`
- [x] `/overview` — mirrors the mock (metrics, sync posture, runway, recent activity)
- [ ] `/secrets` — filterable table, reveal, rotate, delete (stub placeholder in 5a)
- [ ] `/sync` — targets, plan/dry-run/apply (stub placeholder in 5a)
- [ ] `/rotation` — overdue / due soon / no policy (stub placeholder in 5a)
- [ ] `/access` — queue, active grants, members (stub placeholder in 5a)
- [ ] `/audit` — event stream + chain verifier panel (stub placeholder in 5a)
- [ ] `/policies` — enabled rules + catalogue (stub placeholder in 5a)
- [ ] `/tokens` — mint, scopes, env limits, revoke (stub placeholder in 5a)
- [ ] `/settings` — org, session, encryption posture (stub placeholder in 5a)

## Milestone 6 — Worker

- [x] `web/scripts/worker.ts` — rotation sweep (6h default)
- [x] `web/scripts/worker.ts` — drift sweep (30m default)
- [x] Shared JSON-per-line logging, honours `ROTATION_SWEEP_MS` / `DRIFT_SWEEP_MS`

## Milestone 7 — Release

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] `docker compose up -d` builds and comes up healthy
- [ ] CLI examples from `CLI.md` succeed against a fresh instance
- [ ] Manual test plan in `CONTRIBUTING.md § Testing changes by hand` passes
- [ ] Chain verifier catches a tamper on an edited row

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
