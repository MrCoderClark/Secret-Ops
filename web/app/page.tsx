import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { resolveActor } from "@/lib/session";

// The root route is a dispatcher: signed in -> dashboard, otherwise -> login.
// Everything else lives under /login or /(app)/* so we never render a
// standalone root page.
export default async function Home() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  redirect(actor ? "/overview" : "/login");
}
