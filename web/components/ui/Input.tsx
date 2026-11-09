import { InputHTMLAttributes, forwardRef } from "react";

// Text input. Owns no label — callers wrap with their own <label> to stay
// in control of layout. The focus ring uses the accent token so a theme
// swap doesn't miss it.

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full rounded-md bg-surface-sunken border border-border-subtle px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-fg-muted ${className}`}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";
