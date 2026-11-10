# Security model

## Envelope encryption

A secret value never reaches the database in plaintext.

```
value ──AES-256-GCM──► ciphertext        (stored)
  ▲                      ▲
  │                      │
  └── DEK (32 random bytes, per version)
        │
        └──AES-256-GCM──► wrappedDek     (stored)
              ▲
              │
              └── KEK  (root key, from env or KMS — never stored)
```

Two layers, because they fail differently:

- The **DEK** is unique per version. Two versions of the same secret share no
  key material, so a single key compromise does not cascade across history.
- The **KEK** lives outside the database. A database dump — including a
  full backup, a stolen replica or a leaked snapshot — yields ciphertext only.

Each version records `keyId`, so rotating the KEK does not require re-encrypting
anything. Old versions keep working; `rewrapVersion()` swaps the wrapping key
lazily when a version is read.

GCM is authenticated, so tampering with the ciphertext, the wrapped key or the
nonce fails decryption rather than returning corrupted plaintext.

### What is stored alongside a value

| Field | Purpose | Reversible |
|---|---|---|
| `valueHash` | SHA-256 of the plaintext, used to compare versions and detect drift without decrypting | No |
| `fingerprint` | First 4 and last 4 characters of the hash, for display | No |
| `keyId` | Which root key wrapped this version | No |

The fingerprint is in the table because it lets an operator confirm two versions
are the same without either being revealed. It is not derived from the value.

---

## Access control

Two axes, both enforced server-side.

### Role

| Capability | Owner | Admin | Developer | Auditor | Read-only |
|---|:--:|:--:|:--:|:--:|:--:|
| Read values (non-protected) | ✅ | ✅ | ✅ | — | — |
| Read metadata | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write values (non-protected) | ✅ | ✅ | ✅ | — | — |
| Read values (protected) | ✅ | ✅ | grant | — | — |
| Write values (protected) | ✅ | ✅ | grant | — | — |
| Rotate | ✅ | ✅ | ✅ | — | — |
| Delete | ✅ | ✅ | — | — | — |
| Run sync | ✅ | ✅ | ✅ | — | — |
| Configure sync | ✅ | ✅ | — | — | — |
| Review requests | ✅ | ✅ | — | — | — |
| Manage policies / tokens | ✅ | ✅ | — | — | — |
| Manage bundle signing keys | ✅ | ✅ | — | — | — |
| Read audit | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verify chain | ✅ | ✅ | — | ✅ | — |
| Manage org / assign roles | ✅ | — | — | — | — |

### Environment scope

An environment is **protected** when its `stage` is at least 2 or its
`protected` flag is set. For a protected environment:

- Reading a value requires a role that permits reads **and** an unexpired
  grant scoped to that environment, unless the actor is an Owner or Admin.
- Writing requires an Admin-or-above role, or the same kind of grant.

The role is the ceiling; the grant widens it for one environment for a bounded
time. An Auditor can see that `stripe/SECRET_KEY` exists, how many versions it
has and when it last rotated — and can never read the value.

### Machine identities

Tokens are scoped at creation:

```json
{
  "scopes": ["secrets:read", "sync:run"],
  "environmentIds": ["env_dev_payments", "env_dev_portal"]
}
```

A token can never exceed the scopes it holds, and if `environmentIds` is set it
can only reach those environments — the bundle endpoint returns `403` for a
target outside the scope. Only SHA-256 of the token is persisted; the plaintext
exists once, in the creation response.

---

## The audit chain

Every event stores a digest over its own contents and the previous event's hash:

```
hash = SHA256(prevHash | seq | org | actor | action | resource | result | createdAt)
```

The first event in a chain links to a genesis hash of 64 zeros. Consequences:

- **Editing a row** changes its digest, so it no longer equals the stored `hash`,
  and every subsequent link also fails.
- **Deleting a row** breaks the `prevHash` linkage at the next event.
- **Inserting a row** requires recomputing every hash after it, which the
  verifier detects because the stored hashes no longer match.
- **Reordering or truncating** breaks the linkage at the point of change.

`verifyChain()` replays the whole chain and reports the sequence number where it
first fails, so a break is locatable rather than merely detectable.

