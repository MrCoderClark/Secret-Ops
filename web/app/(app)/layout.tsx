import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar, type SidebarUser } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { resolveActor } from "@/lib/session";
import { db } from "@/lib/db";

// Authenticated dashboard shell.
//
// Every /(app)/* page goes through here. We resolve the actor server-side
// and 302 to /login if there is no session. Machine tokens cannot sign in
// to the dashboard — Bearer-only actors redirect to /login too; they are
// the API's problem, not the UI's.

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  if (!actor || actor.kind !== "user") {
    redirect("/login");
  }

  const [user, org] = await Promise.all([
    db.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } }),
    db.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
  ]);
  if (!user || !org) redirect("/login");

  const sidebarUser: SidebarUser = {
    name: user.name,
    email: user.email,
    role: actor.role,
    organizationName: org.name,
  };

  return (
    <div className="min-h-screen flex bg-surface-base text-fg-primary">
      <Sidebar user={sidebarUser} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
