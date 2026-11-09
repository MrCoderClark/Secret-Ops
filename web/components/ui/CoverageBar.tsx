// ASCII coverage bar — the format in the mock (`==========` with a vertical
// pipe marking current fill).
//
// width  = total column count, default 10 (matches the mock)
// filled = count of leading "=" characters
//
// Rendered in mono so columns align across rows. SPECS § 8 locks this in as
// ASCII for v1; a real bar graphic can replace it later without an API change.

export interface CoverageBarProps {
  // Fraction 0..1. Clamped. Over-100% rounds down to full.
  ratio: number;
  width?: number;
  className?: string;
  // Optional aria label so screen readers hear "7 of 10 in sync" not =====.
  srLabel?: string;
}

export function CoverageBar({ ratio, width = 10, className = "", srLabel }: CoverageBarProps) {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const filled = Math.round(r * width);
  const empty = width - filled;
  const bar = "=".repeat(filled) + (filled > 0 && empty > 0 ? "|" : "") + "-".repeat(Math.max(0, empty - (filled > 0 && empty > 0 ? 1 : 0)));

  const tone =
    r >= 0.95 ? "text-success" :
    r >= 0.7  ? "text-fg-primary" :
    r >= 0.4  ? "text-warn" : "text-danger";

  return (
    <span className={`mono text-xs ${tone} ${className}`} aria-label={srLabel}>
      {bar}
    </span>
  );
}
