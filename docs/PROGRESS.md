# SecretOps — Build Progress

Tracks what is built, what is in flight, and what is still ahead. Update as
part of the same change that moves a line — stale progress is worse than none.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-11-09 (phase-2/service-layer branch — M2 complete)

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

- [ ] `prisma/seed.ts` — org, users, projects, environments, secrets, targets, policies, rotation policies, access requests, seeded audit events
- [ ] `prisma migrate dev --name init` + commit the generated directory
- [ ] `prisma db seed` runs clean and prints credentials

## Milestone 4 — API

Health / Auth
- [ ] `GET /api/health`
- [ ] `POST /api/auth/login` (with rate limit + uniform timing)
- [ ] `POST /api/auth/logout`

Secrets
- [ ] `GET /api/secrets`
- [ ] `POST /api/secrets` (idempotent on `valueHash`)
- [ ] `GET /api/secrets/:id` (history)
- [ ] `PATCH /api/secrets/:id`
- [ ] `DELETE /api/secrets/:id` (soft)
- [ ] `POST /api/secrets/:id/reveal` (`no-store`, audited, DENIED logged)
- [ ] `POST /api/secrets/:id/rotate`

Sync
- [ ] `GET /api/sync` · `POST /api/sync`
- [ ] `GET /api/sync/:id/plan`
- [ ] `POST /api/sync/:id/run` (`dryRun` honoured)
- [ ] `GET /api/sync/:id/bundle` (pull-mode only; `no-store`)

Access
- [ ] `GET /api/access/requests`
- [ ] `POST /api/access/requests`
- [ ] `PATCH /api/access/requests/:id` (approve / deny; grants created with expiry)

Governance
- [ ] `GET /api/tokens` · `POST /api/tokens` (returns plaintext once)
- [ ] `DELETE /api/tokens/:id`
- [ ] `POST /api/audit/verify`
- [ ] `GET /api/search?q=`

## Milestone 5 — Dashboard

Shell
- [ ] `web/components/shell/Sidebar.tsx`
- [ ] `web/components/shell/Header.tsx` (search field + health pill)
- [ ] `web/components/shell/CommandPalette.tsx`
- [ ] `web/app/(app)/layout.tsx`
- [ ] UI primitives: `Button`, `Card`, `Table`, `Badge`, `Dialog`, `Input`, `Select`, `CoverageBar`

Pages
- [ ] `web/app/login/page.tsx`
- [ ] `/overview` — mirrors the mock (metrics, sync posture, runway, recent activity)
- [ ] `/secrets` — filterable table, reveal, rotate, delete
- [ ] `/sync` — targets, plan/dry-run/apply
- [ ] `/rotation` — overdue / due soon / no policy
- [ ] `/access` — queue, active grants, members
- [ ] `/audit` — event stream + chain verifier panel
- [ ] `/policies` — enabled rules + catalogue
- [ ] `/tokens` — mint, scopes, env limits, revoke
- [ ] `/settings` — org, session, encryption posture

## Milestone 6 — Worker

- [ ] `scripts/worker.ts` — rotation sweep (6h default)
- [ ] `scripts/worker.ts` — drift sweep (30m default)
- [ ] Shared logging format, honours `ROTATION_SWEEP_MS` / `DRIFT_SWEEP_MS`

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

## Risks / open questions

- The seed must produce an audit chain that verifies. If `recordEvent()` is
  unavailable at seed time, the seed has to use the same hashing helper rather
  than writing rows directly.
- Argon2 native binding fails on some Alpine builds. The crypto layer must
  fall back to `scrypt` as `SECURITY.md` promises.
- The mock's coverage bars are ASCII (`====|-----`). Keep it ASCII in the UI
  for now — a real bar component can replace it later without an API change.
