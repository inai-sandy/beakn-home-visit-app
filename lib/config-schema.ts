// =============================================================================
// CONFIG_SCHEMA — compile-time schema for the `config` table
// =============================================================================
//
// This file is the **source of truth** for every admin-configurable value
// stored in the `config` Postgres table. Adding a new admin setting in
// Phase 1 means:
//
//   1. Add an entry to CONFIG_SCHEMA below with type/category/default/etc.
//   2. Run `pnpm db:seed:config` to insert default rows for any new keys.
//   3. Read it at runtime via `getConfig('your_key')` from `lib/config.ts`;
//      mutate via `setConfig('your_key', value)`. TypeScript narrows the
//      value type per-key via ConfigValueType<K>.
//
// Why a TS map and not a runtime registry: types flow from the schema to
// every call site. `getConfig('day_plan_cutoff_time')` returns `string`,
// `getConfig('red_flag_payment_ratio_threshold')` returns `number`. Adding a
// new key forces every dependent call to typecheck.
//
// Cache behaviour: `getConfig` caches values in-memory with a 60-second TTL
// (see lib/config.ts). `setConfig` invalidates that key's cache entry on
// write. Other process replicas keep stale values until their TTL expires.
// 60 s matches spec §17 (admin changes propagate within ~1 min) and avoids
// every page render hitting Postgres.
//
// What's NOT in here:
// - Admin-editable lookup *lists* (status stages, postpone reasons, outcome
//   options per task type, business types) — those live in their own
//   tables (status_stages, postpone_reasons, outcome_options,
//   business_types) per the HVA-14 schema design. They have FK integrity
//   from downstream tables (tasks.outcome_option_id, etc.) that JSONB
//   inside `config` couldn't provide.
// - Per-city values (Discord webhook URLs, captain routing emails) — those
//   live on the `cities` table per HVA-90 (one row per city, columns).
// - Auth secrets — never in DB; environment-only.
//
// Anything else admin-tweakable belongs here.
// =============================================================================

export type ConfigValueType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export type ConfigCategory =
  | 'organization'
  | 'workflow'
  | 'targets'
  | 'ai'
  | 'notifications'
  | 'audit';

export interface ConfigKeyDef<T = unknown> {
  /** Runtime type discriminant. Used by lib/config.ts to validate DB values. */
  type: ConfigValueType;
  /** Grouping for the admin Settings Hub UI. */
  category: ConfigCategory;
  /** Human-readable description shown in admin UI. */
  description: string;
  /** Returned by getConfig when DB has no row yet, or when the stored row fails validation. */
  defaultValue: T;
  /** True when admin can edit via Settings Hub. False for system-internal values seeded once. */
  editable: boolean;
  /** Optional value-level validation. Enforced by lib/config.ts on read and write. */
  validation?: {
    /** For type='string': RegExp source the value must match. */
    pattern?: string;
    /** For type='number': inclusive minimum. */
    min?: number;
    /** For type='number': inclusive maximum. */
    max?: number;
    /** For type='string': allow-list of literal values. */
    enumValues?: readonly string[];
  };
}

