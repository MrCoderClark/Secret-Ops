# CLAUDE.md — SecretOps

Project-specific guidance for Claude Code working in this repo. Read before
touching code; it names the invariants that are easy to break and expensive to
unbreak.

## What this project is

SecretOps is a self-hosted secrets management control plane. One organization,
many projects, three environments per project (dev/staging/prod), envelope-
encrypted values with per-version data keys, a hash-chained audit log, RBAC
with per-environment grants, rotation policies run by a worker, sync targets
with drift detection, scoped machine tokens, and a dashboard that is the primary
interface.

Read these before planning anything non-trivial:

- `README.md` — product surface and quick start
- `ARCHITECTURE.md` — layering, request lifecycles, design decisions
- `SECURITY.md` — crypto design, RBAC matrix, audit chain, threat model
- `CLI.md` — the shape of every API route the CLI calls
- `SPECS.md` — the binding build spec
- `PROGRESS.md` — what exists, what is in flight

The schema in `schema.prisma` is the source of truth for the data model. Do
not change it without updating `ARCHITECTURE.md` and `SECURITY.md` in the same
change.

## Non-negotiables

These rules are the point of the system. Breaking them is a security defect, not
a style issue.

1. **A secret value never leaves `web/lib/secrets.ts` in plaintext** except
   through `revealSecret()`. No log line, no error message, no list response,
   no React prop handed to a client component. If you find yourself wanting to,
   something upstream is wrong.
2. **Every mutation writes an `AccessEvent`.** Successes and denials both. The
   audit chain is the user-facing security property — a missing event is worse
   than a missing feature.
3. **`SecretVersion` is append-only.** Never `UPDATE`. A write that would
   produce the same `valueHash` as the current version is a no-op; do not
   insert.
4. **UI checks are not enforcement.** Every capability check must also run on
   the server. Hide the button AND refuse the request.
5. **The KEK never touches the database, a log, or a response.** It lives in
   the process memory, derived from `SECRETOPS_ROOT_KEYS`. In production, the
   app refuses to start without it.
6. **Reveal is `POST` + `Cache-Control: no-store`.** Never a `GET`. Set the
   header on the route AND in `next.config.ts`.
7. **Append an `AccessEvent` inside the same transaction that reads the tail.**
   `(organizationId, seq)` is unique — a race loses and must retry rather than
   fork the chain.

## How work is laid out

The layering in `ARCHITECTURE.md § Layering` is load-bearing. In particular:

- Client components never import from `web/lib/secrets.ts`. They receive
  metadata as props from a server component, and call the reveal route when a
  human asks for a value.
- API routes validate (Zod), resolve the actor, check the capability, and
  delegate. They contain no crypto, no business logic, no Prisma calls that
  touch secret material.
- The service layer (`web/lib/secrets.ts`, `sync.ts`, `audit.ts`) owns the
  invariants. Every path that touches a value goes through here.
- Pure helpers (`rbac.ts`, `validation.ts`) are called by both the UI and the
  API so they always agree.

New code slots into this layering. If it does not, stop and reconsider before
adding a lateral import.

## Commands

```bash
npm install
npx tsx scripts/bootstrap.ts    # generate SESSION_SECRET + SECRETOPS_ROOT_KEYS
cp env.example .env             # paste them in
docker compose up -d postgres
npx prisma migrate dev
npx prisma db seed
npm run dev                     # dashboard on :3000
npm run worker                  # rotation + drift sweeps, second terminal
npm run typecheck
npm run build
```

`npm run typecheck` and `npm run build` are the gate. Neither needs a live
database — the build sets a placeholder `DATABASE_URL`.

## Branching

Every major change goes on its own branch off `main`. Do not commit a feature,
milestone, or refactor straight to `main` — branch first, make the change,
merge back. "Major" here means anything larger than a one-line doc tweak or a
typo fix: a milestone from `PROGRESS.md`, a new service module, a schema
change, a UI pass, a dependency bump.

