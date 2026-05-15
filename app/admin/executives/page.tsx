import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import {
  captains as captainsTable,
  cities,
  salesExecutives,
  users,
} from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";

import { ExecutivesClient } from "./executives-client";

// HVA-92: /admin/executives — list + CRUD for sales executives
//
// Server component. Lists execs joined to their captain + that captain's
// cities (since execs serve all of captain's cities per design decision).
// Renders ExecutivesClient with all data as props.

export const dynamic = "force-dynamic";

export default async function ExecutivesAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/admin/executives");
  const user = session.user as { id: string; role?: string };
  if (user.role !== "super_admin") redirect("/admin/dashboard");

  const captainAlias = alias(users, "captain_user");

  const execRows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      isActive: users.isActive,
      captainUserId: salesExecutives.captainUserId,
      captainFullName: captainAlias.fullName,
    })
    .from(users)
    .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
    .innerJoin(captainAlias, eq(captainAlias.id, salesExecutives.captainUserId))
    .where(eq(users.role, "sales_executive"))
    .orderBy(asc(users.fullName));

  // Captain → cities derivation (for display "exec serves these cities").
  const cityRows = await db
    .select({
      id: cities.id,
      name: cities.name,
      captainUserId: cities.captainUserId,
    })
    .from(cities)
    .orderBy(asc(cities.name));

  const execsWithCities = execRows.map((e) => ({
    id: e.id,
    fullName: e.fullName,
    phone: e.phone,
    email: e.email,
    isActive: e.isActive,
    captainUserId: e.captainUserId,
    captainName: e.captainFullName,
    cities: cityRows
      .filter((c) => c.captainUserId === e.captainUserId)
      .map((c) => c.name),
  }));

  // Active captains for the Add/Edit dropdown.
  const activeCaptains = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .innerJoin(captainsTable, eq(captainsTable.userId, users.id))
    .where(and(eq(users.role, "captain"), eq(users.isActive, true)))
    .orderBy(asc(users.fullName));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Sales Executives
            </h1>
            <p className="text-sm text-muted-foreground">
              {execsWithCities.length}{" "}
              {execsWithCities.length === 1 ? "executive" : "executives"} total
            </p>
          </div>
        </header>

        <ExecutivesClient
          executives={execsWithCities}
          activeCaptains={activeCaptains}
        />
      </div>
    </main>
  );
}
