import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNull } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import {
  cities,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { getServerSession } from "@/lib/auth-server";
import { buildCaptainRequestVisibilityWhere } from "@/lib/captain/team-scope";
import { maskCustomerPhone } from "@/lib/format/phone";

import { InlineApprovalButtons } from "./inline-approval-buttons";

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

export default async function CaptainApprovalsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/captain/approvals");

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === "super_admin";

  // 2026-05-26 team-scope fix: approvals now filter by
  // assigned_captain_user_id = me, not by cities the captain owns. This
  // prevents captain B from seeing/approving captain A's request just
  // because the assigned exec works in a city B also owns.
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
    .where(
      and(
        eq(visitRequests.statusStageId, pendingStage.id),
        isNull(visitRequests.cancelledAt),
        captainScope,
      ),
    );

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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pending Approvals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length === 0
              ? "No requests pending your approval right now."
              : `${rows.length} request${rows.length === 1 ? "" : "s"} waiting for your decision.`}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <Icon
            name="check_circle"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground mt-3">
            You&apos;re all caught up.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-3xl border bg-card p-5 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold tracking-tight">
                    <a
                      href={`/requests/${r.id}`}
                      className="hover:underline"
                    >
                      {r.customerName}
                    </a>
                  </h2>
                  <p className="text-xs font-mono text-muted-foreground">
                    {maskCustomerPhone(r.customerPhone)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {r.cityName}
                  </Badge>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                <span>
                  Exec:{" "}
                  <span className="text-foreground font-medium">
                    {r.assignedExecName ?? "—"}
                  </span>
                </span>
                {r.completedAt && (
                  <>
                    <span className="mx-2">·</span>
                    <span title={r.completedAt.toISOString()}>
                      Completed {formatDistanceToNow(r.completedAt, { addSuffix: true })}
                    </span>
                  </>
                )}
              </div>

              {r.execNote ? (
                <blockquote className="rounded-2xl border-l-4 border-primary/40 bg-muted/30 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Exec&apos;s note
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{r.execNote}</p>
                </blockquote>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No note submitted by the exec.
                </p>
              )}

              <div className="flex justify-end pt-1">
                <InlineApprovalButtons
                  requestId={r.id}
                  customerName={r.customerName}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
