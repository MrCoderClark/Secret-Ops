# Architecture

## The problem

A secret exists in more places than it has owners. The same
`DATABASE_URL` lives in a developer's `.bashrc`, a CI provider's secret store,
a Kubernetes `Secret`, a Terraform variable set and a serverless function's
environment. Each has its own lifecycle, its own access control and its own
diff. Nothing tells you when they disagree, and by the time you find out it is
usually because something broke in production.

SecretOps makes the values central and treats every runtime as a replica of a
single source of truth.

## The model

```
Organization
├── Memberships (role: OWNER | ADMIN | DEVELOPER | AUDITOR | READONLY)
├── Policies            org-wide rules evaluated on every write
├── Grants              time-boxed access to a scope
├── AccessRequests      justification → review → grant
├── ApiTokens           machine identities, scoped
├── AccessEvents        append-only, hash-chained
└── Project
    ├── Environment     the sync axis: dev (0) · staging (1) · prod (2)
    │   ├── SyncTarget  where the values must exist at runtime
    │   └── Secret      logical identity: a path + a key
    │       ├── SecretVersion   immutable, envelope-encrypted revisions
    │       └── SyncState       what this target currently holds
    └── …
```

Three decisions shape everything downstream.

**A secret is an identity, not a value.** `Secret` holds the path, key,
description and type. The value lives on `SecretVersion`, one row per write,
immutable. Version history, rollback and audit are consequences of the schema
rather than features bolted onto it.

**Environments are the sync axis.** The same logical secret exists in every
environment with a different value. This is what makes drift meaningful: you are
not comparing arbitrary strings, you are asking whether the prod replica of this
secret matches the control plane's idea of it.

**Everything is scoped to an environment.** Grants, sync targets, approval
requirements and read permissions all attach to an environment, because that is
the unit a team actually reasons about when they say "production".

## Request lifecycle

### Writing a secret

```
POST /api/secrets
  │
  ├─ resolve actor          cookie session or bearer token
  ├─ role check             can(actor, "secret.write")
  ├─ load environment       must belong to the actor's organization
  ├─ scope check            canWriteValue(actor, env) — protected envs need Admin or a grant
  ├─ policy evaluation      evaluatePolicies() → violations abort with 422
  ├─ seal                   seal(value, keyring) → ciphertext + wrapped DEK
  ├─ transaction
  │    ├─ compare valueHash against the current version → no-op if equal
  │    ├─ create Secret if first write
  │    └─ append SecretVersion with the next version number
  └─ recordEvent            "secret.write", with version, fingerprint and keyId
```

The idempotency check matters more than it looks. A CI job that pushes its
environment on every build would otherwise inflate version numbers until history
is meaningless. Comparing the hash first means an unchanged push writes nothing.

### Reading a secret

Metadata and values take different paths on purpose.

- `listSecrets()` returns key, path, type, version count, fingerprint and last
  sync — never a value, never a decryption. It is safe to call from a list page.
- `revealSecret()` is the only function that returns plaintext. It checks
  `canReadValue()`, opens the format from the sealed columns, and writes a
  `secret.read` event. It logs denials too, so an attempt that failed is as
  visible as one that succeeded.

### Syncing an environment

```
planSync()      diff control plane vs. observed state → create / update / noop
    │
runSync()       ─► adapter.apply() per entry ─► recordObservedState()
    │
    └─ SyncRun row with a structured log, SyncState rows updated,
       target status refreshed, "sync.run" appended to the chain
```

`planSync()` is a pure read and the UI calls it directly for the preview diff.
`runSync()` is the only thing that writes to a target, and it accepts `dryRun`
so the preview and the execution share one code path — a preview that cannot
diverge from the real run.

**Push vs pull.** In push mode the control plane calls the provider. In pull
mode an agent inside the target's network calls `/api/sync/:id/bundle` with a
scoped token, so a private-network runtime never needs an inbound endpoint. Pull
mode is what you want when the target is behind a firewall or when you would
rather the long-lived credential have read-only access.

