import { InputHTMLAttributes, forwardRef } from "react";

// Owned by caller for label + layout. Inset surface so it reads as "input
// me", accent-tinged focus border so a filled form shows where the cursor
// landed.

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md bg-inset border border-line px-3 py-2 text-sm outline-none transition focus:border-accent-dim placeholder:text-ink-faint ${className}`}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";
