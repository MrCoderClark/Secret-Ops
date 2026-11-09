#!/usr/bin/env tsx
/**
 * bootstrap — print the two secrets a fresh `.env` needs, in paste-ready form.
 *
 *   pnpm bootstrap                                # print to terminal
 *   pnpm bootstrap >> ../.env                     # append to repo-root .env
 *   pnpm bootstrap --json                         # { session, rootKey, keyId }
 *
 * Deliberately a dumb formatter. It never reads, writes or modifies any file
 * — a wrong path would clobber a working .env, which is how teams lose
 * secrets. The operator reviews the output, then decides where it goes.
 */

import { randomBytes } from "node:crypto";

type Flags = { json: boolean; keyId: string };

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { json: false, keyId: "kek-v1" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--key-id") {
      const next = argv[++i];
      if (!next) fail("--key-id needs a value, e.g. --key-id kek-v2");
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(next)) {
        fail(`--key-id "${next}" must match /^[A-Za-z0-9_-]{1,32}$/`);
      }
      flags.keyId = next;
    } else if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}. Run with --help.`);
    }
  }
  return flags;
}

function printUsage(): void {
  const lines = [
    "bootstrap — generate SecretOps' two root secrets.",
    "",
    "  pnpm bootstrap                 Print SESSION_SECRET and SECRETOPS_ROOT_KEYS",
    "  pnpm bootstrap --json          Emit JSON instead of .env lines",
    "  pnpm bootstrap --key-id <id>   Use a custom keyId (default: kek-v1)",
    "",
    "Paste the output into `.env` at the repo root. The script never writes",
    "a file itself — a wrong path would clobber a working .env.",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

function fail(message: string): never {
  process.stderr.write(`bootstrap: ${message}\n`);
  process.exit(2);
}

function generate(flags: Flags): { session: string; rootKey: string } {
  // SESSION_SECRET: 48 bytes of entropy, base64 (64 chars). The jose HS256
  // session JWT needs at least 32 bytes of key material; 48 gives headroom.
  const session = randomBytes(48).toString("base64");

  // SECRETOPS_ROOT_KEYS entry: 32 bytes raw -> base64 (44 chars). Must
  // decode to exactly 32 bytes for AES-256-GCM in web/lib/crypto.ts.
  const rootKey = randomBytes(32).toString("base64");
  return { session, rootKey };
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  const { session, rootKey } = generate(flags);

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ session, rootKey, keyId: flags.keyId }, null, 2) + "\n",
    );
    return;
  }

  const banner = [
    "# --- paste into .env at the repo root (overwrite the empty lines) ---",
    `# generated ${new Date().toISOString()}`,
    "#",
    "# SESSION_SECRET signs the dashboard session JWT (jose HS256).",
    "# SECRETOPS_ROOT_KEYS is the KEK that wraps every per-version DEK.",
    "# The first entry (left-most) is the active key used for new writes;",
    "# keep retired keys in the list so historical versions keep decrypting.",
  ];
  const envLines = [
    `SESSION_SECRET="${session}"`,
    `SECRETOPS_ROOT_KEYS="${flags.keyId}:${rootKey}"`,
  ];
  process.stdout.write(banner.join("\n") + "\n");
  process.stdout.write(envLines.join("\n") + "\n");
}

main();
