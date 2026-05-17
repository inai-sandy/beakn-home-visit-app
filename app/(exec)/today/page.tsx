import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import { cities, statusStages, visitRequests } from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";

// =============================================================================
// HVA-103: /today — sales exec assigned-requests list (MVP precursor to HVA-57)
// =============================================================================
//
// Replaces HVA-78's session-JSON stub with the first real exec-facing
// surface. Scoped DOWN from HVA-57's full Today dashboard — only ships
// the one section that has real data today: "My Assigned Requests."
// Other HVA-57 sections (Scheduled Visits, Other Tasks, Submit Day Plan)
// depend on infrastructure that isn't built yet — HVA-58, HVA-60, etc.
//
// ROLE GATING (defence-in-depth; proxy.ts also gates at HTTP layer):
//   - sales_executive  → 200, sees own assignments
//   - super_admin      → 200, empty list (intentional HVA-99 escape hatch)
//   - captain          → handled by proxy.ts → 307 → /captain/dashboard?denied=1
//   - anonymous        → handled by proxy.ts → 307 → /login?next=/today
//
// QUERY (single SELECT with two joins):
//   visit_requests where
//     assigned_exec_user_id = current user id
//     AND status_stage_id != (id of "Order Executed Successfully")
//   ORDER BY assigned_at desc NULLS LAST, created_at desc
//
// `created_at` IS the submitted_at field — there's no separate submitted_at
// column in the schema (HVA-14 design). HVA-33 inserts with the default
// now(), so created_at carries the submission moment.
//
// LINKS:
//   Each card wraps the whole row in <Link href={`/requests/${id}`}>. That
//   route doesn't exist yet (HVA-66 will ship it); tapping the row will
//   404 in the interim. Acceptable per HVA-103 brief — the navigation
//   intent is correct, only the destination is missing.
// =============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Today — Beakn",
  description: "Your assigned requests.",
};

const TERMINAL_STAGE_CODE = "ORDER_EXECUTED_SUCCESSFULLY";

export default async function TodayPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=/today");
  }

  const user = session.user as { id: string; role?: string };

  // Belt-and-braces: proxy.ts already gates /today to sales_executive +
  // super_admin escape hatch. Anything else slipping through is a config
  // regression; redirect to login rather than silently rendering an
  // empty list as the wrong role.
  if (user.role !== "sales_executive" && user.role !== "super_admin") {
    redirect("/login");
  }

  // Terminal stage id — exclude from the list. Looked up dynamically so
  // admin-renamed stage codes don't break the page; if the code is
  // missing (somehow not seeded), fall through to "no filter" since the
  // bigger correctness concern is showing the exec their work, not
  // perfectly hiding completed requests.
  const [terminal] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, TERMINAL_STAGE_CODE))
    .limit(1);

  // Build WHERE clause. super_admin's id will return 0 rows from this
  // query (they're not in sales_executives and have no assignments) —
  // empty state will render, matching the intentional escape hatch
  // semantics from HVA-99.
  // HVA-142: cancelled requests should not appear on the exec's active
  // Today view. HVA-69 cancellation is orthogonal to status_stage_id, so
  // the existing ne(statusStageId, terminal.id) check is insufficient
  // (e.g. a request cancelled while ASSIGNED would otherwise remain
  // here, even though no exec action is possible on it).
  const baseWhere = terminal
    ? and(
        eq(visitRequests.assignedExecUserId, user.id),
        ne(visitRequests.statusStageId, terminal.id),
        isNull(visitRequests.cancelledAt),
      )
    : and(
        eq(visitRequests.assignedExecUserId, user.id),
        isNull(visitRequests.cancelledAt),
      );

  // SORT: assigned_at desc nulls last, then created_at desc as the
  // tiebreaker / fallback for any row where assigned_at didn't get
  // populated (legacy rows or future code paths that skip the column).
  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      address: visitRequests.address,
      bhk: visitRequests.bhk,
      interest: visitRequests.interest,
      createdAt: visitRequests.createdAt,
      assignedAt: visitRequests.assignedAt,
      stageName: statusStages.name,
      cityName: cities.name,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(baseWhere)
    .orderBy(
      sql`${visitRequests.assignedAt} DESC NULLS LAST`,
      desc(visitRequests.createdAt),
      // Stable tiebreaker by id so equal timestamps render in a
      // deterministic order across refreshes.
      asc(visitRequests.id),
    );

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "No assignments yet."
              : `${rows.length} assigned ${rows.length === 1 ? "request" : "requests"}.`}
          </p>
        </header>

        <section aria-label="My Assigned Requests" className="space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
            My Assigned Requests
          </h2>

          {rows.length === 0 ? (
            <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
              <Icon
                name="inbox"
                size="lg"
                className="text-muted-foreground/70 mx-auto"
              />
              <p className="text-sm text-muted-foreground">
                No requests assigned to you yet. Check back soon.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => {
                const stamp = r.assignedAt ?? r.createdAt;
                const relative = formatDistanceToNow(new Date(stamp), {
                  addSuffix: true,
                });
                return (
                  <li key={r.id}>
                    {/*
                      Stretched-link card. The card is a positioned
                      container; the outer Link is absolutely positioned
                      to cover the whole surface (the tap target). The
                      phone tel: link sits ABOVE the stretched link via
                      z-index so taps on the phone number dial the
                      customer instead of navigating. No JS handler
                      needed — this is a CSS-only solution, which keeps
                      the row a server component.
                      /requests/[id] lands in HVA-66; until then it
                      404s. Acceptable per the HVA-103 brief.
                    */}
                    <div className="relative rounded-3xl border bg-card p-5 shadow-sm transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring">
                      <Link
                        href={`/requests/${r.id}`}
                        className="absolute inset-0 z-10 rounded-3xl focus-visible:outline-none"
                        aria-label={`View request from ${r.customerName}`}
                      />
                      <div className="relative z-20 space-y-2 pointer-events-none">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold tracking-tight">
                            {r.customerName}
                          </h3>
                          <Badge variant="secondary" className="text-[10px]">
                            {r.stageName}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {r.cityName}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {r.bhk}
                          </Badge>
                          <span
                            className="ml-auto text-xs text-muted-foreground"
                            title={new Date(stamp).toISOString()}
                          >
                            {relative}
                          </span>
                        </div>

                        <p className="text-sm text-muted-foreground whitespace-pre-line">
                          {r.address}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          {/*
                            pointer-events-auto re-enables hit-testing for
                            the tel: link (the parent disables it so the
                            outer stretched Link gets all the rest). Tap
                            on this dials the customer; tap anywhere
                            else navigates.
                          */}
                          <a
                            href={`tel:${r.customerPhone}`}
                            className="pointer-events-auto inline-flex items-center gap-1 font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            aria-label={`Call ${r.customerName} at ${r.customerPhone}`}
                          >
                            <Icon name="phone" size="xs" />
                            {r.customerPhone}
                          </a>
                          {r.interest.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Icon name="lightbulb" size="xs" />
                              {r.interest.join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
