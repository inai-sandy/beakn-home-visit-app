import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { timestamps } from './_helpers';

// =============================================================================
// HVA-228: warnings — soft + hard performance warnings issued by admin
// =============================================================================
//
// Warnings are admin-issued performance notices to a sales exec.
//
//   kind = 'soft' | 'hard'
//     - soft: motivational nudge; in-app + push
//     - hard: strict notice; in-app + push + WhatsApp (when Meta-approved)
//
// 5 active hard warnings flags the exec as eligible for termination
// (manual fire by admin via a separate Deactivate button).
//
// Revoke: admin-only (no delete; revoked_at + revoked_by are filled).
// Counts are computed `WHERE revoked_at IS NULL`.
//
// `message_snapshot` stores the exact text that was rendered at issue
// time so the audit + history rows survive future template edits.
//
// Per-issuance metric snapshot (`metric_code`, `period_label`,
// `current_value` / `target_value`) supports future reporting on which
// metric/period triggered the warning. Values are stored as `bigint`
// in paise (revenue) or as plain integers (counts); the rendering
// layer formats per metric.
// =============================================================================

export const warnings = pgTable(
  'warnings',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 8 }).notNull(),
    metricCode: varchar('metric_code', { length: 32 }).notNull(),
    periodLabel: varchar('period_label', { length: 64 }).notNull(),
    currentValue: bigint('current_value', { mode: 'number' }).notNull(),
    targetValue: bigint('target_value', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    messageSnapshot: text('message_snapshot').notNull(),
    issuedByUserId: uuid('issued_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    revokedReason: text('revoked_reason'),
    ...timestamps(),
  },
  (t) => ({
    activeByExecIdx: index('warnings_exec_revoked_idx').on(
      t.execUserId,
      t.revokedAt,
    ),
    kindIdx: index('warnings_kind_idx').on(t.kind),
    createdAtIdx: index('warnings_created_at_idx').on(t.createdAt),
  }),
);
