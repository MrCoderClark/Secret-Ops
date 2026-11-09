"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { withCsrf } from "@/lib/csrf-client";

// Modal that fetches a secret's plaintext and holds it in local state for
// 30 seconds. Value shows blurred-until-mouseover so a shoulder surf gets
// nothing from a screen left unattended. A countdown ring in the footer
// ticks down to auto-close; a Dismiss button closes immediately.

export interface RevealDialogProps {
  open: boolean;
  onClose: () => void;
  secretId: string;
  label: string;
}

const HOLD_SECONDS = 30;

export function RevealDialog({ open, onClose, secretId, label }: RevealDialogProps) {
  const [value, setValue] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(HOLD_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = !open;
    if (!open) {
      setValue(null); setVersion(null); setFingerprint(null);
      setRemaining(HOLD_SECONDS); setError(null); setCopied(false);
      return;
    }
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/secrets/${secretId}/reveal`, {
          method: "POST",
          cache: "no-store",
          headers: withCsrf({ "content-type": "application/json" }),
          body: JSON.stringify({}),
        });
        if (!alive) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "reveal failed" }));
          setError(body.error ?? `reveal failed (${res.status})`);
          return;
        }
        const body = await res.json();
        setValue(body.value);
        setVersion(body.version);
        setFingerprint(body.fingerprint);
      } catch {
        if (alive) setError("network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, secretId]);

  useEffect(() => {
    if (!open || !value) return;
    setRemaining(HOLD_SECONDS);
    const start = Date.now();
    const id = setInterval(() => {
      const left = Math.max(0, HOLD_SECONDS - Math.floor((Date.now() - start) / 1000));
      setRemaining(left);
      if (left === 0) { clearInterval(id); onClose(); }
    }, 250);
    return () => clearInterval(id);
  }, [open, value, onClose]);

  async function copyValue() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore -- the user can still select+copy from the shown text
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      persistent
      title="Reveal value"
      subtitle={label}
      footer={
        <div className="flex items-center gap-3 w-full">
          <span className="font-mono text-[11px] text-ink-faint">
            auto-closing in <span className={remaining <= 5 ? "text-stop" : "text-ink"}>{remaining}s</span>
          </span>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Dismiss</Button>
          <Button variant="primary" onClick={copyValue} disabled={!value}>
            {copied ? "Copied" : "Copy value"}
          </Button>
        </div>
      }
    >
      {loading && <p className="font-mono text-xs text-ink-faint">fetching value...</p>}
      {error && (
        <div className="rounded-md bg-stop/10 border border-stop/30 px-3 py-2 text-sm text-stop">{error}</div>
      )}
      {value && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-[11px] font-mono text-ink-faint">
            <span>version <span className="text-ink">v{version}</span></span>
            <span>·</span>
            <span>fingerprint <span className="text-ink">{fingerprint}</span></span>
          </div>
          <pre
            className="group relative bg-abyss border border-line rounded-md p-3 font-mono text-[13px] text-ink overflow-x-auto cursor-pointer select-all break-all whitespace-pre-wrap"
            style={{ filter: "blur(4px)", transition: "filter .15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = "blur(0)")}
            onMouseLeave={(e) => (e.currentTarget.style.filter = "blur(4px)")}
            tabIndex={0}
          >
            {value}
          </pre>
          <p className="font-mono text-[10px] text-ink-faint">
            hover to read. closes on its own; a reveal was recorded to the audit chain.
          </p>
        </div>
      )}
    </Dialog>
  );
}
