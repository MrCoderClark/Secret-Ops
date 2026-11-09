import { ButtonHTMLAttributes, forwardRef } from "react";

// Button variants map to intent, not colour, so a palette change flows
// through. "primary" fires the chartreuse accent -- reserve it for the one
// highest-intent action on a screen (New secret, Approve, Mint token).
// Everything else is "secondary" (default), "ghost" (text-only), or
// "danger" (destructive confirmations).

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-slab";

const VARIANTS: Record<Variant, string> = {
  primary:   "bg-accent text-abyss hover:brightness-110 shadow-accent",
  secondary: "bg-raised text-ink border border-line-strong hover:bg-inset hover:border-ink-faint",
  ghost:     "text-ink-dim hover:bg-inset hover:text-ink",
  danger:    "bg-stop text-ink hover:brightness-110",
};

const SIZES: Record<Size, string> = {
  sm: "text-xs px-2.5 py-1.5",
  md: "text-sm px-3.5 py-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...rest }, ref) => {
    return <button ref={ref} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest} />;
  },
);
Button.displayName = "Button";
