import { and, count, desc, eq, ilike, inArray, or, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';
import {
  cities,
  supportTickets,
  users,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-255 (HVA-232 Phase 2): /tickets queue queries
// =============================================================================
//
// Scope rules:
//   - sales_executive: only tickets on requests where assigned_exec = me
//   - captain:         only tickets on requests whose city's captain = me
//   - super_admin:     all tickets
// =============================================================================

export type TicketStatusFilter = 'open' | 'in_progress' | 'resolved' | 'all';
export type TicketCategoryFilter =
  | 'complaint'
  | 'warranty'
  | 'refund'
  | 'other'
  | 'all';

export interface QueueOptions {
  callerRole: 'sales_executive' | 'captain' | 'super_admin';
  callerUserId: string;
  status?: TicketStatusFilter;
  category?: TicketCategoryFilter;
  mineOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface QueueRow {
  ticketId: string;
  subject: string;
  category: 'complaint' | 'warranty' | 'refund' | 'other';
  status: 'open' | 'in_progress' | 'resolved';
  openedAt: Date;
  resolvedAt: Date | null;
  reopenedAt: Date | null;
  customerName: string;
  customerPhone: string;
  cityName: string;
  claimedByName: string | null;
  resolvedByName: string | null;
  requestId: string;
}

export interface QueueResult {
  rows: QueueRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function loadTicketsQueue(
  opts: QueueOptions,
): Promise<QueueResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, opts.pageSize ?? 25);
  const claimedAlias = alias(users, 'claimed_by_user');
  const resolvedAlias = alias(users, 'resolved_by_user');

  const conditions: SQL[] = [];

  // Scope by role
  if (opts.callerRole === 'sales_executive') {
    conditions.push(eq(visitRequests.assignedExecUserId, opts.callerUserId));
  } else if (opts.callerRole === 'captain') {
    conditions.push(eq(cities.captainUserId, opts.callerUserId));
  }
  // super_admin sees everything (no scope condition)

  if (opts.status && opts.status !== 'all') {
    conditions.push(eq(supportTickets.status, opts.status));
  }
  if (opts.category && opts.category !== 'all') {
    conditions.push(eq(supportTickets.category, opts.category));
  }
  if (opts.mineOnly) {
    conditions.push(eq(supportTickets.claimedByUserId, opts.callerUserId));
  }
  if (opts.search && opts.search.trim().length > 0) {
    const pattern = `%${opts.search.trim()}%`;
    const orClause = or(
      ilike(visitRequests.customerName, pattern),
      ilike(visitRequests.customerPhone, pattern),
      ilike(supportTickets.subject, pattern),
    );
    if (orClause) conditions.push(orClause);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(whereClause);
  const totalCount = countRow?.n ?? 0;

  // Rows
  const rows = await db
    .select({
      ticketId: supportTickets.id,
      subject: supportTickets.subject,
      category: supportTickets.category,
      status: supportTickets.status,
      openedAt: supportTickets.openedAt,
      resolvedAt: supportTickets.resolvedAt,
      reopenedAt: supportTickets.reopenedAt,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      claimedByName: claimedAlias.fullName,
      resolvedByName: resolvedAlias.fullName,
      requestId: visitRequests.id,
    })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(claimedAlias, eq(claimedAlias.id, supportTickets.claimedByUserId))
    .leftJoin(resolvedAlias, eq(resolvedAlias.id, supportTickets.resolvedByUserId))
    .where(whereClause)
    .orderBy(desc(supportTickets.openedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows,
    totalCount,
    page,
    pageSize,
  };
}

// Reference imports the linter would otherwise drop
void inArray;
void count;
