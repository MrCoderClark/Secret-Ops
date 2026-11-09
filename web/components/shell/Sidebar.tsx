"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

// Left rail -- 220px, dark-abyss background, nine nav items in the
// SPECS-locked order. The active item gets a 3px chartreuse LED stripe
// on the left edge (the accent's first of four uses on this screen).
// Org row shows the active KEK next to the name, because operators who
// care about secrets care which key is wrapping their values right now.

export type SidebarUser = {
  name: string;
  email: string;
  role: string;
  organizationName: string;
  activeKeyId: string;
};

const NAV: Array<{ href: string; label: string; icon: ReactNode }> = [
  { href: "/overview", label: "Overview",  icon: <HomeIcon /> },
  { href: "/secrets",  label: "Secrets",   icon: <LockIcon /> },
  { href: "/sync",     label: "Sync",      icon: <SyncIcon /> },
  { href: "/rotation", label: "Rotation",  icon: <RotationIcon /> },
  { href: "/access",   label: "Access",    icon: <PeopleIcon /> },
  { href: "/audit",    label: "Audit log", icon: <DocIcon /> },
  { href: "/policies", label: "Policies",  icon: <ShieldIcon /> },
  { href: "/tokens",   label: "Tokens",    icon: <KeyIcon /> },
  { href: "/settings", label: "Settings",  icon: <GearIcon /> },
];

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  async function signOut() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-[220px] shrink-0 bg-abyss border-r border-line flex flex-col sticky top-0 self-start h-screen">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-6">
        <span className="w-[22px] h-[22px] grid place-items-center bg-accent text-abyss rounded font-mono font-bold text-[13px]">S</span>
        <span className="font-mono font-semibold text-[15px] tracking-tight">SecretOps</span>
      </div>

      <div className="px-5 pb-3.5 flex flex-col gap-1">
        <span className="label-eyebrow">Organization</span>
        <span className="text-[13px] font-medium text-ink">{user.organizationName}</span>
        <span className="font-mono text-[11px] text-ink-dim">
          KEK <span className="text-signal font-medium">{user.activeKeyId}</span> &middot; active
        </span>
      </div>

      <nav className="flex flex-col mt-2" aria-label="Pages">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`grid grid-cols-[3px_18px_1fr] items-center gap-3 pr-5 py-[9px] text-[13px] transition-colors
                ${active ? "text-ink bg-gradient-to-r from-accent/[0.06] to-transparent" : "text-ink-dim hover:text-ink hover:bg-white/[0.02]"}`}
            >
              <span className={`w-[3px] h-[18px] rounded-r-sm transition-all ${active ? "bg-accent shadow-accent" : "bg-transparent"}`} />
              <span className={active ? "text-accent" : "text-ink-faint"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-line px-5 pt-3.5 pb-4 flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-inset border border-line-strong grid place-items-center text-[11px] font-semibold text-ink shrink-0">
            {initialsOf(user.name)}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate text-ink">{user.name}</div>
            <div className="font-mono text-[11px] text-ink-faint">{user.role.toLowerCase()}</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full rounded border border-line text-ink-dim text-xs py-1.5 hover:text-ink hover:border-line-strong transition"
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

// Inline 16px icons, 1.5px stroke. No icon library -- a new icon is one new
// SVG element here, not a dependency bump.

function iconProps() {
  return {
    width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.5,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
}
function HomeIcon()     { return <svg {...iconProps()}><path d="M3 11.5 12 4l9 7.5M5 10v10h14V10"/></svg>; }
function LockIcon()     { return <svg {...iconProps()}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 1 1 8 0v3"/></svg>; }
function SyncIcon()     { return <svg {...iconProps()}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>; }
function RotationIcon() { return <svg {...iconProps()}><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>; }
function PeopleIcon()   { return <svg {...iconProps()}><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M15 20c0-2 2-3.5 4-3.5s2 1 2 3.5"/></svg>; }
function DocIcon()      { return <svg {...iconProps()}><path d="M7 3h7l5 5v13H7zM14 3v5h5M9 13h8M9 17h8"/></svg>; }
function ShieldIcon()   { return <svg {...iconProps()}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>; }
function KeyIcon()      { return <svg {...iconProps()}><circle cx="8" cy="15" r="3"/><path d="m10.5 13.5 9-9m-2 2 2 2m-5 1 2 2"/></svg>; }
function GearIcon()     { return <svg {...iconProps()}><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2l.5 2.5h4l.5-2.5c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>; }