Branch names follow `phase-N/short-slug` for milestone work (e.g.
`phase-1/primitives`, `phase-4/api-secrets`) and `fix/<slug>` or
`chore/<slug>` for everything else. Keep a branch focused on one concern —
smaller, reviewable changes beat a sprawling branch that touches everything.

When a branch's work lands, update the matching checkbox in `PROGRESS.md` in
the same commit.

### Staging rules that matter

- **Never use `git commit -am`** when the change set includes new files. `-a`
  only stages *modified tracked* files; untracked ones are silently left out,
  and the commit's message ends up lying about its contents. This has already
  bitten us once — PR #1 shipped a "primitives" commit that contained only a
  schema rename because the eight `web/lib/*.ts` files were untracked.
  Always: `git add <explicit paths>`, then `git status` to eyeball what will
  land, then `git commit -m ...`.
- **After editing `web/package.json`**, run `pnpm install` from `web/` before
  `pnpm typecheck` or `pnpm prisma generate`. Otherwise `npx` falls back to
  downloading whatever version it wants — which has produced a Prisma 8 RC
  against a `@prisma/client@5.22` runtime.
- **After editing `web/prisma/schema.prisma`**, run `pnpm prisma generate`
  from `web/` before typecheck. The generated client is what the service
  layer imports from `@prisma/client`.

## Conventions

- **Validation.** Every write path parses its body with a Zod schema from
  `web/lib/validation.ts`. Add the schema there, do not inline it.
- **Authorization.** Use `can()`, `canReadValue()`, `canWriteValue()` from
  `web/lib/rbac.ts`. Do not write a role comparison inline.
- **Audit.** Add new actions to `actionLabel()` so the UI renders them in
  English. Record DENIED events with a `reason` in the metadata.
- **Validation errors.** Return `{ error, fieldErrors }` — the UI relies on it.
- **No value in a log line.** Not even as `[redacted]`. Log the fingerprint,
  the version, and the keyId; those are safe.
- **No new dependencies without a reason** the standard library cannot meet.
  Current deps are the full set: `@prisma/client`, `argon2`, `jose`, `next`,
  `react`, `react-dom`, `zod`.

## UI

Follow the mock (`mock-ui-design.png`) for the overview. Dark theme by default,
respect `prefers-color-scheme`. Colours come from CSS variables in
`globals.css` — components reference the token, never a raw hex.

The nine nav items in the sidebar are, in order: Overview, Secrets, Sync,
Rotation, Access, Audit log, Policies, Tokens, Settings. The user card at the
bottom shows avatar, name, role, and a Sign out button.

## When adding something

- **A sync provider** — implement `adapterFor(kind)` in `web/lib/sync.ts`. Keep
  the plan/apply/observe contract. Resolve values through the stored version,
  return `{ ok, error }` rather than throwing, and report the hash the target
  now holds.
- **A policy rule** — extend the union in `createPolicySchema`, add a case in
  `evaluatePolicies()`, add a catalogue entry on the Policies page.
- **A role capability** — edit the matrix in `web/lib/rbac.ts` and mirror the
  change in the `SECURITY.md` table in the same commit.
- **A new audited action** — add it to `actionLabel()`, write it at the point
  the action completes (and at the DENIED path too).

## What not to do

- Do not add SSO, MFA enforcement, bundle signing, crypto-shredding, HSM
  integration, or a real KMS without asking first. They are documented gaps and
  each is a project of its own.
- Do not add a real cloud provider SDK to `web/lib/sync.ts`. The adapters are
  stubs on purpose — they prove the value decrypts and report success. A real
  integration is a deliberate, scoped addition.
- Do not introduce a Redis dependency to move rate limiting out of process. It
  is a known limitation; make it a milestone, not a drive-by.
- Do not add a server action that returns plaintext. Reveal is a `POST` route,
  full stop.
- Do not weaken the audit chain for performance. Batching audit writes outside
  the mutation transaction is not an option — the chain is the product.

## Working with memory

Tasks that span a session (audit refactors, adapter work, UI passes) belong in
`PROGRESS.md`, not in CLAUDE memory. Memory is for how the user prefers to
collaborate and surprises worth remembering across sessions; work-in-flight is
for the file that gets committed with the code.
