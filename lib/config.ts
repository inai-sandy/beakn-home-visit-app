import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { config as configTable } from '@/db/schema';

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

// 60-second TTL per spec §17 (admin changes propagate within ~1 min) — same
// number documented in config-schema.ts header. Keep them in sync.
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<ConfigKey, CacheEntry>();

// =============================================================================
// Public API
// =============================================================================

/**
 * Read a config value by key. Returns the typed value (per ConfigValueOf<K>).
 *
 * Behaviour:
 * - Cache hit (within 60 s): returns cached value, no DB hit.
 * - Cache miss + DB row exists + value passes validation: caches and returns the DB value.
 * - Cache miss + DB row exists + value fails validation: logs a warning, returns the default
 *   from CONFIG_SCHEMA (the app keeps working with sane data).
 * - Cache miss + no DB row: returns the default from CONFIG_SCHEMA, caches it so the
 *   next call doesn't re-query. Run `pnpm db:seed:config` to persist defaults.
 */
export async function getConfig<K extends ConfigKey>(key: K): Promise<ConfigValueOf<K>> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as ConfigValueOf<K>;
  }

  const def = CONFIG_SCHEMA[key];
  const rows = await db
    .select({ value: configTable.value })
    .from(configTable)
    .where(eq(configTable.key, key))
    .limit(1);

  let value: unknown;
  if (rows.length === 0) {
    value = def.defaultValue;
  } else {
    const raw = rows[0].value;
    if (validateValue(raw, def)) {
      value = raw;
    } else {
      configLogger.warn(
        { key, stored: raw },
        'getConfig_value_failed_validation_using_default',
      );
      value = def.defaultValue;
    }
  }

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value as ConfigValueOf<K>;
}

/**
 * Write a config value. Throws if the value fails CONFIG_SCHEMA validation.
 * Invalidates this key's cache entry on success.
 *
 * Other replicas of the app keep their cached value until their own 60 s TTL
 * expires. This is fine: admin config changes are rare and not safety-critical.
 */
export async function setConfig<K extends ConfigKey>(
  key: K,
  value: ConfigValueOf<K>,
): Promise<void> {
  const def: ConfigKeyDef = CONFIG_SCHEMA[key];
  if (!validateValue(value, def)) {
    throw new Error(
      `[config] setConfig("${key}", …) rejected: value does not satisfy type=${def.type}` +
        (def.validation ? ` + validation=${JSON.stringify(def.validation)}` : ''),
    );
  }

  // Capture the prior on-disk value for the audit before_state. Not atomic
  // with the UPSERT below; concurrent setConfig calls on the same key may
  // produce overlapping audit windows — acceptable for rare admin writes.
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

  cache.delete(key);

  // Audit the config change. logEvent is fire-and-await; failures inside it
  // are swallowed (the audit service must never break the calling action).
  // TODO(HVA-25): once auth middleware injects request context, thread the
  // actor user id / role / ip / user-agent through to here instead of null.
  await logEvent({
    eventType: 'configuration_change',
    actorUserId: null,
    targetEntityType: 'config_key',
    targetEntityId: key,
    beforeState: beforeValue === undefined ? null : { value: beforeValue },
    afterState: { value: value as unknown },
  });
}

/**
 * Snapshot of every CONFIG_SCHEMA key → current value. One DB round-trip;
 * warms the per-key cache as a side effect.
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
  const now = Date.now();
  const result = {} as Record<ConfigKey, unknown>;

  for (const key of Object.keys(CONFIG_SCHEMA) as ConfigKey[]) {
    const def = CONFIG_SCHEMA[key];
    const raw = byKey.get(key);
    let value: unknown;
    if (raw === undefined) {
      value = def.defaultValue;
    } else if (validateValue(raw, def)) {
      value = raw;
    } else {
      configLogger.warn(
        { key, stored: raw },
        'getAllConfig_value_failed_validation_using_default',
      );
      value = def.defaultValue;
    }
    result[key] = value;
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  }

  return result;
}

/** Drop the entire in-memory cache. Mainly for tests + the seed script. */
export function clearConfigCache(): void {
  cache.clear();
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
