// Segmented coverage gauge. 12 cells; each lit cell counts for `total/12`
// of the whole. One drifted secret in a 5-secret target lights 4 cells
// green + 1 cell amber.
//
// Replaces the earlier ASCII `====|-----` bar, which read as a placeholder
// in a browser even if it was correct in a monospace terminal.

export interface GaugeProps {
  synced: number;
  drifted?: number;
  total: number;
  cells?: number;
  className?: string;
  srLabel?: string;
}

export function Gauge({ synced, drifted = 0, total, cells = 12, className = "", srLabel }: GaugeProps) {
  if (total <= 0) {
    return <span className={`inline-flex items-center gap-[2px] ${className}`} aria-label={srLabel} />;
  }
  const syncedCells  = Math.round((synced  / total) * cells);
  const driftedCells = Math.round((drifted / total) * cells);
  const emptyCells   = Math.max(0, cells - syncedCells - driftedCells);

  const parts: Array<"ok" | "drift" | "off"> = [
    ...Array(syncedCells).fill("ok"),
    ...Array(driftedCells).fill("drift"),
    ...Array(emptyCells).fill("off"),
  ] as Array<"ok" | "drift" | "off">;

  return (
    <span
      className={`inline-grid grid-flow-col auto-cols-[8px] gap-[2px] items-center ${className}`}
      aria-label={srLabel ?? `${synced} of ${total} in sync`}
    >
      {parts.map((kind, i) => (
        <span
          key={i}
          className={
            kind === "ok"    ? "h-2.5 rounded-[1px] bg-signal shadow-[0_0_4px_rgba(79,196,140,.35)]" :
            kind === "drift" ? "h-2.5 rounded-[1px] bg-alert" :
                               "h-2.5 rounded-[1px] bg-line-strong"
          }
        />
      ))}
    </span>
  );
}
