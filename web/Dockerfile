# ---------------------------------------------------------------------------
# SecretOps — production image for the Next.js control plane.
#
# Build context must be this directory (web/) — see docker-compose.yml.
# Multi-stage: pnpm installs once, Next.js builds once (standalone output),
# the runtime image carries only what the server needs at request time.
# Non-root user. The runtime image intentionally has no build toolchain.
# ---------------------------------------------------------------------------

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
# pnpm 10 matches the lockfile version. Corepack ships with Node 20.
RUN corepack enable && corepack prepare pnpm@10 --activate

# ---- deps ------------------------------------------------------------------
# argon2 is a native addon; python3 / make / g++ are needed at install time
# to compile the binding on Alpine. These layers do not reach the runtime.
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder ---------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The build must not need a live database — pages read at request time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm prisma generate
RUN pnpm build

# ---- runner ----------------------------------------------------------------
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Next.js standalone server + static assets. Standalone ships its own minimal
# node_modules containing everything its tracer could reach from the code.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma schema, migrations and the generated client — needed at runtime for
# the client to boot and for `prisma migrate deploy` run via `docker compose
# exec`.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# argon2's native binding. Marked serverComponentsExternalPackages in
# next.config.mjs so Next does not try to bundle the .node file; the whole
# module directory (including prebuilds/) is copied in so require("argon2")
# resolves at boot in web/lib/crypto.ts.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/argon2 ./node_modules/argon2

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
