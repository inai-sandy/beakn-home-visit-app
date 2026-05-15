import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { cities } from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";

import { CaptainSidebar } from "./sidebar";

// =============================================================================
// HVA-78: Captain app shell — route-group layout
// =============================================================================
//
// Wraps every /captain/* page with the persistent 240px sidebar + 56dp top
// bar. Server component — does the auth gate, fetches the captain's cities
// from the DB, and hands the resolved name+cities to the sidebar.
//
// ROLE GATE:
//   - Anonymous → redirect to /login?next=<original>. Same shape as
//     proxy.ts does at the HTTP layer (HVA-25); duplicated here as
//     belt-and-braces in case proxy.ts ever loses the /captain/ guard.
//   - role !== 'captain' AND role !== 'super_admin' → redirect to
//     /login. super_admin gets through DELIBERATELY (HVA-99 escape
//     hatch is intentional for the captain shell — admins need to
//     view captain UI for support without dual-account juggling).
//
// CITIES:
//   - Schema model is 1:N from cities → users via cities.captain_user_id.
//     A captain "owns" their cities. Phase 1 spec assumes 2 cities per
//     captain but the schema doesn't enforce that; we render whatever
//     count comes back, alphabetically.
//   - super_admin viewing this shell has no city assignment — they see
//     an empty cities array. Acceptable; the sidebar renders the row
//     conditionally.
// =============================================================================

export default async function CaptainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=/captain/dashboard");
  }

  const user = session.user as {
    id: string;
    name?: string;
    fullName?: string;
    role?: string;
  };

  // Belt-and-braces role gate. proxy.ts (HVA-25) already enforces this at
  // the HTTP boundary, but the layout double-checks so a broken proxy
  // config or future refactor can't silently let a sales_executive into
  // the captain UI.
  if (user.role !== "captain" && user.role !== "super_admin") {
    redirect("/login");
  }

  const captainName = user.fullName ?? user.name ?? "Captain";

  // Pull this captain's cities. super_admin gets an empty array — they're
  // not "assigned" cities; they view the shell for support purposes only.
  const myCities = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.captainUserId, user.id))
    .orderBy(asc(cities.name));

  return (
    <div className="flex min-h-svh bg-background">
      <CaptainSidebar captainName={captainName} cities={myCities} />

      {/* Right-side column: top bar + main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/*
          Top bar — 56dp. Empty title slot today; pages will fill via a
          Server Component prop in a follow-up issue (HVA-80+). Breadcrumb
          slot stays blank for the dashboard route.
        */}
        <header
          className="h-14 border-b bg-card/50 backdrop-blur-sm flex items-center px-6 sticky top-0 z-10"
          aria-label="Page header"
        >
          <div className="flex-1 min-w-0">
            {/*
              Placeholder: page-level title goes here in HVA-80+. Leaving
              the slot empty rather than a hard-coded string so the per-
              page header pattern lands without ripping out a placeholder
              that customers wouldn't see.
            */}
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
