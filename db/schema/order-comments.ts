import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { visitRequests } from './visits';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): order_comments — per-order thread
// =============================================================================
//
// Append-only Slack-thread-style comments pinned to one visit_request.
// No edit, no delete; the timeline is the historical record. parent_comment_id
// supports a single-level reply nest. mentions is JSON array of user ids
// the author @-tagged at write time.
// =============================================================================

export const orderComments = pgTable(
  'order_comments',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    requestId: uuid('request_id')
      .notNull()
      .references(() => visitRequests.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    parentCommentId: uuid('parent_comment_id').references(
      (): AnyPgColumn => orderComments.id,
      { onDelete: 'restrict' },
    ),
    body: text('body').notNull(),
    mentions: jsonb('mentions').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('order_comments_request_created_idx').on(
      table.requestId,
      table.createdAt,
    ),
    index('order_comments_author_idx').on(table.authorUserId),
    index('order_comments_parent_idx').on(table.parentCommentId),
    check(
      'order_comments_body_length',
      sql`char_length(${table.body}) BETWEEN 1 AND 2000`,
    ),
  ],
);
