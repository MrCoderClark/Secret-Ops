// Zod schemas for every write path. Add new ones here rather than inlining
// at the route — one place to see the full input surface of the API.

import { z } from "zod";

// --------------------------------------------------------------------------
// Primitives reused across schemas.
// --------------------------------------------------------------------------

const cuid = z.string().regex(/^[a-z0-9]{24,32}$/, "expected a cuid");
const email = z.string().email().max(254).transform((s) => s.trim().toLowerCase());
const path = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9/_.-]+$/, "path uses letters, digits, / _ . -")
  .refine((p) => !p.startsWith("/") && !p.endsWith("/"), "path must not start or end with /");
const key = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "key is uppercase-style identifier");
const slug = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(1024),
});
export type LoginInput = z.infer<typeof loginSchema>;

// --------------------------------------------------------------------------
// Secrets
// --------------------------------------------------------------------------

const valueTypes = ["string", "connection-string", "json", "pem", "token", "password"] as const;

export const createSecretSchema = z.object({
  projectId: cuid,
  environmentId: cuid,
  path,
  key,
  value: z.string().min(1).max(64 * 1024, "secret value capped at 64 KiB"),
  valueType: z.enum(valueTypes).default("string"),
  description: z.string().max(1024).optional(),
  rotationPolicyId: cuid.optional(),
});
export type CreateSecretInput = z.infer<typeof createSecretSchema>;

export const updateSecretSchema = z.object({
  description: z.string().max(1024).optional(),
  valueType: z.enum(valueTypes).optional(),
  rotationPolicyId: cuid.nullable().optional(),
});
export type UpdateSecretInput = z.infer<typeof updateSecretSchema>;

export const listSecretsSchema = z.object({
  env: cuid.optional(),
  project: cuid.optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: cuid.optional(),
});

// --------------------------------------------------------------------------
// Sync
// --------------------------------------------------------------------------

const syncKinds = ["LOCAL", "CICD", "KUBERNETES", "TERRAFORM", "SERVERLESS", "VM"] as const;

export const createSyncTargetSchema = z.object({
  environmentId: cuid,
  name: z.string().min(1).max(100),
  kind: z.enum(syncKinds),
  endpoint: z.string().min(1).max(500),
  pullMode: z.boolean().default(false),
});

export const runSyncSchema = z.object({
  dryRun: z.boolean().default(false),
});

// --------------------------------------------------------------------------
// Access requests
// --------------------------------------------------------------------------

export const createRequestSchema = z
  .object({
    environmentId: cuid.optional(),
    secretId: cuid.optional(),
    permission: z.enum(["READ", "WRITE", "ADMIN"]).default("READ"),
    justification: z.string().min(10, "a justification of at least 10 chars is required").max(2000),
    durationMinutes: z.number().int().min(5).max(60 * 24 * 7).default(60),
  })
  .refine((v) => v.environmentId || v.secretId, {
    message: "environmentId or secretId is required",
    path: ["environmentId"],
  });

export const decideRequestSchema = z.object({
  decision: z.enum(["APPROVE", "DENY"]),
  note: z.string().max(2000).optional(),
});

// --------------------------------------------------------------------------
// Tokens
// --------------------------------------------------------------------------

const scopeValues = [
  "secrets:read",
  "secrets:write",
  "sync:run",
  "sync:configure",
  "audit:read",
] as const;

export const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  principal: z.string().min(1).max(200),
  scopes: z.array(z.enum(scopeValues)).min(1),
  environmentIds: z.array(cuid).nullable().default(null),
  // 1 hour to 2 years; null is explicitly disallowed so a perpetual token is
  // a deliberate off-path, not a default.
  expiresInDays: z.number().int().min(1).max(730).default(90),
});

// --------------------------------------------------------------------------
// Policies
// --------------------------------------------------------------------------

const policyRules = [
  "deny_plaintext_in_cicd",
  "require_approval_for_prod",
  "max_ttl_days",
  "require_rotation",
  "deny_wildcard_paths",
  "require_mfa_for_prod",
] as const;

export const createPolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  rule: z.enum(policyRules),
  severity: z.enum(["low", "medium", "high", "critical"]).default("high"),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
});

// --------------------------------------------------------------------------
// Projects / environments (admin surfaces)
// --------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug,
  description: z.string().max(500).optional(),
  sensitivity: z.enum(["internal", "pii", "pci", "hipaa"]).default("internal"),
});

export const createEnvironmentSchema = z.object({
  projectId: cuid,
  name: z.string().min(1).max(100),
  slug,
  stage: z.number().int().min(0).max(5).default(0),
  requiresApproval: z.boolean().default(false),
  protected: z.boolean().default(false),
});

// --------------------------------------------------------------------------
// Helpers for route handlers — standard error shape, zero boilerplate.
// --------------------------------------------------------------------------

export type FieldErrors = Record<string, string[]>;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors: FieldErrors };

export function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): ParseResult<z.infer<T>> {
  const result = schema.safeParse(body);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: "Invalid request body",
    fieldErrors: result.error.flatten().fieldErrors as FieldErrors,
  };
}
