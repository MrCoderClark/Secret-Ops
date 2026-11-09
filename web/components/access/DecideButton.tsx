"use client";

import { useState } from "react";
import { DecideDialog } from "./DecideDialog";

export interface DecideButtonProps {
  requestId: string;
  summary: string;
}

export function DecideButton({ requestId, summary }: DecideButtonProps) {
  const [open, setOpen] = useState<"" | "APPROVE" | "DENY">("");
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setOpen("APPROVE")}
        className="text-xs px-2 py-1 rounded text-ink-dim hover:text-signal hover:bg-inset transition"
      >
        approve
      </button>
      <button
        onClick={() => setOpen("DENY")}
        className="text-xs px-2 py-1 rounded text-ink-dim hover:text-stop hover:bg-inset transition"
      >
        deny
      </button>
      {open !== "" && (
        <DecideDialog
          open
          onClose={() => setOpen("")}
          requestId={requestId}
          summary={summary}
          initialDecision={open}
        />
      )}
    </div>
  );
}