### Rotation

Two sweep paths, one mechanism. `rotateSecret()` generates a value from the
policy's spec, calls `putSecret()` — so rotation inherits every policy check,
the audit entry and the versioning for free — then records a `RotationEvent`.

The worker classifies each secret whose runway has elapsed:

- `auto` mode generates a new value and applies it.
- `manual` mode writes a `SCHEDULED` event and an audit entry. That is the work
  item an operator picks up. Nothing changes without a human.

The distinction matters because rotation is not always safe to automate: rotating
a key the application caches means a deploy window, and rotating a third-party
credential means someone has to update the other end too.

## Layering

| Layer | Files | Rule |
|---|---|---|
| Presentation | `src/app/(app)/**`, `src/components/**` | Reads through the service layer; never talks to Prisma for secret material |
| HTTP | `src/app/api/**` | Validates, resolves the actor, delegates. No business logic, no crypto |
| Service | `src/lib/secrets.ts`, `sync.ts`, `audit.ts` | Owns the invariants. Everything that touches a value goes through here |
| Domain | `src/lib/rbac.ts`, `validation.ts` | Pure functions. Same answer for the UI and the API |
| Primitives | `src/lib/crypto.ts`, `auth.ts`, `db.ts` | No knowledge of the domain above them |

The important property is that a client component cannot reach secret material.
The client components in the secrets table receive metadata as props and call
`/api/secrets/:id/reveal` when a human asks for a value. There is no import path
from a client bundle to `open()`.

Server components read directly through the service layer, which is why the
overview page can compute drift across every target in one pass rather than
N+1 API calls. RBAC is applied at that boundary too — the page hides what the
actor cannot see, and the route handler refuses it regardless.

## Design decisions worth stating

**Why hash-chain the audit log rather than use an append-only table?**
Append-only is a promise about application behaviour. A hash chain is a property
of the data: you can hand the table to an auditor and they can verify it
themselves with nothing but the rows. It costs one extra digest per write.

**Why store `valueHash` separately from the ciphertext?**
It answers "has this changed?" and "does the target match?" without decrypting.
Both are frequent questions, and neither should require the root key.

**Why a `keyId` on every version instead of one global key?**
Rotating a KEK would otherwise mean decrypting and re-encrypting every value in
a maintenance window. With a per-version key id, rotation is an environment
change plus lazy rewrapping, and the old key stays valid for old rows
indefinitely.

**Why is the reveal endpoint a POST?**
A `GET` would be cached by some proxy somewhere, land in browser history, and be
eligible for prefetch. `POST` plus `no-store` plus component-state-only storage
means plaintext has no durable home.

**Why is policy evaluation separate from validation?**
Zod answers "is this well-formed?". Policies answer "should this be allowed at
all, given what the organization has decided?". The first is a schema concern;
the second changes when the organization changes its mind. Keeping them apart
means a new policy is data, not a code change to the validation layer.

## Extension points

| Want to… | Touch |
|---|---|
| Add a real sync provider | `adapterFor()` in `src/lib/sync.ts` — one function, keep the plan/apply/observe contract |
| Add a policy rule | Add to the union in `createPolicySchema`, add a case in `evaluatePolicies()` |
| Move the root key to a KMS | `resolveRootKey()` in `src/lib/crypto.ts` — return the same `Keyring` shape |
| Add SSO | `src/app/api/auth/login/route.ts` — mint the same session cookies from an OIDC callback |
| Add a webhook on events | `recordEvent()` in `src/lib/audit.ts` — one place sees everything |
| Add a CLI | The REST API plus a `secrets:read` token is the whole surface |

## Known limitations

See the closing section of the README. The sync adapters are reference
implementations, rate limiting is in-process, and there is no SSO, MFA
enforcement, bundle signing, or crypto-shredding. Each is a place where the
structure is right and the implementation stops short.
