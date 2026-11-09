import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

// Dead-simple semantic table with the console palette baked in. Alignment /
// width tweaks are handled by callers via className rather than props.

export function Table({ className = "", ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full text-sm ${className}`} {...rest} />;
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className = "", ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-line last:border-b-0 transition-colors hover:bg-accent/[0.035] [&:hover_td:first-child]:shadow-[inset_3px_0_0_var(--accent)] ${className}`}
      {...rest}
    />
  );
}

export function TH({ className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-5 py-2 text-left text-[10.5px] font-semibold tracking-wider uppercase text-ink-faint border-b border-line ${className}`}
      {...rest}
    />
  );
}

export function TD({ className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-5 py-3 text-ink align-middle ${className}`} {...rest} />;
}
