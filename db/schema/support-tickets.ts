import { sql } from 'drizzle-orm';
import {
  check,
  index,
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
// =============================================================================
//
// Customer raises via the public form on /track/[token]. Anchored to a
// visit_request (CASCADE) so a deleted order also removes its tickets.
// customer_name_snapshot + customer_phone_snapshot captured at submission
// time so the team has the identity even if the visit_requests row mutates.
// =============================================================================

export const supportTicketCategoryEnum = pgEnum('support_ticket_category', [
  'complaint',
  'warranty',
  'refund',
  'other',
]);

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
    category: supportTicketCategoryEnum('category').notNull(),
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
    index('support_tickets_claimed_by_idx').on(table.claimedByUserId),
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
