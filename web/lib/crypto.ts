import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  sign as nodeSign,
  verify as nodeVerify,
  timingSafeEqual,
} from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";

// argon2 is a native module. On some Alpine builds the binding is missing;
// `tryRequireArgon2` falls back to scrypt rather than crashing the process.
// Both hashers encode their algorithm in the stored string so `verifyPassword`
// routes to the right backend.
//
// We resolve argon2 via `createRequire` so the load is dynamic (and can fail
// gracefully) without triggering @typescript-eslint/no-require-imports, which
// Next.js enforces at build time. Marking argon2 as serverComponentsExternal
// in next.config.mjs keeps Next from bundling the native .node file so the
// require resolves against the real node_modules at runtime.
const scrypt = promisify(scryptCb);
const requireFn = createRequire(import.meta.url);

type Argon2 = typeof import("argon2") | null;
let argon2Cached: Argon2 | undefined;
function tryRequireArgon2(): Argon2 {
  if (argon2Cached !== undefined) return argon2Cached;
  try {
    argon2Cached = requireFn("argon2") as typeof import("argon2");
  } catch {
    argon2Cached = null;
  }
  return argon2Cached;
}

// --------------------------------------------------------------------------
// Keyring — the active KEK plus every historical key, so existing versions
// stay decryptable after a rotation. SECRETOPS_ROOT_KEYS is a comma-separated
// list of "keyId:base64" entries; the first is active.
// --------------------------------------------------------------------------

export type Keyring = {
  activeKeyId: string;
  keys: Map<string, Buffer>;
};

let keyringCached: Keyring | undefined;
let devKeyWarned = false;

export function resolveRootKey(): Keyring {
  if (keyringCached) return keyringCached;

  const raw = process.env.SECRETOPS_ROOT_KEYS?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SECRETOPS_ROOT_KEYS is required in production. Generate with `openssl rand -base64 32` and set as `keyId:base64`.",
      );
    }
    if (!devKeyWarned) {
      // Deterministic throwaway key for local boot. Documented in env.example.
      // eslint-disable-next-line no-console
      console.warn(
        "[secretops] SECRETOPS_ROOT_KEYS unset — using a deterministic dev-only key. Do not use in production.",
      );
      devKeyWarned = true;
    }
    const devKey = createHash("sha256").update("secretops-dev-only-key").digest();
    keyringCached = { activeKeyId: "kek-dev", keys: new Map([["kek-dev", devKey]]) };
    return keyringCached;
  }

  const keys = new Map<string, Buffer>();
  let activeKeyId: string | undefined;
  for (const entry of raw.split(",")) {
    const [id, b64] = entry.split(":", 2).map((s) => s?.trim());
    if (!id || !b64) {
      throw new Error(`Malformed SECRETOPS_ROOT_KEYS entry: "${entry}" (expected keyId:base64)`);
    }
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) {
      throw new Error(`Root key "${id}" must decode to 32 bytes; got ${key.length}.`);
    }
    if (!activeKeyId) activeKeyId = id;
    keys.set(id, key);
  }
  if (!activeKeyId) throw new Error("SECRETOPS_ROOT_KEYS parsed to zero keys.");
  keyringCached = { activeKeyId, keys };
  return keyringCached;
}

/** Test seam — forget the cached keyring so a test can swap env vars. */
export function __resetKeyringForTests(): void {
  keyringCached = undefined;
  devKeyWarned = false;
}

// --------------------------------------------------------------------------
// Envelope encryption
//
//   plaintext --AES-256-GCM(DEK)-->   ciphertext (stored)
//   DEK (32 random bytes)  --AES-256-GCM(KEK)-->  wrappedDek (stored)
//
// Each SecretVersion gets a fresh DEK, so a single key compromise does not
// cascade across history. `keyId` records which KEK wrapped this DEK so the
// KEK can be rotated without decrypting every value in a maintenance window.
// --------------------------------------------------------------------------

export type SealedValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
  wrappedDek: string;
  dekIv: string;
  dekAuthTag: string;
  keyId: string;
  valueHash: string;
  fingerprint: string;
};

function gcmEncrypt(key: Buffer, plaintext: Buffer): { ct: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ct, iv, tag: cipher.getAuthTag() };
}

