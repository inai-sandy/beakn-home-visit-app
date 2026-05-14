import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { visitRequests } from './visits';

// Columns from HVA-77 (exec write) + HVA-94 (admin reply), spec §7.
export const adminHelpMessages = pgTable(
  'admin_help_messages',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    execUserId: uuid('exec_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // 10-500 chars validated app-side.
    message: text('message').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),

    // Admin reply (reply-once semantics enforced app-side per spec §7).
    repliedMessage: text('replied_message'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    repliedByAdminId: uuid('replied_by_admin_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_help_messages_request_idx').on(table.requestId),
    index('admin_help_messages_exec_idx').on(table.execUserId),
    index('admin_help_messages_sent_at_idx').on(table.sentAt),
    // Partial-style index for the admin inbox "pending reply" filter (replied_at IS NULL).
    index('admin_help_messages_pending_reply_idx').on(table.repliedAt),
  ],
);
