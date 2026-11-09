"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

// Left-rail navigation. Nine items in the order SPECS § 8 locks in:
// Overview, Secrets, Sync, Rotation, Access, Audit log, Policies, Tokens,
// Settings. The item whose path prefixes the current pathname is active.
//
// Sign-out posts to /api/auth/logout (session + csrf cookies cleared) and
// pushes the user to /login.

export type SidebarUser = {
  name: string;
  email: string;
  role: string;
  organizationName: string;
};

const NAV: Array<{ href: string; label: string; icon: ReactNode }> = [
  { href: "/overview", label: "Overview", icon: <HomeIcon /> },
  { href: "/secrets",  label: "Secrets",  icon: <LockIcon /> },
  { href: "/sync",     label: "Sync",     icon: <SyncIcon /> },
  { href: "/rotation", label: "Rotation", icon: <RotationIcon /> },
  { href: "/access",   label: "Access",   icon: <PeopleIcon /> },
  { href: "/audit",    label: "Audit log",icon: <DocIcon /> },
  { href: "/policies", label: "Policies", icon: <ShieldIcon /> },
  { href: "/tokens",   label: "Tokens",   icon: <KeyIcon /> },
  { href: "/settings", label: "Settings", icon: <GearIcon /> },
];

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const onSignOut = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border-subtle bg-surface-raised flex flex-col">
      <div className="px-5 pt-6 pb-4 flex items-center gap-2">
        <span className="text-accent"><LockGlyph /></span>
        <span className="text-lg font-semibold tracking-tight">SecretOps</span>
      </div>

      <div className="px-5 label-eyebrow mb-2">{user.organizationName}</div>

      <nav className="flex-1 px-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition
                ${active ? "bg-accent-soft/40 text-fg-primary" : "text-fg-secondary hover:bg-surface-hover hover:text-fg-primary"}`}
            >
              <span className={active ? "text-accent" : "text-fg-muted"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border-subtle p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-surface-hover flex items-center justify-center text-sm font-semibold text-fg-primary">
            {initialsOf(user.name)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{user.name}</div>
            <div className="text-xs text-fg-muted truncate">{titleCase(user.role)}</div>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="w-full rounded-md border border-border-subtle bg-surface-raised hover:bg-surface-hover text-sm py-2 transition"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[parts.length - 1]?.[0] ?? "";
  return (a + b).toUpperCase().slice(0, 2) || "??";
}
function titleCase(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

// Inline icons — 18px stroke, currentColor. No icon lib dependency; new
// icons are a one-SVG-element change here, not a dep bump.

function iconProps() { return { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }; }

function LockGlyph() {
  return (
    <svg {...iconProps()}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}
function HomeIcon()   { return <svg {...iconProps()}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>; }
function LockIcon()   { return LockGlyph(); }
function SyncIcon()   { return <svg {...iconProps()}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>; }
function RotationIcon(){return <svg {...iconProps()}><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>;}
function PeopleIcon() { return <svg {...iconProps()}><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M15 20c0-2 2-3.5 4-3.5s2 1 2 3.5"/></svg>; }
function DocIcon()    { return <svg {...iconProps()}><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9 13h8"/><path d="M9 17h8"/></svg>; }
function ShieldIcon() { return <svg {...iconProps()}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>; }
function KeyIcon()    { return <svg {...iconProps()}><circle cx="8" cy="15" r="3"/><path d="m10.5 13.5 9-9"/><path d="m17 7 2 2"/><path d="m14 10 2 2"/></svg>; }
function GearIcon()   { return <svg {...iconProps()}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2l.5 2.5h4l.5-2.5c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>; }
