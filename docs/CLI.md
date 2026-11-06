# CLI reference

Every command below works against the REST API with a scoped token. There is no
CLI binary in this repository — the point is that the API surface is complete
enough that one is a thin wrapper.

## Environment

```bash
export APP_URL="https://secretops.internal"
export SECRETOPS_TOKEN="sop_live_xxxxxxxx_yyyyyyyyyyyyyyyyyyyyyyyy"
```

Create the token under **Tokens**. For CI/CD, scope it to `secrets:read` and
`sync:run` and limit it to the environments that pipeline deploys to.

## Read

```bash
# Metadata only — key, path, type, version, fingerprint. Never values.
curl -s -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/secrets?env=$ENVIRONMENT_ID" | jq '.secrets[] | {key, path, latestVersion, fingerprint}'

# One secret's version history
curl -s -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/secrets/$SECRET_ID" | jq '.versions'

# The value. Audited — a secret.read event names this token's principal.
curl -s -X POST -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/secrets/$SECRET_ID/reveal" | jq -r .value
```

## Write

```bash
# Create, or append a version if the value changed.
# Pushing an identical value is a no-op — no version is created.
curl -s -X POST "$APP_URL/api/secrets" \
  -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "projectId": "'"$PROJECT_ID"'",
    "environmentId": "'"$ENVIRONMENT_ID"'",
    "path": "db",
    "key": "DATABASE_URL",
    "value": "'"$NEW_DATABASE_URL"'",
    "valueType": "connection-string"
  }'
```

The response carries `changed: true|false` and the resulting version. A `422`
means a policy rejected the write, and the body names the rule:

```json
{ "error": "Value for \"STRIPE_KEY\" looks like a raw provider credential…",
  "rule": "deny_plaintext_in_cicd", "severity": "high" }
```

## Rotate

```bash
curl -s -X POST -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/secrets/$SECRET_ID/rotate"
```

Requires a rotation policy on the secret; the generated value follows the
policy's generator spec (`base64:32`, `hex:32`, `uuid`, `alnum:64`). Every sync
target is marked drifted until it pulls the new revision.

## Sync

```bash
# What would change, without touching anything.
curl -s -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/sync/$TARGET_ID/plan" \
  | jq '.summary, .entries[] | select(.action != "noop")'

# Apply it.
curl -s -X POST "$APP_URL/api/sync/$TARGET_ID/run" \
  -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  -H "content-type: application/json" \
  -d '{"dryRun": false}' | jq '{pushed, status}'

# Pull-mode agents: fetch the environment's values as a flat map.
curl -s -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/sync/$TARGET_ID/bundle" | jq -r '.values | to_entries[] | "\(.key)=\(.value)"'
```

A pull-mode agent should run on a schedule, compare the returned bundle against
what it last applied, and write only on a difference:

```bash
#!/bin/sh
set -eu

BUNDLE="$(curl -sS -H "Authorization: Bearer $SECRETOPS_TOKEN" \
  "$APP_URL/api/sync/$TARGET_ID/bundle")"

echo "$BUNDLE" | jq -r '.values | to_entries[] | "\(.key)=\(.value)"' > /run/secrets/app.env

chmod 600 /run/secrets/app.env
chown app:app /run/secrets/app.env

# Signal the process to reload if the file actually changed.
if [ "$(sha256sum /run/secrets/app.env | cut -d' ' -f1)" != "$LAST_HASH" ]; then
  kill -HUP "$(cat /run/app.pid)"
fi
```

## CI/CD example

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Pull secrets for the target environment
        env:
          SECRETOPS_TOKEN: ${{ secrets.SECRETOPS_TOKEN }}
          APP_URL: ${{ vars.SECRETOPS_URL }}
        run: |
          curl -sSf -H "Authorization: Bearer $SECRETOPS_TOKEN" \
            "$APP_URL/api/sync/${{ vars.SECRETOPS_TARGET_ID }}/bundle" \
            | jq -r '.values | to_entries[] | "\(.key)=\(.value)"' >> "$GITHUB_ENV"

      - name: Run migrations
        run: npm run migrate

      - name: Mark the target synced
        env:
          SECRETOPS_TOKEN: ${{ secrets.SECRETOPS_TOKEN }}
          APP_URL: ${{ vars.SECRETOPS_URL }}
        run: |
          curl -sSf -X POST -H "Authorization: Bearer $SECRETOPS_TOKEN" \
            -H "content-type: application/json" \
            -d '{"dryRun": false}' \
            "$APP_URL/api/sync/${{ vars.SECRETOPS_TARGET_ID }}/run"
```

Note what this pipeline holds: a read-only token limited to one environment,
valid for 90 days, revocable from the dashboard, and every use recorded against
its principal. It never holds a value that outlives the job.

## Errors

| Status | Meaning |
|---|---|
| `400` | Malformed body — `fieldErrors` names the offending fields |
| `401` | Missing, malformed, expired or revoked token |
| `403` | The token's scopes or environment limits do not cover this |
| `404` | The resource is not in this organization |
| `409` | Conflict — a duplicate key at that path, or a target that is not pull-mode |
| `422` | A policy rejected the write; the body names the rule |
| `429` | Rate limited (login only); `retry-after` carries the seconds |
