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
    // HVA-232 Phase 3 (migration 0082): "open workload" count for the
    // exec/captain/admin Tickets nav badge — status IN (open,in_progress).
    index('support_tickets_status_idx').on(table.status),
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

// =============================================================================
// HVA-232 Phase 3 (migration 0082): two-way support ticket message thread
// =============================================================================
//
// The original tickets model was one-way: a customer raised a ticket and
// staff could only claim + resolve it — no reply, no thread, no customer
// notification. This table adds an append-only message thread so staff can
// reply and the customer can respond, all visible on /track.
//
// author_kind distinguishes the two writer classes:
//   - 'staff'    → author_user_id set (exec / captain / super_admin).
//   - 'customer' → author_user_id NULL (the tracking-token holder; there
//                  is no user row for a customer).
//
// The ticket's own `description` is the opening customer message and is
// NOT duplicated here; the UI renders it as the first bubble, then this
// thread in created_at order.
// =============================================================================

export const supportTicketAuthorKindEnum = pgEnum(
  'support_ticket_author_kind',
  ['staff', 'customer'],
);

export const supportTicketMessages = pgTable(
  'support_ticket_messages',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorKind: supportTicketAuthorKindEnum('author_kind').notNull(),
    // NULL for customer authors (no user row). RESTRICT so a staff author's
    // history survives — you can't delete a user who has replied on a ticket.
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "All messages for this ticket, oldest first" — thread render on both
    // the staff queue and the customer /track page.
    index('support_ticket_messages_ticket_created_idx').on(
      table.ticketId,
      table.createdAt,
    ),
    check(
      'support_ticket_messages_body_length',
      sql`char_length(${table.body}) BETWEEN 1 AND 2000`,
    ),
    // A staff message MUST carry an author; a customer message MUST NOT.
    check(
      'support_ticket_messages_author_kind_consistency',
      sql`(${table.authorKind} = 'staff' AND ${table.authorUserId} IS NOT NULL)
        OR (${table.authorKind} = 'customer' AND ${table.authorUserId} IS NULL)`,
    ),
  ],
);
