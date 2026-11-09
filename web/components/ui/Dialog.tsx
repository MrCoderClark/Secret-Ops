"use client";

import { ReactNode, useEffect, useRef } from "react";

// Headless-ish modal. Backdrop-blurred overlay, graphite card, close on
// Escape, close on backdrop click. Trap focus inside while open, restore
// on close. Compose with <DialogHeader>, body, and <DialogFooter>.

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  // Width preset. "sm" (reveal), "md" (confirms), "lg" (plan diff).
  size?: "sm" | "md" | "lg";
  // When true, clicking the backdrop does NOT close -- for dialogs holding
  // plaintext a stray backdrop click should not drop the modal.
  persistent?: boolean;
}

const SIZE: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

export function Dialog({ open, onClose, title, subtitle, children, footer, size = "md", persistent }: DialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Hold onClose in a ref so the Escape handler always calls the latest
  // copy without needing to live in the open-transition effect's deps.
  // Parents often pass a fresh arrow function on every render; keeping
  // onClose in the effect deps would re-run the focus logic on every
  // keystroke and steal focus from form inputs.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previousFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onMouseDown={(e) => {
        if (persistent) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-abyss/80 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`relative w-full ${SIZE[size]} rounded-lg bg-raised border border-line shadow-card outline-none`}
      >
        {(title || subtitle) && (
          <div className="px-5 pt-4 pb-3 border-b border-line">
            {title && <h2 className="font-mono text-[13px] font-medium text-ink">{title}</h2>}
            {subtitle && <p className="font-mono text-[11px] text-ink-faint mt-0.5">{subtitle}</p>}
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
