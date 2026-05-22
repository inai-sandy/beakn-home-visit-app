import { alias } from "drizzle-orm/pg-core";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { cities, salesExecutives, users } from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";
import { decideExecAccess } from "@/lib/exec-authz";

import { ExecBottomNav } from "./_components/exec-bottom-nav";
import { ExecMobileTopbar } from "./_components/ExecMobileTopbar";
import { ExecSidebar } from "./_components/exec-sidebar";
import { ExecTopbar } from "./_components/exec-topbar";

// =============================================================================
// HVA-115: sales-executive app shell — route-group layout
// =============================================================================
//
// Wraps `/today`, `/requests`, and `/profile`. Server component:
//   1. Defence-in-depth role gate via lib/exec-authz.ts (proxy.ts is the
//      primary gate at the HTTP layer; this catches a regression where
//      a different role reaches the route group).
//   2. Loads exec identity (own name) + captain identity (joined through
//      sales_executives.captain_user_id) + cities served (captain's
//      cities — execs serve all of their captain's cities per the
//      Phase-1 model). All three are passed to the sidebar; the topbar
//      only needs the name for the avatar's initials.
//
// Visual structure (responsive):
//   < 1024px (mobile/tablet) — Topbar (logo + title + avatar menu)
//                              Content
//                              Bottom nav (3 destinations)
//   ≥ 1024px (desktop)       — Sidebar (logo + identity + nav + logout)
//                              Topbar (title + bell placeholder)
//                              Content
//
// CSS-only responsive switch via Tailwind `lg:` — components are always
// rendered server-side; visibility flips by class. No JS viewport detection.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function ExecLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  const decision = decideExecAccess(session, "/today");
  if (!decision.allow) {
    redirect(decision.redirectTo);
  }

  const user = session!.user as { id: string; name?: string; role: string };
  const fullName = user.name ?? "Executive";

  // Captain + cities lookup. `salesExecutives` carries the captain FK;
  // the captain's cities live on `cities.captain_user_id`.
  const captainAlias = alias(users, "captain_user");
  const [execRow] = await db
    .select({
      captainUserId: salesExecutives.captainUserId,
      captainName: captainAlias.fullName,
    })
    .from(salesExecutives)
    .innerJoin(captainAlias, eq(captainAlias.id, salesExecutives.captainUserId))
    .where(eq(salesExecutives.userId, user.id))
    .limit(1);

  let cityRows: { id: string; name: string }[] = [];
  if (execRow?.captainUserId) {
    cityRows = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(eq(cities.captainUserId, execRow.captainUserId))
      .orderBy(asc(cities.name));
  }

  return (
    <div className="min-h-svh flex bg-background">
      <ExecSidebar
        fullName={fullName}
        captainName={execRow?.captainName ?? null}
        cities={cityRows}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {/*
          HVA-51 mobile topbar — only renders below lg. Hamburger
          drawer trigger + page title + avatar dropdown.
        */}
        <ExecMobileTopbar
          fullName={fullName}
          captainName={execRow?.captainName ?? null}
          cities={cityRows}
        />
        <ExecTopbar fullName={fullName} />
        {/*
          Content area is a plain <div>: each child page renders its own
          <main> already (see /today). Two <main> per document is invalid
          HTML, so we keep this wrapper neutral. Same call HVA-86 made
          for the admin shell.
        */}
        <div className="flex-1 overflow-x-auto">{children}</div>
        <ExecBottomNav />
      </div>
    </div>
  );
}
