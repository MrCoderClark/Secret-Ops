import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

// Dead-simple semantic table. Variants of alignment/width are handled by
// callers via className rather than props — a table with a dozen column
// configurations is easier to read as JSX than a meta-prop system.

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
  return <tr className={`border-t border-border-subtle first:border-t-0 ${className}`} {...rest} />;
}

export function TH({ className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={`px-5 py-2 text-left text-[11px] font-semibold tracking-wider uppercase text-fg-muted ${className}`}
      {...rest}
    />
  );
}

export function TD({ className = "", ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-5 py-3 text-fg-primary align-middle ${className}`} {...rest} />;
}
