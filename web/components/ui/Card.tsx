import { HTMLAttributes, ReactNode } from "react";

// A card is a labelled panel: hairline border, dark-raised fill, optional
// header row with title / subtitle / action. Pass `flush` when the body is
// a table (the table's own row padding handles the inside gutter).

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
}

export function Card({ title, subtitle, action, flush, className = "", children, ...rest }: CardProps) {
  return (
    <div className={`rounded-lg bg-raised border border-line ${className}`} {...rest}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 px-5 py-3.5 border-b border-line">
          <div className="min-w-0">
            {title && <h2 className="font-mono text-[13px] font-medium text-ink leading-tight">{title}</h2>}
            {subtitle && <p className="font-mono text-[11px] text-ink-faint mt-0.5 leading-snug">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </div>
  );
}
