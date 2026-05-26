import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import {
  cities,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";
import { buildCaptainRequestVisibilityWhere } from "@/lib/captain/team-scope";
import { computePageRange, parsePage } from "@/lib/pagination";

import {
  ApprovalsFiltersBar,
} from "./_components/ApprovalsFiltersBar";
import {
  ApprovalsListClient,
  type ApprovalRowDTO,
} from "./_components/ApprovalsListClient";

// =============================================================================
// HVA-137: /captain/approvals — captain-pending listing + inline actions
// =============================================================================
//
// Server Component. Replaces the HVA-78 "Coming soon" placeholder.
// Lists every PENDING_CAPTAIN_APPROVAL request in the captain's cities
// (super_admin sees all), most-recently-completed first. Each row
// surfaces the exec's submitted note (from the HVA-68 Mark Installation
// Complete reason) and offers inline Approve / Reject triggers that
// open the same shared modals used by /requests/[id].
//
// We pick the LATEST history row pointing INTO PENDING_CAPTAIN_APPROVAL
// per request (max transition_order) so a request that was rejected and
// re-advanced shows the most recent exec note, not the original one.
// =============================================================================

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string; exec?: string; page?: string }>;
}

export default async function CaptainApprovalsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/captain/approvals");

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === "super_admin";

  const sp = await searchParams;
  const search = (sp.q ?? "").trim();
  const execFilterParam = sp.exec && sp.exec !== "all" ? sp.exec : undefined;
  const page = parsePage(sp.page);

  // Captain's team — drives the exec-filter dropdown AND defence-in-
  // depth: drop an exec id that isn't on the captain's team. Empty
  // for super_admin (sees the full set).
  const teamRows = isAdmin
    ? []
    : await db
        .select({ userId: salesExecutives.userId, fullName: users.fullName })
        .from(salesExecutives)
        .innerJoin(users, eq(users.id, salesExecutives.userId))
        .where(
          and(
            eq(salesExecutives.captainUserId, actor.id),
            eq(users.isActive, true),
          ),
        )
        .orderBy(asc(users.fullName));
  const teamExecSet = new Set(teamRows.map((t) => t.userId));
  const execFilter =
    execFilterParam && (isAdmin || teamExecSet.has(execFilterParam))
      ? execFilterParam
      : undefined;

  // 2026-05-26 team-scope fix: approvals now filter by
  // assigned_captain_user_id = me, not by cities the captain owns.
  const captainScope = isAdmin
    ? undefined
    : buildCaptainRequestVisibilityWhere(actor.id);

  // Resolve the PENDING_CAPTAIN_APPROVAL stage id once so the per-request
  // join can index on it directly.
  const [pendingStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, "PENDING_CAPTAIN_APPROVAL"))
    .limit(1);

  if (!pendingStage) {
    return (
      <div className="p-4 sm:p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Pending Approvals
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Status stages aren&apos;t seeded — admin needs to fix the DB.
        </p>
      </div>
    );
  }

  // Fetch the candidate requests. We join the exec for display + filter
  // out cancelled rows. The "exec's note" + "completed_at" come from a
  // separate per-request lookup below — pulling it via a window function
  // in a single query is possible but the row count for a captain's
  // pending queue is small in practice.
  const execUser = alias(users, "exec_user");
  // PR11 2026-05-26: search (ILIKE on customer name) + exec filter
  // applied at the SQL layer. Pagination happens AFTER the in-memory
  // sort-by-completedAt below because the sort key lives on the per-
  // request history lookup.
  const filterPredicates = and(
    eq(visitRequests.statusStageId, pendingStage.id),
    isNull(visitRequests.cancelledAt),
    captainScope,
    search.length > 0
      ? ilike(visitRequests.customerName, `%${search}%`)
      : undefined,
    execFilter ? eq(visitRequests.assignedExecUserId, execFilter) : undefined,
  );

  const baseRows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedExecName: execUser.fullName,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(execUser, eq(execUser.id, visitRequests.assignedExecUserId))
    .where(filterPredicates);

  // For each candidate, find the LATEST history row pointing INTO
  // PENDING_CAPTAIN_APPROVAL — that carries the exec's note + when they
  // submitted it. transition_order ordering handles re-cycles after a
  // captain Reject.
  const rows = await Promise.all(
    baseRows.map(async (r) => {
      const [latest] = await db
        .select({
          reason: requestStatusHistory.reason,
          changedAt: requestStatusHistory.changedAt,
        })
        .from(requestStatusHistory)
        .where(
          and(
            eq(requestStatusHistory.requestId, r.id),
            eq(requestStatusHistory.toStatusStageId, pendingStage.id),
          ),
        )
        .orderBy(desc(requestStatusHistory.transitionOrder))
        .limit(1);
      return {
        ...r,
        execNote: latest?.reason ?? null,
        completedAt: latest?.changedAt ?? null,
      };
    }),
  );

  // Sort newest-completed first.
  rows.sort((a, b) => {
    const aTime = a.completedAt?.getTime() ?? 0;
    const bTime = b.completedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  // PR11 pagination — in-memory slice after the post-query sort.
  // Acceptable here because the candidate set is bounded by the
  // captain's team + the stage filter (small in practice).
  const totalCount = rows.length;
  const pageRange = computePageRange({ total: totalCount, page });
  const pageRows = rows.slice(
    pageRange.offset,
    pageRange.offset + pageRange.pageSize,
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pending Approvals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount === 0
              ? search.length > 0 || execFilter
                ? "No approvals match the current filter."
                : "No requests pending your approval right now."
              : `${totalCount} request${totalCount === 1 ? "" : "s"} waiting for your decision.`}
          </p>
        </div>
      </header>

      <ApprovalsFiltersBar
        team={teamRows}
        currentExec={execFilter ?? "all"}
        currentSearch={search}
      />

      {totalCount === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <Icon
            name="check_circle"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground mt-3">
            {search.length > 0 || execFilter
              ? "Try clearing the search or picking a different exec."
              : "You're all caught up."}
          </p>
        </div>
      ) : (
        <ApprovalsListClient
          rows={pageRows.map<ApprovalRowDTO>((r) => ({
            id: r.id,
            customerName: r.customerName,
            customerPhone: r.customerPhone,
            cityName: r.cityName,
            assignedExecName: r.assignedExecName,
            execNote: r.execNote,
            completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          }))}
          pageRange={pageRange}
        />
      )}
    </div>
  );
}
