import { PrismaClient } from "@prisma/client";

// In dev, Next.js hot-reload instantiates module scope many times. Attach the
// client to globalThis so we end up with exactly one connection pool per
// process. In production the module is loaded once and this is harmless.
declare global {
  // eslint-disable-next-line no-var
  var __secretopsPrisma: PrismaClient | undefined;
}

export const db: PrismaClient =
  globalThis.__secretopsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__secretopsPrisma = db;
}
