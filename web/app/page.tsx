import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { resolveActor } from "@/lib/session";

// The root route is a dispatcher: signed in -> dashboard, otherwise -> login.
// Everything else lives under /login or /(app)/* so we never render a
// standalone root page.
//
// force-dynamic because cookies() / headers() cannot be read in a static
// context. Without it, `next build` tries to prerender this page, the
// cookies() call throws during prerendering, and the whole error-page
// pipeline fails with a misleading "Html should not be imported" cascade.
export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await resolveActor({ headers: headers(), cookies: cookies() });
  redirect(actor ? "/overview" : "/login");
}
