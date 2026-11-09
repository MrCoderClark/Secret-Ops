// Command-palette search. Back-end for /api/search and the ⌘K palette.
//
// The query is matched case-insensitively against three indexes:
//
//   - Secrets: `key`, `path` (metadata only — never values or hashes)
//   - Paths:   distinct path strings, so an operator searching "stripe" sees
//              the single path "stripe" rather than one row per environment
//   - Actors:  users in the org, by name or email
//
// Every list is RBAC-filtered. A caller with secret.read.metadata sees
// metadata but not values; a caller without it sees an empty secrets slice.
// Actors are visible to anyone with a session — the org membership roster
// is not sensitive on its own.

import { db } from "./db";
import { can, type Actor } from "./rbac";

const MAX = 25;

export type SearchHit = {
  secrets: Array<{
    id: string;
    path: string;
    key: string;
    environmentId: string;
    projectId: string;
    fingerprint: string | null;
  }>;
  paths: Array<{ path: string; count: number }>;
  actors: Array<{ id: string; name: string; email: string }>;
};

export async function search(input: { actor: Actor; q: string; limit?: number }): Promise<SearchHit> {
  const query = input.q.trim();
  if (query.length === 0) return { secrets: [], paths: [], actors: [] };
  const take = clamp(input.limit ?? MAX);

  const [secrets, actors] = await Promise.all([
    searchSecrets(input.actor, query, take),
    searchActors(input.actor, query, take),
  ]);

  // Paths derive from the secret matches so they already respect RBAC and
  // org scoping. Dedupe + count on the way out so "stripe" becomes one row.
  const pathCounts = new Map<string, number>();
  for (const s of secrets) {
    pathCounts.set(s.path, (pathCounts.get(s.path) ?? 0) + 1);
  }
  const paths = Array.from(pathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([path, count]) => ({ path, count }));

  return { secrets, paths, actors };
}

async function searchSecrets(actor: Actor, query: string, take: number): Promise<SearchHit["secrets"]> {
  if (!can(actor, "secret.read.metadata")) return [];
  const rows = await db.secret.findMany({
    where: {
      deletedAt: null,
      project: { organizationId: actor.organizationId },
      ...(actor.kind === "machine" && actor.environmentIds
        ? { environmentId: { in: actor.environmentIds } }
        : {}),
      OR: [
        { key: { contains: query, mode: "insensitive" } },
        { path: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    include: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { fingerprint: true },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    key: r.key,
    environmentId: r.environmentId,
    projectId: r.projectId,
    fingerprint: r.versions[0]?.fingerprint ?? null,
  }));
}

async function searchActors(actor: Actor, query: string, take: number): Promise<SearchHit["actors"]> {
  // Machine tokens do not get the org roster.
  if (actor.kind !== "user") return [];
  const rows = await db.user.findMany({
    where: {
      memberships: { some: { organizationId: actor.organizationId } },
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take,
    select: { id: true, name: true, email: true },
  });
  return rows;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return MAX;
  if (n < 1) return 1;
  if (n > 100) return 100;
  return Math.floor(n);
}
