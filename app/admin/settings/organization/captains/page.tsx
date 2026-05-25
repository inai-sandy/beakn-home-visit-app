import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { captains as captainsTable, cities, users } from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";

import { CaptainsClient } from "./captains-client";

// =============================================================================
// HVA-91: /admin/captains — list + CRUD for captains
// =============================================================================
//
// Server component. Queries:
//   - all captains (with their city assignments, aggregated)
//   - all cities not currently held by an ACTIVE captain (for Add/Edit
//     dropdowns)
// Renders a single client island that owns all the modals + actions.
//
// Per the brief, NO admin shell — admin types URL directly. Page is plain;
// shell + sidebar deferred to HVA-86.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function CaptainsAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/admin/captains");
  const user = session.user as { id: string; role?: string };
  if (user.role !== "super_admin") redirect("/admin/dashboard");

  // Load all captains
  const captainRows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .innerJoin(captainsTable, eq(captainsTable.userId, users.id))
    .where(eq(users.role, "captain"))
    .orderBy(asc(users.fullName));

  // Aggregate cities per captain in one fetch.
  const allCities = await db
    .select({
      id: cities.id,
      name: cities.name,
      state: cities.state,
      captainUserId: cities.captainUserId,
    })
    .from(cities)
    .orderBy(asc(cities.name));

  const captainsWithCities = captainRows.map((c) => ({
    ...c,
    cities: allCities
      .filter((city) => city.captainUserId === c.id)
      .map((city) => ({ id: city.id, name: city.name })),
  }));

  // Cities available to assign: unassigned OR held by an inactive captain.
  // For Edit, the client also includes the cities CURRENTLY held by the
  // editing captain (which the server validates).
  const inactiveCaptainIds = captainRows
    .filter((c) => !c.isActive)
    .map((c) => c.id);
  const availableCities = allCities.filter(
    (city) =>
      city.captainUserId === null || inactiveCaptainIds.includes(city.captainUserId),
  );

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Captains</h1>
            <p className="text-sm text-muted-foreground">
              {captainsWithCities.length}{" "}
              {captainsWithCities.length === 1 ? "captain" : "captains"} total
            </p>
          </div>
        </header>

        <CaptainsClient
          captains={captainsWithCities}
          allCities={allCities.map((c) => ({ id: c.id, name: c.name }))}
          availableCities={availableCities.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </main>
  );
}
