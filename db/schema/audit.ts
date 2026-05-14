import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { userRoleEnum, users } from './auth';

// Columns from HVA-18 verbatim. Toggleable per-event via config (HVA-17 / spec §14);
// re-assignment is logged unconditionally per spec §3.2.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    // Role snapshot at event time so audit survives role changes / user deletion.
    actorRole: userRoleEnum('actor_role'),
    targetEntityType: varchar('target_entity_type', { length: 64 }).notNull(),
    targetEntityId: text('target_entity_id'),
    beforeState: jsonb('before_state').$type<Record<string, unknown>>(),
    afterState: jsonb('after_state').$type<Record<string, unknown>>(),
    reason: text('reason'),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_event_type_idx').on(table.eventType),
    index('audit_log_actor_idx').on(table.actorUserId),
    index('audit_log_target_idx').on(table.targetEntityType, table.targetEntityId),
    index('audit_log_created_idx').on(table.createdAt),
  ],
);