function gcmDecrypt(key: Buffer, ct: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function seal(plaintext: string, kr: Keyring = resolveRootKey()): SealedValue {
  if (typeof plaintext !== "string") {
    throw new TypeError("seal() requires a string plaintext");
  }
  const kek = kr.keys.get(kr.activeKeyId);
  if (!kek) throw new Error(`Active key "${kr.activeKeyId}" missing from keyring`);

  const dek = randomBytes(32);
  const value = Buffer.from(plaintext, "utf8");

  const { ct, iv, tag } = gcmEncrypt(dek, value);
  const wrapped = gcmEncrypt(kek, dek);
  const { hash, fingerprint } = hashValue(plaintext);

  // Scrub the DEK from the heap as soon as we're done with it. A compromised
  // process could still snapshot earlier, but zeroing cuts the window.
  dek.fill(0);

  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
    wrappedDek: wrapped.ct.toString("base64"),
    dekIv: wrapped.iv.toString("base64"),
    dekAuthTag: wrapped.tag.toString("base64"),
    keyId: kr.activeKeyId,
    valueHash: hash,
    fingerprint,
  };
}

export function open(sv: SealedValue, kr: Keyring = resolveRootKey()): string {
  const kek = kr.keys.get(sv.keyId);
  if (!kek) {
    throw new Error(
      `Key "${sv.keyId}" that wrapped this version is not in the current keyring. ` +
        "Keep the retired key available until every version wrapped by it has been rewrapped.",
    );
  }
  const dek = gcmDecrypt(
    kek,
    Buffer.from(sv.wrappedDek, "base64"),
    Buffer.from(sv.dekIv, "base64"),
    Buffer.from(sv.dekAuthTag, "base64"),
  );
  try {
    const value = gcmDecrypt(
      dek,
      Buffer.from(sv.ciphertext, "base64"),
      Buffer.from(sv.iv, "base64"),
      Buffer.from(sv.authTag, "base64"),
    );
    return value.toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/**
 * If the version was wrapped by a retired KEK, re-wrap its DEK under the
 * active KEK and return the fields to persist. No-op (returns null) when
 * the version is already on the active key.
 *
 * The plaintext value never leaves memory — only the DEK is re-wrapped.
 */
export function rewrapVersion(sv: SealedValue, kr: Keyring = resolveRootKey()): Partial<SealedValue> | null {
  if (sv.keyId === kr.activeKeyId) return null;
  const oldKek = kr.keys.get(sv.keyId);
  const newKek = kr.keys.get(kr.activeKeyId);
  if (!oldKek) throw new Error(`Cannot rewrap: key "${sv.keyId}" missing from keyring`);
  if (!newKek) throw new Error(`Cannot rewrap: active key "${kr.activeKeyId}" missing from keyring`);

  const dek = gcmDecrypt(
    oldKek,
    Buffer.from(sv.wrappedDek, "base64"),
    Buffer.from(sv.dekIv, "base64"),
    Buffer.from(sv.dekAuthTag, "base64"),
  );
  try {
    const wrapped = gcmEncrypt(newKek, dek);
    return {
      wrappedDek: wrapped.ct.toString("base64"),
      dekIv: wrapped.iv.toString("base64"),
      dekAuthTag: wrapped.tag.toString("base64"),
      keyId: kr.activeKeyId,
    };
  } finally {
    dek.fill(0);
  }
}

// --------------------------------------------------------------------------
// Hashes and fingerprints
// --------------------------------------------------------------------------

export function hashValue(plaintext: string): { hash: string; fingerprint: string } {
  const hash = createHash("sha256").update(plaintext, "utf8").digest("hex");
  const fingerprint = `${hash.slice(0, 4)}…${hash.slice(-4)}`;
  return { hash, fingerprint };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time string compare. Returns false on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// --------------------------------------------------------------------------
// Value generators used by rotation policies.
// Format: "<kind>:<size>" except for `uuid`.
// --------------------------------------------------------------------------

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generate(spec: string): string {
  const [kind, sizeRaw] = spec.split(":", 2);
  if (kind === "uuid") return randomUUID();

  const size = Number.parseInt(sizeRaw ?? "", 10);
  if (!Number.isFinite(size) || size <= 0 || size > 4096) {
    throw new Error(`Invalid generator size in "${spec}" (expected a positive integer ≤ 4096)`);
  }
  switch (kind) {
    case "base64":
      return randomBytes(size).toString("base64").replace(/=+$/, "").slice(0, size);
    case "hex":
      return randomBytes(size).toString("hex").slice(0, size);
    case "alnum": {
      // Rejection sampling keeps the distribution uniform across 62 symbols.
      const out: string[] = [];
      while (out.length < size) {
        for (const byte of randomBytes(size * 2)) {
          if (byte < 248) {
            out.push(ALNUM[byte % 62]!);
            if (out.length >= size) break;
          }
        }
      }
      return out.join("");
    }
    default:
      throw new Error(`Unknown generator "${kind}". Supported: base64:N, hex:N, alnum:N, uuid`);
  }
}

// --------------------------------------------------------------------------
// Ed25519 bundle signing
//
// Pull-mode sync bundles are signed by the organization's active BundleKey.
// The private key lives in the DB sealed via the same envelope as
// SecretVersion (per-key DEK wrapped by the KEK); only the raw 32-byte
// public key is stored in plaintext so clients can verify without round-
// tripping through the server.
//
// Signatures are computed over the EXACT response body bytes the HTTP route
// writes — no JSON canonicalization — so agents in any language verify by
// hashing the same bytes they received on the wire (GitHub-webhook style).
// --------------------------------------------------------------------------

// Fixed SPKI DER prefix for Ed25519: AlgorithmIdentifier + BIT STRING header.
// Concatenated with a 32-byte raw public key, this is the full 44-byte SPKI
// DER encoding that createPublicKey() accepts.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type GeneratedBundleKey = {
  /** Raw 32-byte Ed25519 public key, base64. */
  publicKeyB64: string;
  /** Private key, sealed under the active KEK. Store as-is on BundleKey. */
  sealedPrivate: SealedValue;
};

/**
 * Generate a fresh Ed25519 keypair and seal the private half under the active
 * KEK. The caller stores the returned fields on a new BundleKey row.
 */
export function generateBundleKey(kr: Keyring = resolveRootKey()): GeneratedBundleKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiPub = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  // Last 32 bytes of the 44-byte Ed25519 SPKI are the raw public key.
  const rawPub = spkiPub.subarray(spkiPub.length - 32);
  // PKCS8 DER is 48 bytes for Ed25519. We base64 it and seal the string so
  // the existing seal()/open() path stays the storage primitive — no new
  // serializer to audit.
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const sealedPrivate = seal(pkcs8.toString("base64"), kr);
  pkcs8.fill(0);
  return { publicKeyB64: rawPub.toString("base64"), sealedPrivate };
}

/**
 * Sign `bodyBytes` with the sealed private key. The signature is Ed25519
 * over the exact input bytes; no hashing or canonicalization happens here —
 * the caller passes the bytes they will transmit on the wire.
 */
export function signBundle(
  bodyBytes: Buffer,
  sealedPrivate: SealedValue,
  kr: Keyring = resolveRootKey(),
): string {
  const pkcs8B64 = open(sealedPrivate, kr);
  const pkcs8 = Buffer.from(pkcs8B64, "base64");
  try {
    const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    const sig = nodeSign(null, bodyBytes, key);
    return sig.toString("base64");
  } finally {
    pkcs8.fill(0);
  }
}

/**
 * Verify an Ed25519 signature over `bodyBytes` against the raw 32-byte
 * public key (base64). The verifier reconstructs the SPKI DER encoding
 * from the fixed prefix so agents in any language can store just the raw
 * 32 bytes.
 */
export function verifyBundle(
  bodyBytes: Buffer,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  const rawPub = Buffer.from(publicKeyB64, "base64");
  if (rawPub.length !== 32) return false;
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, rawPub]);
  try {
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return nodeVerify(null, bodyBytes, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// Passwords — argon2id with a scrypt fallback so Alpine builds that cannot
// load the native binding still boot. The stored hash encodes which backend
// produced it so `verifyPassword` dispatches correctly.
// --------------------------------------------------------------------------

const SCRYPT_PREFIX = "scrypt$";
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 1) throw new Error("password required");
  const argon2 = tryRequireArgon2();
  if (argon2) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 1 << 16,
      timeCost: 3,
      parallelism: 1,
    });
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, SCRYPT_PARAMS.keylen)) as Buffer;
  return `${SCRYPT_PREFIX}${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(stored: string, candidate: string): Promise<boolean> {
  if (!stored || !candidate) return false;
  if (stored.startsWith(SCRYPT_PREFIX)) {
    const [, saltB64, derivedB64] = stored.split("$");
    if (!saltB64 || !derivedB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const derived = Buffer.from(derivedB64, "base64");
    const check = (await scrypt(candidate, salt, derived.length)) as Buffer;
    return check.length === derived.length && timingSafeEqual(check, derived);
  }
  const argon2 = tryRequireArgon2();
  if (!argon2) {
    // The hash was produced by argon2 but the binding is now missing. Fail
    // closed rather than silently reject every legitimate user.
    throw new Error(
      "Stored password uses argon2 but the native binding is unavailable. Install `argon2` or rotate the password.",
    );
  }
  return argon2.verify(stored, candidate);
}
