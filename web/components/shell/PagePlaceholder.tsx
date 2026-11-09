// Shared "under construction" placeholder for nav items whose real pages
// land in phase-5b. Keeps the sidebar clickable without 404s.

export function PagePlaceholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="p-8 max-w-[1400px]">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-fg-muted mt-1">{note ?? "This page lands in phase-5b."}</p>
      <div className="mt-6 rounded-xl bg-surface-raised border border-border-subtle p-10 text-center text-fg-muted">
        The API behind this page is already live. The dashboard view ships next.
      </div>
    </div>
  );
}
