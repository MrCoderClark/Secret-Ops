import { HTMLAttributes, ReactNode } from "react";

// Card — the one surface for grouped content. `title` renders a header row
// with optional `action` on the right (e.g. a "Manage targets →" link).
// `subtitle` sits under the title in muted text.

// Omit the HTML `title` attribute (the browser tooltip) because our `title`
// prop takes ReactNode -- HTMLAttributes defines title as string | undefined
// and TS refuses the widen.
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  // When true, the body gets no padding -- useful for tables that style
  // their own row padding.
  flush?: boolean;
}

export function Card({ title, subtitle, action, flush, className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-xl bg-surface-raised border border-border-subtle shadow-card ${className}`}
      {...rest}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-border-subtle">
          <div>
            {title && <h2 className="text-base font-semibold text-fg-primary">{title}</h2>}
            {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </div>
  );
}
