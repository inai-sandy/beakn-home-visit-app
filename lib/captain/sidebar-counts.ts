// HVA-129 Part 2: badge counts for the captain sidebar nav items.
//
// Three counts surface as numeric badges next to the matching nav item:
//   - Requests       → New-bucket count (Submitted + unassigned in scope)
//   - Pending Approvals → PENDING_CAPTAIN_APPROVAL count
//   - Finance        → count of in-scope requests with outstanding balance
//
// All three use the same team-scope visibility as the underlying list pages
// (buildCaptainRequestVisibilityWhere) so a badge "6" matches what the
// captain sees when they click through. Cancelled requests excluded
// everywhere.

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities as citiesTable,
  payments,
  quotations,
  statusStages,
  visitRequests,
} from '@/db/schema';

import { buildCaptainRequestVisibilityWhere } from './team-scope';

export interface CaptainSidebarCounts {
  newRequestsCount: number;
  pendingApprovalsCount: number;
  outstandingFinanceCount: number;
}

const EMPTY_COUNTS: CaptainSidebarCounts = {
  newRequestsCount: 0,
  pendingApprovalsCount: 0,
  outstandingFinanceCount: 0,
};

export async function loadCaptainSidebarCounts(
  captainUserId: string,
): Promise<CaptainSidebarCounts> {
  // Empty for super_admin viewing the captain shell — they own no cities and
  // are never assigned as a captain to requests, so every count is 0.
  const myCities = await db
    .select({ id: citiesTable.id })
    .from(citiesTable)
    .where(eq(citiesTable.captainUserId, captainUserId));
  const captainCityIds = myCities.map((c) => c.id);
  if (captainCityIds.length === 0) return EMPTY_COUNTS;

  const visibility = buildCaptainRequestVisibilityWhere(captainUserId, {
    captainCityIds,
  });

  const [submittedStage, pendingApprovalStage] = await Promise.all([
    db
      .select({ id: statusStages.id })
      .from(statusStages)
      .where(eq(statusStages.code, 'SUBMITTED'))
      .limit(1),
    db
      .select({ id: statusStages.id })
      .from(statusStages)
      .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
      .limit(1),
  ]);

  const submittedStageId = submittedStage[0]?.id ?? null;
  const pendingApprovalStageId = pendingApprovalStage[0]?.id ?? null;

  const [newRow, pendingRow, outstandingRow] = await Promise.all([
    // New = SUBMITTED + unassigned + not cancelled, within visibility scope.
    submittedStageId
      ? db
          .select({ cnt: sql<number>`COUNT(*)::int` })
          .from(visitRequests)
          .where(
            and(
              visibility,
              isNull(visitRequests.cancelledAt),
              eq(visitRequests.statusStageId, submittedStageId),
              isNull(visitRequests.assignedExecUserId),
            ),
          )
      : Promise.resolve([{ cnt: 0 }]),

    // Pending approvals = PENDING_CAPTAIN_APPROVAL stage, not cancelled.
    pendingApprovalStageId
      ? db
          .select({ cnt: sql<number>`COUNT(*)::int` })
          .from(visitRequests)
          .where(
            and(
              visibility,
              isNull(visitRequests.cancelledAt),
              eq(visitRequests.statusStageId, pendingApprovalStageId),
            ),
          )
      : Promise.resolve([{ cnt: 0 }]),

    // Outstanding = distinct quoted requests where SUM(inbound − outbound on
    // visible payments) < quotation total. Matches the math behind the
    // Finance dashboard's "outstanding" tile (PR12-FIX3) but reduced to a
    // count.
    db
      .select({ cnt: sql<number>`COUNT(DISTINCT ${quotations.visitRequestId})::int` })
      .from(quotations)
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, quotations.visitRequestId),
      )
      .where(
        and(
          visibility,
          isNull(visitRequests.cancelledAt),
          sql`${quotations.totalOrderValuePaise} > COALESCE((
            SELECT
              SUM(CASE WHEN ${payments.direction} = 'inbound' THEN ${payments.amountPaise} ELSE 0 END)
              - SUM(CASE WHEN ${payments.direction} = 'outbound' THEN ${payments.amountPaise} ELSE 0 END)
            FROM ${payments}
            WHERE ${payments.visitRequestId} = ${quotations.visitRequestId}
              AND ${payments.voidedAt} IS NULL
          ), 0)`,
        ),
      ),
  ]);

  return {
    newRequestsCount: newRow[0]?.cnt ?? 0,
    pendingApprovalsCount: pendingRow[0]?.cnt ?? 0,
    outstandingFinanceCount: outstandingRow[0]?.cnt ?? 0,
  };
}
