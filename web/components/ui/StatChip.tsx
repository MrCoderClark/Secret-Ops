import { ReactNode } from "react";

// Compact stat tile for the metric row's secondary slots. One label, a
// status LED, a value, and a foot note that names WHERE the value comes
// from (the actual useful detail: "customer-portal/prod", not just "1").
// Used alongside the HeroMetric so the primary number gets the stage.

type Tone = "neutral" | "signal" | "alert" | "stop";

const LED: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  signal:  "bg-signal shadow-[0_0_8px_rgba(79,196,140,.6)]",
  alert:   "bg-alert  shadow-[0_0_8px_rgba(232,169,64,.6)]",
  stop:    "bg-stop   shadow-[0_0_8px_rgba(229,83,83,.6)]",
};

const VAL: Record<Tone, string> = {
  neutral: "text-ink",
  signal:  "text-signal",
  alert:   "text-alert",
  stop:    "text-stop",
};

export interface StatChipProps {
  label: string;
  value: ReactNode;
  foot: string;
  tone?: Tone;
  valueSize?: "num" | "word"; // "num" for digits (big), "word" for VERIFIED etc.
}

export function StatChip({ label, value, foot, tone = "neutral", valueSize = "num" }: StatChipProps) {
  return (
    <div className="rounded-lg bg-raised border border-line p-4 flex flex-col gap-1">
      <span className="label-eyebrow">{label}</span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className={`w-2 h-2 rounded-full ${LED[tone]}`} />
        <span className={`font-mono font-medium tabular leading-none ${VAL[tone]} ${valueSize === "num" ? "text-[26px] tracking-tight" : "text-lg"}`}>
          {value}
        </span>
      </div>
      <span className="font-mono text-[11px] text-ink-faint mt-0.5">{foot}</span>
    </div>
  );
}
