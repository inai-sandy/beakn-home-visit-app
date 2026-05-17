import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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

import { AssignRequestRow } from "./assign-request-row";

// =============================================================================
// HVA-81: /captain/requests/unassigned — captain's pending-assign queue
// =============================================================================
//
// Lists Submitted visit_requests in the captain's cities that have no
// assigned_exec_user_id. Each row carries the customer payload + an
// "Assign" button that opens a modal (AssignRequestRow client component)
// with a dropdown of the captain's own execs.
//
// AUTHZ:
//   - The (captain) layout already gates this route at the role layer
//     (captain | super_admin).
//   - super_admin gets ALL unassigned Submitted requests across all
//     cities (no captain filter applies). Useful for support but rare;
//     captains usually pre-flight assignment from their own dashboard.
//
// EMPTY STATE:
//   - "No unassigned requests in your cities." rendered when the SELECT
//     returns zero rows.
//
// FUTURE:
//   - HVA-80 surfaces a "Pending Assignments" card on the captain
//     dashboard that links here.
//   - HVA-79 wires the bell badge count to this same query.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function CaptainUnassignedRequestsPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/captain/requests/unassigned");

  const actor = session.user as { id: string; role?: string };
  const isAdmin = actor.role === "super_admin";

  // Submitted stage id — required to filter. Seeded by HVA-33's 0004
  // migration. If absent, this page renders empty rather than erroring.
  const [submittedStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, "SUBMITTED"))
    .limit(1);

  if (!submittedStage) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Unassigned Requests
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Status stages aren&apos;t seeded — admin needs to fix the DB.
        </p>
      </div>
    );
  }

  // Captain's owned cities + execs on captain's team. For super_admin,
  // skip the city filter entirely (load all unassigned + all execs).
  // HVA-127: lookup centralised in lib/captain/cities.ts so the new
  // /captain/requests page reuses the same authority.
  const myCities = isAdmin ? [] : await loadCaptainCities(actor.id);
  const myCityIds = myCities.map((c) => c.id);

  // Execs on the captain's team. super_admin gets all sales executives.
  const teamExecsRows = isAdmin
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
        .orderBy(asc(users.fullName));

  // If a non-admin captain owns no cities (data anomaly — admin should
  // assign them at least one), short-circuit to the empty state instead
  // of querying all of visit_requests.
  if (!isAdmin && myCityIds.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Unassigned Requests
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          You don&apos;t have any cities assigned yet. Ask an admin to set
          this up.
        </p>
      </div>
    );
  }

  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      address: visitRequests.address,
      bhk: visitRequests.bhk,
      interest: visitRequests.interest,
      createdAt: visitRequests.createdAt,
      cityId: visitRequests.cityId,
      cityName: cities.name,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(
      // HVA-142: exclude cancelled rows defensively. Cancellation doesn't
      // change status_stage_id per HVA-69 design, so without this filter
      // a cancelled-then-untouched Submitted+unassigned row could appear
      // here and offer an Assign action against a closed request.
      isAdmin
        ? and(
            eq(visitRequests.statusStageId, submittedStage.id),
            isNull(visitRequests.assignedExecUserId),
            isNull(visitRequests.cancelledAt),
          )
        : and(
            eq(visitRequests.statusStageId, submittedStage.id),
            isNull(visitRequests.assignedExecUserId),
            isNull(visitRequests.cancelledAt),
            inArray(visitRequests.cityId, myCityIds),
          ),
    )
    .orderBy(asc(visitRequests.createdAt));

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <header className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">
          Unassigned Requests
        </h1>
        <span className="text-sm text-muted-foreground">
          {rows.length} pending
        </span>
        {!isAdmin && myCities.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-1.5">
            {myCities.map((c) => (
              <Badge key={c.id} variant="secondary" className="text-xs">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No unassigned requests in your cities.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <AssignRequestRow
              key={r.id}
              request={{
                id: r.id,
                customerName: r.customerName,
                customerPhone: r.customerPhone,
                address: r.address,
                bhk: r.bhk,
                interest: r.interest,
                createdAt: r.createdAt.toISOString(),
                cityName: r.cityName,
              }}
              execs={teamExecsRows.map((e) => ({
                id: e.id,
                fullName: e.fullName,
              }))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
