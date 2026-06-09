import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';

// HVA-235: 'support' added for the new Support Team Portal v1 (HVA-231).
// Order matters for migration safety: existing values stay first; new
// values append at the end via `ALTER TYPE ... ADD VALUE` in migration 0064.
export const userRoleEnum = pgEnum('user_role', [
  'sales_executive',
  'captain',
  'super_admin',
  'support',
]);

// HVA-24 additions to the original HVA-14 users table:
// - emailVerified / image: Better-Auth core fields. BA's user shape requires
//   them; we don't actually use email verification (phone is the primary
//   identifier) but the columns must exist for the adapter to work.
// - phoneVerified: phone-number plugin tracks SMS-OTP verification state.
//   We're password-only in Phase 1 so this stays false; HVA-?? OTP issue
//   flips it.
// - mustChangePassword: HVA-14 deferred this to HVA-24 (BA gates it via
//   the /set-password flow in HVA-26).
// - failedLoginAttempts / lockedUntil: rate-limit state per phone. 5 wrong
//   passwords in 15 min → lockedUntil set, BA's signin returns the lockout.
// - lastLoginAt: housekeeping for admin "stale users" report.
//
// Password ITSELF lives in the `account` table per Better-Auth's standard
// model (one user can have multiple credentials over time — phone-password
// today, social OAuth tomorrow). The originally-locked "password_hash on
// users" decision in the HVA-24 brief was incorrect against BA's schema;
// the PR description documents this deviation.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`uuid_generate_v7()`),
    role: userRoleEnum('role').notNull(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 15 }).notNull(),
    email: varchar('email', { length: 255 }),
    emailVerified: boolean('email_verified').notNull().default(false),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    image: text('image'),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    // HVA-248 (HVA-230): CartPlus webhook exec mapping. Admin sets per user
    // via /admin/integrations/cartplus/execs. Webhook resolves the
    // request's exec by matching this against `data.order.created_by.id`.
    portalExecId: bigint('portal_exec_id', { mode: 'number' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('users_phone_unique').on(table.phone),
    uniqueIndex('users_email_unique').on(table.email),
    // HVA-259: matches migration 0068's partial unique index — the DB
    // enforces it but the Drizzle schema previously didn't declare it.
    uniqueIndex('users_portal_exec_id_unique_idx')
      .on(table.portalExecId)
      .where(sql`${table.portalExecId} IS NOT NULL`),
  ],
);
