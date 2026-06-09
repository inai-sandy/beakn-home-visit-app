import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './auth';
import { visitRequests } from './visits';

// =============================================================================
// HVA-254 (HVA-232 Phase 1): customer support tickets
// HVA-256-FIX1: ticket category is now admin-configurable; the
// support_ticket_category enum has been replaced by a table.
// =============================================================================

export const supportTicketCategories = pgTable(
  'support_ticket_categories',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    // Stable identifier — admin can edit `name` but NOT `code` (the
    // refund auto-close logic + any future code-side branches read by
    // code). 'complaint' / 'warranty' / 'refund' / 'other' seeded.
    code: varchar('code', { length: 64 }).notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    displayOrder: integer('display_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('support_ticket_categories_active_order_idx').on(
      table.isActive,
      table.displayOrder,
    ),
  ],
);

export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
  'open',
  'in_progress',
  'resolved',
]);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    // HVA-256-FIX1: was enum; now varchar holding the category code from
    // support_ticket_categories. Soft reference (no FK) so deactivating
    // a category doesn't cascade to historic tickets.
    category: varchar('category', { length: 64 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    description: text('description').notNull(),
    status: supportTicketStatusEnum('status').notNull().default('open'),
    customerNameSnapshot: varchar('customer_name_snapshot', { length: 255 })
      .notNull(),
    customerPhoneSnapshot: varchar('customer_phone_snapshot', { length: 15 })
      .notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedByUserId: uuid('claimed_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    index('support_tickets_request_opened_idx').on(
      table.requestId,
      table.openedAt,
    ),
    index('support_tickets_status_opened_idx').on(table.status, table.openedAt),
    // HVA-259: partial index — matches migration 0071 (WHERE claimed_by
    // IS NOT NULL); the Drizzle definition previously omitted the WHERE,
    // which a future drizzle-kit introspect would flag as drift.
    index('support_tickets_claimed_by_idx')
      .on(table.claimedByUserId)
      .where(sql`${table.claimedByUserId} IS NOT NULL`),
    check(
      'support_tickets_subject_length',
      sql`char_length(${table.subject}) BETWEEN 1 AND 200`,
    ),
    check(
      'support_tickets_description_length',
      sql`char_length(${table.description}) BETWEEN 1 AND 2000`,
    ),
  ],
);