Appends run inside a transaction that reads the tail and writes the next link.
A unique constraint on `(organizationId, seq)` rejects a racing writer, which
retries — so a fork cannot form under concurrency.

### What gets logged

`auth.login` · `auth.failed` · `auth.logout` · `secret.read` · `secret.write` ·
`secret.delete` · `secret.rotate` · `secret.export` · `sync.run` ·
`sync.configure` · `request.create` · `request.approve` · `request.deny` ·
`grant.create` · `policy.update` · `token.create` · `token.revoke`

Denied attempts are logged as `DENIED` with the reason, which is often the more
interesting half of the record.

---

## Reveal is a first-class event

Reading a value is the operation with the most insider-risk value, so it is
deliberately inconvenient:

- It is a `POST` endpoint — never cacheable, never prefetched, never in browser
  history.
- The response carries `Cache-Control: no-store` and `Pragma: no-cache`, and the
  header is set on both the route and in `next.config.ts`.
- The UI holds plaintext in component state only, clears it on hide, and
  auto-hides after 30 seconds.
- Every call appends a `secret.read` event naming the actor, the version and the
  fingerprint.
- There is no bulk "reveal everything" route. Metadata listings never include
  values, and only one version is ever in flight.

---

## Credential handling

| Secret | Storage |
|---|---|
| User passwords | argon2id (scrypt fallback if the native binding is unavailable) |
| API tokens | SHA-256, constant-time compared |
| Session cookies | HS256 JWT, httpOnly, `SameSite=Lax`, `Secure` in production, 8-hour expiry |
| Root keys | Environment or KMS, never database, never logged |
| CSRF | Double-submit cookie, value echoed in a header on mutations |

Login always performs a password verification, even for an email that does not
exist, so response timing does not reveal which accounts are real. Sign-ins are
rate-limited per `(email, IP)` over a 15-minute window.

---

## Transport and headers

`next.config.ts` sets `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
a restrictive `Permissions-Policy` and HSTS with `preload`.

`middleware.ts` refuses cross-origin state-changing API requests by comparing
the `Origin` header against `Host`. A mutation with a mismatched origin gets a
`403` before any handler runs, and every response carries an `x-request-id` so a
support conversation can be tied to one request.

---

## Threat model

### Mitigated

| Threat | Mitigation |
|---|---|
| Database exfiltration | Values are ciphertext; the KEK is elsewhere. Hashes and fingerprints are not reversible |
| Credential stuffing | Per-`(email, IP)` rate limit; uniform verification timing |
| Token theft from the database | Only hashes stored; plaintext shown once |
| Insider reading production | Protected environments need an explicit, expiring grant; every read is chained |
| Reviewer approving their own request | Separation of duties — the requester cannot decide their own request |
| Permanent access from a one-off decision | Grants carry an expiry derived from the request's own duration |
| History rewriting | Hash chain with a verifiable replay |
| A committed secret reaching production | The `deny_plaintext_in_cicd` rule rejects values shaped like provider keys |
| Silent drift | Per-target observed version and hash, surfaced in the UI |
| Key rotation downtime | `keyId` per version plus lazy rewrapping |
| Tampered pull bundle | Ed25519 detached signature on `GET /api/sync/:id/bundle`; agents verify before applying |

### Not mitigated — read this before deploying

- **No HSM or external KMS integration.** `resolveRootKey()` reads an
  environment variable. Production should replace that function body with a KMS
  call; the `Keyring` interface does not change.
- **No MFA enforcement.** The `require_mfa_for_prod` rule is modelled and
  landable, but no second factor is verified at login yet.
- **No SSO.** Password login only.
- **Single-region.** No read replicas, no failover, no multi-region key
  distribution.
- **No crypto-shredding.** Soft-delete leaves ciphertext in place. A true
  "delete every trace" guarantee needs per-subject keys and a key-destruction
  path.
- **No data-loss prevention on egress.** An Owner or Admin can read any value
  and paste it anywhere. This is inherent to a secrets manager — the control is
  the audit trail and the grant model, not prevention.

---

## Reporting

This is a reference implementation for evaluation, not a hardened product. If
you deploy it, commission a review of the crypto layer, the RBAC matrix and the
sync adapters before it holds anything that matters.
