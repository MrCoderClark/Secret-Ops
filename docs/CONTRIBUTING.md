# Contributing

## Setup

```bash
npm install
npx tsx scripts/bootstrap.ts     # generate SESSION_SECRET and SECRETOPS_ROOT_KEYS
cp .env.example .env             # paste them in
docker compose up -d postgres
npx prisma migrate dev
npx prisma db seed
npm run dev
```

## Before you open a pull request

```bash
npm run typecheck
npm run build
```

Both must pass. Neither needs a live database — the build sets a placeholder
`DATABASE_URL` because pages read at request time.

## Conventions

### Secret material

If you are adding a code path that touches a value, it belongs in
`src/lib/secrets.ts`. The rules that module exists to enforce:

- Never return plaintext from anything except `revealSecret()`.
- Never include a value in a log line, an error message or a list response.
- Never write a `SecretVersion` — always append one.
- Always append an audit event, on success and on denial.

If you find yourself calling `open()` outside that module, stop and reconsider.
The one legitimate exception is the sync adapters, which must decrypt to prove a
value is retrievable before reporting a push as successful.

### Validation

Every write path parses its body with a Zod schema from `src/lib/validation.ts`.
Add the schema there rather than inlining it — one place to see the full input
surface of the API.

### Authorization

Check permissions with the pure helpers in `src/lib/rbac.ts`:

```ts
if (!can(actor, "secret.write")) return forbidden();
if (!canWriteValue(actor, environment)) return forbidden();
```

Never write your own role comparison. The capability matrix is the single place
that answers "may this role do this?", and the UI and the API must agree — the
UI uses it to hide a control, the API uses it to refuse the request. Hiding is
not enforcement; both checks are required.

### Audit events

New actions get an entry in the `actionLabel()` map so the UI renders them as
English rather than a code string. Denials should be recorded with a `reason` in
the metadata — an attempt that failed is as interesting as one that succeeded.

### Migrations

```bash
npx prisma migrate dev --name describe_the_change
```

Commit the generated directory. The schema is the source of truth; the migration
is its history.

## Testing changes by hand

The seed gives you a realistic shape to work against:

1. Sign in as `dev@acme.test` and try to reveal a value in Payments API /
   Production. You should be refused, and the refusal should appear in the audit
   log with `result: DENIED`.
2. Sign in as `auditor@acme.test`. Values should be unreadable everywhere, and
   the audit log should be fully visible.
3. Sign in as `admin@acme.test` and approve the pending request. A grant should
   be issued with a 60-minute expiry, and the Developer should then be able to
   reveal that one environment.
4. Run a sync on a drifted target and watch the coverage meter move.
5. Rotate a secret and confirm every target shows as drifted until it syncs.
6. Press **Verify now** on the audit page — the chain should stay intact.
   Then edit a row directly in Postgres and verify again: it should fail at that
   sequence number. Roll it back afterwards.

## Adding a sync provider

Implement one function in `src/lib/sync.ts`:

```ts
function adapterFor(kind: string): SyncAdapter {
  switch (kind) {
    case "KUBERNETES":
      return {
        async apply({ target, entry }) {
          const value = await resolveValue(entry.secretId, entry.toVersion);
          // …call the provider, patch the Secret object
          return { ok: true, observedHash: entry.observedHash };
        },
      };
    // …
  }
}
```

Keep the contract intact: resolve the value through the stored version, return
`{ ok, error }` rather than throwing, and report the hash the target now holds
so drift detection keeps working.

## Adding a policy rule

1. Add the rule name to the enum in `createPolicySchema`.
2. Add a case to the switch in `evaluatePolicies()`.
3. Add a catalogue entry to `RULE_CATALOGUE` in the policies page so operators
   can see what it does before enabling it.

Rules should return violations rather than throwing, so the API can report all
of them at once instead of one per round trip.
