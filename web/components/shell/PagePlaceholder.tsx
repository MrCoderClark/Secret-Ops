// Shared "under construction" placeholder for nav items whose real pages
// land in phase-5b. Styled against the new token system so it doesn't
// look like a broken page -- just a quiet "nothing here yet".

export function PagePlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="px-8 py-6 max-w-[1400px] mx-auto w-full flex flex-col gap-4">
      <div>
        <h1 className="font-mono text-3xl font-medium tracking-tight leading-none">{title}</h1>
        <p className="font-mono text-xs text-ink-faint mt-2">
          {note ?? "This page lands in phase-5b."}
        </p>
      </div>
      <div className="rounded-lg bg-raised border border-line p-10 text-center">
        <p className="text-sm text-ink-dim">The API behind this page is already live.</p>
        <p className="font-mono text-[11px] text-ink-faint mt-1.5">the dashboard view ships next</p>
      </div>
    </div>
  );
}
