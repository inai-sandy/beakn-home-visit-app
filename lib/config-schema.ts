// Compile-time schema for the `config` table. Replaces the (removed) `value_type`
// column on `config`: instead of storing a runtime string tag alongside each JSONB
// value, we key TypeScript types off the config key here. The map is the source
// of truth for the admin UI (HVA-17), the runtime loader, and the seed file.

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export type ConfigCategory =
  | 'organization'
  | 'workflow'
  | 'targets'
  | 'ai'
  | 'notifications'
  | 'audit';

export interface ConfigKeyDef<T = unknown> {
  type: ConfigValueType;
  category: ConfigCategory;
  description: string;
  defaultValue: T;
}

// HVA-17 will populate this with the full key set from spec §9.2. Each entry's
// `type` is the runtime tag previously stored on `config.value_type` (now removed);
// `defaultValue` + `category` drive the admin UI groupings and seed data.
//
// Example shape:
//
//   'day_plan_cutoff_time': {
//     type: 'string',
//     category: 'workflow',
//     description: 'Time of day (HH:mm) after which day plans are flagged late',
//     defaultValue: '09:30',
//   },
//
export const CONFIG_SCHEMA = {} as const satisfies Record<string, ConfigKeyDef>;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;
