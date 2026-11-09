import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar, type SidebarUser } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";

// Authenticated shell -- Sidebar + Header + <main>. Every /(app)/* page
// goes through here. Machine tokens cannot sign in to the dashboard, so
// a Bearer actor redirects to /login the same as no session.

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") redirect("/login");

  const [user, org] = await Promise.all([
    db.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } }),
    db.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true, activeKeyId: true } }),
  ]);
  if (!user || !org) redirect("/login");

  const sidebarUser: SidebarUser = {
    name: user.name,
    email: user.email,
    role: actor.role,
    organizationName: org.name,
    activeKeyId: org.activeKeyId,
  };

  return (
    <div className="min-h-screen flex bg-slab text-ink">
      <Sidebar user={sidebarUser} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
