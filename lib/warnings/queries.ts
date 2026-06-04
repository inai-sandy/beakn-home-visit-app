import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  salesExecutives,
  userRoleEnum,
  users,
  warnings,
} from '@/db/schema';

import { HARD_WARNING_FIRE_THRESHOLD } from './metrics';

// =============================================================================
// HVA-228: warning read queries
// =============================================================================
//
// Active counts use `WHERE revoked_at IS NULL` so revoked warnings
// don't push an exec past the fire threshold. History returns all
// rows (active + revoked) with the issuer + revoker resolved to
// display names. Polymorphic — caller passes execUserId.
// =============================================================================

export interface ActiveWarningCounts {
  softActive: number;
  hardActive: number;
  hardThreshold: number;
  /** True iff hardActive >= HARD_WARNING_FIRE_THRESHOLD. */
  fireFlag: boolean;
}

export async function loadActiveWarningCounts(
  execUserId: string,
): Promise<ActiveWarningCounts> {
  const rows = await db
    .select({
      kind: warnings.kind,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(warnings)
    .where(and(eq(warnings.execUserId, execUserId), isNull(warnings.revokedAt)))
    .groupBy(warnings.kind);

  const softActive = rows.find((r) => r.kind === 'soft')?.cnt ?? 0;
  const hardActive = rows.find((r) => r.kind === 'hard')?.cnt ?? 0;
  return {
    softActive,
    hardActive,
    hardThreshold: HARD_WARNING_FIRE_THRESHOLD,
    fireFlag: hardActive >= HARD_WARNING_FIRE_THRESHOLD,
  };
}

export interface WarningHistoryRow {
  id: string;
  kind: 'soft' | 'hard';
  metricCode: string;
  periodLabel: string;
  currentValue: number;
  targetValue: number;
  reason: string;
  messageSnapshot: string;
  issuedByName: string;
  issuedAt: Date;
  revokedAt: Date | null;
  revokedByName: string | null;
  revokedReason: string | null;
}

export async function loadWarningHistory(
  execUserId: string,
  limit = 50,
): Promise<WarningHistoryRow[]> {
  const issuedBy = users;
  const rows = await db
    .select({
      id: warnings.id,
      kind: warnings.kind,
      metricCode: warnings.metricCode,
      periodLabel: warnings.periodLabel,
      currentValue: warnings.currentValue,
      targetValue: warnings.targetValue,
      reason: warnings.reason,
      messageSnapshot: warnings.messageSnapshot,
      issuedAt: warnings.createdAt,
      issuedByName: issuedBy.fullName,
      revokedAt: warnings.revokedAt,
      revokedByUserId: warnings.revokedByUserId,
      revokedReason: warnings.revokedReason,
    })
    .from(warnings)
    .innerJoin(issuedBy, eq(issuedBy.id, warnings.issuedByUserId))
    .where(eq(warnings.execUserId, execUserId))
    .orderBy(desc(warnings.createdAt))
    .limit(limit);

  // Resolve revokedBy names in a single follow-up query (only for rows
  // that have a revoker — keeps the main query simple, avoids a self-
  // join with an alias).
  const revokerIds = Array.from(
    new Set(
      rows
        .map((r) => r.revokedByUserId)
        .filter((x): x is string => x != null),
    ),
  );
  let revokerNameById = new Map<string, string>();
  if (revokerIds.length > 0) {
    const revRows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, revokerIds));
    revokerNameById = new Map(revRows.map((r) => [r.id, r.name ?? '—']));
  }

  return rows.map<WarningHistoryRow>((r) => ({
    id: r.id,
    kind: r.kind as 'soft' | 'hard',
    metricCode: r.metricCode,
    periodLabel: r.periodLabel,
    currentValue: Number(r.currentValue),
    targetValue: Number(r.targetValue),
    reason: r.reason,
    messageSnapshot: r.messageSnapshot,
    issuedByName: r.issuedByName ?? '—',
    issuedAt: r.issuedAt,
    revokedAt: r.revokedAt,
    revokedByName: r.revokedByUserId
      ? revokerNameById.get(r.revokedByUserId) ?? '—'
      : null,
    revokedReason: r.revokedReason,
  }));
}

// =============================================================================
// loadAdminExecWarningRoster — full exec list with warning counts
// =============================================================================
//
// One row per active sales_executive plus their captain (display name)
// and city. Joined with active warning counts via a single GROUP BY.
// Used by /admin/targets to render the WarningButtons table beneath
// the arena.
// =============================================================================

export interface AdminExecRosterEntry {
  execUserId: string;
  execName: string;
  captainUserId: string | null;
  captainName: string | null;
  cityNames: string[];
  softActive: number;
  hardActive: number;
}

export async function loadAdminExecWarningRoster(): Promise<
  AdminExecRosterEntry[]
> {
  // 1. All active sales_executives with their captain id + city id.
  const execRows = await db
    .select({
      execId: users.id,
      execName: users.fullName,
      captainId: salesExecutives.captainUserId,
      cityId: salesExecutives.cityId,
    })
    .from(users)
    .innerJoin(salesExecutives, eq(salesExecutives.userId, users.id))
    .where(and(eq(users.role, 'sales_executive'), eq(users.isActive, true)))
    .orderBy(asc(users.fullName));

  if (execRows.length === 0) return [];

  const execIds = execRows.map((r) => r.execId);
  const captainIds = Array.from(
    new Set(execRows.map((r) => r.captainId).filter((x): x is string => !!x)),
  );
  const cityIds = Array.from(
    new Set(execRows.map((r) => r.cityId).filter((x): x is string => !!x)),
  );

  // 2. Captain display names.
  let captainNameById = new Map<string, string>();
  if (captainIds.length > 0) {
    const captainRows = await db
      .select({ id: users.id, name: users.fullName })
      .from(users)
      .where(inArray(users.id, captainIds));
    captainNameById = new Map(captainRows.map((c) => [c.id, c.name ?? '—']));
  }

  // 3. City names.
  let cityNameById = new Map<string, string>();
  if (cityIds.length > 0) {
    const cityRows = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(inArray(cities.id, cityIds));
    cityNameById = new Map(cityRows.map((c) => [c.id, c.name]));
  }

  // 4. Active warning counts per exec by kind.
  const countRows = await db
    .select({
      execId: warnings.execUserId,
      kind: warnings.kind,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(warnings)
    .where(and(inArray(warnings.execUserId, execIds), isNull(warnings.revokedAt)))
    .groupBy(warnings.execUserId, warnings.kind);

  const softByExec = new Map<string, number>();
  const hardByExec = new Map<string, number>();
  for (const r of countRows) {
    if (r.kind === 'soft') softByExec.set(r.execId, r.cnt ?? 0);
    else if (r.kind === 'hard') hardByExec.set(r.execId, r.cnt ?? 0);
  }

  return execRows.map<AdminExecRosterEntry>((r) => ({
    execUserId: r.execId,
    execName: r.execName ?? '—',
    captainUserId: r.captainId,
    captainName: r.captainId
      ? captainNameById.get(r.captainId) ?? '—'
      : null,
    cityNames: r.cityId
      ? [cityNameById.get(r.cityId) ?? '—']
      : [],
    softActive: softByExec.get(r.execId) ?? 0,
    hardActive: hardByExec.get(r.execId) ?? 0,
  }));
}
