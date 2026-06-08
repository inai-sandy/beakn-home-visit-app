import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  users,
  webhookEvents,
  webhookSecrets,
} from '@/db/schema';

// =============================================================================
// HVA-248 (HVA-230): CartPlus integration admin queries
// =============================================================================
//
// Read-side helpers for /admin/integrations/cartplus/*. Mutations live in
// the per-page actions.ts files. All callers must enforce super_admin
// access — this module does not gate; it just reads.
//
// "Last activity" timestamps come from webhook_events filtered by store_id
// (cities) or by created_by.id parsed from the payload (execs) — cheap
// scalar subqueries; if the volume grows large we can switch to a
// materialized view.
// =============================================================================

const PROVIDER_CARTPLUS = 'cartplus';

// -----------------------------------------------------------------------------
// Secrets
// -----------------------------------------------------------------------------

export interface CartplusSecretListRow {
  id: string;
  preview: string;
  createdByName: string | null;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  isActive: boolean;
}

export async function loadCartplusSecrets(): Promise<CartplusSecretListRow[]> {
  const rows = await db
    .select({
      id: webhookSecrets.id,
      preview: webhookSecrets.secretPreview,
      createdByName: users.fullName,
      createdAt: webhookSecrets.createdAt,
      revokedAt: webhookSecrets.revokedAt,
      lastUsedAt: webhookSecrets.lastUsedAt,
    })
    .from(webhookSecrets)
    .leftJoin(users, eq(users.id, webhookSecrets.createdByUserId))
    .where(eq(webhookSecrets.provider, PROVIDER_CARTPLUS))
    .orderBy(desc(webhookSecrets.createdAt));

  return rows.map((r) => ({
    ...r,
    isActive: r.revokedAt === null,
  }));
}

/**
 * Single active secret for a provider, if any. The webhook handler calls
 * this to verify HMAC signatures. Auto-revoke older active rows when a new
 * one is generated (see actions.ts) so this only ever returns 0 or 1 row.
 */
export async function getActiveCartplusSecret(): Promise<
  { id: string; secret: string } | null
> {
  const [row] = await db
    .select({ id: webhookSecrets.id, secret: webhookSecrets.secret })
    .from(webhookSecrets)
    .where(
      and(
        eq(webhookSecrets.provider, PROVIDER_CARTPLUS),
        isNull(webhookSecrets.revokedAt),
      ),
    )
    .orderBy(desc(webhookSecrets.createdAt))
    .limit(1);
  return row ?? null;
}

// -----------------------------------------------------------------------------
// Cities ↔ store_id mapping
// -----------------------------------------------------------------------------

export interface CartplusCityRow {
  cityId: string;
  cityName: string;
  state: string | null;
  cartplusStoreId: number | null;
  lastWebhookAt: Date | null;
}

export async function loadCartplusCities(): Promise<CartplusCityRow[]> {
  const lastActivityExpr = sql<Date | null>`(
    SELECT MAX(${webhookEvents.receivedAt})
    FROM ${webhookEvents}
    WHERE ${webhookEvents.provider} = ${PROVIDER_CARTPLUS}
      AND ${webhookEvents.payload} -> 'store' ->> 'id' = ${cities.cartplusStoreId}::text
  )`;

  const rows = await db
    .select({
      cityId: cities.id,
      cityName: cities.name,
      state: cities.state,
      cartplusStoreId: cities.cartplusStoreId,
      lastWebhookAt: lastActivityExpr,
    })
    .from(cities)
    .orderBy(asc(cities.name));

  return rows.map((r) => ({
    cityId: r.cityId,
    cityName: r.cityName,
    state: r.state,
    cartplusStoreId: r.cartplusStoreId ?? null,
    lastWebhookAt: r.lastWebhookAt ? new Date(r.lastWebhookAt) : null,
  }));
}

// -----------------------------------------------------------------------------
// Users ↔ portal_exec_id mapping
// -----------------------------------------------------------------------------

export interface CartplusExecRow {
  userId: string;
  fullName: string;
  phone: string;
  role: string;
  isActive: boolean;
  portalExecId: number | null;
  lastWebhookAt: Date | null;
}

/**
 * Lists active sales_executive + captain users. Super admins don't sell so
 * we exclude them; support team isn't an exec on the portal so we exclude
 * those too.
 */
export async function loadCartplusExecs(): Promise<CartplusExecRow[]> {
  const lastActivityExpr = sql<Date | null>`(
    SELECT MAX(${webhookEvents.receivedAt})
    FROM ${webhookEvents}
    WHERE ${webhookEvents.provider} = ${PROVIDER_CARTPLUS}
      AND ${webhookEvents.payload} -> 'data' -> 'order' -> 'created_by' ->> 'id' = ${users.portalExecId}::text
  )`;

  const rows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      portalExecId: users.portalExecId,
      lastWebhookAt: lastActivityExpr,
    })
    .from(users)
    .where(
      sql`${users.role} IN ('sales_executive', 'captain') AND ${users.isActive} = TRUE`,
    )
    .orderBy(asc(users.fullName));

  return rows.map((r) => ({
    ...r,
    portalExecId: r.portalExecId ?? null,
    lastWebhookAt: r.lastWebhookAt ? new Date(r.lastWebhookAt) : null,
  }));
}

// -----------------------------------------------------------------------------
// Reverse lookups — used by the webhook handler in HVA-249 / HVA-250
// -----------------------------------------------------------------------------

export async function findCityByStoreId(
  storeId: number,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.cartplusStoreId, storeId))
    .limit(1);
  return row ?? null;
}

export async function findUserByPortalExecId(
  portalExecId: number,
): Promise<{ id: string; fullName: string; role: string } | null> {
  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.portalExecId, portalExecId),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}