// `as const satisfies …` keeps the literal types of `type` so ConfigValueType<K>
// can map per-key to the correct JS type at the type level.
export const CONFIG_SCHEMA = {
  // -------------------------------------------------------------------------
  // Workflow timing — spec §9.2, §10.1, §10.7
  // -------------------------------------------------------------------------
  day_plan_cutoff_time: {
    type: 'string',
    category: 'workflow',
    description:
      'Time of day (HH:MM, 24h) after which day plans submitted for that day are flagged is_late.',
    defaultValue: '09:30',
    editable: true,
    validation: { pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  },
  day_close_target_time: {
    type: 'string',
    category: 'workflow',
    description:
      'Target time of day (HH:MM, 24h) by which sales execs should close their day. Used in reminders and reports.',
    defaultValue: '18:30',
    editable: true,
    validation: { pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  },
  week_start_day: {
    type: 'string',
    category: 'workflow',
    description:
      'Day the work week starts. Drives weekly aggregations and report cards.',
    defaultValue: 'tuesday',
    editable: true,
    validation: {
      enumValues: [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ] as const,
    },
  },

  // -------------------------------------------------------------------------
  // AI defaults — spec §11
  // -------------------------------------------------------------------------
  ai_provider: {
    type: 'string',
    category: 'ai',
    description:
      'AI provider used for Phase 1 features (report cards, summaries). Switching providers requires API keys in env.',
    defaultValue: 'claude',
    editable: true,
    validation: { enumValues: ['claude', 'openai'] as const },
  },
  ai_tone_default: {
    type: 'string',
    category: 'ai',
    description:
      'Default tone for AI-generated content. One of: "professional", "friendly", "concise".',
    defaultValue: 'professional',
    editable: true,
    validation: { enumValues: ['professional', 'friendly', 'concise'] as const },
  },

  // -------------------------------------------------------------------------
  // Support contacts — spec §9.2
  // -------------------------------------------------------------------------
  customer_support_phone: {
    type: 'string',
    category: 'organization',
    description:
      'Customer-facing support phone number. Shown on the public tracking page and in customer-facing notification templates.',
    defaultValue: '',
    editable: true,
    validation: { pattern: '^[+]?[0-9 ()-]{0,20}$' },
  },
  admin_support_phone: {
    type: 'string',
    category: 'organization',
    description:
      'Internal admin/exec support phone number. Shown in exec-side help screens (Admin Help fallback).',
    defaultValue: '',
    editable: true,
    validation: { pattern: '^[+]?[0-9 ()-]{0,20}$' },
  },

  // -------------------------------------------------------------------------
  // Notification routing — spec §1.4
  // -------------------------------------------------------------------------
  other_orders_webhook: {
    type: 'string',
    category: 'notifications',
    description:
      'Discord webhook URL used to route requests submitted for the "Other" pseudo-city. Per-city webhooks live on cities.discord_webhook_url.',
    defaultValue: '',
    editable: true,
    validation: { pattern: '^(https?://[^\\s]+)?$' },
  },

  // -------------------------------------------------------------------------
  // Audit trail — spec §14, HVA-18
  // -------------------------------------------------------------------------
  audit_enabled_events: {
    type: 'array',
    category: 'audit',
    description:
      'Event types written to audit_log. Admin can toggle inclusion per type. ' +
      'reassignment is ALWAYS logged regardless of this list (spec §3.2 hard rule, enforced in lib/audit.ts).',
    defaultValue: [
      'status_change',
      'assignment',
      'reassignment',
      'captain_approval',
      'completion',
      'cancellation',
      'payment_entry',
      'login',
      'configuration_change',
    ],
    editable: true,
  },

  // -------------------------------------------------------------------------
  // Red-flag thresholds — spec §11 (AI report cards) / §3 (request lifecycle)
  // -------------------------------------------------------------------------
  red_flag_payment_ratio_threshold: {
    type: 'number',
    category: 'targets',
    description:
      'Ratio of payments collected to total_order_value (0..1) below which a request is flagged at order-execute time. 0.25 = 25%.',
    defaultValue: 0.25,
    editable: true,
    validation: { min: 0, max: 1 },
  },
  red_flag_visit_to_close_days_threshold: {
    type: 'number',
    category: 'targets',
    description:
      'Maximum days from visit-completion to order-execute before the request is flagged.',
    defaultValue: 30,
    editable: true,
    validation: { min: 1, max: 365 },
  },
  fast_completion_threshold_ratio: {
    type: 'number',
    category: 'targets',
    description:
      'actual_time / estimated_time ratio below which a task is flagged as suspiciously fast in AI report cards. 0.5 = 50%.',
    defaultValue: 0.5,
    editable: true,
    validation: { min: 0, max: 1 },
  },
} as const satisfies Record<string, ConfigKeyDef>;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

// Map ConfigValueType discriminants → actual TS types. Drives ConfigValueOf<K>.
type ValueTypeMap = {
  string: string;
  number: number;
  boolean: boolean;
  object: Record<string, unknown>;
  array: unknown[];
};

/** TS type of the value stored at a given config key. */
export type ConfigValueOf<K extends ConfigKey> =
  ValueTypeMap[(typeof CONFIG_SCHEMA)[K]['type']];
