import { alias } from "drizzle-orm/pg-core";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { cities, users } from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";

import { CitiesClient } from "./cities-client";

// =============================================================================
// HVA-110: /admin/settings/organization/cities
// =============================================================================
//
// Cities config MVP — captain_routing_email is the only editable column.
// Discord webhooks + support phones + Other routing config are deferred
// to HVA-90.
//
// List view shows every city + Other row. Each row carries city name,
// the currently-assigned captain (read-only here — HVA-91 owns captain
// → city writes), and the editable captain_routing_email.
//
// Schema path for captain lookup: cities.captain_user_id → users.id.
// Direct FK column; no subtype-table join needed for the display. The
// `cities.captain_routing_email` column is independent of who the captain
// is — admin curates routing email as a separate concern (HVA-90 design).
//
// super_admin only. Captain or sales_executive → redirected to their role
// home (proxy.ts handles non-authed). Defense-in-depth here too because the
// route is reachable via direct URL.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function CitiesAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/admin/settings/organization/cities");
  const user = session.user as { id: string; role?: string };
  if (user.role !== "super_admin") redirect("/admin/dashboard");

  const captainAlias = alias(users, "captain_user");

  const rows = await db
    .select({
      id: cities.id,
      name: cities.name,
      state: cities.state,
      captainUserId: cities.captainUserId,
      captainName: captainAlias.fullName,
      captainIsActive: captainAlias.isActive,
      captainRoutingEmail: cities.captainRoutingEmail,
      isActive: cities.isActive,
    })
    .from(cities)
    .leftJoin(captainAlias, eq(captainAlias.id, cities.captainUserId))
    .orderBy(asc(cities.name));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cities</h1>
            <p className="text-sm text-muted-foreground">
              {rows.length} {rows.length === 1 ? "city" : "cities"} — edit
              captain routing email for new customer requests.
            </p>
          </div>
        </header>

        <CitiesClient cities={rows} />
      </div>
    </main>
  );
}
