"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { MintDialog } from "./MintDialog";

// Thin client wrapper so the primary Mint CTA lives in a Server Component
// header row -- the dialog's open state belongs on the client.

export function MintButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>+ Mint token</Button>
      <MintDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
