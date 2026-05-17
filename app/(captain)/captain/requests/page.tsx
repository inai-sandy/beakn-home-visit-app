import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import {
  cities,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";
import { loadCaptainCities } from "@/lib/captain/cities";
import {
  BUCKET_LABELS,
  CAPTAIN_REQUEST_BUCKETS,
  categorizeRequest,
  isCaptainRequestBucket,
  type CaptainRequestBucket,
} from "@/lib/captain/request-buckets";
import { maskCustomerPhone } from "@/lib/format/phone";
import { cn } from "@/lib/utils";

import { InlineAssignButton } from "./inline-assign-button";

// =============================================================================
// HVA-127: /captain/requests — all requests in the captain's cities
// =============================================================================
//
// Wide-net listing. Filter: `visit_requests.city_id IN (cities WHERE
// captain_user_id = me)`. No status filter at the query layer — bucket
// tabs operate client-rendering-side on the same row set so the captain
// always sees their full request volume on first load.
//
// AUTH:
//   - captain   → own-city requests, all statuses
//   - super_admin → all requests (skip the city filter)
//   - (captain layout's role gate keeps anyone else out)
//
// "Other" pseudo-city has `captain_user_id IS NULL`, so the inArray
// filter excludes it by construction. No captain ever sees Other-city
// requests in this list — by design.
//
// /captain/requests/unassigned remains as the narrower "pending-assign"
// queue (HVA-81). Same ownership rule, different status filter.
// =============================================================================

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ bucket?: string }>;
}

