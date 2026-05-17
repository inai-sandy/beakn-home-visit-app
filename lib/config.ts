import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { config as configTable } from '@/db/schema';
import { type Role } from '@/lib/auth/roles';

import { logEvent } from './audit';
import {
  CONFIG_SCHEMA,
  type ConfigKey,
  type ConfigKeyDef,
  type ConfigValueOf,
  type ConfigValueType,
} from './config-schema';
import { log } from './logger';

const configLogger = log.child({ component: 'config' });

// =============================================================================
// HVA-112: in-memory cache removed
// =============================================================================
//
// Prior to HVA-112 this module carried an in-process `Map` cache with a
// 60-second TTL. Phase 1 diagnostic established that:
//   * the prod container runs a single Next.js worker, so the
//     cross-process invalidation framing in the original ship was moot;
//   * the entire production read frequency was ~1 read/hour on /track
//     plus rare admin/login reads — the cache earned no measurable
//     performance benefit;
//   * the only invalidation-on-write call (`clearConfigCache` from the
//     HVA-105 PATCH route) was working but still left the door open to
//     the same class of staleness bugs whenever new write sites landed.
//
// Path D from the HVA-112 Linear body: remove the cache. Every
// `getConfig` call now hits Postgres. If a future surface (e.g. HVA-89
// Settings Hub) reads many keys per render and read volume spikes, the
// upgrade path is to wrap `getConfig` in React's `cache()` for
// per-render dedup — see docs/config.md.
// =============================================================================

// =============================================================================
// Public API
// =============================================================================

/**
 * Read a config value by key. Returns the typed value (per ConfigValueOf<K>).
 *
 * Always hits the DB. No in-memory cache.
 */
export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigValueOf<K>> {
  const def = CONFIG_SCHEMA[key];
  const rows = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .limit(1);

  if (rows.length === 0) {
    return def.defaultValue as ConfigValueOf<K>;
  }
  const raw = rows[0].value;
  if (validateValue(raw, def)) {
    return raw as ConfigValueOf<K>;
  }
  configLogger.warn(
    { key, stored: raw },
    'getConfig_value_failed_validation_using_default',
  );
  return def.defaultValue as ConfigValueOf<K>;
}

/**
 * Optional caller-supplied audit context. HVA-112 (bundled fix for the
 * HVA-25 TODO this file used to carry): admin write surfaces can now
 * pass a session-derived actor so the audit row attributes the
 * configuration_change correctly. Internal callers (seed scripts,
 * system events) leave it undefined; the audit row records actor null
 * exactly as before.
 */
export interface ConfigChangeActor {
  userId: string;
  role: Role;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Write a config value. Throws if the value fails CONFIG_SCHEMA validation.
 *
 * Audit row is written via `logEvent({ eventType: 'configuration_change' })`.
 * If `actor` is supplied, the audit row carries that user/role/ip/UA; if
 * not, the row is written with `actorUserId = null` and `actorRole = null`
 * (matches the pre-HVA-112 internal-caller behaviour).
 */
export async function setConfig<K extends ConfigKey>(
  key: K,
  value: ConfigValueOf<K>,
  actor?: ConfigChangeActor,
): Promise<void> {
  const def: ConfigKeyDef = CONFIG_SCHEMA[key];
  if (!validateValue(value, def)) {
    throw new Error(
      `[config] setConfig("${key}", …) rejected: value does not satisfy type=${def.type}` +
        (def.validation ? ` + validation=${JSON.stringify(def.validation)}` : ''),
    );
  }

  // Capture the prior on-disk value for the audit before_state. Not
  // atomic with the UPSERT below; concurrent setConfig calls on the
  // same key may produce overlapping audit windows — acceptable for
  // rare admin writes.
  const beforeRows = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .limit(1);
  const beforeValue = beforeRows[0]?.value;

  await db
    .insert(configTable)
    .values({
      key,
      category: def.category,
      // JSONB column — Drizzle serialises arbitrary serialisable values.
      value: value as unknown,
      description: def.description,
    })
    .onConflictDoUpdate({
      target: configTable.key,
      set: {
        value: value as unknown,
        category: def.category,
        description: def.description,
        updatedAt: new Date(),
      },
    });

  // Audit the config change. logEvent is fire-and-await; failures inside
  // it are swallowed (the audit service must never break the calling
  // action).
  await logEvent({
    eventType: 'configuration_change',
    actorUserId: actor?.userId ?? null,
    actorRole: actor?.role ?? null,
    targetEntityType: 'config_key',
    targetEntityId: key,
    beforeState: beforeValue === undefined ? null : { value: beforeValue },
    afterState: { value: value as unknown },
    ipAddress: actor?.ipAddress ?? null,
    userAgent: actor?.userAgent ?? null,
  });
}

/**
 * Snapshot of every CONFIG_SCHEMA key → current value. One DB round-trip.
 *
 * Used by the admin Settings Hub UI to render the full form. Keys missing
 * from the DB are returned as their CONFIG_SCHEMA default (consistent with
 * getConfig's behaviour).
 */
export async function getAllConfig(): Promise<Record<ConfigKey, unknown>> {
  const rows = await db
    .select({ key: configTable.key, value: configTable.value })
    .from(configTable);

  const byKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
  const result = {} as Record<ConfigKey, unknown>;

  for (const key of Object.keys(CONFIG_SCHEMA) as ConfigKey[]) {
    const def = CONFIG_SCHEMA[key];
    const raw = byKey.get(key);
    if (raw === undefined) {
      result[key] = def.defaultValue;
      continue;
    }
    if (validateValue(raw, def)) {
      result[key] = raw;
      continue;
    }
    configLogger.warn(
      { key, stored: raw },
      'getAllConfig_value_failed_validation_using_default',
    );
    result[key] = def.defaultValue;
  }

  return result;
}

// =============================================================================
// Internal validation
// =============================================================================

function matchesType(value: unknown, type: ConfigValueType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
  }
}

function validateValue(value: unknown, def: ConfigKeyDef): boolean {
  if (!matchesType(value, def.type)) return false;
  const v = def.validation;
  if (!v) return true;
  if (def.type === 'string') {
    const s = value as string;
    if (v.pattern && !new RegExp(v.pattern).test(s)) return false;
    if (v.enumValues && !v.enumValues.includes(s)) return false;
  }
  if (def.type === 'number') {
    const n = value as number;
    if (v.min !== undefined && n < v.min) return false;
    if (v.max !== undefined && n > v.max) return false;
  }
  return true;
}
