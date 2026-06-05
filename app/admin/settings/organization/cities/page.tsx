import { alias } from "drizzle-orm/pg-core";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { cities, users } from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";
import { getConfig } from "@/lib/config";

import { CitiesClient } from "./cities-client";
import { SupportPhonesSection } from "./support-phones-section";

// =============================================================================
// HVA-110 + HVA-90: /admin/settings/organization/cities
// =============================================================================
//
// HVA-110 shipped with `captain_routing_email` as the only editable
// column. HVA-90 (2026-06-05) lights up the deferred fields:
//
//   - Discord webhook URL (per-city, with live ping validation on save)
//   - other_routing_email (only on the "Other" row, replaces the
//     "field is fixed" lockout)
//   - customer_support_phone + admin_support_phone (top-of-page
//     inline editor — read by the tracking page footer + forgot-
//     password modal respectively)
//
// super_admin only. Captain or sales_executive redirected. Reuses
// HVA-91/HVA-110 lookup paths.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function CitiesAdminPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/admin/settings/organization/cities");
  const user = session.user as { id: string; role?: string };
  if (user.role !== "super_admin") redirect("/admin/dashboard");

  const captainAlias = alias(users, "captain_user");

  const [rows, customerSupportPhone, adminSupportPhone] = await Promise.all([
    db
      .select({
        id: cities.id,
        name: cities.name,
        state: cities.state,
        captainUserId: cities.captainUserId,
        captainName: captainAlias.fullName,
        captainIsActive: captainAlias.isActive,
        captainRoutingEmail: cities.captainRoutingEmail,
        otherRoutingEmail: cities.otherRoutingEmail,
        discordWebhookUrl: cities.discordWebhookUrl,
        isActive: cities.isActive,
      })
      .from(cities)
      .leftJoin(captainAlias, eq(captainAlias.id, cities.captainUserId))
      .orderBy(asc(cities.name)),
    getConfig("customer_support_phone"),
    getConfig("admin_support_phone"),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Cities</h1>
            <p className="text-sm text-muted-foreground">
              {rows.length} {rows.length === 1 ? "city" : "cities"} — edit
              captain routing email, Discord webhook, and Other-row fallback.
            </p>
          </div>
        </header>

        <SupportPhonesSection
          customerSupportPhone={customerSupportPhone ?? ""}
          adminSupportPhone={adminSupportPhone ?? ""}
        />

        <CitiesClient cities={rows} />
      </div>
    </main>
  );
}
