import { sql } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

// =============================================================================
// HVA-73 PR 1: notes — append-only polymorphic timeline
// =============================================================================
//
// Polymorphic over target_type:
//   'request' → target_id points at visit_requests.id
//   'contact' → target_id points at leads.id
//
// No DB FK on target_id (postgres lacks polymorphic FKs); server actions
// validate target existence before insert. Append-only by design:
//   - no updated_at
//   - no is_deleted / is_archived
//   - no soft-delete tombstones
//
// UI ships in PR 2 (request banner refactor + timeline render) and PR 3
// (contact timeline render + write action). This file lands the schema
// + Drizzle types so the runtime is ready when those PRs go up.
// =============================================================================

export const noteTargetTypeEnum = pgEnum('note_target_type', [
  'request',
  'contact',
]);

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    targetType: noteTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    body: text('body').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Supports `WHERE target_type=? AND target_id=? ORDER BY created_at DESC`
    // — the timeline query for PR 2 / PR 3. Direction is DESC so the
    // planner doesn't need a sort.
    index('notes_target_timeline_idx').on(
      table.targetType,
      table.targetId,
      table.createdAt.desc(),
    ),
  ],
);
