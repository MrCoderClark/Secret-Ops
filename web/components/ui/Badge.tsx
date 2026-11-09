import { HTMLAttributes } from "react";

// Two shapes: `tone` is an "is this healthy" status pill (success/warn/
// danger/info/accent), `kind` is a "what is this thing" tag (KUBERNETES,
// LOCAL). The visual distinction is that tones round into pills with LEDs
// optional; kinds stay rectangular with a mono face.

type Tone = "neutral" | "success" | "warn" | "danger" | "info" | "accent";
type Shape = "pill" | "tag";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  shape?: Shape;
  led?: boolean;
}

const TONES: Record<Tone, string> = {
  neutral: "text-ink-dim border border-line bg-inset",
  success: "text-signal border border-signal/30 bg-signal/10",
  warn:    "text-alert  border border-alert/30  bg-alert/10",
  danger:  "text-stop   border border-stop/30   bg-stop/10",
  info:    "text-trace  border border-trace/30  bg-trace/10",
  accent:  "text-accent border border-accent/30 bg-accent/10",
};

export function Badge({ tone = "neutral", shape = "pill", led, className = "", children, ...rest }: BadgeProps) {
  if (shape === "tag") {
    return (
      <span
        className={`inline-flex items-center font-mono text-[9.5px] tracking-widest uppercase px-1.5 py-0.5 rounded bg-inset border border-line-strong text-ink-dim ${className}`}
        {...rest}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] leading-5 ${TONES[tone]} ${className}`}
      {...rest}
    >
      {led && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