export default async function CaptainRequestsListPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/captain/requests");

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === "super_admin";

  const { bucket: bucketRaw } = await searchParams;
  const activeBucket: CaptainRequestBucket = isCaptainRequestBucket(bucketRaw)
    ? bucketRaw
    : "all";

  const myCities = isAdmin ? [] : await loadCaptainCities(actor.id);
  const myCityIds = myCities.map((c) => c.id);

  // Empty state for a captain with no city assignments. Skip the query
  // entirely — avoids returning everything via the absence of the
  // inArray filter on an empty list.
  if (!isAdmin && myCityIds.length === 0) {
    return (
      <div className="p-8 max-w-5xl space-y-3">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        </header>
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No requests in your cities yet. If you expected to see requests
            here, ask an admin to confirm your city assignments.
          </p>
        </div>
      </div>
    );
  }

  const execUser = alias(users, "exec_user");

  // Single query — JOIN cities for name, status_stages for human-readable
  // status, LEFT JOIN exec user for the assigned-to display.
  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      statusCode: statusStages.code,
      statusName: statusStages.name,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedExecName: execUser.fullName,
      cancelledAt: visitRequests.cancelledAt,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .where(
      isAdmin
        ? undefined
        : and(inArray(visitRequests.cityId, myCityIds)),
    )
    .orderBy(desc(visitRequests.createdAt));

  // Bucket the rows in-memory. Counts feed the tab strip; filtering
  // happens after so the "All" count is always row total.
  const bucketCounts: Record<CaptainRequestBucket, number> = {
    all: rows.length,
    open: 0,
    assigned: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const r of rows) {
    bucketCounts[
      categorizeRequest({
        statusCode: r.statusCode,
        assignedExecUserId: r.assignedExecUserId,
        cancelledAt: r.cancelledAt,
      })
    ] += 1;
  }

  const visible =
    activeBucket === "all"
      ? rows
      : rows.filter(
          (r) =>
            categorizeRequest({
              statusCode: r.statusCode,
              assignedExecUserId: r.assignedExecUserId,
              cancelledAt: r.cancelledAt,
            }) === activeBucket,
        );

  // HVA-139: load the captain's exec list once so any row that qualifies
  // for an inline Assign trigger can pass it down. Super_admin gets the
  // full active-exec list (they may assign across teams for support).
  // Captain gets only execs reporting to them.
  const hasAssignableRow = visible.some(
    (r) =>
      r.cancelledAt === null &&
      r.statusCode === "SUBMITTED" &&
      r.assignedExecUserId === null,
  );
  const execsForAssignment: Array<{ id: string; fullName: string }> =
    hasAssignableRow
      ? isAdmin
        ? await db
            .select({ id: users.id, fullName: users.fullName })
            .from(users)
            .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
            .where(eq(users.isActive, true))
            .orderBy(asc(users.fullName))
        : await db
            .select({ id: users.id, fullName: users.fullName })
            .from(salesExecutives)
            .innerJoin(users, eq(users.id, salesExecutives.userId))
            .where(
              and(
                eq(salesExecutives.captainUserId, actor.id),
                eq(users.isActive, true),
              ),
            )
            .orderBy(asc(users.fullName))
      : [];

  function rowQualifiesForInlineAssign(r: (typeof visible)[number]): boolean {
    return (
      r.cancelledAt === null &&
      r.statusCode === "SUBMITTED" &&
      r.assignedExecUserId === null
    );
  }

  return (
    <div className="p-6 sm:p-8 max-w-6xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin
              ? "All requests across every city."
              : `${rows.length} request${rows.length === 1 ? "" : "s"} across ${myCities.length} ${myCities.length === 1 ? "city" : "cities"}.`}
          </p>
        </div>
        {!isAdmin && myCities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {myCities.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-xs">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </header>

      {/* Bucket pills. URL-driven so the active tab survives reload. */}
      <nav
        aria-label="Filter by status"
        className="flex flex-wrap gap-1.5 border-b pb-3"
      >
        {CAPTAIN_REQUEST_BUCKETS.map((b) => {
          const active = b === activeBucket;
          const href = b === "all" ? "/captain/requests" : `/captain/requests?bucket=${b}`;
          return (
            <Link
              key={b}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span>{BUCKET_LABELS[b]}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px]",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted-foreground/15 text-muted-foreground",
                )}
              >
                {bucketCounts[b]}
              </span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {activeBucket === "all"
              ? "No requests in your cities yet."
              : `No ${BUCKET_LABELS[activeBucket].toLowerCase()} requests.`}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: card list.
              HVA-139: uses the stretched-link pattern so the inline
              Assign button can sit ABOVE the Link without React's "<a>
              inside <a>" warning and without the button click bubbling
              to the row navigation. */}
          <ul className="lg:hidden space-y-3" aria-label="Requests (mobile)">
            {visible.map((r) => {
              const qualifies = rowQualifiesForInlineAssign(r);
              return (
                <li key={r.id}>
                  <div className="relative rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring">
                    <Link
                      href={`/requests/${r.id}`}
                      className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none"
                      aria-label={`Open request from ${r.customerName}`}
                    />
                    <div className="relative z-20 pointer-events-none">
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold tracking-tight">
                          {r.customerName}
                        </h3>
                        {/* HVA-142: destructive badge for cancelled
                            (cancellation is orthogonal to
                            status_stage_id per HVA-69). */}
                        {r.cancelledAt !== null ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Cancelled
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            {r.statusName}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-mono text-muted-foreground mt-1">
                        {maskCustomerPhone(r.customerPhone)}
                      </p>
                      <div className="flex items-center justify-between gap-2 mt-2 text-xs text-muted-foreground">
                        <span>{r.cityName}</span>
                        <span>{r.assignedExecName ?? "—"}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                      </p>
                      {qualifies && (
                        <div className="mt-3 flex justify-end pointer-events-auto">
                          <InlineAssignButton
                            requestId={r.id}
                            execs={execsForAssignment}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: table */}
          <div
            className="hidden lg:block rounded-2xl border bg-card overflow-hidden"
            aria-label="Requests (desktop)"
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 font-medium">Phone</th>
                  <th className="text-left px-4 py-3 font-medium">City</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Assigned exec</th>
                  <th className="text-left px-4 py-3 font-medium">Submitted</th>
                  {/* HVA-139: per-row action column for inline Assign
                      on Submitted+unassigned rows. Empty for other
                      rows to keep alignment. */}
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const qualifies = rowQualifiesForInlineAssign(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-t hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/requests/${r.id}`}
                          className="font-medium hover:underline"
                        >
                          {r.customerName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {maskCustomerPhone(r.customerPhone)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.cityName}
                      </td>
                      <td className="px-4 py-3">
                        {/* HVA-142: see mobile-card variant above. */}
                        {r.cancelledAt !== null ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Cancelled
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            {r.statusName}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.assignedExecName ?? (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span title={r.createdAt.toISOString()}>
                          {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {qualifies && (
                          <InlineAssignButton
                            requestId={r.id}
                            execs={execsForAssignment}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* HVA-139: the "Open the unassigned queue" hint used to live here.
          Inline Assign buttons on Submitted+unassigned rows make that
          deep link redundant — the queue page itself is still functional
          and is the documented HVA-81 surface, but is no longer the
          dominant assignment path. */}
    </div>
  );
}
