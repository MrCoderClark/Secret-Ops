import { ButtonHTMLAttributes, forwardRef } from "react";

// Button — the one control type for every clickable action. Variants map to
// intent, not colour, so a rename of the accent token flows through.
//
//   primary   accent-filled, high emphasis (the single "primary action" per screen)
//   secondary surface-raised, standard
//   ghost     text-only, subtle inline action
//   danger    red-filled, destructive confirmation
//
// Size: md (default) or sm. Use sm inside tables and compact lists.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base";

const VARIANTS: Record<Variant, string> = {
  primary:   "bg-accent text-fg-on-accent hover:bg-accent-hover",
  secondary: "bg-surface-raised text-fg-primary border border-border-subtle hover:bg-surface-hover",
  ghost:     "text-fg-secondary hover:bg-surface-hover",
  danger:    "bg-danger text-fg-on-accent hover:brightness-110",
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
