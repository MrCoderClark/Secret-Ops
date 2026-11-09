// Shell-prompt crumb under the top bar. Reads like a terminal "you are
// here" line: org · plan · signed-in-N-ago. The point is to remind the
// operator what context every write below is landing against.

export interface ContextStripProps {
  orgSlug: string;
  plan: string;
  signedInAgo: string;
}

export function ContextStrip({ orgSlug, plan, signedInAgo }: ContextStripProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-mono text-[11px] text-ink-faint" aria-label="Context">
      <Chip k="org"       v={orgSlug} />
      <span className="text-line-strong">/</span>
      <Chip k="plan"      v={plan} />
      <span className="text-line-strong">/</span>
      <Chip k="signed in" v={`${signedInAgo} ago`} />
    </div>
  );
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="px-2 py-0.5 bg-raised border border-line rounded-sm text-ink-dim">
      {k} <span className="text-ink font-medium">{v}</span>
    </span>
  );
}
