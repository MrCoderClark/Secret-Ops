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
# .npmrc MUST be here so `node-linker=hoisted` takes effect on this install.
# Without it, pnpm falls back to its isolated symlink layout and the runner
# stage's `COPY /app/node_modules/.prisma` finds nothing at the top level.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
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
# exec`. The `prisma` CLI package (distinct from `@prisma/client`) is copied
# too, and a .bin shim is written so operators can invoke it directly as
# `node_modules/.bin/prisma` without going through pnpm/corepack (which
# re-triggers an install at runtime and dies on overlayfs symlink limits).
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
RUN mkdir -p ./node_modules/.bin && \
    ln -sf /app/node_modules/prisma/build/index.js /app/node_modules/.bin/prisma && \
    chmod +x /app/node_modules/prisma/build/index.js

# argon2's native binding. Marked serverComponentsExternalPackages in
# next.config.mjs so Next does not try to bundle the .node file; the whole
# module directory (including prebuilds/) is copied in so require("argon2")
# resolves at boot in web/lib/crypto.ts.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/argon2 ./node_modules/argon2

# Worker runtime. The worker runs the same service layer the Next.js server
# does (web/lib/*), so we carry the raw TS sources + tsconfig.json for the
# @/* path alias, plus tsx to execute them. docker-compose.yml's worker
# service overrides CMD to point at scripts/worker.ts. The Next.js server
# itself never touches any of these files.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/lib ./lib
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
RUN npm install -g tsx@4.19.2

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
