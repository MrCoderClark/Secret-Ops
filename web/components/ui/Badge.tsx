import { HTMLAttributes } from "react";

// Badge — a status pill. Tone maps to semantic status, not colour, so the
// palette can swap without a component change. Use `kind` for a "what is
// this thing" tag (KUBERNETES, CI/CD) and `tone` for an "is it healthy"
// status (In sync, drifted, Attention needed).

type Tone = "neutral" | "success" | "warn" | "danger" | "info" | "accent";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-hover text-fg-secondary border border-border-subtle",
  success: "bg-success-soft text-success border border-success/30",
  warn:    "bg-warn-soft text-warn border border-warn/30",
  danger:  "bg-danger-soft text-danger border border-danger/30",
  info:    "bg-info-soft text-info border border-info/30",
  accent:  "bg-accent-soft text-fg-on-accent border border-accent/40",
};

export function Badge({ tone = "neutral", className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ${TONES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
