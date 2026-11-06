// Policy engine — org-level rules evaluated on every write path.
//
// Validation (Zod) answers "is this well-formed?". Policies answer "should
// this be allowed at all, given what the org has decided?". Keeping them
// apart means a new policy is data, not a code change to the validation
// layer.

import type { EnvironmentLike } from "./rbac";

export type PolicyRule =
  | "deny_plaintext_in_cicd"
  | "require_approval_for_prod"
  | "max_ttl_days"
  | "require_rotation"
  | "deny_wildcard_paths"
  | "require_mfa_for_prod";

export type PolicySeverity = "low" | "medium" | "high" | "critical";

export type Policy = {
  id: string;
  name: string;
  rule: PolicyRule;
  severity: PolicySeverity;
  enabled: boolean;
  config: Record<string, unknown> | null;
};

export type WriteContext = {
  path: string;
  key: string;
  value: string;
  environment: EnvironmentLike;
  valueType?: string;
  actorHasApproval?: boolean;
  actorMfaVerified?: boolean;
  rotationPolicyId?: string | null;
};

export type Violation = {
  rule: PolicyRule;
  severity: PolicySeverity;
  message: string;
};

// --------------------------------------------------------------------------
// Rule catalogue — surfaced on the Policies page so operators know what a
// rule does before enabling it. Add a new entry here for every rule added to
// `evaluatePolicies`.
// --------------------------------------------------------------------------

export const RULE_CATALOGUE: Record<
  PolicyRule,
  { title: string; description: string; defaultSeverity: PolicySeverity }
> = {
  deny_plaintext_in_cicd: {
    title: "Deny raw provider credentials",
    description:
      "Reject writes whose value matches the shape of a known provider secret (AWS, GitHub, Stripe, Google) so a leaked key cannot be stored verbatim.",
    defaultSeverity: "high",
  },
  require_approval_for_prod: {
    title: "Require approval for production writes",
    description:
      "Writes to a production environment must carry an approved access request from an Admin.",
    defaultSeverity: "high",
  },
  max_ttl_days: {
    title: "Cap credential lifetime",
    description:
      "Secrets must have a rotation policy whose interval is no greater than the configured ceiling (default: 90 days).",
    defaultSeverity: "medium",
  },
  require_rotation: {
    title: "Require a rotation policy",
    description:
      "Every secret in scope must have a rotation policy attached. Values with no rotation plan are refused.",
    defaultSeverity: "medium",
  },
  deny_wildcard_paths: {
    title: "Forbid wildcards in paths",
    description:
      "Reject paths or keys containing wildcard characters (*, ?). A wildcard in a secret identifier is almost always a mistake.",
    defaultSeverity: "low",
  },
  require_mfa_for_prod: {
    title: "Require MFA for production",
    description:
      "Writes to a protected environment require the actor to have completed an MFA challenge in the current session.",
    defaultSeverity: "high",
  },
};

// --------------------------------------------------------------------------
// Evaluation — returns every violation so the API can report all at once.
// Rules return a violation rather than throwing, per the contract in
// CONTRIBUTING.md.
// --------------------------------------------------------------------------

export function evaluatePolicies(policies: Policy[], ctx: WriteContext): Violation[] {
  const out: Violation[] = [];
  for (const policy of policies) {
    if (!policy.enabled) continue;
    const v = evaluateOne(policy, ctx);
    if (v) out.push(v);
  }
  return out;
}

function evaluateOne(policy: Policy, ctx: WriteContext): Violation | null {
  const mk = (message: string): Violation => ({ rule: policy.rule, severity: policy.severity, message });

  switch (policy.rule) {
    case "deny_plaintext_in_cicd":
      return matchesProviderSecret(ctx.value)
        ? mk(
            `Value for "${ctx.key}" looks like a raw provider credential. ` +
              "Use a provider short-lived token or reference, not the raw key.",
          )
        : null;

    case "require_approval_for_prod":
      if (!isProduction(ctx.environment)) return null;
      return ctx.actorHasApproval
        ? null
        : mk(`Writes to ${ctx.environment.id} require an approved access request.`);

    case "max_ttl_days": {
      const ceiling = Number((policy.config as { days?: unknown } | null)?.days ?? 90);
      if (!ctx.rotationPolicyId) {
        return mk(`"${ctx.key}" has no rotation policy; credential lifetime cap (${ceiling}d) cannot be enforced.`);
      }
      // The config ceiling is informational at write time; rotation worker
      // enforces the actual interval. A rotation policy whose intervalDays
      // exceeds the ceiling is flagged on the Policies page, not here.
      return null;
    }

    case "require_rotation":
      return ctx.rotationPolicyId
        ? null
        : mk(`"${ctx.key}" must have a rotation policy attached.`);

    case "deny_wildcard_paths":
      return /[*?]/.test(ctx.path) || /[*?]/.test(ctx.key)
        ? mk(`Wildcards are not allowed in paths or keys ("${ctx.path}/${ctx.key}").`)
        : null;

    case "require_mfa_for_prod":
      if (!isProduction(ctx.environment)) return null;
      return ctx.actorMfaVerified
        ? null
        : mk(`Writes to ${ctx.environment.id} require MFA to be verified in this session.`);

    default:
      return null;
  }
}

function isProduction(env: EnvironmentLike): boolean {
  return env.stage >= 2 || env.protected;
}

// Shape-based detection — not exhaustive, deliberately conservative. The goal
// is to catch obvious paste-of-raw-key mistakes, not to replace a scanner.
const PROVIDER_PATTERNS: RegExp[] = [
  /^AKIA[0-9A-Z]{16}$/,           // AWS access key ID
  /^ASIA[0-9A-Z]{16}$/,           // AWS session access key ID
  /^ghp_[A-Za-z0-9]{36}$/,        // GitHub personal access token
  /^github_pat_[A-Za-z0-9_]{70,}$/, // GitHub fine-grained PAT
  /^gho_[A-Za-z0-9]{36}$/,        // GitHub OAuth token
  /^sk_live_[A-Za-z0-9]{24,}$/,   // Stripe live secret
  /^rk_live_[A-Za-z0-9]{24,}$/,   // Stripe restricted key
  /^AIza[0-9A-Za-z_-]{35}$/,      // Google API key
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/, // Slack token
];

function matchesProviderSecret(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return PROVIDER_PATTERNS.some((re) => re.test(trimmed));
}
